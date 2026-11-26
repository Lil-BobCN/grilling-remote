/**
 * 调度器：每 30 秒读一遍 open 工单，按 `docs/工单模型.md` 第五节的迁移表推进。
 *
 * 判断只看可检查的事实：`状态:*` 标签、子票状态和阻塞边、父工单评论里的关口词、
 * 仓库里有没有 spec。不读客户原话，不猜内容。
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { eventKey } from '../../backend/lib/protocol.mjs'
import { DEFAULT_AGENT_TIMEOUT_MS } from './agent-runner.mjs'
import { readTrail } from './evidence.mjs'
import { git } from './git.mjs'
import { latestGate } from './gate.mjs'
import { ensureCommentOnce, ensureLabel } from './issues.mjs'
import { blockingStop, findJob, jobBlocked } from './job.mjs'
import { logLine } from './log.mjs'
import { acquireFileLock } from './lock.mjs'
import { notificationEvent, sendEvent as sendNotification } from './notify.mjs'
import { repeatProblems, roundsWithoutProgress } from './stall.mjs'
import { frontier } from './tickets.mjs'
import {
  clientRound,
  parseProgress,
  progressComment,
  progressLine,
  visibleNote,
} from './progress.mjs'

export const STATES = ['已提交', '排队中', '开发中', '待验收']

export const STATE_LABELS = {
  '状态:已提交': { color: 'ededed', description: '已建单，等技术闸门' },
  '状态:排队中': { color: 'fbca04', description: '轮到了，等点火' },
  '状态:开发中': { color: '1d76db', description: '正在跑' },
  '状态:待验收': { color: '0e8a16', description: '活干完了，等下一步确认' },
}

export const SMALL_LABEL = '大小:小需求'
export const SANDBOX_LABEL = 'Sandcastle'
export const NEEDS_INFO_LABEL = 'needs-info'
const WAYFINDER_PREFIX = 'wayfinder:'
const SMALL_PATH = '小需求'
const NORMAL_PATH = '其余'

function normalizedFirstLine(body) {
  return String(body || '')
    .replace(/^﻿/, '')
    .trimStart()
    .split(/\r?\n/)[0]
    .trim()
}

export function labelNames(issueOrLabels) {
  const rows = Array.isArray(issueOrLabels) ? issueOrLabels : issueOrLabels?.labels
  return (rows || []).map((row) => (typeof row === 'string' ? row : row?.name)).filter(Boolean)
}

export function hasLabel(issue, name) {
  return labelNames(issue).includes(name)
}

export function isSmall(parent) {
  return hasLabel(parent, SMALL_LABEL)
}

export function isSandcastle(issue) {
  return hasLabel(issue, SANDBOX_LABEL)
}

export function isOpen(issue) {
  return issue?.state !== 'closed'
}

/** 父工单的当前档。没有标签或同时挂多个档都返回 null，调用方打 needs-info。 */
export function stateOf(parent) {
  const found = labelNames(parent)
    .filter((name) => name.startsWith('状态:'))
    .map((name) => name.slice('状态:'.length))
    .filter((name) => STATES.includes(name))
  return found.length === 1 ? found[0] : null
}

export function parentFacts(parent) {
  const body = String(parent?.body || '')
  const customer = /^\s*-\s*客户简称：\s*(.+?)\s*$/m.exec(body)?.[1] || parent?.customer || ''
  const requirement =
    /^\s*-\s*需求名：\s*(.+?)\s*$/m.exec(body)?.[1] || parent?.requirement || parent?.title || ''
  const order = /<!--\s*factory:order=([^\s>]+)\s*-->/.exec(body)?.[1] || ''
  return { customer: customer || '未知客户', requirement, order }
}

function parentLink(parent, owner, repo) {
  if (parent?.html_url) return parent.html_url
  if (parent?.url) return parent.url
  if (owner && repo && parent?.number) return `https://github.com/${owner}/${repo}/issues/${parent.number}`
  return ''
}

/** 关口词，含运营者写的普通 `驳回：`；同一位置只看最新一条。 */
export function latestSignal(comments = []) {
  const latest = latestGate(comments)
  const floor = latest ? latest.index : -1
  for (let index = comments.length - 1; index > floor; index -= 1) {
    if (normalizedFirstLine(comments[index]?.body).startsWith('驳回：')) {
      return { kind: '驳回：', body: String(comments[index].body), comment: comments[index], index }
    }
  }
  return latest
}

function isWaitingSignal(kind) {
  return Boolean(
    kind &&
      (kind.startsWith('提案：') || kind.startsWith('驳回：') || kind === '改口：'),
  )
}

function roundOf(comments = []) {
  return clientRound(comments)
}

/** 驳回之后已经写过进度行，说明这一条驳回处理过了，不能再开一张修复票。 */
function progressAfter(comments = [], index = -1) {
  for (let cursor = index + 1; cursor < comments.length; cursor += 1) {
    for (const line of String(comments[cursor]?.body || '').split(/\r?\n/)) {
      if (parseProgress(line)) return true
    }
  }
  return false
}

function pathOf(parent) {
  return isSmall(parent) ? SMALL_PATH : NORMAL_PATH
}

/**
 * 停法两条可检查判据：同一张票三圈没进展、同类问题跨票两次。
 * 只看父工单的进度行和子票 trail，不猜内容。
 *
 * @returns {Array<{reason: string, detail: string}>} 命中的判据；空数组表示没停
 */
export function stallHits({ comments = [], trails = [], openTickets = null } = {}) {
  const hits = []
  const rounds = roundsWithoutProgress({ comments, openTickets })
  if (rounds.stalled) {
    hits.push({
      reason: '三圈没进展',
      detail: rounds.reason,
      ticket: rounds.ticket,
      tickets: rounds.tickets,
    })
  }

  const repeated = repeatProblems({ trails })
  if (repeated.repeat) {
    hits.push({
      reason: '同类两次',
      detail: repeated.repeats
        .map((item) => `${item.problem}（#${item.tickets.join('、#')}）`)
        .join('；'),
    })
  }
  return hits
}

/** 命中停法：打 needs-info、写卡住进度、推 `出事`，不点火。 */
function stallActions({ parent, comments, state, hits, owner, repo }) {
  const detail = hits.map((hit) => `${hit.reason}：${hit.detail}`).join('；')
  const tickets = [
    ...new Set(
      hits.flatMap((hit) =>
        Array.isArray(hit.tickets) ? hit.tickets : hit.ticket === undefined ? [] : [hit.ticket],
      ),
    ),
  ]
  const actions = needsInfoActions({ parent, comments, state, reason: detail, owner, repo, tickets })
  for (const hit of hits) {
    actions.push(
      notifyAction({
        parent,
        owner,
        repo,
        event: '出事',
        scope: hit.reason,
        data: { reason: hit.reason, tried: hit.detail, round: roundOf(comments) },
      }),
    )
  }
  return actions
}

function customerTier(state) {
  if (state === '已提交' || state === '排队中') return '安排中'
  if (state === '开发中' || state === '待验收') return '开发中'
  return '安排中'
}

function stageFor(state, small) {
  if (state === '已提交') return '技术闸门'
  if (state === '排队中') return small ? '点头' : '写规格'
  if (state === '开发中') return '开工'
  if (state === '待验收') return '合主干'
  return '建单'
}

function progressFor({ parent, state, comments, tier, step, ticket, stuck, note = '' }) {
  return progressLine({
    path: pathOf(parent),
    tier: tier || customerTier(state),
    step: step || stageFor(state, isSmall(parent)),
    ticket,
    round: roundOf(comments),
    stuck: stuck ?? (hasLabel(parent, NEEDS_INFO_LABEL) || hasLabel(parent, '点火超时')),
    note: visibleNote(note),
  })
}

function notifyAction({ parent, owner, repo, event, scope = '', data, link }) {
  const facts = parentFacts(parent)
  return {
    type: 'notify',
    event,
    key: eventKey({ owner, repo, subject: `#${parent.number}`, event, scope }),
    data: { customer: facts.customer, requirement: facts.requirement, ...data },
    link: link || parentLink(parent, owner, repo),
  }
}

function needsInfoActions({ parent, comments, state, reason, owner, repo, tickets = [] }) {
  const targets = tickets.length ? tickets : [undefined]
  const lines = targets
    .map((ticket) =>
      progressFor({
        parent,
        state,
        comments,
        ticket,
        stuck: true,
        note: reason,
      }),
    )
    .join('\n')
  const body = progressComment(lines, reason)
  return [
    { type: 'addLabel', name: NEEDS_INFO_LABEL },
    { type: 'comment', body },
    notifyAction({
      parent,
      owner,
      repo,
      event: 'needs-info',
      scope: state || '无状态',
      data: { round: roundOf(comments) },
    }),
  ]
}

function selectTicket({ subIssues, closedNumbers }) {
  const open = subIssues
    .filter(isOpen)
    .filter((ticket) => !hasLabel(ticket, '状态:待验收'))
    .sort((left, right) => left.number - right.number)
  const ready = frontier({ tickets: open, closedNumbers })
  return ready[0] || null
}

function igniteEligible({ subIssues, jobs, now, jobPolicy }) {
  return subIssues.filter(
    (ticket) =>
      !jobBlocked(findJob(jobs, { action: 'ignite', ticket: ticket.number }), {
        now,
        policy: jobPolicy,
      }),
  )
}

/**
 * 开发中挑下一张子票，返回点火动作。
 * 驳回建的修复子票、子票跑完后接上的下一张，都走这里。
 * 条件：有 open 子票、没有子票正在跑、并发额度够。
 * `selectTicket` 还要能挑出没有未关闭阻塞的票。
 * 没有可跑的票时返回空数组，等下一次状态变化。
 */
function igniteNextActions({ subIssues, closedNumbers, repoBusy, activeCount, maxActive, jobs = [], now, jobPolicy = {} }) {
  const open = subIssues.filter(isOpen)
  if (open.length === 0) return []
  if (open.some(isSandcastle)) return []
  const ticket = selectTicket({
    subIssues: igniteEligible({ subIssues: open, jobs, now, jobPolicy }),
    closedNumbers,
  })
  if (!ticket) return []
  if (repoBusy || activeCount >= maxActive) return []
  return [{ type: 'ignite', ticket, ticketNumber: ticket.number }]
}

