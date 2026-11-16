#!/usr/bin/env node
/**
 * 收尾合并的命令行入口。E1 用。
 *
 *   node factory/bin/finish.mjs finish --owner <owner> --repo <repo> \
 *     --parent <父工单号> --req-branch <分支> [--main main] [--dry-run]
 *
 * 默认注入真实 git、gh、agent runner 和 notifier。
 * `--dry-run` 只读：打印四栏和检查结果，不建 PR、不合、不通知。
 * trail 从工作树读，`--dry-run` 要在需求分支的 worktree 里跑；真跑会先切到需求分支。
 */
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAgentRunner } from '../lib/agent-runner.mjs'
import {
  collectRequirementState,
  finishRequirement,
  previewRequirement,
} from '../lib/finish.mjs'
import { createGithub } from '../lib/github.mjs'
import { git } from '../lib/git.mjs'
import { createNotifier } from '../lib/notify.mjs'
import { parseParentAcceptance } from '../lib/tickets.mjs'
import { parseVerdict } from './evidence.mjs'

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const AGENTS_DIR = join(REPO_ROOT, 'factory', 'agents')
const USAGE = `用法：
  node factory/bin/finish.mjs finish --owner <owner> --repo <repo> --parent <父工单号> --req-branch <分支> [--main main] [--dry-run]`

function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

function parseArgs(argv) {
  const options = { main: 'main', dryRun: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--dry-run') {
      options.dryRun = true
      continue
    }
    if (!arg.startsWith('--')) throw new Error(`不认识的参数：${arg}`)
    const key = arg.slice(2)
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`${arg} 后面要跟值`)
    options[key] = value
    index += 1
  }
  return options
}

function tail(text, limit = 400) {
  const value = String(text ?? '').trim()
  return value.length > limit ? value.slice(-limit) : value
}

function acceptanceText(parentIssue) {
  const items = parseParentAcceptance(parentIssue?.body)
  return items.length ? items.map((item) => `- ${item}`).join('\n') : '（父工单没写验收条件）'
}

function parentBlock(parentIssue) {
  return [`父工单 #${parentIssue.number} ${parentIssue.title || ''}`.trim(), '', String(parentIssue.body || '')].join(
    '\n',
  )
}

function reviewBrief({ instructions, parentIssue, reqBranch, small }) {
  const lines = [
    instructions,
    '',
    `需求分支：${reqBranch}`,
    '',
    parentBlock(parentIssue),
    '',
    '验收条件：',
    acceptanceText(parentIssue),
  ]
  if (small) {
    lines.push('', '这是小需求：Spec 轴读父工单的「客户确认的结论」「验收条件」「不做清单」，不读 spec。')
  }
  return lines.join('\n')
}

function fixerBrief({ instructions, reqBranch, findings }) {
  return [
    instructions,
    '',
    `需求分支：${reqBranch}`,
    '',
    '收尾评审报的问题：',
    ...(findings.length ? findings.map((finding) => `- ${finding}`) : ['- 见上一条评审意见']),
    '',
    '在一个提交里统一修完，提交前缀 `FACTORY:`。只改这些问题，不扩大范围。',
  ].join('\n')
}

function verifyBrief({ instructions, parentIssue, reqBranch }) {
  return [
    instructions,
    '',
    `需求分支：${reqBranch}`,
    '',
    parentBlock(parentIssue),
    '',
    '验收条件：',
    acceptanceText(parentIssue),
    '',
    '最后一行写 `AFK_VERDICT: pass` 或 `AFK_VERDICT: fail 一句话原因`。',
  ].join('\n')
}

function safeName(value) {
  return String(value || 'branch').replace(/[^a-zA-Z0-9._-]+/g, '-')
}

/** 合并后清理绑定在需求分支上的 worktree。当前目录不删。 */
export async function cleanupRequirement({ repoDir, reqBranch }) {
  const output = await git(repoDir, ['worktree', 'list', '--porcelain']).catch(() => '')
  const current = resolve(repoDir)
  for (const block of output.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/)
    const path = lines.find((line) => line.startsWith('worktree '))?.slice('worktree '.length)
    const branch = lines.find((line) => line.startsWith('branch '))?.slice('branch '.length)
    if (!path || branch !== `refs/heads/${reqBranch}`) continue
    if (resolve(path) === current) continue
    await git(repoDir, ['worktree', 'remove', '--force', path]).catch(() => {})
  }
  await git(repoDir, ['worktree', 'prune']).catch(() => {})
}

/**
 * @param {object} options `parseArgs` 的结果
 * @param {object} [deps] 测试或别的入口注入 `gh`、`runner`、`notifier`
 */
