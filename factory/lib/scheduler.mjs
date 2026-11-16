/**
 * 调度器：每 30 秒读一遍 open 工单，按 `docs/工单模型.md` 第五节的迁移表推进。
 *
 * 判断只看可检查的事实：`状态:*` 标签、子票状态和阻塞边、父工单评论里的关口词、
 * 仓库里有没有 spec。不读客户原话，不猜内容。
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readTrail } from './evidence.mjs'
import { latestGate } from './gate.mjs'
import { ensureCommentOnce, ensureLabel } from './issues.mjs'
import { logLine } from './log.mjs'
import { tryWithFileLock } from './lock.mjs'
import { repeatProblems, roundsWithoutProgress } from './stall.mjs'
import { frontier } from './tickets.mjs'
import { parseProgress, progressLine } from './progress.mjs'

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
  return { customer: customer || '未知客户', requirement }
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
  let latest = null
  for (const comment of comments) {
    for (const line of String(comment?.body || '').split(/\r?\n/)) {
      const parsed = parseProgress(line)
      if (parsed) latest = parsed
    }
  }
  if (!latest) return 1
  return latest.tier === '已驳回' ? latest.round + 1 : latest.round
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
export function stallHits({ comments = [], trails = [] } = {}) {
  const hits = []
  const rounds = roundsWithoutProgress({ comments })
  if (rounds.stalled) hits.push({ reason: '三圈没进展', detail: rounds.reason })

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
  const actions = needsInfoActions({ parent, comments, state, reason: detail, owner, repo })
  for (const hit of hits) {
    actions.push(
      notifyAction({
        parent,
        owner,
        repo,
        event: '出事',
        key: `#${parent.number}:出事:${hit.reason}`,
        data: { reason: hit.reason, tried: hit.detail },
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

function progressFor({ parent, state, comments, tier, step, stuck, note = '' }) {
  return progressLine({
    path: pathOf(parent),
    tier: tier || customerTier(state),
    step: step || stageFor(state, isSmall(parent)),
    round: roundOf(comments),
    stuck: stuck ?? (hasLabel(parent, NEEDS_INFO_LABEL) || hasLabel(parent, '点火超时')),
    note,
  })
}

function notifyAction({ parent, owner, repo, event, key, data, link }) {
  const facts = parentFacts(parent)
  return {
    type: 'notify',
    event,
    key,
    data: { customer: facts.customer, requirement: facts.requirement, ...data },
    link: link || parentLink(parent, owner, repo),
  }
}

function needsInfoActions({ parent, comments, state, reason, owner, repo }) {
  const body = progressFor({
    parent,
    state,
    comments,
    stuck: true,
    note: reason,
  })
  return [
    { type: 'addLabel', name: NEEDS_INFO_LABEL },
    { type: 'comment', body },
    notifyAction({
      parent,
      owner,
      repo,
      event: 'needs-info',
      key: `#${parent.number}:needs-info:${state || '无状态'}:${roundOf(comments)}`,
      data: {},
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

  const small = isSmall(parent)
  const signal = latestSignal(comments)

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

  // 开发中读到驳回、并且驳回后面已经写过进度行，说明修复票已建，接着点火；
  // 其余等待信号（新的提案、没处理过的驳回、改口）仍然停。
  const handledRejection =
    state === '开发中' &&
    signal?.kind === '驳回：' &&
    progressAfter(comments, signal.index)
  if (isWaitingSignal(signal?.kind) && !handledRejection) return []

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
      const ticket = selectTicket({ subIssues, closedNumbers })
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
        { type: 'comment', body: progressFor({ parent, state: '开发中', comments }) },
        ...(already ? [] : [{ type: 'ignite', ticket, ticketNumber: ticket.number }]),
      ]
    }
    if (state === '开发中') {
      const hits = stallHits({ comments, trails })
      if (hits.length) return stallActions({ parent, comments, state, hits, owner, repo })
    }
    return []
  }

  if (state === '已提交') {
    if (signal?.kind !== '点头：补缺口') return []
    return [
      { type: 'setState', from: '已提交', to: '排队中' },
      { type: 'comment', body: progressFor({ parent, state: '排队中', comments }) },
      notifyAction({
        parent,
        owner,
        repo,
        event: '该跑 to-spec',
        key: `#${parent.number}:该跑 to-spec:${daysBetween(signal.comment?.created_at, now)}`,
        data: {},
      }),
    ]
  }

  if (state === '排队中' || state === '开发中') {
    const hits = stallHits({ comments, trails })
    if (hits.length) return stallActions({ parent, comments, state, hits, owner, repo })
  }

  if (state === '开发中') {
    // 驳回建的修复票、以及子票跑完后接上的下一张，都在开发中点火。
    const open = subIssues.filter(isOpen)
    if (open.length === 0) return []
    if (open.some(isSandcastle)) return []
    const ticket = selectTicket({ subIssues, closedNumbers })
    if (!ticket) return []
    if (repoBusy || activeCount >= maxActive) return []
    return [{ type: 'ignite', ticket, ticketNumber: ticket.number }]
  }

  if (state === '排队中') {
    if (spec && subIssues.length === 0) return [{ type: 'runDecompose' }]
    if (signal?.kind === '点头：拆票') {
      const ticket = selectTicket({ subIssues, closedNumbers })
      if (!ticket) return []
      const already = isSandcastle(ticket)
      if (!already && (repoBusy || activeCount >= maxActive)) return []
      return [
        { type: 'setState', from: '排队中', to: '开发中' },
        { type: 'comment', body: progressFor({ parent, state: '开发中', comments }) },
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
    key: `#${parent.number}:新单进队列`,
    data: {},
  })
}

/**
 * 四条等人待办：提案：补缺口、点头：补缺口但没 spec、提案：拆票、需要你答。
 * 每 24 小时换一个新 key，通知模块按 key 去重，同一事实同一天只送一次。
 */
