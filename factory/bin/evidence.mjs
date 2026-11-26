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
import { fixerRoundsUsed, runReviewAudit, runVerifyAudit } from '../lib/audit-agents.mjs'
import { CLEAN_CHECK_MARKER, verifyInCleanCheckout } from '../lib/clean-check.mjs'
import { productFromRepo } from '../lib/deploy.mjs'
import {
  appendTrail,
  assessMerge,
  diffInfo,
  freshTestRows,
  freshVerifiers,
  interrogateStatus,
  readTrail,
  mergeTicket,
  missingEvidenceAxes,
  resolveMaxFixRounds,
  riskLevel,
  serializeTrail,
  verifyPlan,
} from '../lib/evidence.mjs'
import { createGithub } from '../lib/github.mjs'
import { git } from '../lib/git.mjs'
import { runHelper } from '../lib/helper.mjs'
import { parentCustomer, parentRequirement } from '../lib/ignition.mjs'
import { createNotifier, sendEvent } from '../lib/notify.mjs'
import { previewNeeded, startPreview, stopPreview } from '../lib/preview.mjs'
import { localPreviewDir, writeLocalPreviewEnv } from './preview.mjs'
import { clientRound } from '../lib/progress.mjs'

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const AGENTS_DIR = join(REPO_ROOT, 'factory', 'agents')
const INTERROGATE_MISSING = '高风险评审（interrogate）'
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

function auditGaps(rows = [], { interrogate = false } = {}) {
  const missingAxes = missingEvidenceAxes(rows)
  const gaps = []
  if (missingAxes.verify) gaps.push('verify')
  if (missingAxes.reviewStandard || missingAxes.reviewSpec) gaps.push('review')
  if (interrogate) gaps.push(INTERROGATE_MISSING)
  return gaps
}