export async function runFinish(options, deps = {}) {
  const repoDir = options['repo-dir'] || process.cwd()
  const owner = options.owner
  const repo = options.repo
  const parentNumber = Number(options.parent)
  const reqBranch = options['req-branch']
  const mainBranch = options.main || 'main'
  if (!owner || !repo || !Number.isInteger(parentNumber) || parentNumber <= 0 || !reqBranch) {
    throw new Error(USAGE)
  }

  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || ''
  if (!deps.gh && !token) throw new Error('缺 GITHUB_TOKEN 或 GH_TOKEN')
  const gh = deps.gh || createGithub({ token })

  if (!options.dryRun) {
    const current = await git(repoDir, ['branch', '--show-current']).catch(() => '')
    if (current !== reqBranch) await git(repoDir, ['checkout', reqBranch])
  }

  const state = await collectRequirementState({
    gh,
    owner,
    repo,
    parent: parentNumber,
    repoDir,
  })

  const checks = {
    parent: parentNumber,
    subIssues: state.subIssues.map((ticket) => ({
      number: ticket.number,
      state: ticket.state,
      merged: ticket.merged,
    })),
    allClosed: state.allClosed,
    unmerged: state.unmerged,
  }

  if (options.dryRun) {
    if (!state.allClosed) {
      return { output: { dryRun: true, ok: false, reason: 'open_sub_tickets', checks }, exitCode: 1 }
    }
    if (state.unmerged.length) {
      return { output: { dryRun: true, ok: false, reason: 'unmerged_sub_tickets', checks }, exitCode: 1 }
    }
    const preview = await previewRequirement({ repoDir, parent: state, reqBranch, mainBranch })
    return {
      output: {
        dryRun: true,
        ok: true,
        checks,
        risk: preview.risk,
        pr: { title: preview.title, body: preview.body },
      },
      exitCode: 0,
    }
  }

  const runner =
    deps.runner ||
    createAgentRunner({ command: options['agent-command'] || process.env.AFK_AGENT_COMMAND || 'claude' })
  const [reviewInstructions, verifyInstructions] = await Promise.all([
    readFile(join(AGENTS_DIR, 'finish-review.md'), 'utf8'),
    readFile(join(AGENTS_DIR, 'verify.md'), 'utf8'),
  ])

  const review = async ({ repoDir: dir, branch, parent, small }) => {
    const run = await runner.run({
      name: `finish-review-${safeName(branch)}`,
      cwd: dir,
      brief: reviewBrief({ instructions: reviewInstructions, parentIssue: parent, reqBranch: branch, small }),
    })
    return parseVerdict(run, { okWord: 'pass', label: '收尾评审' })
  }

  const fixer = async ({ repoDir: dir, branch, findings }) => {
    const run = await runner.run({
      name: `finish-fix-${safeName(branch)}`,
      cwd: dir,
      brief: fixerBrief({ instructions: reviewInstructions, reqBranch: branch, findings }),
    })
    return run.ok ? { ok: true } : { ok: false, problems: [tail(run.stderr || run.stdout)] }
  }

  const verify = async ({ repoDir: dir, branch, parent }) => {
    const run = await runner.run({
      name: `finish-verify-${safeName(branch)}`,
      cwd: dir,
      brief: verifyBrief({ instructions: verifyInstructions, parentIssue: parent, reqBranch: branch }),
    })
    return parseVerdict(run, { okWord: 'pass', label: '收尾验证' })
  }

  const openPr = async ({ owner, repo, base, head, title, body }) => {
    const existing =
      typeof gh.findPullByHead === 'function'
        ? await gh.findPullByHead({ owner, repo, head }).catch(() => null)
        : null
    if (existing) return existing
    return gh.request('POST', `/repos/${owner}/${repo}/pulls`, { base, head, title, body })
  }

  const mergePr = async ({ owner, repo, pr, method }) => {
    const number = pr && typeof pr === 'object' ? pr.number : Number(pr)
    return gh.mergePull({ owner, repo, number, mergeMethod: method })
  }

  const result = await finishRequirement({
    repoDir,
    owner,
    repo,
    parent: state,
    reqBranch,
    mainBranch,
    review,
    verify,
    fixer,
    openPr,
    mergePr,
    notifier: deps.notifier || createNotifier(),
    cleanup: cleanupRequirement,
  })

  return { output: result, exitCode: result.ok ? 0 : 1 }
}

async function main() {
  const [command, ...argv] = process.argv.slice(2)
  try {
    if (command !== 'finish') {
      process.stderr.write(`${USAGE}\n`)
      process.exitCode = 2
      return
    }
    const { output, exitCode } = await runFinish(parseArgs(argv))
    process.stdout.write(`${JSON.stringify(output)}\n`)
    if (exitCode !== 0) process.exitCode = exitCode
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: errorText(error) })}\n`)
    process.exitCode = 2
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}

export { parseArgs }
