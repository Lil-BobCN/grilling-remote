/**
 * 「停法」里两条可检查的判据：
 *
 * 1. 同一张票三圈没进展：父工单的进度行按轮次取最后一条，最近三轮
 *    客户档和细阶段都一样；
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

/**
 * @returns {{stalled: boolean, rounds: number, reason: string, tiers: string[]}}
 */
export function roundsWithoutProgress({ comments = [], threshold = 3 } = {}) {
  const byRound = new Map()
  for (const row of progressRowsOf(comments)) byRound.set(row.round, row)
  const ordered = [...byRound.values()].sort((left, right) => left.round - right.round)
  const last = ordered.slice(-Math.max(1, threshold))
  if (last.length < threshold) {
    return { stalled: false, rounds: last.length, reason: `只有 ${last.length} 轮进度，不够 ${threshold} 轮`, tiers: [] }
  }
  const key = (row) => `${row.tier}｜${row.sub}`
  const same = last.every((row) => key(row) === key(last[0]))
  const increasing = last.every((row, index) => index === 0 || row.round > last[index - 1].round)
  return {
    stalled: same && increasing,
    rounds: last.length,
    reason: same ? `连续 ${last.length} 轮都停在 ${key(last[0])}` : '最近几轮有推进',
    tiers: last.map((row) => key(row)),
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
