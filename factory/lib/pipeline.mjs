/**
 * D3/D4/D5 一条流水线：票点完火，补齐验证和评审，再合进需求分支。
 *
 * 证据已经齐了也要继续走合并：合并没成，下一轮接着试，并按 verifyPlan
 * 补足验证者。失败不在这里修，只返回原因，下一轮继续看同一事实。
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureEvidenceBeforeMerge } from '../bin/evidence.mjs'
import { MERGER_TOOLS } from './agent-runner.mjs'
import { runFixerAudit, runReviewAudit, runVerifyAudit } from './audit-agents.mjs'
import {
  mergeTicket,
  readTrail,
  resolveMaxFixRounds,
  serializeTrail,
} from './evidence.mjs'
import { git } from './git.mjs'
import { parentCustomer, parentOrder, parentRequirement } from './ignition.mjs'
import { ensureLabel } from './issues.mjs'
import {
  acquireTicketLease,
  releaseTicketLease,
  touchTicketLease,
} from './lock.mjs'
import { logLine } from './log.mjs'
import { sendEvent } from './notify.mjs'
import { previewNeeded } from './preview.mjs'
import {
  clientRound,
  parseProgress,
  progressComment,
  progressLine,
  visibleNote,
} from './progress.mjs'
import { createRepoWorkspace } from './repo-workspace.mjs'
import { hasLabel, NEEDS_INFO_LABEL } from './scheduler.mjs'

export const SANDBOX_LABEL = 'Sandcastle'
export const PENDING_LABEL = '状态:待验收'

function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

/** 读 common dir 的 info/exclude：哈希、mtime 和原始行，给管道前后对比。 */
async function readExclude({ gitImpl, repoDir }) {
  const commonRaw = String(await gitImpl(repoDir, ['rev-parse', '--git-common-dir'])).trim()
  const common = isAbsolute(commonRaw) ? commonRaw : resolve(repoDir, commonRaw)
  const path = join(common, 'info', 'exclude')
  try {
    const [text, info] = await Promise.all([readFile(path, 'utf8'), stat(path)])
    return {
      path,
      hash: createHash('sha256').update(text).digest('hex'),
      mtimeMs: info.mtimeMs,
      lines: text.split(/\r?\n/),
    }
  } catch {
    return { path, hash: '', mtimeMs: 0, lines: [] }
  }
}

function newExcludeLines(before, after) {
  const known = new Set(before.lines)
  return after.lines.filter((line) => line.trim() && !known.has(line))
}

function emptyExclude(error) {
  return { path: '', hash: '', mtimeMs: 0, lines: [], error: errorText(error) }
}

