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
import { readFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAgentRunner, MERGER_TOOLS } from '../lib/agent-runner.mjs'
import { runReviewAudit, runVerifyAudit } from '../lib/audit-agents.mjs'
import { productFromRepo } from '../lib/deploy.mjs'
import {
  readTrail,
  evidenceReady,
  mergeTicket,
  missingEvidenceAxes,
  serializeTrail,
} from '../lib/evidence.mjs'
import { createGithub } from '../lib/github.mjs'
import { git } from '../lib/git.mjs'
import { runHelper } from '../lib/helper.mjs'
import { parentCustomer, parentRequirement } from '../lib/ignition.mjs'
import { createNotifier } from '../lib/notify.mjs'
import { previewNeeded, startPreview, stopPreview } from '../lib/preview.mjs'
import { localPreviewDir, writeLocalPreviewEnv } from './preview.mjs'

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

function defaultPreview({ customer, product, pr }) {
  return {
    async start({ ticket, ticketBranch, repoDir, headSha }) {
      const image = process.env.AFK_PREVIEW_IMAGE
      const commitAt = await git(repoDir, ['log', '-1', '--format=%cI', headSha]).catch(() => '')
      return startPreview({
        ticket,
        pr: pr || ticket.number,
        customer,
        product,
        baseBranch: ticketBranch,
        worktree: repoDir,
        repoDir,
        ref: headSha,
        helper: runHelper,
        ...(image ? { buildImage: async () => image } : {}),
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

function auditGaps(rows = []) {
  const axes = missingEvidenceAxes(rows)
  const gaps = []
  if (axes.verify) gaps.push('verify')
  if (axes.reviewStandard || axes.reviewSpec) gaps.push('review')
  return gaps
}

/** 预览只起一次：证据补齐用掉以后，合并阶段复用同一套，合完再销毁。 */
function cachedPreview(preview) {
  let started = null
  return {
    needed: preview?.needed,
    async start(args) {
      if (!started) started = await preview.start(args)
      return started
    },
    async stop(args) {
      try {
        return await preview.stop(args)
      } finally {
        started = null
      }
    },
    startedAddress() {
      return started?.ok ? started.address || '' : ''
    },
  }
}

async function notifyAuditIncident({ notifier, ticket, problems }) {
  if (typeof notifier?.send !== 'function') return
  const at = new Date().toISOString()
  try {
    await notifier.send({
      v: 1,
      key: `#${ticket.number}:出事:验证评审修不过:${at}`,
      event: '出事',
      occurred_at: at,
      link: ticket.htmlUrl || '',
      data: {
        customer: ticket.customer,
        requirement: ticket.requirement,
        reason: '验证评审修不过',
        tried: problems.join('；') || '证据补齐失败',
      },
    })
  } catch {
    // 通知失败不改变判断。
  }
}

/**
 * 合并前补齐四样证据：缺 verify 或 review 就先起预览，跑对应的 agent 写 trail，
 * 再读一遍。跑不过就销毁预览、发「出事」、返回 evidence_not_ready。
 *
 * @returns {Promise<{ok: boolean, trail?: object[], reason?: string, missing?: string[], problems?: string[], previewStarted?: boolean}>}
 */
export async function ensureEvidenceBeforeMerge({
  repoDir,
  ticket,
  ticketNumber,
  branch,
  runner,
  preview,
  notifier,
  now,
} = {}) {
  let rows = await readTrail({ repoDir, ticket: ticketNumber })
  const gaps = auditGaps(rows)
  if (gaps.length === 0) return { ok: true, trail: rows }

  let started = null
  if (previewNeeded({ trail: serializeTrail(rows) }) && typeof preview?.start === 'function') {
    const headSha = await git(repoDir, ['rev-parse', branch])
    started = await preview
      .start({ repoDir, ticket, ticketBranch: branch, headSha, risk: 'normal' })
      .catch((error) => ({ ok: false, error: errorText(error) }))
    if (!started?.ok) {
      const problems = [`预览起不来：${started?.error || '未知原因'}`]
      await notifyAuditIncident({ notifier, ticket, problems })
      return { ok: false, reason: 'evidence_not_ready', missing: gaps, problems }
    }
  }

  const extraBrief =
    started?.ok && started.url
      ? `预览：${started.url}（用户名 ${started.user}，密码 ${started.password}）`
      : ''
  const problems = []
  try {
    if (gaps.includes('verify')) {
      const audit = await runVerifyAudit({
        repoDir,
        ticket: ticketNumber,
        branch,
        runner,
        extraBrief,
        now,
      })
      if (!audit.ok) problems.push(...(audit.problems.length ? audit.problems : ['验证没过']))
    }
    if (gaps.includes('review')) {
      const audit = await runReviewAudit({
        repoDir,
        ticket: ticketNumber,
        branch,
        mode: 'all',
        runner,
        extraBrief,
        now,
      })
      if (!audit.ok) problems.push(...(audit.problems.length ? audit.problems : ['评审没过']))
    }
  } catch (error) {
    problems.push(errorText(error))
  }

  rows = await readTrail({ repoDir, ticket: ticketNumber })
  if (problems.length) {
    if (started?.ok) {
      await preview.stop({ address: started.address, ticket, repoDir }).catch(() => {})
    }
    await notifyAuditIncident({ notifier, ticket, problems })
    return { ok: false, reason: 'evidence_not_ready', missing: auditGaps(rows), problems }
  }
  return { ok: true, trail: rows, previewStarted: Boolean(started?.ok) }
}

async function runMerge(options, deps = {}) {
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
  if (!deps.gh && !token) throw new Error('缺 GITHUB_TOKEN 或 GH_TOKEN')
  const { owner, repo } = deps.owner && deps.repo ? deps : await repoSlug({ repoDir, options })
  const gh = deps.gh || createGithub({ token })
  const issue = deps.issue || (await gh.getIssue({ owner, repo, number: ticketNumber }))
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

  const runner =
    deps.runner ||
    createAgentRunner({
      command: options['agent-command'] || process.env.AFK_AGENT_COMMAND || 'claude',
    })
  const mergerInstructions = await readFile(join(AGENTS_DIR, 'merger.md'), 'utf8')

  const product = productFromRepo({
    repo,
    customer: ticket.customer,
    explicit: options.product,
  })
  if (!product) {
    throw new Error(
      `软件简称拼不出来：传 --product，或让仓名是 ${ticket.customer}-<软件简称>；不猜`,
    )
  }

  const notifier = deps.notifier || createNotifier()
  const previewImpl =
    deps.preview ||
    defaultPreview({
      customer: ticket.customer,
      product,
      pr: options.pr ? Number(options.pr) : ticketNumber,
    })
  const preview = cachedPreview(previewImpl)
  const headSha = await git(repoDir, ['rev-parse', ticketBranch])

  const ensured = await ensureEvidenceBeforeMerge({
    repoDir,
    ticket,
    ticketNumber,
    branch: ticketBranch,
    runner,
    preview,
    notifier,
    now: deps.now,
  })
  if (!ensured.ok) return { output: ensured, exitCode: 1 }
  const trail = ensured.trail

  const result = await mergeTicket({
    repoDir,
    ticketBranch,
    reqBranch,
    ticket,
    trail,
    verifier: async ({ headSha: mergedHead }) => {
      const audit = await runVerifyAudit({
        repoDir,
        ticket: ticketNumber,
        branch: mergedHead,
        runner,
      })
      return {
        ok: audit.ok,
        problems: audit.problems,
        evidence: audit.evidence.join(','),
      }
    },
    review: async ({ headSha: reviewHead, mode }) => {
      const audit = await runReviewAudit({
        repoDir,
        ticket: ticketNumber,
        branch: reviewHead,
        mode: mode || 'all',
        runner,
      })
      return { ok: audit.ok, problems: audit.problems, decision: audit.decision }
    },
    merger: async ({ files }) => {
      const run = await runner.run({
        name: `merge-${ticketNumber}`,
        cwd: repoDir,
        allowedTools: MERGER_TOOLS,
        brief: mergerBrief({ files, instructions: mergerInstructions }),
      })
      return parseVerdict(run, { okWord: 'merged', label: '合并者' })
    },
    preview,
    notifier,
    github: gh,
  })

  // 合并提前返回（已合过、分支不存在等）时，补齐证据阶段起的预览还没人销毁。
  const leftover = preview.startedAddress()
  if (leftover) {
    await preview.stop({ address: leftover, ticket, repoDir }).catch(() => {})
  }

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

export { mergerBrief, parseVerdict, runMerge }
