/**
 * 拆票：按 spec 出提案、运营者点头后建子票。
 *
 * 契约见 `docs/工单模型.md` 第三节「子票和决定票」：
 * - 正文三段固定：`## 垂直切片`、`## 验收条件`、`## 阻塞`
 * - 验收条件只能从父工单的「验收条件」拆
 * - 阻塞边以 GitHub 原生依赖为准，正文照抄 `Blocked by:` 一行
 * - 子票建出来只挂 `状态:排队中`
 */
import { ensureBlockedBy, ensureLabel, ensureSubIssue } from './issues.mjs'

export const QUEUE_LABEL = '状态:排队中'

const FORBIDDEN_LABELS = ['ready-for-agent', 'Sandcastle', '大小:小需求']

export class TicketError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'TicketError'
    this.code = code
    this.details = details
  }
}

/** 从父工单正文的 `## 验收条件` 读 `- [ ] ...`，返回去掉复选框的文本。 */
export function parseParentAcceptance(parentBody) {
  const lines = String(parentBody || '')
    .replace(/^﻿/, '')
    .split(/\r?\n/)
  const items = []
  let inSection = false
  for (const line of lines) {
    if (/^##\s/.test(line.trim())) {
      inSection = /^##\s*验收条件\s*$/.test(line.trim())
      continue
    }
    if (!inSection) continue
    const match = /^\s*[-*]\s*\[[ xX]\]\s*(.*)$/.exec(line)
    if (!match) continue
    const item = match[1].trim()
    if (item) items.push(item)
  }
  return items
}

function requireText(value, code, message) {
  if (typeof value !== 'string' || !value.trim()) throw new TicketError(code, message)
  return value.trim()
}

/** blockedBy 的值：本批票从 0 开始的下标，或票的标题。找不到返回 -1。 */
function blockerIndex(value, tickets) {
  if (Number.isInteger(value) && value >= 0 && value < tickets.length) return value
  return tickets.findIndex((ticket) => ticket.title === value)
}

/**
 * 校验一批票。任何一条不合法就抛出 TicketError，调用方不建票。
 */
export function validateTickets({ tickets, parentAcceptance = [] }) {
  if (!Array.isArray(tickets) || tickets.length === 0) {
    throw new TicketError('tickets_empty', '没有票可建')
  }

  const allowed = new Set(parentAcceptance.map((item) => item.trim()))
  const seenTitles = new Set()
  tickets.forEach((ticket, index) => {
    const title = requireText(ticket?.title, 'missing_title', `第 ${index + 1} 张票缺标题`)
    if (seenTitles.has(title)) {
      throw new TicketError('duplicate_title', `票标题重复：${title}`, { title })
    }
    seenTitles.add(title)
    requireText(ticket?.verticalSlice, 'missing_vertical_slice', `「${title}」缺垂直切片`)

    if (Array.isArray(ticket.labels)) {
      const forbidden = ticket.labels.find((name) => FORBIDDEN_LABELS.includes(name))
      if (forbidden) {
        throw new TicketError('forbidden_label', `子票不能挂 ${forbidden}：${title}`, { title, label: forbidden })
      }
    }

    if (!Array.isArray(ticket.acceptance) || ticket.acceptance.length === 0) {
      throw new TicketError('acceptance_empty', `「${title}」没有验收条件`)
    }
    for (const item of ticket.acceptance) {
      const text = requireText(item, 'acceptance_empty', `「${title}」有空的验收条件`)
      if (!allowed.has(text)) {
        throw new TicketError(
          'acceptance_not_from_parent',
          `「${title}」的验收条件不在父工单里：${text}`,
          { title, acceptance: text },
        )
      }
    }

    if (!Array.isArray(ticket.blockedBy)) {
      throw new TicketError('blocked_by_not_array', `「${title}」的 blockedBy 必须是数组`)
    }
    for (const blocker of ticket.blockedBy) {
      if (blockerIndex(blocker, tickets) === -1) {
        throw new TicketError(
          'unknown_blocker',
          `「${title}」的阻塞票不在本批里：${String(blocker)}`,
          { title, blocker },
        )
      }
    }
  })

  return tickets
}

function oneLine(text) {
  return String(text || '').replace(/\s*\r?\n\s*/g, ' ').trim()
}

const TICKETS_MARKER_RE = /<!--\s*factory:tickets\s+([A-Za-z0-9_-]+)\s*-->/g

/** 把票单编码成隐藏 JSON 行，放在提案末尾，重跑和 console 都从这里读。 */
export function encodeTicketsPayload(tickets) {
  const json = JSON.stringify(Array.isArray(tickets) ? tickets : [])
  return `<!-- factory:tickets ${Buffer.from(json, 'utf8').toString('base64url')} -->`
}