/**
 * 子票全部完成、每张票都已合进需求分支，叫收尾。
 * 分支事实由 `collectBranchFacts` 提前算好；这里只看快照，不碰 git。
 * 收尾成功后才转 `待验收`，失败留在 `开发中` 等下一轮。
 * 作业表里写了 stop 或还在退避时，不叫收尾，也不转状态。
 */
function finishActions({ parent, subIssues, jobs = [], now, jobPolicy = {} }) {
  const finishJob = findJob(jobs, { action: 'finish' })
  if (jobBlocked(finishJob, { now, policy: jobPolicy })) return []
  if (parent?.branchesMerged !== true) return []
  const order = String(parent?.order || '')
  if (!order || subIssues.length === 0) return []
  if (subIssues.some(isOpen)) return []
  return [
    { type: 'finish', reqBranch: `req/${order}` },
    { type: 'setState', from: '开发中', to: '待验收' },
  ]
}

/**
 * 一张父工单该做什么。纯函数，不碰 GitHub。
 * @returns {Array<object>} 动作数组；空数组表示停，等下一次状态变化。
 */
export function routeParent({
  parent,
  comments = [],
  subIssues = [],
  spec = null,
  closedNumbers = [],
  trails = [],
  jobs = [],
  jobPolicy = {},
  now,
  maxActive = 5,
  activeCount = 0,
  repoBusy = false,
  owner,
  repo,
}) {
  const state = stateOf(parent)
  if (!state) {
    return needsInfoActions({ parent, comments, state, reason: '状态对不上', owner, repo })
  }

  // 作业表停了线，或父工单还挂着 needs-info：这一轮什么都不推，等运营者处理。
  // 待验收的驳回照旧处理，不被停线挡住。
  const stopped = blockingStop(jobs)
  if (state !== '待验收' && (stopped || hasLabel(parent, NEEDS_INFO_LABEL))) return []

  const small = isSmall(parent)
  const signal = latestSignal(comments)
  const openTickets = subIssues.filter(isOpen).map((ticket) => ticket.number)

  if (state === '待验收') {
    if (signal?.kind === '驳回：' && !progressAfter(comments, signal.index)) {
      const body = progressFor({
        parent,
        state,
        comments,
        tier: '已驳回',
        step: '记驳回',
        stuck: false,
      })
      return [
        { type: 'setState', from: '待验收', to: '开发中' },
        { type: 'comment', body },
        { type: 'createFixTicket', rejection: signal.comment || { body: signal.body } },
      ]
    }
    return []
  }

  // 驳回后重跑对应 Agent：已提交重列补缺口；排队中有 spec、没子票时重拆票。
  // 小需求不走拆票。新的提案、改口和其余驳回仍然停。
  const rerunGap = state === '已提交' && signal?.kind === '驳回：补缺口'
  const rerunDecompose =
    !small &&
    state === '排队中' &&
    signal?.kind === '驳回：拆票' &&
    Boolean(spec) &&
    subIssues.length === 0

  // 开发中读到驳回、并且驳回后面已经写过进度行，说明修复子票已建，接着点火；
  // 其余等待信号（新的提案、没处理过的驳回、改口）仍然停。
  const handledRejection =
    state === '开发中' &&
    signal?.kind === '驳回：' &&
    progressAfter(comments, signal.index)
  if (isWaitingSignal(signal?.kind) && !handledRejection && !rerunGap && !rerunDecompose) return []

  if (small) {
    if (state === '排队中') {
      return needsInfoActions({
        parent,
        comments,
        state,
        reason: '小需求却是排队中',
        owner,
        repo,
      })
    }
    if (state === '已提交' && signal?.kind === '点头：补缺口') {
      const ticket = selectTicket({
        subIssues: igniteEligible({ subIssues, jobs, now, jobPolicy }),
        closedNumbers,
      })
      if (!ticket) {
        return needsInfoActions({
          parent,
          comments,
          state,
          reason: '小需求没有 open 子票',
          owner,
          repo,
        })
      }
      const already = isSandcastle(ticket)
      if (!already && (repoBusy || activeCount >= maxActive)) return []
      return [
        { type: 'setState', from: '已提交', to: '开发中' },
        { type: 'comment', body: progressFor({ parent, state: '开发中', comments, ticket: ticket.number }) },
        ...(already ? [] : [{ type: 'ignite', ticket, ticketNumber: ticket.number }]),
      ]
    }
    if (rerunGap) {
      const gapJob = findJob(jobs, { action: 'gap-proposal' })
      if (jobBlocked(gapJob, { now, policy: jobPolicy })) return []
      return [{ type: 'runGapProposal' }]
    }
    if (state === '开发中') {
      const finish = finishActions({ parent, subIssues, jobs, now, jobPolicy })
      if (finish.length) return finish
      const hits = stallHits({ comments, trails, openTickets })
      if (hits.length) return stallActions({ parent, comments, state, hits, owner, repo })
      return igniteNextActions({ subIssues, closedNumbers, repoBusy, activeCount, maxActive, jobs, now, jobPolicy })
    }
    return []
  }

  if (state === '已提交') {
    if (signal?.kind !== '点头：补缺口') {
      const gapJob = findJob(jobs, { action: 'gap-proposal' })
      if (jobBlocked(gapJob, { now, policy: jobPolicy })) return []
      return [{ type: 'runGapProposal' }]
    }
    return [
      { type: 'setState', from: '已提交', to: '排队中' },
      { type: 'comment', body: progressFor({ parent, state: '排队中', comments }) },
      notifyAction({
        parent,
        owner,
        repo,
        event: '该跑 to-spec',
        scope: String(daysBetween(signal.comment?.created_at, now)),
        data: { days_waited: daysBetween(signal.comment?.created_at, now) },
      }),
    ]
  }

  if (state === '开发中') {
    const finish = finishActions({ parent, subIssues, jobs, now, jobPolicy })
    if (finish.length) return finish
  }

  if (state === '排队中' || state === '开发中') {
    const hits = stallHits({ comments, trails, openTickets })
    if (hits.length) return stallActions({ parent, comments, state, hits, owner, repo })
  }

  if (state === '开发中') {
    return igniteNextActions({ subIssues, closedNumbers, repoBusy, activeCount, maxActive, jobs, now, jobPolicy })
  }

  if (state === '排队中') {
    if (spec && subIssues.length === 0) {
      const decomposeJob = findJob(jobs, { action: 'decompose' })
      if (jobBlocked(decomposeJob, { now, policy: jobPolicy })) return []
      return [{ type: 'runDecompose' }]
    }
    if (!spec && signal?.kind === '点头：补缺口') {
      const toSpecJob = findJob(jobs, { action: 'to-spec' })
      if (jobBlocked(toSpecJob, { now, policy: jobPolicy })) return []
      return [{ type: 'runToSpec' }]
    }
    if (signal?.kind === '点头：拆票') {
      const ticket = selectTicket({
        subIssues: igniteEligible({ subIssues, jobs, now, jobPolicy }),
        closedNumbers,
      })
      if (!ticket) return []
      const already = isSandcastle(ticket)
      if (!already && (repoBusy || activeCount >= maxActive)) return []
      return [
        { type: 'setState', from: '排队中', to: '开发中' },
        { type: 'comment', body: progressFor({ parent, state: '开发中', comments, ticket: ticket.number }) },
        ...(already ? [] : [{ type: 'ignite', ticket, ticketNumber: ticket.number }]),
      ]
    }
    return []
  }

  // 开发中：等子票跑完，调度器没有可推进的动作。
  return []
}

/** 子票进入 `待验收` 或关闭后摘掉队列标签。 */
export function cleanupActions(snapshot) {
  const actions = []
  for (const parent of snapshot?.parents || []) {
    for (const ticket of parent.subIssues || []) {
      if (!isSandcastle(ticket)) continue
      if (ticket.state === 'closed' || hasLabel(ticket, '状态:待验收')) {
        actions.push({
          type: 'removeSandcastle',
          parentNumber: parent.number,
          ticketNumber: ticket.number,
        })
      }
    }
  }
  return actions
}

function daysBetween(from, now) {
  const start = Date.parse(from || '')
  const end = now instanceof Date ? now.getTime() : Date.parse(now || '')
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0
  return Math.floor((end - start) / (24 * 60 * 60 * 1000))
}

/**
 * 新建父工单第一次出现时推一条「新单进队列」。
 * 只看两条事实：状态是 `已提交`，且工单上还没有任何评论。
 * key 固定用父工单号，通知模块记得发过，重启不重复。
 */
export function newTicketEvent({ parent, comments = [], owner, repo }) {
  if (stateOf(parent) !== '已提交') return null
  if (Array.isArray(comments) && comments.length > 0) return null
  return notifyAction({
    parent,
    owner,
    repo,
    event: '新单进队列',
    data: {},
  })
}

/**
 * 等人待办的共用判据：点头：补缺口、父工单排队中、还没有 spec，就是该跑 to-spec。
 * 通知按天去重，console 用来列待办，两边共用这一条。
 */
export function toSpecWaiting({ parent, latestGate } = {}) {
  return latestGate?.kind === '点头：补缺口' && !parent?.spec && stateOf(parent) === '排队中'
}

/**
 * 提案事件的 scope 带关口评论 id（缺了用 created_at），
 * 同一天的第二份提案也换新 key，24 小时重复靠天数再换一次。
 */
function proposalScope(comment, days) {
  const stamp = comment?.id ?? comment?.created_at ?? ''
  return [String(stamp), String(days)].filter(Boolean).join(':')
}

/**
 * 四条等人待办：提案：补缺口、点头：补缺口但没 spec、提案：拆票、需要你答。
 * 每 24 小时换一个新 scope，通知模块按 key 去重，同一事实同一天只送一次。
 * 给了 owner 和 repo 时 key 带仓库身份，两个客户仓同号不会相撞。
 */
