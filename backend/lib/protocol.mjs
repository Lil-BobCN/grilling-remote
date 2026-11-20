/**
 * 文本协议：客户原话、验收条件、票单 marker、进度行、通知 key。
 *
 * 生成端和解析端共用这一份，工厂从 `../../backend/lib/protocol.mjs` 直接 import。
 * 模块自包含，只认 Node 内置对象，不 import 工厂或后端其他文件。
 *
 * 每种格式的规范写法和兼容写法见各函数注释。改动格式先改这里的契约测试。
 */

export const PROGRESS_PREFIX = '进度 v1｜'

const TICKETS_MARKER_RE = /<!--\s*factory:tickets\s+([A-Za-z0-9_-]+)\s*-->/g

function textOf(value) {
  return String(value ?? '').replace(/^\uFEFF/, '')
}

function sectionBody(text, headingRe) {
  const match = headingRe.exec(text)
  if (!match) return null
  const rest = text.slice(match.index + match[0].length)
  const next = /^##\s/m.exec(rest)
  return (next ? rest.slice(0, next.index) : rest).trim()
}

function oneLine(value) {
  return String(value ?? '').replace(/\s*\r?\n\s*/g, ' ').trim()
}

// ---- 客户原话 ----

const CUSTOMER_QUOTE_HEADING = /^##\s*(?:\d+\s*[.、．]?\s*)?客户原话\s*$/m
const ANY_HEADING = /^##\s/m
const QUOTE_DATE_LINE = /^日期[：:]\s*(.+)$/m
const DATE_PREFIX_LINE = /^\s*(?:>\s*)?(\d{4}-\d{2}-\d{2})\s*[：:]\s*(.+)$/m

/**
 * 从问答记录、需求草稿或父工单正文里读客户原话。
 *
 * 规范写法：「」包住原话，另起一行 `日期：YYYY-MM-DD`。命中返回 format `quote-date`。
 * 兼容写法一：`YYYY-MM-DD：原话`，命中返回 format `date-prefix`。
 * 兼容写法二：普通条目（需求草稿第 1 段），日期可缺，命中返回 format `plain-line`。
 * 同一节里有多种写法时，按上面的优先级取。
 *
 * 只读 `## 客户原话` 一节，后面轮次的话不算原话。
 * 文本里没有任何 `##` 标题时，把整段当作原话段落读。
 * 读不到原话或只读到空引号都返回 null，调用方用 null 判断缺原话。
 *
 * @param {string} text
 * @returns {{quote: string, date: string, format: 'quote-date'|'date-prefix'|'plain-line'}|null}
 */
export function parseCustomerQuote(text) {
  const source = textOf(text)
  let body = sectionBody(source, CUSTOMER_QUOTE_HEADING)
  if (body === null) {
    if (ANY_HEADING.test(source)) return null
    body = source.trim()
  }
  if (!body) return null

  const dateLine = QUOTE_DATE_LINE.exec(body)

  const quoted = /「([\s\S]*?)」/.exec(body)
  if (quoted && quoted[1].trim()) {
    return {
      quote: quoted[1].trim(),
      date: dateLine ? dateLine[1].trim() : '',
      format: 'quote-date',
    }
  }

  const dated = DATE_PREFIX_LINE.exec(body)
  if (dated) {
    let quote = dated[2].trim()
    const wrapped = /^「([\s\S]*?)」$/.exec(quote)
    if (wrapped) quote = wrapped[1].trim()
    if (quote) return { quote, date: dated[1], format: 'date-prefix' }
  }

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^(?:>\s*)+/, '').replace(/^[-*]\s+/, '').trim()
    if (!line) continue
    if (/^日期[：:]/.test(line)) continue
    if (/^#/.test(line)) continue
    if (/^「」$/.test(line)) continue
    if (DATE_PREFIX_LINE.test(line)) continue
    return {
      quote: line,
      date: dateLine ? dateLine[1].trim() : '',
      format: 'plain-line',
    }
  }

  return null
}

// ---- 验收条件 ----

const ACCEPTANCE_HEADING = /^##\s*验收条件\s*$/m
const CHECKBOX_LINE = /^\s*[-*]\s*\[([ xX])\]\s*(.*)$/
const BULLET_LINE = /^\s*[-*]\s+(.*)$/

/**
 * 生成验收条件，一行一条，统一写 `- [ ]`。
 * 传入字符串或 `{ text, checked }` 都可以，checked 不参与生成。
 *
 * @param {Array<string|{text: string, checked?: boolean}>} items
 * @returns {string}
 */
export function encodeAcceptance(items = []) {
  if (!Array.isArray(items)) throw new TypeError('encodeAcceptance 需要数组')
  return items
    .map((item) => {
      if (typeof item === 'string') return item
      return item && typeof item.text === 'string' ? item.text : ''
    })
    .map(oneLine)
    .filter(Boolean)
    .map((line) => `- [ ] ${line}`)
    .join('\n')
}

