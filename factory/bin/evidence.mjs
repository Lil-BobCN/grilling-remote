#!/usr/bin/env node
/**
 * 合需求分支的命令行入口。D5 用。
 *
 *   node factory/bin/evidence.mjs merge --repo-dir <路径> --ticket <票号> \
 *     --ticket-branch <分支> --req-branch <分支> [--dry-run]
 *
 * 可选：
 *   --owner --repo        不传就从 origin 的 GitHub 地址解析
 *   --parent             父工单号；不传就在 open 的「状态:开发中」里找
 *   --pr                 预览地址要的 PR 号；默认用票号
 *   --customer --product 预览地址要的客户简称和软件简称
 *   --agent-command      默认 claude
 *
 * 默认注入真实 git、agent runner、预览和通知。测试不跑这个入口。
 */
import { execFile } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { createAgentRunner } from '../lib/agent-runner.mjs'
import { readTrail, evidenceReady, mergeTicket } from '../lib/evidence.mjs'
import { createGithub } from '../lib/github.mjs'
import { git } from '../lib/git.mjs'
import { parentCustomer, parentRequirement } from '../lib/ignition.mjs'
import { createNotifier } from '../lib/notify.mjs'
import { startPreview, stopPreview } from '../lib/preview.mjs'
import { parseParentAcceptance } from '../lib/tickets.mjs'
import { localPreviewDir, writeLocalPreviewEnv } from './preview.mjs'

const execFileAsync = promisify(execFile)
const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const AGENTS_DIR = join(REPO_ROOT, 'factory', 'agents')
const USAGE = `用法：
  node factory/bin/evidence.mjs merge --repo-dir <路径> --ticket <票号> --ticket-branch <分支> --req-branch <分支> [--dry-run]
  可选：--owner --repo --parent --pr --customer --product --agent-command`

function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

function parseArgs(argv) {
  const options = { dryRun: false }
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

async function repoSlug({ repoDir, options }) {
  if (options.owner && options.repo) return { owner: options.owner, repo: options.repo }
  const url = await git(repoDir, ['remote', 'get-url', 'origin']).catch(() => '')
  const match = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url)
  if (!match) throw new Error('解析不到 GitHub owner/repo，用 --owner 和 --repo 指定')
  return { owner: match[1], repo: match[2] }
}

function labelNames(issue) {
  return (issue?.labels || []).map((label) => (typeof label === 'string' ? label : label?.name))
}

async function findParent({ gh, owner, repo, ticketNumber }) {
  const parents = await gh.listIssues({ owner, repo, state: 'open', labels: '状态:开发中' })
  for (const issue of parents) {
    if (issue.number === Number(ticketNumber)) continue
    const children = await gh.listSubIssues({ owner, repo, number: issue.number }).catch(() => [])
    if (children.some((child) => child.number === Number(ticketNumber))) return issue
  }
  return null
}

function tail(text, limit = 400) {
  const value = String(text ?? '').trim()
  return value.length > limit ? value.slice(-limit) : value
}

function acceptanceText(body) {
  const items = parseParentAcceptance(body)
  return items.length ? items.map((item) => `- ${item}`).join('\n') : '（票里没写验收条件）'
}

function verifierBrief({ ticket, issue, headSha }) {
  return [
    '你是验证 agent，没写过这份代码。',
    '像真实顾客一样启动应用，走关键路径，改前改后各留截图或 trace，逐条过验收条件。',
    '只报问题，不改代码。先读 .claude/skills/verify/SKILL.md 和 docs/agents/feature-map.md。',
    '',
    `票：#${ticket.number} ${ticket.title}`,
    `head：${headSha}`,
    '',
    '验收条件：',
    acceptanceText(issue.body),
    '',
    '最后一行写 `AFK_VERDICT: pass` 或 `AFK_VERDICT: fail 一句话原因`。',
  ].join('\n')
}