/** 从提案评论里读回隐藏票单；没有或解析失败返回 null。 */
export function parseTicketsPayload(body) {
  const matches = [...String(body || '').matchAll(TICKETS_MARKER_RE)]
  if (!matches.length) return null
  try {
    const parsed = JSON.parse(Buffer.from(matches.at(-1)[1], 'base64url').toString('utf8'))
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** `提案：拆票` 评论：接缝、票单一行一张，末尾带隐藏票单 JSON。提案阶段不建票。 */
export function renderProposal({ seams = [], tickets = [] }) {
  const seamLines = seams.length ? seams.map((seam) => `- ${oneLine(seam)}`) : ['- 无']
  const ticketLines = tickets.map((ticket, index) => {
    const acceptance = (ticket.acceptance || []).map(oneLine).join('；')
    return `- ${index + 1}. ${oneLine(ticket.title)} —— ${acceptance}`
  })
  return [
    '提案：拆票',
    '',
    '## 接缝',
    '',
    ...seamLines,
    '',
    '## 票单',
    '',
    `共 ${tickets.length} 张票。`,
    '',
    ...ticketLines,
    '',
    encodeTicketsPayload(tickets),
  ].join('\n')
}

/** `点头：拆票` 评论。 */
export function renderPoint({ count }) {
  return `点头：拆票\n\n建了 ${count} 张子票。`
}

/** 子票正文三段。没有阻塞时整段不写，不留「Blocked by: 无」。 */
export function renderTicketBody(ticket, blockerNumbers = []) {
  const blocks = [
    `## 垂直切片\n\n${oneLine(ticket.verticalSlice)}`,
    `## 验收条件\n\n${ticket.acceptance.map((item) => `- [ ] ${oneLine(item)}`).join('\n')}`,
  ]
  if (blockerNumbers.length) {
    blocks.push(`## 阻塞\n\nBlocked by: ${blockerNumbers.map((number) => `#${number}`).join(', ')}`)
  }
  return blocks.join('\n\n')
}

/**
 * 点头后建子票。先校验，再建；按标题复用父工单现有子票，重跑不建第二套。
 * 子票只挂 `状态:排队中`，不碰 spec 和父工单标签。
 */
export async function createTickets({ gh, owner, repo, parent, tickets }) {
  const parentIssue = await gh.getIssue({ owner, repo, number: parent })
  const parentAcceptance = parseParentAcceptance(parentIssue.body)
  validateTickets({ tickets, parentAcceptance })

  await ensureLabel(gh, {
    owner,
    repo,
    name: QUEUE_LABEL,
    color: 'fbca04',
    description: '轮到了，等点火',
  })

  const existing = await gh.listSubIssues({ owner, repo, number: parent })
  const existingByTitle = new Map(existing.map((row) => [row.title, row]))

  const rows = []
  for (const ticket of tickets) {
    let issue = existingByTitle.get(ticket.title)
    let created = false
    if (!issue) {
      issue = await gh.createIssue({
        owner,
        repo,
        title: ticket.title,
        body: renderTicketBody(ticket),
        labels: [QUEUE_LABEL],
      })
      created = true
    }
    rows.push({ ticket, issue, created })
  }

  for (const row of rows) {
    const blockerNumbers = row.ticket.blockedBy.map(
      (value) => rows[blockerIndex(value, tickets)].issue.number,
    )
    const body = renderTicketBody(row.ticket, blockerNumbers)
    if (row.issue.body !== body) {
      row.issue = await gh.updateIssue({ owner, repo, number: row.issue.number, body })
    }
  }

  for (const row of rows) {
    await ensureSubIssue(gh, { owner, repo, parent, childId: row.issue.id })
  }
  for (const row of rows) {
    for (const value of row.ticket.blockedBy) {
      const blocker = rows[blockerIndex(value, tickets)].issue
      await ensureBlockedBy(gh, {
        owner,
        repo,
        issue: row.issue.number,
        blockerId: blocker.id,
      })
    }
  }

  return {
    tickets: rows.map(({ ticket, issue, created }) => ({
      title: ticket.title,
      number: issue.number,
      id: issue.id,
      created,
    })),
  }
}

/**
 * 当前能开工的票：所有阻塞票都已关闭。
 * @param {Array<{number: number, blockedBy: number[]}>} tickets
 * @param {number[]} closedNumbers
 */
export function frontier({ tickets = [], closedNumbers = [] }) {
  const closed = new Set([...closedNumbers].map(String))
  return tickets.filter((ticket) =>
    (ticket.blockedBy || []).every((number) => closed.has(String(number))),
  )
}