export function pendingReminder({ parent, latestGate, now, needsAnswer = [], owner = '', repo = '' }) {
  const state = stateOf(parent)
  const waitingState = state === '已提交' || state === '排队中'
  const answers = Array.isArray(needsAnswer) ? needsAnswer : []

  if (answers.length) {
    const item = answers[0]
    const days = daysBetween(item.opened_at || item.created_at, now)
    return {
      event: '需要你答',
      days_waited: days,
      key: eventKey({
        owner,
        repo,
        subject: `#${parent.number}`,
        event: '需要你答',
        scope: `${item.key}:${days}`,
      }),
      item,
    }
  }

  if (!latestGate || !waitingState) return null
  const kind = latestGate.kind
  const at = latestGate.comment?.created_at
  const base = { owner, repo, subject: `#${parent.number}` }

  if (kind === '提案：补缺口') {
    const days = daysBetween(at, now)
    return {
      event: '补缺口提案',
      days_waited: days,
      key: eventKey({ ...base, event: '补缺口提案', scope: proposalScope(latestGate.comment, days) }),
      gate: latestGate,
    }
  }
  if (toSpecWaiting({ parent, latestGate })) {
    const days = daysBetween(at, now)
    if (days < 1) return null
    return {
      event: '该跑 to-spec',
      days_waited: days,
      key: eventKey({ ...base, event: '该跑 to-spec', scope: String(days) }),
      gate: latestGate,
    }
  }
  if (kind === '提案：拆票') {
    const days = daysBetween(at, now)
    return {
      event: '拆票提案',
      days_waited: days,
      key: eventKey({ ...base, event: '拆票提案', scope: proposalScope(latestGate.comment, days) }),
      gate: latestGate,
    }
  }
  return null
}

function localDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** 每天当地 8:30 之后，今天还没发过，就该发每日抽样。 */
export function dueDigest({ now = new Date(), lastSentDate = null } = {}) {
  const date = now instanceof Date ? now : new Date(now)
  if (!Number.isFinite(date.getTime())) return false
  if (lastSentDate === localDate(date)) return false
  return date.getHours() * 60 + date.getMinutes() >= 8 * 60 + 30
}

/** 每日抽样事件。没有合并返回 null，一单都不发。 */
export function digestEvent({ items = [], date = '' } = {}) {
  if (!Array.isArray(items) || items.length === 0) return null
  const day = date || items[0]?.date || ''
  return {
    v: 1,
    key: eventKey({ event: '每日抽样', scope: day }),
    event: '每日抽样',
    data: {
      date: day,
      items: items.map((item) => ({
        customer: item.customer,
        requirement: item.requirement,
        pr: item.pr,
        ...(item.url ? { url: item.url } : {}),
      })),
    },
  }
}

// ---- 发现客户仓 ----

/**
 * 只读 `customers.json`：`status === 'active'` 且 `repos` 非空的行。
 * 不按前缀扫账号下的仓。
 */
export function collectRepos({ gh, customers, owner }) {
  const rows = Array.isArray(customers) ? customers : customers?.customers
  if (!Array.isArray(rows)) return []
  const result = []
  const seen = new Set()
  const ordered = [...rows].sort((left, right) =>
    String(left?.id || '').localeCompare(String(right?.id || '')),
  )
  for (const row of ordered) {
    if (row?.status !== 'active') continue
    const repos = row.repos
    if (!repos || typeof repos !== 'object' || Array.isArray(repos)) continue
    for (const [product, value] of Object.entries(repos)) {
      if (typeof value !== 'string' || !value.trim()) continue
      const fullName = value.includes('/') ? value.trim() : owner ? `${owner}/${value.trim()}` : ''
      const [repoOwner, repo] = fullName.split('/')
      if (!repoOwner || !repo) continue
      if (owner && repoOwner !== owner) continue
      if (seen.has(`${repoOwner}/${repo}`)) continue
      seen.add(`${repoOwner}/${repo}`)
      result.push({
        customerId: row.id || '',
        shortName: row.short_name || '',
        product,
        owner: repoOwner,
        repo,
        fullName: `${repoOwner}/${repo}`,
      })
    }
  }
  return result
}

// ---- 读快照 ----

function isMapIssue(issue) {
  return hasLabel(issue, `${WAYFINDER_PREFIX}map`)
}

function isDecisionIssue(issue) {
  return labelNames(issue).some((name) => name.startsWith(WAYFINDER_PREFIX)) && !isMapIssue(issue)
}

export function isParentIssue(issue) {
  return String(issue?.body || '').includes('<!-- factory:order=')
}

export function isSpecIssue(issue) {
  return hasLabel(issue, 'ready-for-agent')
}

/**
 * 父工单对应的 spec：标题或正文带需求名。
 * 返回父工单事实和命中的 spec；没有 spec 时 `spec` 为 null。
 */
export function specForParent({ parent, specs = [] } = {}) {
  const facts = parentFacts(parent)
  const spec =
    specs.find(
      (candidate) =>
        facts.requirement &&
        (String(candidate.title || '').includes(facts.requirement) ||
          String(candidate.body || '').includes(facts.requirement)),
    ) || null
  return { facts, spec }
}

function slimIssue(issue, extra = {}) {
  return {
    number: issue.number,
    id: issue.id,
    title: issue.title,
    body: issue.body,
    state: issue.state,
    labels: labelNames(issue).map((name) => ({ name })),
    html_url: issue.html_url,
    ...extra,
  }
}

function slimComments(comments = []) {
  return comments.map((comment) => ({
    id: comment.id,
    body: comment.body,
    created_at: comment.created_at,
    html_url: comment.html_url,
  }))
}

/**
 * 一个客户仓的纯数据快照。不做判断，只把路由要看的可检查事实读出来。
 */
export async function collectSnapshot({ gh, owner, repo }) {
  const issues = await gh.listIssues({ owner, repo, state: 'open' })
  const maps = []
  const decisions = []
  const parents = []
  const specs = []

  for (const issue of issues) {
    if (isMapIssue(issue)) {
      const comments = await gh.listComments({ owner, repo, number: issue.number })
      maps.push(slimIssue(issue, { comments: slimComments(comments) }))
      continue
    }
    if (isDecisionIssue(issue)) {
      decisions.push(slimIssue(issue))
      continue
    }
    if (isParentIssue(issue)) {
      parents.push(issue)
      continue
    }
    if (isSpecIssue(issue)) specs.push(issue)
  }

  const parentRows = []
  for (const parent of parents) {
    const comments = await gh.listComments({ owner, repo, number: parent.number })
    const children = await gh.listSubIssues({ owner, repo, number: parent.number })
    const closedNumbers = new Set(
      children.filter((child) => child.state === 'closed').map((child) => child.number),
    )
    const subIssues = []
    for (const child of children) {
      const blockedBy = []
      if (child.state !== 'closed') {
        const blockers = await gh.listBlockedBy({ owner, repo, number: child.number })
        for (const blocker of blockers) {
          blockedBy.push(blocker.number)
          if (blocker.state === 'closed') closedNumbers.add(blocker.number)
        }
      }
      subIssues.push(
        slimIssue(child, {
          blockedBy,
          state: child.state,
        }),
      )
    }

    const { facts, spec } = specForParent({ parent, specs })

    parentRows.push(
      slimIssue(parent, {
        comments: slimComments(comments),
        subIssues,
        closedNumbers: [...closedNumbers],
        spec: spec ? slimIssue(spec) : null,
        customer: facts.customer,
        requirement: facts.requirement,
        order: facts.order,
      }),
    )
  }

  return { owner, repo, maps, decisions, parents: parentRows }
}

/**
 * 读一个客户仓里所有子票的 trail，给「同类问题跨票两次」用。
 * 仓库还没 clone 或没有 `.audit` 时返回空数组。
 */
export async function collectTrails({ repoDir, parents = [] } = {}) {
  if (!repoDir) return []
  const trails = []
  for (const parent of parents) {
    for (const ticket of parent.subIssues || []) {
      const rows = await readTrail({ repoDir, ticket: ticket.number }).catch(() => [])
      if (rows.length) trails.push({ ticket: ticket.number, rows })
    }
  }
  return trails
}

/**
 * 收尾前的分支事实：子票全关，且每个 `ticket/<n>` 都已合进 `req/<order>`。
 * 结果写到父工单快照的 `branchesMerged`。仓库读不到、分支不存在或子票没齐一律 false。
 */
export async function collectBranchFacts({ repoDir, parents = [] } = {}) {
  for (const parent of parents) {
    parent.branchesMerged = await branchesMerged({ repoDir, parent })
  }
  return parents
}

async function branchesMerged({ repoDir, parent }) {
  const order = String(parent?.order || '')
  const subIssues = parent?.subIssues || []
  if (!repoDir || !order || subIssues.length === 0) return false
  if (subIssues.some((ticket) => ticket.state !== 'closed')) return false
  const reqBranch = `req/${order}`
  for (const ticket of subIssues) {
    const ticketBranch = `ticket/${ticket.number}`
    try {
      await git(repoDir, ['rev-parse', '--verify', '--quiet', ticketBranch])
      await git(repoDir, ['merge-base', '--is-ancestor', ticketBranch, reqBranch])
    } catch {
      return false
    }
  }
  return true
}

// ---- 路由一个仓 ----

function stillSandcastle(ticket) {
  return (
    isSandcastle(ticket) &&
    ticket.state !== 'closed' &&
    !hasLabel(ticket, '状态:待验收')
  )
}

/** 地图上最新一条 `重传：<日期>` 评论。 */
function latestReupload(comments = []) {
  for (let index = comments.length - 1; index >= 0; index -= 1) {
    const first = normalizedFirstLine(comments[index]?.body)
    if (!first.startsWith('重传：')) continue
    const rest = first.slice('重传：'.length).trim()
    const date = /(\d{4}-\d{2}-\d{2})/.exec(rest)?.[1] || rest
    return { date, comment: comments[index], index }
  }
  return null
}

/** 地图正文的 `<!-- factory:parent=<链接> -->` 或 Notes 里的父工单链接。 */
function mapParentNumber(map) {
  const body = String(map?.body || '')
  const marker = /<!--\s*factory:parent=([^>]+?)\s*-->/.exec(body)
  const note = /^\s*-\s*父工单：\s*(\S+)/m.exec(body)
  const url = marker?.[1] || note?.[1] || ''
  const match = /\/issues\/(\d+)/.exec(url)
  return match ? Number(match[1]) : null
}