async function reviewBrief({ ticket, issue, headSha, mode, instructions }) {
  return [
    instructions,
    '',
    `模式：${mode}`,
    `票：#${ticket.number} ${ticket.title}`,
    `head：${headSha}`,
    '',
    '验收条件：',
    acceptanceText(issue.body),
    '',
    '只报问题，不改代码。意见按采纳、考虑、记下、驳回四类分开。',
    '最后一行写 `AFK_VERDICT: pass` 或 `AFK_VERDICT: fail 一句话原因`。',
  ].join('\n')
}

function mergerBrief({ files, instructions }) {
  return [
    instructions,
    '',
    '冲突文件：',
    ...files.map((file) => `- ${file}`),
    '',
    '解完把文件改好，不要提交。最后一行写 `AFK_VERDICT: merged` 或 `AFK_VERDICT: blocked 原因`。',
  ].join('\n')
}

function parseVerdict(result, { okWord, label }) {
  if (!result.ok) {
    return {
      ok: false,
      problems: [`${label} agent 退出码 ${result.code}：${tail(result.stderr || result.stdout)}`],
    }
  }
  const line = String(result.stdout || '')
    .split(/\r?\n/)
    .reverse()
    .find((row) => row.startsWith('AFK_VERDICT:'))
  if (!line) return { ok: false, problems: [`${label} agent 没写 AFK_VERDICT`] }
  const text = line.slice('AFK_VERDICT:'.length).trim()
  if (new RegExp(`^${okWord}\\b`, 'i').test(text)) {
    return { ok: true, decision: text, evidence: tail(result.stdout, 300) }
  }
  return { ok: false, problems: [text || `${label} agent 判不过`] }
}

function helperCommand() {
  if (process.env.AFK_HELPER?.trim()) return process.env.AFK_HELPER.trim().split(/\s+/)
  if (process.env.AFK_SSH_TARGET?.trim()) {
    return ['ssh', process.env.AFK_SSH_TARGET.trim(), 'sudo', '/usr/local/sbin/afk-product']
  }
  return ['afk-product']
}

async function runHelper(args) {
  const [command, ...prefix] = helperCommand()
  const result = await execFileAsync(command, [...prefix, ...args], {
    maxBuffer: 8 * 1024 * 1024,
    timeout: 70 * 60 * 1000,
  }).catch((error) => {
    throw new Error(String(error.stderr || error.message || '').trim())
  })
  return String(result.stdout ?? '')
}

function defaultPreview({ customer, product, pr }) {
  return {
    async start({ ticket, ticketBranch, repoDir, headSha }) {
      const image = process.env.AFK_PREVIEW_IMAGE
      if (!image) return { ok: false, error: '缺 AFK_PREVIEW_IMAGE，起不了预览' }
      const commitAt = await git(repoDir, ['log', '-1', '--format=%cI', headSha]).catch(() => '')
      return startPreview({
        ticket,
        pr: pr || ticket.number,
        customer,
        product,
        baseBranch: ticketBranch,
        worktree: repoDir,
        helper: runHelper,
        buildImage: async () => image,
        writeLocalEnv: async ({ address, user, password, serverEnv }) =>
          writeLocalPreviewEnv({ dir: localPreviewDir(), address, info: { user, password, env: serverEnv } }),
        seed: process.env.AFK_PREVIEW_SEED || '',
        commitAt,
      })
    },
    async stop({ address }) {
      return stopPreview({
        address,
        helper: runHelper,
        removeLocalEnv: async ({ address: target }) =>
          rm(join(localPreviewDir(), `${target}.env`), { force: true }),
      })
    },
  }
}