/**
 * 解析验收条件。
 *
 * 规范写法：`- [ ] 条目`。兼容写法：普通 `-` 或 `*` 条目，按未勾选处理。
 * `- [x]`、`- [X]` 按已勾选读回，生成时仍写回 `- [ ]`。
 * 正文里有 `## 验收条件` 时只读这一节；没有时读整段，方便直接读验收场景文件。
 * 传 `{ requireSection: true }` 时，没有这一节返回空数组。
 * 父工单用这个模式，免得把「客户确认的结论」「不做清单」里的条目当成验收条件。
 *
 * @param {string} text
 * @param {{requireSection?: boolean}} [options]
 * @returns {Array<{text: string, checked: boolean}>}
 */
export function parseAcceptance(text, { requireSection = false } = {}) {
  const source = textOf(text)
  if (!source.trim()) return []
  const section = sectionBody(source, ACCEPTANCE_HEADING)
  if (section === null && requireSection) return []
  const body = section === null ? source : section

  const items = []
  for (const line of body.split(/\r?\n/)) {
    const checkbox = CHECKBOX_LINE.exec(line)
    if (checkbox) {
      const item = checkbox[2].trim()
      if (item) items.push({ text: item, checked: checkbox[1] !== ' ' })
      continue
    }
    const bullet = BULLET_LINE.exec(line)
    if (bullet) {
      const item = bullet[1].trim()
      if (item) items.push({ text: item, checked: false })
    }
  }
  return items
}

// ---- 票单 marker ----

/**
 * 把票单编码成隐藏 JSON 行，放在提案末尾。
 * 规范写法：`<!-- factory:tickets <base64url> -->`，一行，在提案最后。
 * 传入非数组时按空票单编码，和旧实现一致。
 */
export function encodeTicketsPayload(tickets) {
  const json = JSON.stringify(Array.isArray(tickets) ? tickets : [])
  return `<!-- factory:tickets ${Buffer.from(json, 'utf8').toString('base64url')} -->`
}

/**
 * 从提案评论里读回隐藏票单。
 * 有多条 marker 时取最后一条；没有、解不开或不是数组都返回 null。
 */
export function parseTicketsPayload(body) {
  const matches = [...textOf(body).matchAll(TICKETS_MARKER_RE)]
  if (!matches.length) return null
  try {
    const parsed = JSON.parse(Buffer.from(matches.at(-1)[1], 'base64url').toString('utf8'))
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

// ---- 进度行 ----

/**
 * 生成一行进度。规范写法：
 * `进度 v1｜路径：其余｜客户档：安排中｜细阶段：写规格｜轮次：1｜卡住：否`
 * 备注可选，非空时接在末尾 `｜备注：...`。
 */
export function progressLine({ path = '其余', tier, step, round = 1, stuck = false, note = '' }) {
  const parts = [
    '进度 v1',
    `路径：${path}`,
    `客户档：${tier}`,
    `细阶段：${step}`,
    `轮次：${round}`,
    `卡住：${stuck ? '是' : '否'}`,
  ]
  if (note) parts.push(`备注：${note}`)
  return parts.join('｜')
}

/**
 * 解析一行进度。不是 `进度 v1｜` 开头或缺客户档，返回 null。
 * 兼容写法：没有 `路径：` 的订单进度行按默认路径 `其余` 读。
 * 字段之间用全角 `｜` 分隔，每个字段是 `名：值`。
 * `sub` 是细阶段第一段，`progress` 是后面的进度数（如 `2/4`），合起来是细阶段原文。
 */
export function parseProgress(line) {
  if (typeof line !== 'string') return null
  const text = line.trim()
  if (!text.startsWith(PROGRESS_PREFIX)) return null

  const fields = {}
  for (const segment of text.split('｜').slice(1)) {
    const cut = segment.indexOf('：')
    if (cut > 0) fields[segment.slice(0, cut).trim()] = segment.slice(cut + 1).trim()
  }
  if (!fields['客户档']) return null

  const [sub = '', ...rest] = (fields['细阶段'] || '').split(/\s+/)
  return {
    line: text,
    path: fields['路径'] || '其余',
    tier: fields['客户档'],
    sub,
    progress: rest.join(' '),
    round: Number(fields['轮次']) || 1,
    stuck: fields['卡住'] === '是',
    note: fields['备注'] || '',
  }
}

// ---- 通知 key ----

/**
 * 生成通知去重 key：`owner/repo:subject:event[:scope]`。
 *
 * owner 和 repo 小写，大小写写法不同也算同一个 key。
 * owner 和 repo 要么都给，要么都不给；不给时 key 不带仓库段。
 * subject 和 scope 为空时省略对应段。event 必填。
 *
 * @param {{owner?: string, repo?: string, subject?: string, event: string, scope?: string}} input
 * @returns {string}
 */
export function eventKey({ owner = '', repo = '', subject = '', event = '', scope = '' } = {}) {
  const name = String(event || '').trim()
  if (!name) throw new TypeError('eventKey 缺 event')

  const ownerName = String(owner || '').trim().toLowerCase()
  const repoName = String(repo || '').trim().toLowerCase()
  if (Boolean(ownerName) !== Boolean(repoName)) {
    throw new TypeError('eventKey 的 owner 和 repo 要么都给，要么都不给')
  }

  const location = ownerName ? `${ownerName}/${repoName}` : ''
  const parts = [location, String(subject || '').trim(), name, String(scope || '').trim()]
  return parts.filter(Boolean).join(':')
}