function mapFacts(map, parentsByNumber) {
  const parent = parentsByNumber.get(mapParentNumber(map))
  if (parent) {
    const facts = parentFacts(parent)
    return {
      customer: parent.customer || facts.customer,
      requirement: parent.requirement || facts.requirement,
    }
  }
  const facts = parentFacts(map)
  return { customer: facts.customer, requirement: facts.requirement || map?.title || '' }
}

export function routeRepo({ snapshot, now, maxActive = 5, activeCount = 0, owner, repo, jobs = [], jobPolicy = {} }) {
  let active = activeCount
  let repoBusy = (snapshot?.parents || []).some((parent) =>
    (parent.subIssues || []).some(stillSandcastle),
  )
  const decisions = []
  const trails = snapshot?.trails || []
  for (const parent of snapshot?.parents || []) {
    const ownsSandcastle = (parent.subIssues || []).some(stillSandcastle)
    const actions = routeParent({
      parent,
      comments: parent.comments || [],
      subIssues: parent.subIssues || [],
      spec: parent.spec || null,
      closedNumbers: parent.closedNumbers || [],
      trails,
      jobs: jobs.filter(
        (row) => row?.owner === owner && row?.repo === repo && row?.parent === parent.number,
      ),
      jobPolicy,
      now,
      maxActive,
      activeCount: active,
      repoBusy: repoBusy && !ownsSandcastle,
      owner,
      repo,
    })
    if (actions.some((action) => action.type === 'ignite')) {
      active += 1
      repoBusy = true
    }
    decisions.push({ parent, actions })
  }

  const parentsByNumber = new Map((snapshot?.parents || []).map((parent) => [parent.number, parent]))
  const maps = []
  for (const map of snapshot?.maps || []) {
    const reupload = latestReupload(map.comments || [])
    if (!reupload) continue
    const facts = mapFacts(map, parentsByNumber)
    maps.push({
      map,
      actions: [
        {
          type: 'notify',
          event: '重传地图已更新',
          key: eventKey({
            owner,
            repo,
            subject: `#${map.number}`,
            event: '重传地图已更新',
            scope: reupload.date,
          }),
          data: { customer: facts.customer, requirement: facts.requirement },
          link: map.html_url || parentLink(map, owner, repo),
        },
      ],
    })
  }

  return { decisions, maps, activeCount: active }
}

// ---- 执行动作 ----

function missingImplementation(actions, { ignite, decompose, toSpec, gapProposal, createFixTicket, finish }) {
  for (const action of actions) {
    if (action.type === 'finish' && typeof finish !== 'function') return 'finish'
    if (action.type === 'ignite' && typeof ignite !== 'function') return 'ignite'
    if (action.type === 'runDecompose' && typeof decompose !== 'function') return 'decompose'
    if (action.type === 'runToSpec' && typeof toSpec !== 'function') return 'toSpec'
    if (action.type === 'runGapProposal' && typeof gapProposal !== 'function') {
      return 'gapProposal'
    }
    if (action.type === 'createFixTicket' && typeof createFixTicket !== 'function') {
      return 'createFixTicket'
    }
  }
  return null
}

function defaultLockDir() {
  return join(homedir(), '.grilling', 'factory', 'locks')
}

async function setStateLabel({ gh, owner, repo, parent, to }) {
  const current = await gh.getIssue({ owner, repo, number: parent.number })
  const names = labelNames(current)
  const target = `状态:${to}`
  const others = names.filter((name) => name.startsWith('状态:') && name !== target)
  const missing = !names.includes(target)
  if (missing) {
    await ensureLabel(gh, { owner, repo, name: target, ...STATE_LABELS[target] })
    await gh.addLabels({ owner, repo, number: parent.number, labels: [target] })
  }
  for (const name of others) {
    await gh.removeLabel({ owner, repo, number: parent.number, name })
  }
  return { type: 'setState', changed: missing || others.length > 0 }
}

async function ensureIssueLabel({ gh, owner, repo, number, name }) {
  const current = await gh.getIssue({ owner, repo, number })
  if (labelNames(current).includes(name)) return { type: 'addLabel', name, changed: false }
  await ensureLabel(gh, { owner, repo, name })
  await gh.addLabels({ owner, repo, number, labels: [name] })
  return { type: 'addLabel', name, changed: true }
}

async function removeSandcastleLabel({ gh, owner, repo, ticketNumber }) {
  const current = await gh.getIssue({ owner, repo, number: ticketNumber })
  if (!labelNames(current).includes(SANDBOX_LABEL)) {
    return { type: 'removeSandcastle', changed: false }
  }
  await gh.removeLabel({ owner, repo, number: ticketNumber, name: SANDBOX_LABEL })
  return { type: 'removeSandcastle', changed: true }
}

async function executeIgnite({ gh, owner, repo, parent, action, ignite, config, now, clock, signal }) {
  const ticketNumber = action.ticketNumber ?? action.ticket?.number
  const fresh = await gh.getIssue({ owner, repo, number: ticketNumber })
  if (labelNames(fresh).includes(SANDBOX_LABEL)) {
    return { type: 'ignite', ticket: ticketNumber, skipped: 'already-sandcastle' }
  }
  const lockPath = join(config.lockDir || defaultLockDir(), `${owner}__${repo}.lock`)
  const lock = await acquireFileLock(lockPath, {
    timeoutMs: 0,
    staleMs: config.lockStaleMs ?? 10 * 60 * 1000,
  })
  if (lock.skipped) return { type: 'ignite', ticket: ticketNumber, skipped: 'locked' }

  let claimed = false
  try {
    const again = await gh.getIssue({ owner, repo, number: ticketNumber })
    if (labelNames(again).includes(SANDBOX_LABEL)) {
      return { type: 'ignite', ticket: ticketNumber, skipped: 'already-sandcastle' }
    }
    await ensureIssueLabel({ gh, owner, repo, number: ticketNumber, name: SANDBOX_LABEL })
    claimed = true
  } finally {
    if (!claimed) await lock.release()
  }

  // 认领完成：实现跑在后台，这一轮不等它。锁跟到后台任务结束才放；
  // 进程重启后由已经贴上的 Sandcastle 标签挡住重复点火。
  config.pendingIgnitions ??= new Set()
  const previousRows = config.jobs?.rowsFor?.({ owner, repo, parent: parent.number }) || []
  const previous = previousRows.find(
    (row) => row?.action === 'ignite' && row?.ticket === ticketNumber,
  )
  const attempt = (previous?.attempt || 0) + 1
  const task = runIgnitionInBackground({
    gh,
    owner,
    repo,
    parent,
    ticket: action.ticket,
    ticketNumber,
    attempt,
    ignite,
    lock,
    log: config.log,
    jobs: config.jobs || null,
    jobPolicy: config.jobPolicy || {},
    now,
    clock,
    signal,
  })
  config.pendingIgnitions.add(task)
  const forget = () => config.pendingIgnitions.delete(task)
  task.then(forget, forget)
  return { type: 'ignite', ticket: ticketNumber, started: true }
}

async function runIgnitionInBackground({
  gh,
  owner,
  repo,
  parent,
  ticket,
  ticketNumber,
  attempt = 1,
  ignite,
  lock,
  log,
  jobs,
  jobPolicy,
  now,
  clock,
  signal,
}) {
  // 点火可能跑很久，作业行的 lastBeat 要用失败那一刻的时间，不能拿轮次开始时间。
  const currentTime = () => {
    if (typeof clock !== 'function') return now || new Date()
    const value = clock()
    return value instanceof Date ? value : new Date(value)
  }
  const writeFailure = async (reason) => {
    await gh.removeLabel({ owner, repo, number: ticketNumber, name: SANDBOX_LABEL }).catch(() => {})
    if (!jobs) return
    try {
      const row = await jobs.recordFailure({
        owner,
        repo,
        parent: parent.number,
        ticket: ticketNumber,
        action: 'ignite',
        reason,
        now: currentTime(),
        policy: jobPolicy,
      })
      if (row?.stop) {
        await ensureIssueLabel({ gh, owner, repo, number: parent.number, name: NEEDS_INFO_LABEL })
      }
    } catch (writeError) {
      ;(log || logLine)({
        level: 'error',
        msg: '点火失败没写进作业表',
        owner,
        repo,
        ticket: ticketNumber,
        error: writeError.message,
      })
    }
  }

  try {
    const result = await ignite({
      owner,
      repo,
      parent: { number: parent.number, title: parent.title, body: parent.body },
      ticket,
      attempt,
      signal,
    })
    if (result?.skipped) {
      // busy/blocked：这次没真正跑，不写作业表，不涨 attempt，不进退避。
      return
    }
    if (result?.ok === false) {
      const detail = String(result.error || result.reason || '').trim()
      const reason = result.timeout ? '点火超时' : detail ? `点火失败：${detail}` : '点火失败'
      ;(log || logLine)({
        level: 'error',
        msg: '后台点火失败',
        owner,
        repo,
        ticket: ticketNumber,
        error: reason,
      })
      await writeFailure(reason)
      return
    }
    if (jobs) {
      try {
        await jobs.recordSuccess({
          owner,
          repo,
          parent: parent.number,
          ticket: ticketNumber,
          action: 'ignite',
          now: currentTime(),
        })
      } catch (writeError) {
        ;(log || logLine)({
          level: 'error',
          msg: '点火成功没写进作业表',
          owner,
          repo,
          ticket: ticketNumber,
          error: writeError.message,
        })
      }
    }
  } catch (error) {
    const reason = `点火失败：${String(error?.message || error)}`
    ;(log || logLine)({
      level: 'error',
      msg: '后台点火失败',
      owner,
      repo,
      ticket: ticketNumber,
      error: String(error?.message || error),
    })
    await writeFailure(reason)
  } finally {
    await lock.release()
  }
}

function notificationPayload(event, now) {
  return notificationEvent({
    key: event.key,
    event: event.event,
    data: event.data,
    link: event.link,
    now: now instanceof Date ? now : new Date(now),
  })
}

