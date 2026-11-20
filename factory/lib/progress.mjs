/**
 * 父工单上的转档行。生成和解析都在 `backend/lib/protocol.mjs`。
 *
 * 工厂这边额外要求进度行带 `路径：`：父工单进度行都有路径，订单转档行没有，
 * 不能把订单行当成父工单进度读。
 */
import {
  PROGRESS_PREFIX,
  parseProgress as parseAnyProgress,
  progressLine,
} from '../../backend/lib/protocol.mjs'

export { PROGRESS_PREFIX, progressLine }

export function parseProgress(line) {
  const text = typeof line === 'string' ? line.trim() : ''
  if (!text.startsWith(PROGRESS_PREFIX) || !text.includes('｜路径：')) return null
  return parseAnyProgress(text)
}
