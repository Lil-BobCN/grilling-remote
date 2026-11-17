/**
 * 父工单上的转档行：格式和 `backend/lib/progress.mjs` 相同。
 *
 * 评论正文只有一行，时间由 GitHub 评论的 `created_at` 提供。
 * 字段词表见 `prototype/issue-109/README.md`。
 */

export const PROGRESS_PREFIX = '进度 v1｜'

const SEP = '｜'

export function progressLine({ path = '其余', tier, step, round, stuck = false, note = '' }) {
  const parts = [
    '进度 v1',
    `路径：${path}`,
    `客户档：${tier}`,
    `细阶段：${step}`,
    `轮次：${round}`,
    `卡住：${stuck ? '是' : '否'}`,
  ]
  if (note) parts.push(`备注：${note}`)
  return parts.join(SEP)
}

/**
 * 解析一行进度。不是 `进度 v1｜` 开头，或缺路径、客户档，返回 null。
 * @param {string} line
 */
export function parseProgress(line) {
  if (typeof line !== 'string') return null
  const text = line.trim()
  if (!text.startsWith(PROGRESS_PREFIX)) return null

  const fields = {}
  for (const segment of text.split(SEP).slice(1)) {
    const cut = segment.indexOf('：')
    if (cut > 0) fields[segment.slice(0, cut).trim()] = segment.slice(cut + 1).trim()
  }
  if (!fields['路径'] || !fields['客户档']) return null

  const [sub = '', ...rest] = (fields['细阶段'] || '').split(/\s+/)
  return {
    line: text,
    path: fields['路径'],
    tier: fields['客户档'],
    sub,
    progress: rest.join(' '),
    round: Number(fields['轮次']) || 1,
    stuck: fields['卡住'] === '是',
    note: fields['备注'] || '',
  }
}
