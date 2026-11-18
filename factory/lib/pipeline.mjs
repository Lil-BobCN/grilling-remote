/**
 * D3/D4/D5 一条流水线：票点完火，补齐验证和评审，再合进需求分支。
 *
 * 证据已经齐了也要继续走合并：合并没成，下一轮接着试，并按 verifyPlan
 * 补足验证者。失败不在这里修，只返回原因，下一轮继续看同一事实。
 */
import { mkdir, readFile, rename, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureEvidenceBeforeMerge } from '../bin/evidence.mjs'
import { MERGER_TOOLS } from './agent-runner.mjs'
import { runFixerAudit, runReviewAudit, runVerifyAudit } from './audit-agents.mjs'
import {
  mergeTicket,
  readTrail,
  serializeTrail,
} from './evidence.mjs'
import { git } from './git.mjs'
import { parentCustomer, parentOrder, parentRequirement } from './ignition.mjs'
import { logLine } from './log.mjs'
import { previewNeeded } from './preview.mjs'
import { parseProgress, progressLine } from './progress.mjs'
import { hasLabel } from './scheduler.mjs'

export const SANDBOX_LABEL = 'Sandcastle'
export const PENDING_LABEL = '状态:待验收'

function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

function firstLine(body) {
  return String(body || '')
    .replace(/^﻿/, '')
    .trimStart()
    .split(/\r?\n/)[0]
    .trim()
}

function progressRound(comments = []) {
  let round = 1
  for (const comment of comments) {
    for (const line of String(comment?.body || '').split(/\r?\n/)) {
      const parsed = parseProgress(line)
      if (parsed) round = parsed.round
    }
  }
  return round + 1
}

function archiveStamp(at) {
  const date = at instanceof Date ? at : new Date(at ?? Date.now())
  const iso = Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
  return `${iso.slice(0, 19).replace(/[-:]/g, '')}Z`
}