function firstLine(body) {
  return String(body || '')
    .replace(/^﻿/, '')
    .trimStart()
    .split(/\r?\n/)[0]
    .trim()
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
 * 认证失败：管线停下。父工单打 `needs-info`、写「卡住：是」进度、发一次出事通知。
 * 已经写过认证失败的进度行就不再写、不再通知；同一轮不再跑任何 agent。
 */
async function stopForAuthFailure({ gh, notifier, owner, repo, parent, ticket, problems, stage, now }) {
  const current = await gh.getIssue({ owner, repo, number: parent.number })
  if (!hasLabel(current, NEEDS_INFO_LABEL)) {
    await ensureLabel(gh, { owner, repo, name: NEEDS_INFO_LABEL })
    await gh.addLabels({ owner, repo, number: parent.number, labels: [NEEDS_INFO_LABEL] })
  }
  const comments = await gh.listComments({ owner, repo, number: parent.number })
  const already = comments.some((comment) =>
    String(comment?.body || '')
      .split(/\r?\n/)
      .some((line) => {
        const parsed = parseProgress(line)
        return Boolean(parsed?.stuck && parsed.note.startsWith('认证失败'))
      }),
  )
  if (already) return
  const fullNote = `认证失败：${problems.join('；') || 'agent 认证失败'}`
  const body = progressComment(
    progressLine({
      path: ticket.path,
      tier: '开发中',
      step: stage === 'verify' ? '验证' : '评审',
      ticket: ticket.number,
      round: ticket.round,
      stuck: true,
      note: visibleNote(fullNote),
    }),
    fullNote,
  )
  await gh.createComment({ owner, repo, number: parent.number, body })
  if (typeof notifier?.send !== 'function') return
  try {
    await sendEvent(notifier, {
      owner,
      repo,
      subject: `#${parent.number}`,
      event: '出事',
      scope: '认证失败',
      now: now instanceof Date ? now : new Date(now ?? Date.now()),
      link: ticket.htmlUrl || '',
      data: {
        customer: ticket.customer,
        requirement: ticket.requirement,
        reason: '认证失败',
        tried: visibleNote(fullNote),
        round: ticket.round,
        owner,
        repo,
        ticket: parent.number,
      },
    })
  } catch {
    // 通知失败不改变判断。
  }
}

/**
 * @param {object} options
 * @param {object} options.runner 验证、评审和默认解冲突用的 agent runner
 * @param {Function} [options.previewFor] 按票返回预览实现；返回 null 表示没有预览
 * @param {Function} [options.ensureEvidence] 默认 `ensureEvidenceBeforeMerge`
 * @param {number} [options.maxFixRounds] 评审修复轮次上限，默认读环境变量 `AFK_MAX_FIX_ROUNDS`，再回落 4
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
  maxFixRounds = resolveMaxFixRounds(),
  fixer: fixerOverride,
  merge = mergeTicket,
  readTrailImpl = readTrail,
  gitImpl = git,
  lockDir = process.env.AFK_LOCK_DIR || join(homedir(), '.grilling', 'factory', 'locks'),
  leaseHeartbeatMs = 60 * 1000,
  leaseStaleMs = 10 * 60 * 1000,
  acquireLease = acquireTicketLease,
  releaseLease = releaseTicketLease,
  touchLease = touchTicketLease,
} = {}) {
  const workspace = createRepoWorkspace()
  // 同一进程里两轮重叠时，先靠内存集合挡住，再抢跨进程的租约。
  const inFlight = new Set()
  /**
   * 证据写在票工作树里，先提交到票分支；主仓合并时从分支上读得到。
   * 只提交 `.audit`，agent 留下的其他未跟踪文件交给 release 归档。
   */
  async function commitAuditFiles({ worktree, ticket }) {
    // `.git/info/exclude` 之类的忽略规则会挡住普通 git add，证据必须进分支，强制加入。
    // 先把被忽略的 `.audit` 文件逐个点名，再整体 force-add，避免漏掉已经存在的证据。
    const ignored = await gitImpl(worktree, [
      'status',
      '--ignored',
      '--porcelain',
      '-z',
      '--',
      '.audit',
    ]).catch(() => '')
    const ignoredPaths = String(ignored)
      .split('\0')
      .filter((entry) => entry.startsWith('!! '))
      .map((entry) => entry.slice(3))
      .filter(Boolean)
    if (ignoredPaths.length) {
      await gitImpl(worktree, ['add', '-f', '--', ...ignoredPaths]).catch(() => {})
    }
    await gitImpl(worktree, ['add', '-f', '-A', '--', '.audit']).catch(() => {})
    const staged = await gitImpl(worktree, ['diff', '--cached', '--name-only', '--', '.audit']).catch(
      () => '',
    )
    if (!staged) return ''
    await gitImpl(worktree, ['commit', '-m', `FACTORY: 证据进 git #${ticket}`])
    return gitImpl(worktree, ['rev-parse', 'HEAD'])
  }

  async function merger({ repoDir, files, runner: mergerRunner = runner }) {
    if (typeof mergerRunner?.run !== 'function') {
      return { ok: false, problems: ['没有注入 runner，解不了冲突'] }
    }
    const dir = agentsDir || fileURLToPath(new URL('../agents/', import.meta.url))
    const instructions = await readFile(join(dir, 'merger.md'), 'utf8').catch(() => '')
    const run = await mergerRunner.run({
      name: `merge-${Date.now()}`,
      cwd: repoDir,
      allowedTools: MERGER_TOOLS,
      brief: mergerBrief({ files, instructions }),
    })
    return parseMergerVerdict(run)
  }

  async function runOne({ gh, owner, repo, parent, ticket, repoDir, signal }) {
    if (signal?.aborted) return { ticket: ticket.number, ok: false, reason: 'aborted' }
    if (ticket.state === 'closed') return null
    if (hasLabel(ticket, PENDING_LABEL)) return null
    if (!hasLabel(ticket, SANDBOX_LABEL)) return null
    // 父工单挂着 needs-info：这一轮不碰 runner，运营者摘掉标签后下一轮自然恢复。
    if (hasLabel(parent, NEEDS_INFO_LABEL)) return { ticket: ticket.number, skipped: 'needs-info' }

    const comments = await gh.listComments({ owner, repo, number: ticket.number })
    if (!firstLine(comments.at(-1)?.body).startsWith('点火完成')) return null

    const ticketBranch = `ticket/${ticket.number}`
    const headSha = await gitImpl(repoDir, ['rev-parse', '--verify', '--quiet', ticketBranch]).catch(() => '')
    if (!headSha) return { ticket: ticket.number, skipped: 'branch-missing' }

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
      round: clientRound(parent?.comments || []),
      htmlUrl: ticket.html_url || `https://github.com/${owner}/${repo}/issues/${ticket.number}`,
    }

    const activeRunner = !runner
      ? runner
      : signal
        ? {
            run(args = {}) {
              if (signal.aborted) {
                return {
                  ok: false,
                  aborted: true,
                  reason: 'aborted',
                  stdout: '',
                  stderr: '',
                }
              }
              return runner.run({ ...args, signal })
            },
          }
        : runner

    const fixer =
      fixerOverride ||
      (({ repoDir: dir, branch, findings, round }) =>
        runFixerAudit({ repoDir: dir, ticket: ticket.number, branch, findings, round, runner: activeRunner }))

    // 没过的那一轮在父工单留一行进度，轮次递增，三圈停滞检测读得到。
    const reviewProgress = async ({ round, ok, problems, stage = '' }) => {
      if (ok) return
      const label = stage === 'verify' ? '验证没过' : '评审没过'
      const fullNote = `${label}：${problems.join('；')}`
      const body = progressComment(
        progressLine({
          path: ticketInfo.path,
          tier: '开发中',
          step: '评审修复',
          ticket: ticket.number,
          round: ticketInfo.round,
          stuck: false,
          note: visibleNote(fullNote),
        }),
        fullNote,
      )
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

    // 主仓不切票分支：挡路的未跟踪文件先归档，再去 repoWorkspace 拿票工作树。
    const archived = []
    try {
      const conflicts = await untrackedOverlaps({ gitImpl, repoDir, branch: ticketBranch })
      if (conflicts.length > 0) {
        const current = await gitImpl(repoDir, ['branch', '--show-current']).catch(() => '')
        archived.push(
          ...(await archiveUntracked({ repoDir, files: conflicts, branch: current, at: clock() })),
        )
        log({
          level: 'info',
          msg: '准备票工作树前归档了未跟踪文件',
          owner,
          repo,
          ticket: ticket.number,
          branch: ticketBranch,
          files: archived.map((row) => row.to),
        })
      }
    } catch (error) {
      // 主仓不切分支，归档失败不挡后面的工作树。
      log({
        level: 'warning',
        msg: '归档主仓未跟踪文件失败',
        owner,
        repo,
        ticket: ticket.number,
        branch: ticketBranch,
        error: errorText(error),
      })
    }

    async function prepareWorktree() {
      try {
        return await workspace.prepareTicket({ repoDir, base: reqBranch, ticketBranch })
      } catch (error) {
        // 上一次点火留下的脏工作树：先把证据提交到票分支，再归档未跟踪文件；只剩已跟踪改动时交给人。
        try {
          await commitAuditFiles({
            worktree: workspace.worktreePath(repoDir, ticketBranch),
            ticket: ticket.number,
          })
        } catch {
          // 提交失败不挡 release，归档路径仍把文件留在本地。
        }
        const released = await workspace.release({ repoDir, branch: ticketBranch }).catch(() => null)
        if (released?.archived?.length) archived.push(...released.archived)
        if (released?.kept) {
          const dirty = new Error(`票工作树 ${released.path} 有未提交的已跟踪改动，先人工处理`)
          dirty.worktreeDirty = released.path
          throw dirty
        }
        return await workspace.prepareTicket({ repoDir, base: reqBranch, ticketBranch })
      }
    }

    let prepared
    try {
      prepared = await prepareWorktree()
    } catch (error) {
      if (error.worktreeDirty) {
        return {
          ticket: ticket.number,
          ok: false,
          reason: 'worktree_dirty',
          worktree: error.worktreeDirty,
          problems: [errorText(error)],
          archived: archived.map((row) => row.to),
        }
      }
      log({
        level: 'error',
        msg: '准备票工作树失败',
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
        archived: archived.map((row) => row.to),
      }
    }
    const worktree = prepared.worktree

    const worktreeTrail = await readTrailImpl({ repoDir: worktree, ticket: ticket.number })
    const preview = previewFor({ ticket: ticketInfo, parent, owner, repo, repoDir: worktree })
    if (previewNeeded({ trail: serializeTrail(worktreeTrail) }) && typeof preview?.start !== 'function') {
      const missing = ['这张票有界面，但没有注入预览（等 #469）']
      log({ level: 'error', msg: '证据补齐失败', owner, repo, ticket: ticket.number, reason: 'preview_required', missing })
      await workspace.release({ repoDir, worktree, branch: ticketBranch }).catch(() => {})
      return { ticket: ticket.number, ok: false, reason: 'preview_required', missing }
    }
    const previewImpl = preview?.start && preview?.stop ? cachedPreview(preview) : preview

    if (signal?.aborted) return { ticket: ticket.number, ok: false, reason: 'aborted' }
    try {
      let ensured
      let keptWorktree = ''
      let auditCommitFailed = false
      try {
        ensured = await ensureEvidence({
          repoDir: worktree,
          ticket: ticketInfo,
          ticketNumber: ticket.number,
          owner,
          repo,
          branch: ticketBranch,
          baseBranch: reqBranch,
          runner: activeRunner,
          preview: previewImpl,
          notifier,
          now: clock(),
          clock,
          fixer,
          onReviewRound: reviewProgress,
          maxFixRounds,
        })
      } finally {
        // 证据先落到票分支，再释放工作树；主仓合并时才切得动票分支。
        try {
          // 取消时这里不提交；release 会统一把 .audit 提交到票分支，工作树删除也不丢证据。
          if (!signal?.aborted) {
            const auditHead = await commitAuditFiles({ worktree, ticket: ticket.number })
            if (auditHead) {
              log({
                level: 'info',
                msg: '证据提交到票分支',
                owner,
                repo,
                ticket: ticket.number,
                head: auditHead,
              })
            }
          }
          const released = await workspace.release({
            repoDir,
            worktree,
            branch: ticketBranch,
          })
          if (released.archived?.length) {
            archived.push(...released.archived)
            log({
              level: 'info',
              msg: '归档票工作树里的未跟踪文件',
              owner,
              repo,
              ticket: ticket.number,
              files: released.archived.map((row) => row.to),
            })
          }
          if (released.worktreeDirty) auditCommitFailed = true
          if (released.kept) keptWorktree = released.path
        } catch (error) {
          log({
            level: 'error',
            msg: '释放票工作树失败',
            owner,
            repo,
            ticket: ticket.number,
            worktree,
            error: errorText(error),
          })
          keptWorktree = worktree
        }
      }

      if (auditCommitFailed) {
        return {
          ticket: ticket.number,
          ok: false,
          reason: 'worktree_dirty',
          worktree: keptWorktree,
          problems: ['.audit 提交失败，工作树保留'],
          archived: archived.map((row) => row.to),
        }
      }
      if (signal?.aborted) return { ticket: ticket.number, ok: false, reason: 'aborted' }

      if (!ensured.ok) {
        const reason = ensured.reason || 'evidence_not_ready'
        if (reason === 'auth_failed') {
          try {
            await stopForAuthFailure({
              gh,
              notifier,
              owner,
              repo,
              parent,
              ticket: ticketInfo,
              problems: ensured.problems || [],
              stage: ensured.stage || '',
              now: clock(),
            })
          } catch (error) {
            log({
              level: 'error',
              msg: '认证失败后写 needs-info 失败',
              owner,
              repo,
              ticket: ticket.number,
              error: errorText(error),
            })
          }
        }
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
        return {
          ticket: ticket.number,
          ...ensured,
          reason,
          archived: archived.map((row) => row.to),
        }
      }

      if (keptWorktree) {
        return {
          ticket: ticket.number,
          ok: false,
          reason: 'worktree_dirty',
          worktree: keptWorktree,
          problems: ['票工作树有未提交的已跟踪改动，没合需求分支'],
          archived: archived.map((row) => row.to),
        }
      }

      if (signal?.aborted) return { ticket: ticket.number, ok: false, reason: 'aborted' }

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
            runner: activeRunner,
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
            runner: activeRunner,
            now: clock(),
          })
          return { ok: audit.ok, problems: audit.problems, decision: audit.decision }
        },
        merger: (args) => merger({ ...args, runner: activeRunner }),
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
        archived: archived.map((row) => row.to),
      })
      return {
        ticket: ticket.number,
        ...result,
        archived: archived.map((row) => row.to),
      }
    } catch (error) {
      if (signal?.aborted) {
        log({ level: 'info', msg: '管道已取消', owner, repo, ticket: ticket.number })
        return { ticket: ticket.number, ok: false, reason: 'aborted' }
      }
      log({
        level: 'error',
        msg: '流水线出错',
        owner,
        repo,
        ticket: ticket.number,
        error: errorText(error),
      })
      return { ticket: ticket.number, ok: false, reason: 'pipeline_error', error: errorText(error) }
    }
  }

  return async function ticketPipeline({
    gh,
    owner,
    repo,
    parents = [],
    repoDir = '',
    jobs = null,
    signal = null,
    lockDir: runLockDir = '',
  } = {}) {
    const runs = []
    const state = { active: null, lastActive: null }
    if (!repoDir) return { runs, skipped: 'no-repo' }
    const excludeBefore = await readExclude({ gitImpl, repoDir }).catch(emptyExclude)
    log({
      level: 'info',
      msg: '管道开始，记录 info/exclude 快照',
      owner,
      repo,
      file: excludeBefore.path,
      hash: excludeBefore.hash,
      mtimeMs: excludeBefore.mtimeMs,
    })
    try {
    for (const parent of parents || []) {
      for (const ticket of parent.subIssues || []) {
        if (signal?.aborted) return { runs, aborted: true, active: state.active }
        const ready =
          ticket.state !== 'closed' &&
          !hasLabel(ticket, PENDING_LABEL) &&
          hasLabel(ticket, SANDBOX_LABEL) &&
          !hasLabel(parent, NEEDS_INFO_LABEL)
        if (!ready) {
          const outcome = await runOne({ gh, owner, repo, parent, ticket, repoDir, signal })
          if (outcome) runs.push(outcome)
          continue
        }

        const key = `${owner}/${repo}#${ticket.number}`
        if (inFlight.has(key)) {
          log({
            level: 'info',
            msg: `票 #${ticket.number} 已有管道在跑`,
            owner,
            repo,
            ticket: ticket.number,
            skipped: 'busy',
          })
          runs.push({ ticket: ticket.number, skipped: 'busy' })
          continue
        }
        inFlight.add(key)
        let lease = null
        try {
          lease = await acquireLease({
            lockDir: runLockDir || lockDir,
            owner,
            repo,
            ticket: ticket.number,
            now: clock,
            staleMs: leaseStaleMs,
          })
          if (!lease.acquired) {
            log({
              level: 'info',
              msg: `票 #${ticket.number} 已有管道在跑`,
              owner,
              repo,
              ticket: ticket.number,
              skipped: 'busy',
              holder: lease.holder || null,
            })
            runs.push({ ticket: ticket.number, skipped: 'busy' })
            continue
          }
          if (lease.takeover) {
            log({
              level: 'warning',
              msg: `接管票 #${ticket.number} 的旧租约`,
              owner,
              repo,
              ticket: ticket.number,
              previous: lease.previous || null,
            })
          }
          state.active = { ticket: ticket.number, parent: parent.number }
          state.lastActive = state.active
          const leaseController = new AbortController()
          const runSignal = signal
            ? AbortSignal.any([signal, leaseController.signal])
            : leaseController.signal
          try {
            await jobs?.markRunning({
              owner,
              repo,
              parent: parent.number,
              ticket: ticket.number,
              action: 'pipeline',
              reason: '管道运行中',
              now: clock(),
            })
          } catch (error) {
            log({ level: 'warning', msg: '写管道作业行失败', owner, repo, ticket: ticket.number, error: errorText(error) })
          }
          const beat = setInterval(() => {
            Promise.resolve()
              .then(() => touchLease(lease.path, { now: clock, token: lease.token }))
              .then(() =>
                jobs?.beatJob({
                  owner,
                  repo,
                  parent: parent.number,
                  ticket: ticket.number,
                  action: 'pipeline',
                  now: clock(),
                }),
              )
              .catch((error) => {
                leaseController.abort(error)
                log({
                  level: 'error',
                  msg: '票租约心跳失败，停止管道',
                  owner,
                  repo,
                  ticket: ticket.number,
                  error: errorText(error),
                })
              })
          }, leaseHeartbeatMs)
          beat?.unref?.()

          try {
            const outcome = await runOne({ gh, owner, repo, parent, ticket, repoDir, signal: runSignal })
            if (outcome) runs.push(outcome)
            if (outcome?.reason === 'aborted' || runSignal.aborted) {
              return { runs, aborted: true, active: state.active }
            }
          } finally {
            clearInterval(beat)
            try {
              await jobs?.clearRunning({
                owner,
                repo,
                parent: parent.number,
                ticket: ticket.number,
                action: 'pipeline',
                now: clock(),
              })
            } catch (error) {
              log({ level: 'warning', msg: '清管道作业行失败', owner, repo, ticket: ticket.number, error: errorText(error) })
            }
            state.active = null
          }
        } finally {
          if (lease?.acquired) await releaseLease(lease.path, { token: lease.token })
          inFlight.delete(key)
        }
      }
    }
    } finally {
      const excludeAfter = await readExclude({ gitImpl, repoDir }).catch(emptyExclude)
      const added = excludeBefore.error || excludeAfter.error ? [] : newExcludeLines(excludeBefore, excludeAfter)
      const changed =
        !excludeBefore.error &&
        !excludeAfter.error &&
        excludeBefore.hash !== excludeAfter.hash
      log({
        level: changed || added.length ? 'warning' : 'info',
        msg: changed || added.length ? 'evidence_ignored' : '管道结束，记录 info/exclude 快照',
        owner,
        repo,
        file: excludeAfter.path,
        before: { hash: excludeBefore.hash, mtimeMs: excludeBefore.mtimeMs },
        after: { hash: excludeAfter.hash, mtimeMs: excludeAfter.mtimeMs },
        added,
        ...(excludeBefore.error ? { beforeError: excludeBefore.error } : {}),
        ...(excludeAfter.error ? { afterError: excludeAfter.error } : {}),
      })
    }
    return { runs, active: state.lastActive }
  }
}
