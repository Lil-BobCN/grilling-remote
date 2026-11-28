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

/** 可见备注的上限，含末尾省略号。 */
export const NOTE_LIMIT = 160

function collapse(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 进度行里给人看的那段备注。空白折叠，超过 limit 时切到最近的句号、分号或逗号，
 * 末尾加「…」，总长不超过 limit。找不到标点才硬切。
 */
export function visibleNote(text, limit = NOTE_LIMIT) {
  const clean = collapse(text)
  if (clean.length <= limit) return clean
  const budget = Math.max(1, limit - 1)
  const head = clean.slice(0, budget)
  let cut = -1
  for (const mark of ['。', '；', ';', '，', ',']) {
    cut = Math.max(cut, head.lastIndexOf(mark))
  }
  const body = cut >= 0 ? head.slice(0, cut + 1) : head
  return `${body.trimEnd()}…`
}

/** 完整原因放进 GitHub 折叠区，和进度行同一条评论。 */
export function reasonDetails(text) {
  const clean = collapse(text)
  if (!clean) return ''
  return `<details><summary>完整原因</summary>\n\n${clean}\n\n</details>`
}

/** 进度行加完整原因折叠区；没有原因时只返回进度行。 */
export function progressComment(line, fullNote) {
  const details = reasonDetails(fullNote)
  return details ? `${line}\n\n${details}` : line
}

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