function branchSlug(branch) {
  const slug = String(branch || '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return slug || 'detached'
}

/** 当前工作树里的未跟踪文件，和目标分支跟踪的路径取交集。 */
async function untrackedOverlaps({ gitImpl, repoDir, branch }) {
  const tracked = await gitImpl(repoDir, ['ls-tree', '-r', '--name-only', branch])
  const paths = new Set(String(tracked).split(/\r?\n/).filter(Boolean))
  if (paths.size === 0) return []
  const untracked = await gitImpl(repoDir, ['ls-files', '--others', '--exclude-standard'])
  return String(untracked)
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((file) => paths.has(file))
}

/**
 * 把挡住切分支的未跟踪文件挪进 `.audit/archive/<时间戳>-<原分支>/`。
 * 只移动，不改内容；目标批次已存在就加序号，不覆盖上一次归档。
 */
async function archiveUntracked({ repoDir, files, branch, at }) {
  const base = `${archiveStamp(at)}-${branchSlug(branch)}`
  let batch = base
  for (let index = 2; ; index += 1) {
    try {
      await stat(join(repoDir, '.audit', 'archive', batch))
      batch = `${base}-${index}`
    } catch {
      break
    }
  }
  const moved = []
  for (const file of files) {
    const relative = file.startsWith('.audit/') ? file.slice('.audit/'.length) : file
    const target = `.audit/archive/${batch}/${relative}`
    await mkdir(dirname(join(repoDir, target)), { recursive: true })
    await rename(join(repoDir, file), join(repoDir, target))
    moved.push({ from: file, to: target })
  }
  return moved
}

/** 预览只起一次：补证据用掉以后，合并阶段复用同一套，合完再销毁。 */
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

function mergerBrief({ files, instructions }) {
  return [
    String(instructions || '').trim(),
    '',
    '冲突文件：',
    ...(files || []).map((file) => `- ${file}`),
    '',
    '解完把文件改好，不要提交。最后一行写 `AFK_VERDICT: merged` 或 `AFK_VERDICT: blocked 原因`。',
  ].join('\n')
}

function parseMergerVerdict(result) {
  if (!result?.ok) {
    return { ok: false, problems: [`合并者 agent 退出码 ${result?.code ?? 1}：${String(result?.stderr || '').slice(-400)}`] }
  }
  const line = String(result.stdout || '')
    .split(/\r?\n/)
    .reverse()
    .find((row) => row.startsWith('AFK_VERDICT:'))
  if (!line) return { ok: false, problems: ['合并者 agent 没写 AFK_VERDICT'] }
  const text = line.slice('AFK_VERDICT:'.length).trim()
  if (/^merged\b/i.test(text)) return { ok: true, decision: text }
  return { ok: false, problems: [text || '合并者判不过'] }
}

/**
 * @param {object} options
 * @param {object} options.runner 验证、评审和默认解冲突用的 agent runner
 * @param {Function} [options.previewFor] 按票返回预览实现；返回 null 表示没有预览
 * @param {Function} [options.ensureEvidence] 默认 `ensureEvidenceBeforeMerge`
 * @param {Function} [options.fixer] 评审没过时的修复实现，默认 `runFixerAudit`
 * @param {Function} [options.merge] 默认 `mergeTicket`
 * @returns {(context: {gh: object, owner: string, repo: string, parents: Array, repoDir: string}) => Promise<object>}
 */
export function createTicketPipeline({
  runner,
  previewFor = () => null,
  notifier,
  clock = () => new Date(),
  log = logLine,
  agentsDir,
  ensureEvidence = ensureEvidenceBeforeMerge,
  fixer: fixerOverride,
  merge = mergeTicket,
  readTrailImpl = readTrail,
  gitImpl = git,
} = {}) {
  async function merger({ repoDir, files }) {
    if (typeof runner?.run !== 'function') {
      return { ok: false, problems: ['没有注入 runner，解不了冲突'] }
    }
    const dir = agentsDir || fileURLToPath(new URL('../agents/', import.meta.url))
    const instructions = await readFile(join(dir, 'merger.md'), 'utf8').catch(() => '')
    const run = await runner.run({
      name: `merge-${Date.now()}`,
      cwd: repoDir,
      allowedTools: MERGER_TOOLS,
      brief: mergerBrief({ files, instructions }),
    })
    return parseMergerVerdict(run)
  }

  async function runOne({ gh, owner, repo, parent, ticket, repoDir }) {
    if (ticket.state === 'closed') return null
    if (hasLabel(ticket, PENDING_LABEL)) return null
    if (!hasLabel(ticket, SANDBOX_LABEL)) return null

    const comments = await gh.listComments({ owner, repo, number: ticket.number })
    if (!firstLine(comments.at(-1)?.body).startsWith('点火完成')) return null

    const ticketBranch = `ticket/${ticket.number}`
    const headSha = await gitImpl(repoDir, ['rev-parse', '--verify', '--quiet', ticketBranch]).catch(() => '')
    if (!headSha) return { ticket: ticket.number, skipped: 'branch-missing' }

    const trail = await readTrailImpl({ repoDir, ticket: ticket.number })

    const order = parentOrder(parent?.body)
    if (!order) return { ticket: ticket.number, skipped: 'no-order' }
    const reqBranch = `req/${order}`

    const ticketInfo = {
      number: ticket.number,
      title: ticket.title,
      body: ticket.body,
      owner,
      repo,
      parentNumber: parent.number,
      customer: parentCustomer(parent?.body) || parent?.title || '',
      requirement: parentRequirement(parent?.body) || parent?.title || '',
      path: hasLabel(parent, '大小:小需求') ? '小需求' : '其余',
      round: progressRound(parent?.comments || []),
      htmlUrl: ticket.html_url || `https://github.com/${owner}/${repo}/issues/${ticket.number}`,
    }

    const fixer =
      fixerOverride ||
      (({ repoDir: dir, branch, findings, round }) =>
        runFixerAudit({ repoDir: dir, ticket: ticket.number, branch, findings, round, runner }))

    // 评审没过的那一轮在父工单留一行进度，轮次递增，三圈停滞检测读得到。
    const reviewProgress = async ({ round, ok, problems }) => {
      if (ok) return
      const body = progressLine({
        path: ticketInfo.path,
        tier: '开发中',
        step: '评审修复',
        round: ticketInfo.round + round - 1,
        stuck: false,
        note: `评审没过：${problems.slice(0, 2).join('；')}`.replace(/\s+/g, ' ').slice(0, 160),
      })
      try {
        await gh.createComment({ owner, repo, number: parent.number, body })
      } catch (error) {
        log({
          level: 'error',
          msg: '评审进度没写成',
          owner,
          repo,
          ticket: ticket.number,
          error: errorText(error),
        })
      }
    }

    const preview = previewFor({ ticket: ticketInfo, parent, owner, repo, repoDir })
    if (previewNeeded({ trail: serializeTrail(trail) }) && typeof preview?.start !== 'function') {
      const missing = ['这张票有界面，但没有注入预览（等 #469）']
      log({ level: 'error', msg: '证据补齐失败', owner, repo, ticket: ticket.number, reason: 'preview_required', missing })
      return { ticket: ticket.number, ok: false, reason: 'preview_required', missing }
    }
    const previewImpl = preview?.start && preview?.stop ? cachedPreview(preview) : preview

    const originalBranch = await gitImpl(repoDir, ['branch', '--show-current']).catch(() => '')
    let switched = false
    if (originalBranch !== ticketBranch) {
      let archived = []
      try {
        const conflicts = await untrackedOverlaps({ gitImpl, repoDir, branch: ticketBranch })
        if (conflicts.length > 0) {
          archived = await archiveUntracked({
            repoDir,
            files: conflicts,
            branch: originalBranch,
            at: clock(),
          })
          log({
            level: 'info',
            msg: '切票分支前归档了未跟踪文件',
            owner,
            repo,
            ticket: ticket.number,
            branch: ticketBranch,
            files: archived.map((row) => row.to),
          })
        }
        await gitImpl(repoDir, ['checkout', ticketBranch])
        switched = true
      } catch (error) {
        log({
          level: 'error',
          msg: '切不到票分支',
          owner,
          repo,
          ticket: ticket.number,
          branch: ticketBranch,
          reason: 'branch_conflict',
          archived: archived.map((row) => row.to),
          error: errorText(error),
        })
        return {
          ticket: ticket.number,
          ok: false,
          reason: 'branch_conflict',
          problems: [errorText(error)],
          ...(archived.length ? { archived: archived.map((row) => row.to) } : {}),
        }
      }
    }

    try {
      const ensured = await ensureEvidence({
        repoDir,
        ticket: ticketInfo,
        ticketNumber: ticket.number,
        branch: ticketBranch,
        baseBranch: reqBranch,
        runner,
        preview: previewImpl,
        notifier,
        now: clock(),
        fixer,
        onReviewRound: reviewProgress,
      })
      if (!ensured.ok) {
        const reason = ensured.reason || 'evidence_not_ready'
        log({
          level: 'error',
          msg: '证据补齐失败',
          owner,
          repo,
          ticket: ticket.number,
          reason,
          missing: ensured.missing || [],
          problems: ensured.problems || [],
        })
        return { ticket: ticket.number, ...ensured, reason }
      }

      const result = await merge({
        repoDir,
        ticketBranch,
        reqBranch,
        ticket: ticketInfo,
        trail: ensured.trail,
        verifier: async ({ headSha: mergedHead }) => {
          const audit = await runVerifyAudit({
            repoDir,
            ticket: ticket.number,
            branch: mergedHead,
            runner,
            now: clock(),
          })
          return { ok: audit.ok, problems: audit.problems, evidence: audit.evidence.join(',') }
        },
        review: async ({ headSha: reviewHead, mode }) => {
          const audit = await runReviewAudit({
            repoDir,
            ticket: ticket.number,
            branch: reviewHead,
            mode: mode || 'all',
            runner,
            now: clock(),
          })
          return { ok: audit.ok, problems: audit.problems, decision: audit.decision }
        },
        merger,
        preview: previewImpl,
        notifier,
        github: gh,
      })

      log({
        level: result.ok ? 'info' : 'error',
        msg: result.ok ? '证据齐，已合需求分支' : '合需求分支失败',
        owner,
        repo,
        ticket: ticket.number,
        reason: result.reason || '',
        mergedSha: result.mergedSha || '',
        missing: result.missing || [],
        problems: result.problems || [],
      })
      return { ticket: ticket.number, ...result }
    } catch (error) {
      log({
        level: 'error',
        msg: '流水线出错',
        owner,
        repo,
        ticket: ticket.number,
        error: errorText(error),
      })
      return { ticket: ticket.number, ok: false, reason: 'pipeline_error', error: errorText(error) }
    } finally {
      if (switched && originalBranch) {
        await gitImpl(repoDir, ['checkout', originalBranch]).catch(() => {})
      } else if (switched) {
        await gitImpl(repoDir, ['checkout', reqBranch]).catch(() => {})
      }
    }
  }

  return async function ticketPipeline({ gh, owner, repo, parents = [], repoDir = '' } = {}) {
    const runs = []
    if (!repoDir) return { runs, skipped: 'no-repo' }
    for (const parent of parents || []) {
      for (const ticket of parent.subIssues || []) {
        const outcome = await runOne({ gh, owner, repo, parent, ticket, repoDir })
        if (outcome) runs.push(outcome)
      }
    }
    return { runs }
  }
}