async function runMerge(options) {
  const repoDir = options['repo-dir'] || process.cwd()
  const ticketNumber = Number(options.ticket)
  if (!Number.isInteger(ticketNumber) || ticketNumber <= 0) throw new Error(USAGE)
  if (!options['ticket-branch'] || !options['req-branch']) throw new Error(USAGE)
  const ticketBranch = options['ticket-branch']
  const reqBranch = options['req-branch']

  if (options.dryRun) {
    const trail = await readTrail({ repoDir, ticket: ticketNumber })
    const headSha = await git(repoDir, ['rev-parse', ticketBranch]).catch(() => '')
    if (!headSha) throw new Error(`分支不存在：${ticketBranch}`)
    const check = await evidenceReady({ trail, headSha, repoDir })
    return { output: { ok: check.ready, headSha, ...check }, exitCode: check.ready ? 0 : 1 }
  }

  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || ''
  if (!token) throw new Error('缺 GITHUB_TOKEN 或 GH_TOKEN')
  const { owner, repo } = await repoSlug({ repoDir, options })
  const gh = createGithub({ token })
  const issue = await gh.getIssue({ owner, repo, number: ticketNumber })
  const parentIssue = options.parent
    ? await gh.getIssue({ owner, repo, number: Number(options.parent) })
    : await findParent({ gh, owner, repo, ticketNumber })
  if (!parentIssue) throw new Error('找不到父工单，用 --parent 指定')

  const comments = await gh.listComments({ owner, repo, number: parentIssue.number }).catch(() => [])
  const round = comments.filter((row) => String(row.body).startsWith('进度 v1｜')).length + 1
  const ticket = {
    number: issue.number,
    title: issue.title,
    body: issue.body,
    owner,
    repo,
    parentNumber: parentIssue.number,
    customer: options.customer || parentCustomer(parentIssue.body) || parentIssue.title,
    requirement: parentRequirement(parentIssue.body) || parentIssue.title,
    path: labelNames(parentIssue).includes('大小:小需求') ? '小需求' : '其余',
    round,
    htmlUrl: issue.html_url,
  }

  const runner = createAgentRunner({
    command: options['agent-command'] || process.env.AFK_AGENT_COMMAND || 'claude',
  })
  const [reviewInstructions, mergerInstructions] = await Promise.all([
    readFile(join(AGENTS_DIR, 'review.md'), 'utf8'),
    readFile(join(AGENTS_DIR, 'merger.md'), 'utf8'),
  ])

  const headSha = await git(repoDir, ['rev-parse', ticketBranch])
  const trail = await readTrail({ repoDir, ticket: ticketNumber })

  const result = await mergeTicket({
    repoDir,
    ticketBranch,
    reqBranch,
    ticket,
    trail,
    verifier: async ({ headSha: mergedHead }) => {
      const run = await runner.run({
        name: `verify-${ticketNumber}-${mergedHead.slice(0, 8)}`,
        cwd: repoDir,
        brief: verifierBrief({ ticket, issue, headSha: mergedHead }),
      })
      return parseVerdict(run, { okWord: 'pass', label: '验证' })
    },
    review: async ({ headSha: reviewHead, mode }) => {
      const run = await runner.run({
        name: `review-${ticketNumber}-${mode}`,
        cwd: repoDir,
        brief: await reviewBrief({ ticket, issue, headSha: reviewHead, mode, instructions: reviewInstructions }),
      })
      return parseVerdict(run, { okWord: 'pass', label: '评审' })
    },
    merger: async ({ files }) => {
      const run = await runner.run({
        name: `merge-${ticketNumber}`,
        cwd: repoDir,
        brief: mergerBrief({ files, instructions: mergerInstructions }),
      })
      return parseVerdict(run, { okWord: 'merged', label: '合并者' })
    },
    preview: defaultPreview({
      customer: ticket.customer,
      product: options.product || ticket.requirement,
      pr: options.pr ? Number(options.pr) : ticketNumber,
    }),
    notifier: createNotifier(),
    github: gh,
  })

  return { output: result, exitCode: result.ok ? 0 : 1 }
}

async function main() {
  const [command, ...argv] = process.argv.slice(2)
  try {
    if (command !== 'merge') {
      process.stderr.write(`${USAGE}\n`)
      process.exitCode = 2
      return
    }
    const options = parseArgs(argv)
    const { output, exitCode } = await runMerge(options)
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

export { parseVerdict, verifierBrief, reviewBrief, mergerBrief }