/** 调度器这一层的发送：先查本轮已发 key，再走统一的 sendEvent。 */
async function deliverEvent({ notifier, event, config, now }) {
  const payload = notificationPayload(event, now)
  if (config.notifiedKeys?.has(payload.key)) {
    return { type: 'notify', event: payload.event, key: payload.key, skipped: 'already-notified' }
  }
  const result = await sendNotification(notifier, {
    key: payload.key,
    event: payload.event,
    data: payload.data,
    link: payload.link,
    now,
  })
  if (result?.code === 0) config.notifiedKeys?.add(payload.key)
  return { type: 'notify', event: payload.event, key: payload.key, code: result?.code }
}

const EXECUTION_ORDER = [
  'finish',
  'runGapProposal',
  'runToSpec',
  'runDecompose',
  'ignite',
  'createFixTicket',
  'setState',
  'addLabel',
  'removeSandcastle',
  'comment',
  'notify',
]

async function executeActions({
  gh,
  owner,
  repo,
  parent,
  actions,
  ignite,
  decompose,
  toSpec,
  gapProposal,
  createFixTicket,
  finish,
  notifier,
  config,
  now,
  clock,
  signal,
}) {
  const missing = missingImplementation(actions, { ignite, decompose, toSpec, gapProposal, createFixTicket, finish })
  if (missing) return { skipped: missing, results: [] }

  const ordered = [...actions].sort(
    (left, right) => EXECUTION_ORDER.indexOf(left.type) - EXECUTION_ORDER.indexOf(right.type),
  )
  const results = []
  for (const action of ordered) {
    if (action.type === 'finish') {
      const result = await finish({ owner, repo, parent, reqBranch: action.reqBranch })
      results.push({ type: 'finish', result })
      // 收尾没成就不转状态，下一轮再看。
      if (result?.ok !== true) return { skipped: 'finish-failed', results }
    } else if (action.type === 'setState') {
      results.push(await setStateLabel({ gh, owner, repo, parent, to: action.to }))
    } else if (action.type === 'comment') {
      const created = await ensureCommentOnce(gh, {
        owner,
        repo,
        number: parent.number,
        body: action.body,
      })
      results.push({ type: 'comment', created })
    } else if (action.type === 'notify') {
      results.push(await deliverEvent({ notifier, event: action, config, now }))
    } else if (action.type === 'addLabel') {
      results.push(
        await ensureIssueLabel({ gh, owner, repo, number: parent.number, name: action.name }),
      )
    } else if (action.type === 'removeSandcastle') {
      results.push(
        await removeSandcastleLabel({
          gh,
          owner,
          repo,
          ticketNumber: action.ticketNumber ?? action.ticket,
        }),
      )
    } else if (action.type === 'runDecompose') {
      const result = await decompose({ owner, repo, parent, spec: parent.spec || null })
      results.push({ type: 'runDecompose', result })
    } else if (action.type === 'runToSpec') {
      const result = await toSpec({ owner, repo, parent, spec: parent.spec || null })
      results.push({ type: 'runToSpec', result })
      if (result?.ok === false) {
        await ensureCommentOnce(gh, {
          owner,
          repo,
          number: parent.number,
          body: `to-spec 失败：${failureText(result)}。按退避重试，到上限会挂 needs-info。`,
        })
      }
    } else if (action.type === 'runGapProposal') {
      const result = await gapProposal({ owner, repo, parent })
      results.push({ type: 'runGapProposal', result })
      if (result?.ok === false) {
        results.push(
          await ensureIssueLabel({
            gh,
            owner,
            repo,
            number: parent.number,
            name: NEEDS_INFO_LABEL,
          }),
        )
      }
    } else if (action.type === 'ignite') {
      const result = await executeIgnite({ gh, owner, repo, parent, action, ignite, config, now, clock, signal })
      results.push(result)
      // 抢不到仓锁：这一轮整张票都不动，状态留给下一轮，避免没点火就先改开发中。
      if (result.skipped === 'locked') return { skipped: 'locked', results }
    } else if (action.type === 'createFixTicket') {
      const result = await createFixTicket({ owner, repo, parent, rejection: action.rejection })
      results.push({ type: 'createFixTicket', result })
    }
  }
  return { skipped: null, results }
}

function decisionOf(actions) {
  if (actions.some((action) => action.type === 'finish')) return 'finish'
  if (actions.some((action) => action.type === 'createFixTicket')) return 'reject'
  if (actions.some((action) => action.type === 'ignite')) return 'develop'
  if (actions.some((action) => action.type === 'runGapProposal')) return 'gap-proposal'
  if (actions.some((action) => action.type === 'runToSpec')) return 'to-spec'
  if (actions.some((action) => action.type === 'runDecompose')) return 'decompose'
  if (actions.some((action) => action.type === 'addLabel' && action.name === NEEDS_INFO_LABEL)) {
    return 'needs-info'
  }
  if (actions.some((action) => action.type === 'setState')) return 'advance'
  if (actions.some((action) => action.type === 'removeSandcastle')) return 'cleanup'
  return 'wait'
}

function reasonOf(parent, actions) {
  const parts = [`状态:${stateOf(parent) || '对不上'}`]
  if (isSmall(parent)) parts.push('小需求')
  const signal = latestSignal(parent.comments || [])
  if (signal) parts.push(`最新关口:${signal.kind}`)
  const notification = actions.find((action) => action.type === 'notify')
  if (notification) parts.push(`通知:${notification.event}`)
  const ignition = actions.find((action) => action.type === 'ignite')
  if (ignition) parts.push(`点火:#${ignition.ticketNumber ?? ignition.ticket?.number}`)
  return parts.join('｜')
}

function summarizeAction(action) {
  if (action.type === 'finish') return { type: 'finish', reqBranch: action.reqBranch }
  if (action.type === 'setState') return { type: 'setState', from: action.from, to: action.to }
  if (action.type === 'comment') return { type: 'comment', body: action.body }
  if (action.type === 'notify') return { type: 'notify', event: action.event, key: action.key }
  if (action.type === 'ignite') return { type: 'ignite', ticket: action.ticketNumber ?? action.ticket?.number }
  if (action.type === 'runDecompose') return { type: 'runDecompose' }
  if (action.type === 'runToSpec') return { type: 'runToSpec' }
  if (action.type === 'runGapProposal') return { type: 'runGapProposal' }
  if (action.type === 'addLabel') return { type: 'addLabel', name: action.name }
  if (action.type === 'createFixTicket') return { type: 'createFixTicket' }
  if (action.type === 'removeSandcastle') return { type: 'removeSandcastle', ticket: action.ticketNumber }
  return { type: action.type }
}

function countQuestions(body) {
  return (String(body || '').match(/^\s*\d+\.\s*题目：/gm) || []).length
}

function countTickets(body) {
  const explicit = /共\s*(\d+)\s*张票/.exec(String(body || ''))
  if (explicit) return Number(explicit[1])
  return (String(body || '').match(/^\s*-\s*\d+\.\s/gm) || []).length
}

export function reminderEvent({ reminder, parent, owner, repo, repoRoot = '' }) {
  const facts = parentFacts(parent)
  const kind =
    reminder.event === '补缺口提案'
      ? 'gap'
      : reminder.event === '拆票提案'
        ? 'split'
        : reminder.event === '需要你答'
          ? 'gate'
          : ''
  const event = {
    v: 1,
    key: reminder.key,
    event: reminder.event,
    link: parentLink(parent, owner, repo),
    data: {
      customer: facts.customer,
      requirement: facts.requirement,
      days_waited: reminder.days_waited,
      ...(kind ? { owner, repo, ticket: parent.number, kind } : {}),
    },
  }
  if (reminder.event === '补缺口提案') {
    event.data.question_count = countQuestions(reminder.gate?.body)
    if (reminder.gate?.comment?.html_url) {
      event.data.comment_url = reminder.gate.comment.html_url
    }
  }
  if (reminder.event === '拆票提案') {
    event.data.ticket_count = countTickets(reminder.gate?.body)
    if (reminder.gate?.comment?.html_url) {
      event.data.comment_url = reminder.gate.comment.html_url
    }
  }
  if (reminder.event === '需要你答') {
    event.data.question = reminder.item.question
    event.data.recommended = reminder.item.recommended
    if (repoRoot) event.data.repo_dir = join(repoRoot, repo)
    if (reminder.item.link) event.link = reminder.item.link
  }
  return event
}

async function resolveNeedsAnswer(config, context) {
  if (typeof config.needsAnswer === 'function') {
    const rows = await config.needsAnswer(context)
    return Array.isArray(rows) ? rows : []
  }
  return Array.isArray(config.needsAnswer) ? config.needsAnswer : []
}

function localDateOffset(date, days) {
  const moved = new Date(date.getTime())
  moved.setDate(moved.getDate() + days)
  return localDate(moved)
}


// ---- 作业表、心跳和看门狗 ----

const DEFAULT_STEP_TIMEOUT_MS = 30 * 60 * 1000
const DEFAULT_ROUND_TIMEOUT_MS = 30 * 60 * 1000
const DEFAULT_HEARTBEAT_MS = 60 * 1000
export const DEFAULT_PIPELINE_TIMEOUT_MS = 2 * 60 * 60 * 1000
export const DEFAULT_CANCEL_GRACE_MS = 10 * 1000

/** 三个硬上限：非 agent 步骤 30 分钟、单个 agent 45 分钟、一条管道 2 小时。 */
export function resolveTimeouts(env = process.env) {
  const pick = (key, fallback) => {
    const value = Number(env[key])
    return Number.isFinite(value) && value > 0 ? value : fallback
  }
  return {
    stepTimeoutMs: pick('AFK_STEP_TIMEOUT_MS', DEFAULT_STEP_TIMEOUT_MS),
    agentTimeoutMs: pick('AFK_AGENT_TIMEOUT_MS', DEFAULT_AGENT_TIMEOUT_MS),
    pipelineTimeoutMs: pick('AFK_PIPELINE_TIMEOUT_MS', DEFAULT_PIPELINE_TIMEOUT_MS),
  }
}

export class StepTimeoutError extends Error {
  constructor(label, timeoutMs) {
    super(`${label}超时：${timeoutMs} 毫秒没跑完`)
    this.name = 'StepTimeoutError'
    this.label = label
    this.timeoutMs = timeoutMs
  }
}

/**
 * 跑一步：跑的时候按时写心跳，超时就取消任务再抛 StepTimeoutError。
 * 取消后最多等 cancelGraceMs，让子进程和管道收尾，下一轮不会和这一轮叠着跑。
 */