export function pendingReminder({ parent, latestGate, now, needsAnswer = [] }) {
  const state = stateOf(parent)
  const waitingState = state === '已提交' || state === '排队中'
  const answers = Array.isArray(needsAnswer) ? needsAnswer : []

  if (answers.length) {
    const item = answers[0]
    const days = daysBetween(item.opened_at || item.created_at, now)
    return {
      event: '需要你答',
      days_waited: days,
      key: `#${parent.number}:需要你答:${item.key}:${days}`,
      item,
    }
  }

  if (!latestGate || !waitingState) return null
  const kind = latestGate.kind
  const at = latestGate.comment?.created_at

  if (kind === '提案：补缺口') {
    const days = daysBetween(at, now)
    return { event: '补缺口提案', days_waited: days, key: `#${parent.number}:补缺口提案:${days}`, gate: latestGate }
  }
  if (kind === '点头：补缺口' && !parent?.spec && state === '排队中') {
    const days = daysBetween(at, now)
    if (days < 1) return null
    return { event: '该跑 to-spec', days_waited: days, key: `#${parent.number}:该跑 to-spec:${days}`, gate: latestGate }
  }
  if (kind === '提案：拆票') {
    const days = daysBetween(at, now)
    return { event: '拆票提案', days_waited: days, key: `#${parent.number}:拆票提案:${days}`, gate: latestGate }
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
    key: `每日抽样:${day}`,
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

function isParentIssue(issue) {
  return String(issue?.body || '').includes('<!-- factory:order=')
}

function isSpecIssue(issue) {
  return hasLabel(issue, 'ready-for-agent')
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

    const facts = parentFacts(parent)
    const spec =
      specs.find(
        (candidate) =>
          facts.requirement &&
          (String(candidate.title || '').includes(facts.requirement) ||
            String(candidate.body || '').includes(facts.requirement)),
      ) || null

    parentRows.push(
      slimIssue(parent, {
        comments: slimComments(comments),
        subIssues,
        closedNumbers: [...closedNumbers],
        spec: spec ? slimIssue(spec) : null,
        customer: facts.customer,
        requirement: facts.requirement,
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

export function routeRepo({ snapshot, now, maxActive = 5, activeCount = 0, owner, repo }) {
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
          key: `#${map.number}:重传地图已更新:${reupload.date}`,
          data: { customer: facts.customer, requirement: facts.requirement },
          link: map.html_url || parentLink(map, owner, repo),
        },
      ],
    })
  }

  return { decisions, maps, activeCount: active }
}

// ---- 执行动作 ----

function missingImplementation(actions, { ignite, decompose, createFixTicket }) {
  for (const action of actions) {
    if (action.type === 'ignite' && typeof ignite !== 'function') return 'ignite'
    if (action.type === 'runDecompose' && typeof decompose !== 'function') return 'decompose'
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

async function executeIgnite({ gh, owner, repo, parent, action, ignite, config }) {
  const ticketNumber = action.ticketNumber ?? action.ticket?.number
  const fresh = await gh.getIssue({ owner, repo, number: ticketNumber })
  if (labelNames(fresh).includes(SANDBOX_LABEL)) {
    return { type: 'ignite', ticket: ticketNumber, skipped: 'already-sandcastle' }
  }
  const lockPath = join(config.lockDir || defaultLockDir(), `${owner}__${repo}.lock`)
  const locked = await tryWithFileLock(
    lockPath,
    async () => {
      const again = await gh.getIssue({ owner, repo, number: ticketNumber })
      if (labelNames(again).includes(SANDBOX_LABEL)) {
        return { type: 'ignite', ticket: ticketNumber, skipped: 'already-sandcastle' }
      }
      await ensureIssueLabel({ gh, owner, repo, number: ticketNumber, name: SANDBOX_LABEL })
      try {
        const result = await ignite({
          owner,
          repo,
          parent: { number: parent.number, title: parent.title, body: parent.body },
          ticket: action.ticket,
        })
        return { type: 'ignite', ticket: ticketNumber, ignited: true, result }
      } catch (error) {
        await gh
          .removeLabel({ owner, repo, number: ticketNumber, name: SANDBOX_LABEL })
          .catch(() => {})
        throw error
      }
    },
    { timeoutMs: 0, staleMs: config.lockStaleMs ?? 10 * 60 * 1000 },
  )
  if (locked.skipped) return { type: 'ignite', ticket: ticketNumber, skipped: 'locked' }
  return locked.value
}

function notificationPayload(event, now) {
  return {
    v: 1,
    key: event.key,
    event: event.event,
    occurred_at: (now instanceof Date ? now : new Date(now)).toISOString(),
    ...(event.link ? { link: event.link } : {}),
    data: event.data || {},
  }
}

async function sendEvent({ notifier, event, config, now }) {
  const payload = notificationPayload(event, now)
  if (config.notifiedKeys?.has(payload.key)) {
    return { type: 'notify', event: payload.event, key: payload.key, skipped: 'already-notified' }
  }
  const result = await notifier.send(payload)
  if (result?.code === 0) config.notifiedKeys?.add(payload.key)
  return { type: 'notify', event: payload.event, key: payload.key, code: result?.code }
}

const EXECUTION_ORDER = [
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
  createFixTicket,
  notifier,
  config,
  now,
}) {
  const missing = missingImplementation(actions, { ignite, decompose, createFixTicket })
  if (missing) return { skipped: missing, results: [] }

  const ordered = [...actions].sort(
    (left, right) => EXECUTION_ORDER.indexOf(left.type) - EXECUTION_ORDER.indexOf(right.type),
  )
  const results = []
  for (const action of ordered) {
    if (action.type === 'setState') {
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
      results.push(await sendEvent({ notifier, event: action, config, now }))
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
    } else if (action.type === 'ignite') {
      const result = await executeIgnite({ gh, owner, repo, parent, action, ignite, config })
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
  if (actions.some((action) => action.type === 'createFixTicket')) return 'reject'
  if (actions.some((action) => action.type === 'ignite')) return 'develop'
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
  if (action.type === 'setState') return { type: 'setState', from: action.from, to: action.to }
  if (action.type === 'comment') return { type: 'comment', body: action.body }
  if (action.type === 'notify') return { type: 'notify', event: action.event, key: action.key }
  if (action.type === 'ignite') return { type: 'ignite', ticket: action.ticketNumber ?? action.ticket?.number }
  if (action.type === 'runDecompose') return { type: 'runDecompose' }
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

function reminderEvent({ reminder, parent, owner, repo }) {
  const facts = parentFacts(parent)
  const event = {
    v: 1,
    key: reminder.key,
    event: reminder.event,
    link: parentLink(parent, owner, repo),
    data: {
      customer: facts.customer,
      requirement: facts.requirement,
      days_waited: reminder.days_waited,
    },
  }
  if (reminder.event === '补缺口提案') {
    event.data.question_count = countQuestions(reminder.gate?.body)
  }
  if (reminder.event === '拆票提案') {
    event.data.ticket_count = countTickets(reminder.gate?.body)
  }
  if (reminder.event === '需要你答') {
    event.data.question = reminder.item.question
    event.data.recommended = reminder.item.recommended
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

// ---- 跑一轮 ----

export async function runOnce({
  gh,
  customers,
  notifier,
  ignite,
  decompose,
  createFixTicket,
  clock = () => new Date(),
  config = {},
}) {
  const now = clock()
  const nowDate = now instanceof Date ? now : new Date(now)
  config.notifiedKeys ??= new Set()

  const repos = collectRepos({ gh, customers, owner: config.owner })
  const snapshots = []
  for (const row of repos) {
    snapshots.push({
      row,
      snapshot: await collectSnapshot({ gh, owner: row.owner, repo: row.repo }),
    })
  }

  const report = {
    now: nowDate.toISOString(),
    repos: [],
    cleanup: [],
    notifications: [],
    errors: [],
    digest: null,
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
        report.errors.push({ repo: row.repo, cleanup: action.ticketNumber, message: error.message })
      }
    }
  }

  let activeCount = 0
  for (const { snapshot } of snapshots) {
    for (const parent of snapshot.parents) {
      for (const ticket of parent.subIssues) if (stillSandcastle(ticket)) activeCount += 1
    }
  }

  for (const { row, snapshot } of snapshots) {
    if (config.repoRoot) {
      try {
        snapshot.trails = await collectTrails({
          repoDir: join(config.repoRoot, row.repo),
          parents: snapshot.parents,
        })
      } catch (error) {
        report.errors.push({ repo: row.repo, trails: true, message: error.message })
      }
    }
    const routed = routeRepo({
      snapshot,
      now: nowDate,
      maxActive: config.maxActive ?? 5,
      activeCount,
      owner: row.owner,
      repo: row.repo,
    })
    activeCount = routed.activeCount

    const parents = []
    for (const { parent, actions } of routed.decisions) {
      let executed = { skipped: null, results: [] }
      if (actions.length) {
        try {
          executed = await executeActions({
            gh,
            owner: row.owner,
            repo: row.repo,
            parent,
            actions,
            ignite,
            decompose,
            createFixTicket,
            notifier,
            config,
            now: nowDate,
          })
        } catch (error) {
          report.errors.push({ repo: row.repo, parent: parent.number, message: error.message })
          executed = { skipped: null, results: [], error: error.message }
        }
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
        executed = await executeActions({
          gh,
          owner: row.owner,
          repo: row.repo,
          parent: map,
          actions,
          ignite,
          decompose,
          createFixTicket,
          notifier,
          config,
          now: nowDate,
        })
      } catch (error) {
        report.errors.push({ repo: row.repo, map: map.number, message: error.message })
        executed = { skipped: null, results: [], error: error.message }
      }
      maps.push({
        map: map.number,
        decision: actions.length ? 'notify' : 'wait',
        actions: actions.map(summarizeAction),
        executed,
      })
    }
    report.repos.push({ repo: row.repo, fullName: row.fullName, parents, maps })

    for (const parent of snapshot.parents) {
      const newTicket = newTicketEvent({
        parent,
        comments: parent.comments || [],
        owner: row.owner,
        repo: row.repo,
      })
      if (newTicket) {
        try {
          const result = await sendEvent({ notifier, event: newTicket, config, now: nowDate })
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
          parent: parent.number,
          needsAnswer: true,
          message: error.message,
        })
      }
      const reminder = pendingReminder({
        parent,
        latestGate: latestGate(parent.comments || []),
        now: nowDate,
        needsAnswer: answers,
      })
      if (!reminder) continue
      const event = reminderEvent({ reminder, parent, owner: row.owner, repo: row.repo })
      try {
        const result = await sendEvent({ notifier, event, config, now: nowDate })
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
        result = { sent: true, count: items.length, ...(await sendEvent({ notifier, event, config, now: nowDate })) }
      } catch (error) {
        report.errors.push({ digest: true, message: error.message })
        result = { sent: false, count: items.length, error: error.message }
      }
    }
    config.lastSentDate = queryFailed ? config.lastSentDate : localDate(nowDate)
    report.digest = { due: true, date, ...(queryFailed ? { queryFailed: true } : {}), ...result }
  }

  return report
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

/** 每 30 秒一轮。单轮失败记一行 JSON 日志，不退出。 */
export async function runLoop({
  intervalMs = 30000,
  signal,
  log = logLine,
  run = runOnce,
  ...options
}) {
  while (!signal?.aborted) {
    try {
      await run(options)
    } catch (error) {
      log({ level: 'error', msg: '调度器这一轮失败', error: error.message })
    }
    if (signal?.aborted) break
    await sleep(intervalMs, signal)
  }
}
