/**
 * 客户进度的转档行：认 `进度｜` 开头的新写法，也认旧的 `进度 v1｜`。
 *
 * 订单记录里的建单前转档，和工单评论里的转档，格式相同、时间不同。
 * 这里只做解析、排序和拼接，不做显示。
 */
import { isProgressLine, PROGRESS_PREFIX } from './protocol.mjs'

export { PROGRESS_PREFIX }
export const KNOWN_TIERS = ['已收到', '安排中', '开发中', '待客户验收', '已完成']

export { isProgressLine }

function timeValue(iso) {
  const value = Date.parse(iso || '')
  return Number.isFinite(value) ? value : 0
}

export function parseProgressEntry(entry) {
  const line = typeof entry?.line === 'string' ? entry.line.trim() : ''
  if (!isProgressLine(line)) return null

  const fields = {}
  for (const segment of line.split('｜').slice(1)) {
    const cut = segment.indexOf('：')
    if (cut > 0) fields[segment.slice(0, cut).trim()] = segment.slice(cut + 1).trim()
  }

  const subRaw = fields['细阶段'] || ''
  const [sub = '', ...rest] = subRaw.split(/\s+/)
  const ticketText = fields['票'] || ''

  return {
    at: entry?.at || '',
    line,
    path: fields['路径'] || '',
    tier: fields['客户视角'] || fields['客户档'] || '',
    sub,
    progress: rest.join(' '),
    ticket: /^\d+$/.test(ticketText) ? Number(ticketText) : undefined,
    round: Number(fields['轮次']) || 1,
    stuck: fields['卡住'] === '是',
    note: fields['备注'] || '',
  }
}

export function isKnownTier(tier) {
  return KNOWN_TIERS.includes(tier) || tier === '校验未通过' || tier === '已驳回'
}

function sortEntries(entries) {
  return [...entries].sort((left, right) => timeValue(left.at) - timeValue(right.at))
}

function dedupe(entries) {
  const seen = new Set()
  return entries.filter((entry) => {
    const key = `${entry.at}\n${entry.line}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function lastParsed(entries) {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const parsed = parseProgressEntry(entries[index])
    if (parsed && isKnownTier(parsed.tier)) return parsed
  }
  return null
}

/**
 * 把订单记录里的转档和工单评论里的转档拼起来。
 *
 * 父工单关闭、最后停在「待客户验收」时，补一行「已完成」，时间取关闭时间。
 * 关票前没到过「待客户验收」的，不补。
 */
export function mergeTransitions(order, issue) {
  const local = (order?.transitions || []).filter((entry) => isProgressLine(entry?.line))
  const remote = (issue?.transitions || []).filter((entry) => isProgressLine(entry?.line))
  const merged = sortEntries(dedupe([...local, ...remote]))

  const last = lastParsed(merged)
  if (issue?.state === 'closed' && issue?.closedAt && last?.tier === '待客户验收') {
    merged.push({
      at: issue.closedAt,
      line: [
        '进度',
        `路径：${last.path || '其余'}`,
        '客户视角：已完成',
        '细阶段：关单',
        `轮次：${last.round}`,
        '卡住：否',
      ].join('｜'),
    })
  }

  return merged
}