export async function runJobStep({
  jobs,
  clock = () => new Date(),
  config = {},
  label = '这一步',
  task,
  timeoutMs: timeoutOverride,
}) {
  const timeoutMs = timeoutOverride ?? config.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS
  const heartbeatMs = config.jobHeartbeatMs ?? DEFAULT_HEARTBEAT_MS
  const log = config.log || logLine
  // 计时器可注入：测试用确定性触发，不跟真实时间赛跑。
  const timers = config.timers || {}
  const interval = timers.setInterval || setInterval
  const clearIntervalFn = timers.clearInterval || clearInterval
  const timeout = timers.setTimeout || setTimeout
  const clearTimeoutFn = timers.clearTimeout || clearTimeout
  let beatTimer = null
  let timeoutTimer = null
  if (jobs && heartbeatMs > 0) {
    beatTimer = interval(() => {
      jobs.beat({ now: clock() }).catch((error) => {
        log({ level: 'error', msg: '写作业心跳失败', error: error.message })
      })
    }, heartbeatMs)
    beatTimer?.unref?.()
  }
  const controller = new AbortController()
  const work = Promise.resolve().then(() => task({ signal: controller.signal }))
  try {
    if (timeoutMs <= 0) return await work
    const limit = new Promise((resolve, reject) => {
      timeoutTimer = timeout(() => {
        const error = new StepTimeoutError(label, timeoutMs)
        controller.abort(error)
        reject(error)
      }, timeoutMs)
      timeoutTimer?.unref?.()
    })
    return await Promise.race([work, limit])
  } catch (error) {
    if (error instanceof StepTimeoutError) {
      const grace = config.cancelGraceMs ?? DEFAULT_CANCEL_GRACE_MS
      const boxed = await Promise.race([
        work.then((value) => ({ value })).catch(() => null),
        new Promise((resolve) => {
          const timer = timeout(() => resolve(null), grace)
          timer?.unref?.()
        }),
      ])
      if (boxed) error.cancelledResult = boxed.value
    }
    throw error
  } finally {
    if (beatTimer) clearIntervalFn(beatTimer)
    if (timeoutTimer) clearTimeoutFn(timeoutTimer)
  }
}

/** GitHub 401/403 归为认证失败；限流的 403 不算，其它错误（网络、5xx）也不归。 */
function authStatusOf(error) {
  const status = Number(error?.status || 0)
  if (status !== 401 && status !== 403) return 0
  const message = String(error?.body?.message || error?.message || '')
  if (status === 403 && /rate limit/i.test(message)) return 0
  return status
}

function failureText(result) {
  const problem =
    (result?.problems || result?.findings || [])[0] ||
    String(result?.stderr || result?.error || '').trim()
  const reason = String(result?.reason || '')
  if (reason) return problem ? `${reason}：${problem}` : reason
  return problem || '失败'
}

/**
 * 把这一轮的执行结果写进作业表。
 * needs-info 和部署失败直接写 stop；其余失败按 attempt 退避，到上限也写 stop。
 * 写 stop 时给父工单补 needs-info，运营者摘掉标签后下一轮自动放行。
 */
async function noteJobResults({ gh, jobs, owner, repo, parent, actions, executed, now, jobPolicy, report, notifier, config }) {
  if (!jobs) return
  const guard = async (work) => {
    try {
      return await work
    } catch (error) {
      report.errors.push({ repo, parent: parent.number, jobs: true, message: error.message })
      return null
    }
  }
  const ensureStopLabel = () =>
    ensureIssueLabel({ gh, owner, repo, number: parent.number, name: NEEDS_INFO_LABEL })
  const failureEvent = (action, result, row, scope, reason = '作业失败', extra = {}) =>
    notifyAction({
      parent,
      owner,
      repo,
      event: '出事',
      scope,
      data: {
        reason,
        tried: failureText(result),
        attempt: row?.attempt ?? 0,
        ...extra,
      },
    })
  // 同一故障只报一次：key 稳定，attempt 放 data；到上限另发一条换 key 的升级。
  // 收尾的验证评审失败和收尾模块自己发的「验证评审修不过」共用 key，不重复报。
  const failureScope = (action, result) => {
    if (action === 'finish' && result?.reason === 'review_failed') {
      return { scope: '验证评审修不过:收尾评审', reason: '验证评审修不过' }
    }
    if (action === 'finish' && result?.reason === 'verify_failed') {
      return { scope: '验证评审修不过:PR 验证', reason: '验证评审修不过' }
    }
    const kind = String(result?.reason || '失败').replace(/\s+/g, '-')
    return { scope: `作业失败:${action}:${kind}`, reason: '作业失败' }
  }
  const notifyFailure = async (action, result, row) => {
    if (!row || !notifier) return
    const { scope, reason } = failureScope(action, result)
    await guard(
      deliverEvent({
        notifier,
        event: failureEvent(action, result, row, scope, reason),
        config,
        now,
      }),
    )
    if (row.stop === 'retry-exhausted') {
      await guard(
        deliverEvent({
          notifier,
          event: failureEvent(action, result, row, `${scope}:升级`, '重试用完，作业停了'),
          config,
          now,
        }),
      )
    }
  }
  const recordRetry = async (action, result) => {
    const row = await guard(
      jobs.recordFailure({
        owner,
        repo,
        parent: parent.number,
        action,
        reason: failureText(result),
        now,
        policy: jobPolicy,
      }),
    )
    if (row?.stop) await guard(ensureStopLabel())
    await notifyFailure(action, result, row)
  }
  const results = executed?.results || []

  const needsInfoAction =
    actions.some((action) => action.type === 'addLabel' && action.name === NEEDS_INFO_LABEL) ||
    results.some((row) => row.type === 'addLabel' && row.name === NEEDS_INFO_LABEL)
  if (needsInfoAction) {
    const gapFailure = results.find((row) => row.type === 'runGapProposal')?.result
    const reason =
      gapFailure?.ok === false ? `补缺口失败：${failureText(gapFailure)}` : reasonOf(parent, actions)
    await guard(
      jobs.stop({
        owner,
        repo,
        parent: parent.number,
        action: 'needs-info',
        stop: 'needs-info',
        reason,
        now,
      }),
    )
    return
  }

  const finishResult = results.find((row) => row.type === 'finish')?.result
  if (finishResult) {
    if (finishResult.ok === true) {
      await guard(jobs.recordSuccess({ owner, repo, parent: parent.number, action: 'finish', now }))
    } else if (finishResult.deploy && finishResult.deploy.ok === false) {
      const reason = `部署失败：${finishResult.deploy.reason || finishResult.deploy.error || '未知原因'}`
      const row = await guard(
        jobs.stop({
          owner,
          repo,
          parent: parent.number,
          action: 'finish',
          stop: 'deploy-failed',
          reason,
          now,
        }),
      )
      await guard(ensureStopLabel())
      const deploySeq = finishResult.deploy?.deploySeq
      const deployScope =
        deploySeq === undefined || deploySeq === null
          ? '作业失败:finish:升级'
          : `作业失败:finish:升级:${deploySeq}`
      await guard(
        deliverEvent({
          notifier,
          event: failureEvent('finish', { reason }, row, deployScope, '部署失败，作业停了', {
            deploy_seq: deploySeq,
          }),
          config,
          now,
        }),
      )
    } else {
      await recordRetry('finish', finishResult)
    }
  }

  const gapResult = results.find((row) => row.type === 'runGapProposal')?.result
  if (gapResult && gapResult.ok !== false) {
    await guard(jobs.recordSuccess({ owner, repo, parent: parent.number, action: 'gap-proposal', now }))
  }

  const decomposeResult = results.find((row) => row.type === 'runDecompose')?.result
  if (decomposeResult) {
    if (decomposeResult.ok === true) {
      await guard(jobs.recordSuccess({ owner, repo, parent: parent.number, action: 'decompose', now }))
    } else {
      await recordRetry('decompose', decomposeResult)
    }
  }

  const toSpecResult = results.find((row) => row.type === 'runToSpec')?.result
  if (toSpecResult) {
    if (toSpecResult.ok === true) {
      await guard(jobs.recordSuccess({ owner, repo, parent: parent.number, action: 'to-spec', now }))
    } else {
      await recordRetry('to-spec', toSpecResult)
    }
  }
}

const RETRY_ACTIONS = {
  finish: 'finish',
  runGapProposal: 'gap-proposal',
  runToSpec: 'to-spec',
  runDecompose: 'decompose',
  ignite: 'ignite',
}

/** executeActions 整个抛错或超时：按计划里的动作记失败，下一轮先退避再试，不马上重发。 */
async function noteJobCrash({ gh, jobs, owner, repo, parent, actions, error, now, jobPolicy, report }) {
  if (!jobs) return
  const reason =
    error instanceof StepTimeoutError
      ? `执行超时：${error.message}`
      : `执行失败：${error?.message || error}`
  const guard = async (work) => {
    try {
      return await work
    } catch (writeError) {
      report.errors.push({ repo, parent: parent.number, jobs: true, message: writeError.message })
      return null
    }
  }
  const ensureStopLabel = () =>
    ensureIssueLabel({ gh, owner, repo, number: parent.number, name: NEEDS_INFO_LABEL })
  if (actions.some((action) => action.type === 'addLabel' && action.name === NEEDS_INFO_LABEL)) {
    await guard(
      jobs.stop({
        owner,
        repo,
        parent: parent.number,
        action: 'needs-info',
        stop: 'needs-info',
        reason,
        now,
      }),
    )
    return
  }
  for (const action of actions) {
    const actionName = RETRY_ACTIONS[action.type]
    if (!actionName) continue
    const ticket =
      action.type === 'ignite' ? action.ticketNumber ?? action.ticket?.number ?? null : null
    const row = await guard(
      jobs.recordFailure({
        owner,
        repo,
        parent: parent.number,
        ticket,
        action: actionName,
        reason,
        now,
        policy: jobPolicy,
      }),
    )
    if (row?.stop) await guard(ensureStopLabel())
  }
}

