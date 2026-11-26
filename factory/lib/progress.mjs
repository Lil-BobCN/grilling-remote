/**
 * 父工单上的转档行。生成和解析都在 `backend/lib/protocol.mjs`。
 *
 * 工厂这边额外要求进度行带 `路径：`：父工单进度行都有路径，订单转档行没有，
 * 不能把订单行当成父工单进度读。
 *
 * 新写法行首是 `进度｜`，旧写法 `进度 v1｜` 继续认。客户轮次只数不带票号的进度。
 */
import {
  LEGACY_PROGRESS_PREFIX,
  PROGRESS_PREFIX,
  isProgressLine as isAnyProgressLine,
  parseProgress as parseAnyProgress,
  progressLine,
} from '../../backend/lib/protocol.mjs'

export { LEGACY_PROGRESS_PREFIX, PROGRESS_PREFIX, progressLine }

export function parseProgress(line) {
  const text = typeof line === 'string' ? line.trim() : ''
  if (!isAnyProgressLine(text) || !text.includes('｜路径：')) return null
  return parseAnyProgress(text)
}

/**
 * 客户轮次：最后一条不带票号的进度；那一条是「已驳回」时加一。
 * 票级进度不参与。一条都没有时是 1。
 */
export function clientRound(comments = []) {
  let latest = null
  for (const comment of Array.isArray(comments) ? comments : []) {
    for (const line of String(comment?.body || '').split(/\r?\n/)) {
      const parsed = parseProgress(line)
      if (parsed && parsed.ticket === undefined) latest = parsed
    }
  }
  if (!latest) return 1
  return latest.tier === '已驳回' ? latest.round + 1 : latest.round
}
