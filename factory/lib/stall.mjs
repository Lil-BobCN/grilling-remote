/**
 * 「停法」里两条可检查的判据：
 *
 * 1. 同一张票连续三条进度停在同一个细阶段；
 * 2. 同类问题跨票两次：两张以上票的 trail 里有同一条失败的验证或评审记录。
 *
 * 只读评论和 trail，不碰 GitHub，不改状态。
 */
import { parseProgress } from './progress.mjs'
import { parseTrail } from './evidence.mjs'

function progressRowsOf(comments = []) {
  const rows = []
  for (const comment of comments) {
    for (const line of String(comment?.body || '').split(/\r?\n/)) {
      const parsed = parseProgress(line)
      if (parsed) rows.push(parsed)
    }
  }
  return rows
}

function openTicketSet(openTickets) {
  if (openTickets === null || openTickets === undefined) return null
  return openTickets instanceof Set ? openTickets : new Set(openTickets)
}

/**
 * 按票分组看最近三条进度。
 *
 * 没有票号的旧进度不参与；`openTickets` 传了集合时，已关闭的票跳过。
 * 同一张票的进度按出现顺序取最近三条，客户视角和细阶段都相同才算停滞。
 *
 * @param {object} options
 * @param {Array<{body?: string}>} [options.comments]
 * @param {number} [options.threshold]
 * @param {Iterable<number>|Set<number>|null} [options.openTickets]
 * @returns {{stalled: boolean, rounds: number, reason: string, tiers: string[], ticket?: number, tickets: number[]}}
 */
export function roundsWithoutProgress({ comments = [], threshold = 3, openTickets = null } = {}) {
  const open = openTicketSet(openTickets)
  const groups = new Map()
  for (const row of progressRowsOf(comments)) {
    if (row.ticket === undefined) continue
    if (open && !open.has(row.ticket)) continue
    if (!groups.has(row.ticket)) groups.set(row.ticket, [])
    groups.get(row.ticket).push(row)
  }

  const key = (row) => `${row.tier}｜${row.sub}`
  const tickets = []
  let firstRows = []
  for (const [ticket, rows] of groups) {
    const last = rows.slice(-Math.max(1, threshold))
    if (last.length < threshold) continue
    if (!last.every((row) => key(row) === key(last[0]))) continue
    tickets.push(ticket)
    if (!firstRows.length) firstRows = last
  }

  if (tickets.length) {
    const where = key(firstRows[0])
    const label = tickets.map((ticket) => `#${ticket}`).join('、')
    return {
      stalled: true,
      rounds: firstRows.length,
      reason: `票 ${label} 连续 ${firstRows.length} 条都停在 ${where}`,
      tiers: firstRows.map((row) => key(row)),
      ticket: tickets[0],
      tickets,
    }
  }

  const total = [...groups.values()].reduce((sum, rows) => sum + rows.length, 0)
  const reason =
    total === 0
      ? '没有带票号的进度'
      : total < threshold
        ? `只有 ${total} 条带票号的进度，不够 ${threshold} 条`
        : '没有任何一张票连续三条停在同一个细阶段'
  return {
    stalled: false,
    rounds: total,
    reason,
    tiers: [],
    tickets: [],
  }
}

function normalizeProblem(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[\s，。；、,:：;.!?！？"'`（）()\[\]-]+/g, '')
    .slice(0, 120)
}

/**
 * @param {object} options
 * @param {Array<{ticket: number|string, rows?: object[], trail?: string}>} options.trails
 * @param {number} [options.minTickets]
 * @returns {{repeat: boolean, repeats: Array<{problem: string, tickets: Array<number|string>}>}}
 */
export function repeatProblems({ trails = [], minTickets = 2 } = {}) {
  const groups = new Map()
  for (const item of Array.isArray(trails) ? trails : []) {
    const ticket = item?.ticket
    if (ticket === undefined || ticket === null) continue
    const rows = Array.isArray(item.rows) ? item.rows : parseTrail(item.trail || '')
    for (const row of rows) {
      if (row.result !== 'fail') continue
      if (!['verify', 'review'].includes(row.phase)) continue
      const problem = normalizeProblem(row.evidence || row.decision)
      if (!problem) continue
      if (!groups.has(problem)) groups.set(problem, new Set())
      groups.get(problem).add(ticket)
    }
  }
  const repeats = [...groups.entries()]
    .filter(([, tickets]) => tickets.size >= minTickets)
    .map(([problem, tickets]) => ({
      problem,
      tickets: [...tickets].sort((left, right) => String(left).localeCompare(String(right))),
    }))
  return { repeat: repeats.length > 0, repeats }
}