/** 已用的验证者 id 之外，按顺序取 count 个新 id（v1、v2…）。 */
function nextVerifierIds(existing = [], count = 0) {
  const ids = []
  let index = 1
  while (ids.length < count) {
    const id = `v${index}`
    if (!existing.includes(id)) ids.push(id)
    index += 1
  }
  return ids
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

async function notifyAuditIncident({ notifier, ticket, owner = '', repo = '', problems }) {
  if (typeof notifier?.send !== 'function') return
  try {
    await sendEvent(notifier, {
      owner,
      repo,
      subject: `#${ticket.number}`,
      event: '出事',
      scope: '验证评审修不过:证据补齐',
      now: new Date(),
      link: ticket.htmlUrl || '',
      data: {
        customer: ticket.customer,
        requirement: ticket.requirement,
        reason: '验证评审修不过',
        tried: problems.join('；') || '证据补齐失败',
        round: ticket.round ?? 1,
      },
    })
  } catch {
    // 通知失败不改变判断。
  }
}

/** 每轮修复结果交给调用方；回调抛错不影响判定。 */
async function reportReviewRound({ onReviewRound, round, ok, problems = [], stage = '' }) {
  if (typeof onReviewRound !== 'function') return
  try {
    await onReviewRound({ round, ok, problems, stage })
  } catch {
    // 进度写不进去不改评审结论。
  }
}

/** 审计 agent 报认证失败时的问题行；调用方据此停下整条管线。 */
function authProblems(audit) {
  return audit?.problems?.length ? audit.problems : ['认证失败']
}

/**
 * 合并前补齐四样证据：缺 verify 或 review 就先起预览，跑对应的 agent 写 trail，
 * 再读一遍。给了 baseBranch 时按 riskLevel/verifyPlan 算验证队要几个，
 * 按 fresh 验证者 id 的差额补跑；高风险票还要求一条指向当前 head 的 interrogate pass。
 *
 * 验证前还会在干净检出里跑一次确定性测试（`cleanCheck`，默认
 * `verifyInCleanCheckout`）：有 lockfile 用 `npm ci`，没有用 `npm install`，
 * 再跑测试。结果按 head 记成 test 行，旧 head 的 pass 不算数。干净检查和验证
 * agent 的问题与评审问题放进同一个 failed，交给同一条 fixer 路径。
 *
 * 评审、验证或 interrogate 没过时，如果注入了 `fixer`，按轮次修完再复评；默认最多四轮
 * （`maxFixRounds` 或环境变量 `AFK_MAX_FIX_ROUNDS` 可改，跨调度轮次按票分支上的修复
 * 提交累计）。每次修完 head 变了，按新 head 重算问题：干净检查、验证、standard/spec
 * 和 interrogate 都重跑；复验也没过时，复验问题同样交给下一轮 fixer，不提前停。
 * 每轮结果交给 `onReviewRound`，调度器用它写进度行。
 * 修不过或没注入 fixer 就销毁预览、发「出事」、返回 evidence_not_ready。
 * 轮次用完且同一 head 已经判过 interrogate fail 时不再重跑，直接返回。
 *
 * @returns {Promise<{ok: boolean, trail?: object[], reason?: string, missing?: string[], problems?: string[], previewStarted?: boolean}>}
 */
export async function ensureEvidenceBeforeMerge({
  repoDir,
  ticket,
  ticketNumber,
  owner = '',
  repo = '',
  branch,
  baseBranch,
  runner,
  preview,
  notifier,
  now,
  fixer,
  onReviewRound,
  maxFixRounds = resolveMaxFixRounds(),
  cleanCheck = verifyInCleanCheckout,
} = {}) {
  let rows = await readTrail({ repoDir, ticket: ticketNumber })
  const gaps = auditGaps(rows)

  let plan = null
  let freshIds = []
  let risk = 'normal'
  const headSha = await git(repoDir, ['rev-parse', branch])
  if (baseBranch) {
    const { files, diffStat } = await diffInfo(repoDir, baseBranch, branch)
    risk = riskLevel({ files, diffStat })
    plan = verifyPlan({ risk, changedLines: diffStat.additions + diffStat.deletions })
    freshIds = await freshVerifiers({ trail: rows, headSha, repoDir })
  }
  const wantsInterrogate = Boolean(plan) && risk === 'high'
  const interrogate = wantsInterrogate
    ? await interrogateStatus({ trail: rows, headSha, repoDir })
    : { pass: true, fail: null }
  const interrogateGap = wantsInterrogate && !interrogate.pass

  const missingVerifiers = plan ? Math.max(0, plan.verifiers - freshIds.length) : 0
  const verifyRuns = gaps.includes('verify')
    ? Math.max(missingVerifiers, plan ? 0 : 1)
    : missingVerifiers
  // 干净检查是确定性门禁：这个 head 还没有 pass 的干净检出 test 行就补跑。
  // 非 Node 仓库由 verifyInCleanCheckout 自己跳过，不记行，下一轮再查一次。
  const cleanCheckEnabled = typeof cleanCheck === 'function'
  const freshCleanChecks = cleanCheckEnabled
    ? (await freshTestRows({ trail: rows, headSha, repoDir })).filter((row) =>
        String(row.why || '').includes(CLEAN_CHECK_MARKER),
      )
    : []
  const needsCleanCheck = cleanCheckEnabled && freshCleanChecks.length === 0
  if (gaps.length === 0 && verifyRuns === 0 && !interrogateGap && !needsCleanCheck) {
    return { ok: true, trail: rows }
  }

  // 轮次用完、同一 head 已经判过 fail：再跑一次要 9–12 分钟，问题不会变。
  if (interrogateGap && interrogate.fail && gaps.length === 0 && verifyRuns === 0) {
    const used = await fixerRoundsUsed({ repoDir, ticket: ticketNumber, branch })
    if (used >= maxFixRounds) {
      const detail = interrogate.fail.evidence ? `：${interrogate.fail.evidence}` : ''
      return {
        ok: false,
        reason: 'evidence_not_ready',
        missing: [INTERROGATE_MISSING],
        problems: [`${INTERROGATE_MISSING}在 head ${headSha} 判过 fail，修复轮次已用完${detail}`],
      }
    }
  }

  let started = null
  if (previewNeeded({ trail: serializeTrail(rows) }) && typeof preview?.start === 'function') {
    started = await preview
      .start({ repoDir, ticket, ticketBranch: branch, headSha, risk: 'normal' })
      .catch((error) => ({ ok: false, error: errorText(error) }))
    if (!started?.ok) {
      const problems = [`预览起不来：${started?.error || '未知原因'}`]
      await notifyAuditIncident({ notifier, ticket, owner, repo, problems })
      return { ok: false, reason: 'evidence_not_ready', missing: gaps, problems }
    }
  }

  const extraBrief =
    started?.ok && started.url
      ? `预览：${started.url}（用户名 ${started.user}，密码 ${started.password}）`
      : ''
  const problems = []
  let authProblem = null
  let authStage = ''
  let aborted = false
  let abortedStage = ''
  const stopOnAuth = (audit, stage) => {
    if (!audit?.authFailure) return false
    authProblem = authProblems(audit)
    authStage = stage
    return true
  }
  const stopOnAbort = (audit, stage) => {
    if (!audit?.aborted) return false
    aborted = true
    abortedStage = stage
    return true
  }
  let interrogateFailed = false

  // 在干净检出里跑确定性门禁。结果记成 test 行，why 里绑当前 head；
  // 失败原因交给 fixer，和评审问题同一条修复路径。
  const runCleanCheck = async () => {
    if (!cleanCheckEnabled) return []
    const head = await git(repoDir, ['rev-parse', branch])
    let result
    try {
      result = await cleanCheck({ repoDir, ref: head, branch, ticket, now })
    } catch (error) {
      return [`干净检查出错：${errorText(error)}`]
    }
    if (!result || typeof result !== 'object') return ['干净检查没有返回结果']
    if (result.skipped) return []
    const boundHead = String(result.headSha || '')
    if (boundHead && !(head.startsWith(boundHead) || boundHead.startsWith(head))) {
      return [
        `干净检查跑在 ${boundHead.slice(0, 8)}，不是当前 head ${head.slice(0, 8)}，这一轮不算`,
      ]
    }
    const ok = result.ok === true
    const cleanProblems = ok
      ? []
      : [
          `干净检查没过（${result.reason || 'check'}）：${(result.missing || []).join('；') || '看日志'}`,
        ]
    try {
      await appendTrail({
        repoDir,
        ticket: ticketNumber,
        ts: now,
        phase: 'test',
        decision: result.command || '干净检查',
        why: `${CLEAN_CHECK_MARKER} head ${boundHead || head}`,
        evidence: result.logPath || (ok ? 'pass' : 'fail'),
        result: ok ? 'pass' : 'fail',
      })
    } catch (error) {
      cleanProblems.push(`干净检查结果没写进 trail：${errorText(error)}`)
    }
    return cleanProblems
  }

  const runReviewRound = async ({ standards }) => {
    const roundProblems = []
    if (standards) {
      const audit = await runReviewAudit({
        repoDir,
        ticket: ticketNumber,
        branch,
        mode: 'all',
        runner,
        extraBrief,
        now,
      })
      if (stopOnAuth(audit, 'review')) return []
      if (stopOnAbort(audit, 'review')) return []
      if (!audit.ok) roundProblems.push(...(audit.problems.length ? audit.problems : ['评审没过']))
    }
    if (wantsInterrogate) {
      const audit = await runReviewAudit({
        repoDir,
        ticket: ticketNumber,
        branch,
        mode: 'interrogate',
        runner,
        extraBrief,
        now,
      })
      if (stopOnAuth(audit, 'review')) return []
      if (stopOnAbort(audit, 'review')) return []
      interrogateFailed = !audit.ok
      if (!audit.ok) {
        roundProblems.push(...(audit.problems.length ? audit.problems : [INTERROGATE_MISSING]))
      }
    }
    return roundProblems
  }

  // 修完 head 变了，旧验证不算数：干净检查先在新 head 重跑，再按计划把验证队补回来。
  const reverifyAfterFix = async () => {
    const cleanProblems = await runCleanCheck()
    if (cleanProblems.length) return cleanProblems
    const fixedHead = await git(repoDir, ['rev-parse', branch])
    if (!plan) {
      const audit = await runVerifyAudit({ repoDir, ticket: ticketNumber, branch, runner, extraBrief, now })
      if (stopOnAuth(audit, 'verify')) return []
      if (stopOnAbort(audit, 'verify')) return []
      return audit.ok ? [] : audit.problems.length ? audit.problems : ['验证没过']
    }
    const trail = await readTrail({ repoDir, ticket: ticketNumber })
    const fresh = await freshVerifiers({ trail, headSha: fixedHead, repoDir })
    const needed = Math.max(0, plan.verifiers - fresh.length)
    const found = []
    for (const verifierId of nextVerifierIds(fresh, needed)) {
      const audit = await runVerifyAudit({
        repoDir,
        ticket: ticketNumber,
        branch,
        verifierId,
        runner,
        extraBrief,
        now,
      })
      if (stopOnAuth(audit, 'verify')) break
      if (stopOnAbort(audit, 'verify')) break
      if (!audit.ok) {
        found.push(...(audit.problems.length ? audit.problems : ['验证没过']))
        break
      }
    }
    return found
  }

  try {
    // 验证问题（确定性干净检查 + 验证 agent）和评审问题放进同一个 failed，
    // 修完按当前 head 重算；旧 head 的问题不留在里面多挡一轮。
    let failed = []
    let failedStage = ''
    if (!authProblem && needsCleanCheck) {
      const cleanProblems = await runCleanCheck()
      if (cleanProblems.length) {
        failed.push(...cleanProblems)
        failedStage = 'verify'
      }
    }
    if (!authProblem && verifyRuns > 0) {
      const ids = plan ? nextVerifierIds(freshIds, verifyRuns) : ['']
      for (const verifierId of ids) {
        const audit = await runVerifyAudit({
          repoDir,
          ticket: ticketNumber,
          branch,
          verifierId,
          runner,
          extraBrief,
          now,
        })
        if (stopOnAuth(audit, 'verify')) break
        if (stopOnAbort(audit, 'verify')) break
        if (!audit.ok) {
          failed.push(...(audit.problems.length ? audit.problems : ['验证没过']))
          failedStage = 'verify'
          break
        }
      }
    }
    if (!authProblem && (gaps.includes('review') || interrogateGap)) {
      const reviewProblems = await runReviewRound({ standards: gaps.includes('review') })
      if (reviewProblems.length) {
        failed.push(...reviewProblems)
        if (!failedStage) failedStage = 'review'
      }
    }
    let round = 1
    if (!authProblem && !aborted) {
      await reportReviewRound({
        onReviewRound,
        round,
        ok: failed.length === 0,
        problems: failed,
        stage: failedStage,
      })
    }
    if (!authProblem && !aborted && failed.length && typeof fixer === 'function') {
      let used = await fixerRoundsUsed({ repoDir, ticket: ticketNumber, branch })
      while (failed.length && used < maxFixRounds) {
        used += 1
        const fixed = await fixer({ repoDir, branch, findings: failed, round: used })
        if (stopOnAuth(fixed, 'review')) break
        if (stopOnAbort(fixed, 'review')) break
        if (!fixed?.ok) break
        round += 1
        failed = await reverifyAfterFix()
        if (authProblem) break
        if (failed.length) {
          // 复验问题和评审问题一样，继续交给下一轮 fixer，轮次用完才停。
          failedStage = 'verify'
          await reportReviewRound({
            onReviewRound,
            round,
            ok: false,
            problems: failed,
            stage: failedStage,
          })
          continue
        }
        failed = await runReviewRound({ standards: true })
        if (authProblem) break
        failedStage = failed.length ? 'review' : ''
        await reportReviewRound({
          onReviewRound,
          round,
          ok: failed.length === 0,
          problems: failed,
          stage: failedStage,
        })
      }
    }
    if (!authProblem && !aborted && failed.length) problems.push(...failed)
  } catch (error) {
    problems.push(errorText(error))
  }

  rows = await readTrail({ repoDir, ticket: ticketNumber })
  if (aborted) {
    if (started?.ok) {
      await preview.stop({ address: started.address, ticket, repoDir }).catch(() => {})
    }
    return { ok: false, reason: 'aborted', stage: abortedStage, missing: [], problems: [] }
  }
  if (authProblem) {
    if (started?.ok) {
      await preview.stop({ address: started.address, ticket, repoDir }).catch(() => {})
    }
    return {
      ok: false,
      reason: 'auth_failed',
      stage: authStage,
      missing: auditGaps(rows, { interrogate: wantsInterrogate && interrogateFailed }),
      problems: authProblem,
    }
  }
  if (problems.length) {
    if (started?.ok) {
      await preview.stop({ address: started.address, ticket, repoDir }).catch(() => {})
    }
    await notifyAuditIncident({ notifier, ticket, owner, repo, problems })
    return {
      ok: false,
      reason: 'evidence_not_ready',
      missing: auditGaps(rows, { interrogate: wantsInterrogate && interrogateFailed }),
      problems,
    }
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
    const headSha = await git(repoDir, ['rev-parse', ticketBranch]).catch(() => '')
    if (!headSha) throw new Error(`分支不存在：${ticketBranch}`)
    const assessment = await assessMerge({
      repoDir,
      ticketBranch,
      reqBranch,
      ticket: { number: ticketNumber },
    })
    return {
      output: {
        dryRun: true,
        ok: assessment.ok,
        ready: assessment.ok,
        reason: assessment.reason,
        headSha: assessment.headSha || headSha,
        missing: assessment.missing,
        stale: assessment.stale,
        risk: assessment.risk,
        plan: assessment.plan,
        fresh: assessment.fresh,
        preview: assessment.preview,
        alreadyMerged: assessment.alreadyMerged,
      },
      exitCode: assessment.ok ? 0 : 1,
    }
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
  const round = clientRound(comments)
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
    owner,
    repo,
    branch: ticketBranch,
    baseBranch: reqBranch,
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