/** 流水线报认证失败：写 stop 并确保父工单挂 needs-info。 */
async function notePipelineStops({ jobs, gh, owner, repo, parents, pipeline, now, report }) {
  if (!jobs) return
  for (const run of pipeline?.runs || []) {
    if (run?.ok !== false || run.reason !== 'auth_failed') continue
    const parent = (parents || []).find((row) =>
      (row.subIssues || []).some((ticket) => ticket.number === run.ticket),
    )
    if (!parent) continue
    try {
      await jobs.stop({
        owner,
        repo,
        parent: parent.number,
        action: 'pipeline',
        stop: 'auth-failed',
        reason: `认证失败：${(run.problems || [])[0] || 'agent 认证失败'}`,
        now,
      })
      await ensureIssueLabel({ gh, owner, repo, number: parent.number, name: NEEDS_INFO_LABEL })
    } catch (error) {
      report.errors.push({ repo, parent: parent.number, jobs: true, message: error.message })
    }
  }
}

/**
 * 运行中 GitHub 401/403：能定位到父工单的写 stop、挂 needs-info、发一次「出事」；
 * 拿不到父工单（比如读快照就失败）时至少发一条稳定 key 的通知，让运营者看到停线。
 */
async function noteAuthFailures({ report, jobs, gh, notifier, config, now, facts }) {
  const failures = (report.errors || []).filter((row) => row.auth)
  if (!failures.length) return
  const seen = new Set()
  for (const row of failures) {
    const identity = `${row.owner || ''}/${row.repo || ''}#${row.parent ?? 'repo'}`
    if (seen.has(identity)) continue
    seen.add(identity)
    const reason = `GitHub 认证失败（${row.auth}）`
    if (row.parent && jobs) {
      try {
        await jobs.stop({
          owner: row.owner,
          repo: row.repo,
          parent: row.parent,
          action: 'auth',
          stop: 'auth-failed',
          reason,
          now,
        })
      } catch (error) {
        report.errors.push({ repo: row.repo, parent: row.parent, jobs: true, message: error.message })
      }
      try {
        await ensureIssueLabel({ gh, owner: row.owner, repo: row.repo, number: row.parent, name: NEEDS_INFO_LABEL })
      } catch (error) {
        report.errors.push({ repo: row.repo, parent: row.parent, labels: true, message: error.message })
      }
    }
    const subject = row.parent ? `#${row.parent}` : '仓库'
    const fact = row.parent
      ? facts?.parent?.get(`${row.owner}/${row.repo}#${row.parent}`)
      : facts?.repo?.get(`${row.owner}/${row.repo}`)
    const event = {
      event: '出事',
      key: eventKey({ owner: row.owner, repo: row.repo, subject, event: '认证失败' }),
      data: {
        customer: fact?.customer || '未知客户',
        requirement: fact?.requirement || row.repo || '未知需求',
        reason,
        tried: String(row.message || reason),
        status: row.auth,
      },
      ...(fact?.link ? { link: fact.link } : {}),
    }
    try {
      const result = await deliverEvent({ notifier, event, config, now })
      report.notifications.push({
        repo: row.repo,
        parent: row.parent ?? null,
        event: event.event,
        key: event.key,
        ...result,
      })
    } catch (error) {
      report.errors.push({ repo: row.repo, parent: row.parent, event: event.event, message: error.message })
    }
  }
}

/**
 * 管道超时：写 pipeline 作业行，reason 含「超时」，按 attempt 退避。
 * 能定位到正在跑的那张票就只写它；定位不到就把有活跃子票的父工单都记上。
 */
async function notePipelineTimeout({ jobs, gh, owner, repo, parents, active, error, now, jobPolicy, report }) {
  if (!jobs) return
  const targets = active?.parent
    ? [{ parent: active.parent, ticket: active.ticket ?? null }]
    : (parents || [])
        .filter((parent) => (parent.subIssues || []).some((ticket) => stillSandcastle(ticket)))
        .map((parent) => ({ parent: parent.number, ticket: null }))
  const seen = new Set()
  for (const target of targets) {
    if (seen.has(target.parent)) continue
    seen.add(target.parent)
    try {
      const row = await jobs.recordFailure({
        owner,
        repo,
        parent: target.parent,
        ticket: target.ticket,
        action: 'pipeline',
        reason: `管道超时：${error.message}`,
        now,
        policy: jobPolicy,
      })
      if (row?.stop) {
        await ensureIssueLabel({ gh, owner, repo, number: target.parent, name: NEEDS_INFO_LABEL })
      }
    } catch (writeError) {
      report.errors.push({ repo, parent: target.parent, jobs: true, message: writeError.message })
    }
  }
}

/** 父工单没有 needs-info 标签了，说明运营者放行：清掉这张单的 stop，needs-info 的重置重试预算。 */
async function reconcileJobStops({ jobs, owner, repo, parent, now, report }) {
  if (!jobs) return
  try {
    const rows = jobs.rowsFor({ owner, repo, parent: parent.number })
    if (!blockingStop(rows)) return
    if (hasLabel(parent, NEEDS_INFO_LABEL)) return
    const cleared = await jobs.clearStop({
      owner,
      repo,
      parent: parent.number,
      now,
      resetBudget: true,
    })
    if (cleared) {
      logLine({ level: 'info', msg: '人工放行', owner, repo, parent: parent.number, cleared })
    }
  } catch (error) {
    report.errors.push({ repo, parent: parent.number, jobs: true, message: error.message })
  }
}

/**
 * 看门狗：心跳停了 stallMs 就发一次「出事」，不看这一轮跑了多久。
 * 同一轮只发一次；一轮结束（roundStart 清空）后自然安静。
 */
export function createWatchdog({
  jobs,
  notifier,
  clock = () => new Date(),
  log = logLine,
  stallMs = DEFAULT_ROUND_TIMEOUT_MS,
  config = {},
} = {}) {
  config.notifiedKeys ??= new Set()
  let timer = null
  async function tick() {
    if (!jobs || typeof jobs.stalledFor !== 'function') return null
    const at = clock()
    const stalled = jobs.stalledFor(at, { stallMs })
    if (!stalled) return null
    // 探活事件的身份固定：同一轮只报一次，轮次开始时间放 scope。
    const key = eventKey({
      subject: '调度器',
      event: '出事',
      scope: `心跳停止:${stalled.roundStart}`,
    })
    if (config.notifiedKeys?.has(key)) return null
    const minutes = Math.max(1, Math.round(stalled.stalledMs / 60000))
    const event = {
      v: 1,
      key,
      event: '出事',
      occurred_at: (at instanceof Date ? at : new Date(at)).toISOString(),
      link: config.runsLogPath ? `file://${config.runsLogPath}` : `file://${jobs.filePath || ''}`,
      data: {
        customer: '工厂',
        requirement: '调度器',
        reason: '心跳停止',
        tried: `心跳停了 ${minutes} 分钟`,
        heartbeat: stalled.lastBeat,
        round_start: stalled.roundStart,
      },
    }
    if (typeof notifier?.send !== 'function') {
      log({ level: 'error', msg: '心跳停止通知没发出去', reason: '没有注入 notifier' })
      return event
    }
    try {
      const result = await deliverEvent({ notifier, event, config, now: at })
      if (result?.skipped) return null
    } catch (error) {
      log({ level: 'error', msg: '心跳停止通知没发出去', error: error.message })
    }
    return event
  }
  return {
    tick,
    start(intervalMs = DEFAULT_HEARTBEAT_MS) {
      if (timer || !(intervalMs > 0)) return
      const interval = config.timers?.setInterval || setInterval
      timer = interval(() => {
        tick().catch((error) => log({ level: 'error', msg: '看门狗检查失败', error: error.message }))
      }, intervalMs)
      timer?.unref?.()
    },
    stop() {
      const clear = config.timers?.clearInterval || clearInterval
      if (timer) clear(timer)
      timer = null
    },
  }
}

// ---- 跑一轮 ----

export async function runOnce({
  gh,
  customers,
  notifier,
  ignite,
  decompose,
  toSpec,
  gapProposal,
  ticketPipeline,
  createFixTicket,
  finish,
  clock = () => new Date(),
  config = {},
}) {
  const now = clock()
  const nowDate = now instanceof Date ? now : new Date(now)
  // customers 可以直接是表，也可以是每轮调用的读取函数（常驻时按 mtime 重读）。
  const customerRows = typeof customers === 'function' ? await customers() : customers
  config.notifiedKeys ??= new Set()
  const jobs = config.jobs || null
  const jobPolicy = config.jobPolicy || {}
  const log = config.log || logLine
  const step = (label, task, opts = {}) =>
    runJobStep({ jobs, clock, config: { ...config, log }, label, task, ...opts })

  const report = {
    now: nowDate.toISOString(),
    repos: [],
    cleanup: [],
    notifications: [],
    errors: [],
    digest: null,
  }

  if (jobs) {
    try {
      await jobs.startRound({ now: nowDate })
    } catch (error) {
      report.errors.push({ jobs: true, message: error.message })
    }
  }

  try {
    const repos = collectRepos({ gh, customers: customerRows, owner: config.owner })
    const snapshots = []
    for (const row of repos) {
      try {
        snapshots.push({
          row,
          snapshot: await step(`读 ${row.repo} 快照`, () =>
            collectSnapshot({ gh, owner: row.owner, repo: row.repo }),
          ),
        })
      } catch (error) {
        report.errors.push({
          repo: row.repo,
          owner: row.owner,
          snapshot: true,
          auth: authStatusOf(error),
          message: error.message,
        })
      }
    }

    for (const { row, snapshot } of snapshots) {
      for (const action of cleanupActions(snapshot)) {
        try {
          const result = await removeSandcastleLabel({
            gh,
            owner: row.owner,
            repo: row.repo,
            ticketNumber: action.ticketNumber,
          })
          report.cleanup.push({ repo: row.repo, ticket: action.ticketNumber, ...result })
        } catch (error) {
          report.errors.push({
            repo: row.repo,
            owner: row.owner,
            cleanup: action.ticketNumber,
            auth: authStatusOf(error),
            message: error.message,
          })
        }
      }
    }

    let activeCount = 0
    for (const { snapshot } of snapshots) {
      for (const parent of snapshot.parents) {
        for (const ticket of parent.subIssues) if (stillSandcastle(ticket)) activeCount += 1
      }
    }

    const parentFactsByKey = new Map()
    const repoFactsByKey = new Map()
    for (const { row, snapshot } of snapshots) {
      repoFactsByKey.set(`${row.owner}/${row.repo}`, {
        customer: row.shortName || '未知客户',
        requirement: row.product || row.repo,
      })
      for (const parent of snapshot.parents) {
        parentFactsByKey.set(`${row.owner}/${row.repo}#${parent.number}`, {
          ...parentFacts(parent),
          link: parentLink(parent, row.owner, row.repo),
        })
      }
    }

    for (const { row, snapshot } of snapshots) {
      for (const parent of snapshot.parents) {
        await reconcileJobStops({ jobs, owner: row.owner, repo: row.repo, parent, now: nowDate, report })
      }
      if (config.repoRoot) {
        try {
          snapshot.trails = await collectTrails({
            repoDir: join(config.repoRoot, row.repo),
            parents: snapshot.parents,
          })
        } catch (error) {
          report.errors.push({ repo: row.repo, trails: true, message: error.message })
        }
        await collectBranchFacts({
          repoDir: join(config.repoRoot, row.repo),
          parents: snapshot.parents,
        })
      }
      let pipeline = null
      if (typeof ticketPipeline === 'function') {
        try {
          pipeline = await step(
            `跑 ${row.repo} 流水线`,
            ({ signal }) =>
              ticketPipeline({
                gh,
                owner: row.owner,
                repo: row.repo,
                parents: snapshot.parents,
                repoDir: config.repoRoot ? join(config.repoRoot, row.repo) : '',
                jobs,
                lockDir: config.lockDir || '',
                signal,
              }),
            { timeoutMs: config.pipelineTimeoutMs ?? DEFAULT_PIPELINE_TIMEOUT_MS },
          )
        } catch (error) {
          report.errors.push({
            repo: row.repo,
            owner: row.owner,
            pipeline: true,
            auth: authStatusOf(error),
            message: error.message,
          })
          if (error instanceof StepTimeoutError) {
            await notePipelineTimeout({
              jobs,
              gh,
              owner: row.owner,
              repo: row.repo,
              parents: snapshot.parents,
              active: error.cancelledResult?.active || null,
              error,
              now: nowDate,
              jobPolicy,
              report,
            })
          }
        }
      }
      await notePipelineStops({
        jobs,
        gh,
        owner: row.owner,
        repo: row.repo,
        parents: snapshot.parents,
        pipeline,
        now: nowDate,
        report,
      })

      const routed = routeRepo({
        snapshot,
        now: nowDate,
        maxActive: config.maxActive ?? 5,
        activeCount,
        owner: row.owner,
        repo: row.repo,
        jobs: jobs ? jobs.all() : [],
        jobPolicy,
      })
      activeCount = routed.activeCount

      const parents = []
      for (const { parent, actions } of routed.decisions) {
        let executed = { skipped: null, results: [] }
        if (actions.length) {
          try {
            executed = await step(`执行父工单 #${parent.number} 的动作`, ({ signal }) =>
              executeActions({
                gh,
                owner: row.owner,
                repo: row.repo,
                parent,
                actions,
                ignite,
                decompose,
                toSpec,
                gapProposal,
                createFixTicket,
                finish,
                notifier,
                config,
                now: nowDate,
                clock,
                signal,
              }),
            )
          } catch (error) {
            report.errors.push({
              repo: row.repo,
              owner: row.owner,
              parent: parent.number,
              auth: authStatusOf(error),
              message: error.message,
            })
            executed = { skipped: null, results: [], error: error.message }
            await noteJobCrash({
              gh,
              jobs,
              owner: row.owner,
              repo: row.repo,
              parent,
              actions,
              error,
              now: nowDate,
              jobPolicy,
              report,
            })
          }
          await noteJobResults({
            gh,
            jobs,
            owner: row.owner,
            repo: row.repo,
            parent,
            actions,
            executed,
            now: nowDate,
            jobPolicy,
            report,
            notifier,
            config,
          })
        }
        parents.push({
          parent: parent.number,
          decision: decisionOf(actions),
          reason: reasonOf(parent, actions),
          actions: actions.map(summarizeAction),
          executed,
        })
      }
      const maps = []
      for (const { map, actions } of routed.maps) {
        let executed = { skipped: null, results: [] }
        try {
          executed = await step(`执行地图 #${map.number} 的动作`, ({ signal }) =>
            executeActions({
              gh,
              owner: row.owner,
              repo: row.repo,
              parent: map,
              actions,
              ignite,
              decompose,
              toSpec,
              gapProposal,
              createFixTicket,
              notifier,
              config,
              now: nowDate,
              clock,
              signal,
            }),
          )
        } catch (error) {
          report.errors.push({
            repo: row.repo,
            owner: row.owner,
            map: map.number,
            auth: authStatusOf(error),
            message: error.message,
          })
          executed = { skipped: null, results: [], error: error.message }
        }
        maps.push({
          map: map.number,
          decision: actions.length ? 'notify' : 'wait',
          actions: actions.map(summarizeAction),
          executed,
        })
      }
      report.repos.push({ repo: row.repo, fullName: row.fullName, parents, maps, pipeline })

      for (const parent of snapshot.parents) {
        const newTicket = newTicketEvent({
          parent,
          comments: parent.comments || [],
          owner: row.owner,
          repo: row.repo,
        })
        if (newTicket) {
          try {
            const result = await deliverEvent({ notifier, event: newTicket, config, now: nowDate })
            report.notifications.push({
              repo: row.repo,
              parent: parent.number,
              event: newTicket.event,
              key: newTicket.key,
              ...result,
            })
          } catch (error) {
            report.errors.push({
              repo: row.repo,
              parent: parent.number,
              event: newTicket.event,
              message: error.message,
            })
          }
        }

        let answers = []
        try {
          answers = await resolveNeedsAnswer(config, {
            owner: row.owner,
            repo: row.repo,
            parent,
            snapshot,
          })
        } catch (error) {
          report.errors.push({
            repo: row.repo,
            owner: row.owner,
            parent: parent.number,
            needsAnswer: true,
            auth: authStatusOf(error),
            message: error.message,
          })
        }
        const reminder = pendingReminder({
          parent,
          latestGate: latestGate(parent.comments || []),
          now: nowDate,
          needsAnswer: answers,
          owner: row.owner,
          repo: row.repo,
        })
        if (!reminder) continue
        const event = reminderEvent({
          reminder,
          parent,
          owner: row.owner,
          repo: row.repo,
          repoRoot: config.repoRoot || '',
        })
        try {
          const result = await deliverEvent({ notifier, event, config, now: nowDate })
          report.notifications.push({
            repo: row.repo,
            parent: parent.number,
            event: event.event,
            key: event.key,
            ...result,
          })
        } catch (error) {
          report.errors.push({
            repo: row.repo,
            parent: parent.number,
            event: event.event,
            message: error.message,
          })
        }
      }
    }

    await noteAuthFailures({
      report,
      jobs,
      gh,
      notifier,
      config,
      now: nowDate,
      facts: { parent: parentFactsByKey, repo: repoFactsByKey },
    })

    if (typeof config.previewSweep === 'function' && dueDigest({ now: nowDate, lastSentDate: config.lastPreviewSweepDate })) {
      try {
        const result = await config.previewSweep({ now: nowDate })
        report.previewSweep = { ok: true, ...result }
      } catch (error) {
        report.errors.push({ previewSweep: true, message: error.message })
        report.previewSweep = { ok: false, error: error.message }
      }
      // 每天只试一次：helper 不在或失败，留到明天，不每 30 秒重试。
      config.lastPreviewSweepDate = localDate(nowDate)
    }

    if (dueDigest({ now: nowDate, lastSentDate: config.lastSentDate })) {
      const date = localDateOffset(nowDate, -1)
      let items = []
      let queryFailed = false
      if (typeof config.listMergedYesterday === 'function') {
        try {
          const rows = await config.listMergedYesterday({
            now: nowDate,
            repos: snapshots.map(({ row }) => row),
          })
          if (Array.isArray(rows)) items = rows
        } catch (error) {
          queryFailed = true
          report.errors.push({ digest: true, listMergedYesterday: true, message: error.message })
        }
      }
      const event = digestEvent({ items, date })
      let result = { sent: false, count: items.length }
      if (event) {
        try {
          result = { sent: true, count: items.length, ...(await deliverEvent({ notifier, event, config, now: nowDate })) }
        } catch (error) {
          report.errors.push({ digest: true, message: error.message })
          result = { sent: false, count: items.length, error: error.message }
        }
      }
      config.lastSentDate = queryFailed ? config.lastSentDate : localDate(nowDate)
      report.digest = { due: true, date, ...(queryFailed ? { queryFailed: true } : {}), ...result }
    }

    return report
  } finally {
    if (jobs) {
      try {
        await jobs.endRound({ now: clock() })
      } catch (error) {
        report.errors.push({ jobs: true, message: error.message })
      }
    }
  }
}

function sleep(ms, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })
}

/**
 * 每 30 秒一轮。单轮失败记一行 JSON 日志，不退出。
 * 接上作业表时同时开看门狗：一轮跑太久或心跳停了就发「出事」。
 */
export async function runLoop({
  intervalMs = 30000,
  signal,
  log = logLine,
  run = runOnce,
  onReport,
  watchdog,
  ...options
}) {
  const config = options.config || {}
  const activeWatchdog =
    watchdog !== undefined
      ? watchdog
      : config.jobs
        ? createWatchdog({
            jobs: config.jobs,
            notifier: options.notifier ?? config.notifier,
            clock: options.clock || (() => new Date()),
            log,
            stallMs: config.roundTimeoutMs ?? DEFAULT_ROUND_TIMEOUT_MS,
            config,
          })
        : null
  activeWatchdog?.start?.(config.watchdogIntervalMs ?? DEFAULT_HEARTBEAT_MS)
  try {
    while (!signal?.aborted) {
      try {
        const report = await run(options)
        if (typeof onReport === 'function') await onReport(report)
      } catch (error) {
        log({ level: 'error', msg: '调度器这一轮失败', error: error.message })
      }
      if (signal?.aborted) break
      await sleep(intervalMs, signal)
    }
  } finally {
    activeWatchdog?.stop?.()
  }
}
