/**
 * 清图协议：地图标记、清雾三个去处、结论、严格门禁。
 *
 * 全是纯函数，不碰 GitHub；写回命令在 `factory/bin/map.mjs`。
 * 协议和判据见 `.inbox/plans/bot-map-clearing-2026-11-25.md`。
 */

export const PROTOCOL_MARKER = '- 清图协议：v1'

export class MapClearingError extends Error {
  constructor(message) {
    super(message)
    this.name = 'MapClearingError'
  }
}

function normalizeText(text) {
  return String(text ?? '').replace(/^﻿/, '').replace(/\r\n/g, '\n')
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isCommentLine(line) {
  return /^\s*<!--[\s\S]*-->\s*$/.test(line)
}

function stripBullet(line) {
  return String(line ?? '').replace(/^\s*[-*]\s+/, '').trim()
}

// 这里不并到 map-issues 的私有 sectionText：清图版要剥掉地图末尾的
// `<!-- factory:parent=... -->`，那个私有版本不剥，两份用途不同。
/** 读一段原文；地图最后一段末尾的 `<!-- factory:parent=... -->` 不算正文。 */
export function sectionText(text, heading) {
  const source = normalizeText(text)
  const marker = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, 'm')
  const match = marker.exec(source)
  if (!match) return null
  const rest = source.slice(match.index + match[0].length)
  const next = /^##\s+/m.exec(rest)
  const body = next ? rest.slice(0, next.index) : rest
  return body
    .split('\n')
    .filter((line) => !isCommentLine(line))
    .join('\n')
    .trim()
}

/** 段里的列表项：去空行、去注释、去 `（空）`、去列表符号。 */
export function itemsOf(text) {
  return normalizeText(text)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !isCommentLine(line) && line !== '（空）')
    .map((line) => stripBullet(line))
    .filter(Boolean)
}

function replaceSection(body, heading, content) {
  const source = normalizeText(body)
  const lines = source.split('\n')
  const headingPattern = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`)
  const headingIndex = lines.findIndex((line) => headingPattern.test(line))
  if (headingIndex === -1) throw new MapClearingError(`地图缺「${heading}」段`)

  let endIndex = lines.length
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) {
      endIndex = index
      break
    }
  }

  // 最后一段后面的工厂注释要原样留着，不能当正文删掉。
  const trailer = []
  let contentEnd = endIndex
  while (contentEnd > headingIndex + 1) {
    const line = lines[contentEnd - 1]
    if (line.trim() === '') {
      contentEnd -= 1
      continue
    }
    if (isCommentLine(line)) {
      trailer.unshift(line)
      contentEnd -= 1
      continue
    }
    break
  }

  const contentLines = content.trim() ? content.trim().split('\n') : []
  const rebuilt = [...lines.slice(0, headingIndex + 1)]
  if (contentLines.length) rebuilt.push('', ...contentLines)
  if (trailer.length) rebuilt.push('', ...trailer)
  if (endIndex < lines.length) rebuilt.push('', ...lines.slice(endIndex))
  return rebuilt.join('\n')
}

export function hasProtocol(body) {
  const notes = sectionText(body, 'Notes')
  if (notes === null) return false
  return notes.split('\n').some((line) => line.trim() === PROTOCOL_MARKER)
}

/** 在 Notes 段补协议标记；已有就原样返回。 */
export function addProtocolMarker(body) {
  if (hasProtocol(body)) return normalizeText(body)
  const notes = sectionText(body, 'Notes')
  if (notes === null) throw new MapClearingError('地图缺「Notes」段')
  const content = notes ? `${notes}\n${PROTOCOL_MARKER}` : PROTOCOL_MARKER
  return replaceSection(body, 'Notes', content)
}

export function ticketNumberOf(title) {
  const match = /^\s*#?(\d+)(?:\s|$)/.exec(String(title ?? '').trim())
  return match ? Number(match[1]) : null
}

export function stripTicketNumber(title) {
  return String(title ?? '').replace(/^\s*#?\d+\s+/, '').trim()
}

export function formatTicketNumber(number) {
  const value = Number(number)
  if (!Number.isFinite(value)) return String(number ?? '')
  return String(Math.trunc(value)).padStart(2, '0')
}

/** 从 `Not yet specified` 删掉整项；找不到报错，不动别的项。 */
export function removeFogItem(body, item) {
  const target = String(item ?? '').trim()
  if (!target) throw new MapClearingError('要删的雾项是空的')
  const fog = sectionText(body, 'Not yet specified')
  if (fog === null) throw new MapClearingError('地图缺「Not yet specified」段')
  const lines = fog ? fog.split('\n') : []
  const index = lines.findIndex((line) => stripBullet(line) === target)
  if (index === -1) throw new MapClearingError(`Not yet specified 里找不到这一项：${target}`)
  lines.splice(index, 1)
  return replaceSection(body, 'Not yet specified', lines.join('\n').trim())
}

function nextItemNumberOf(line) {
  const match = /^第\s*0*(\d+)\s*张[：:]\s*(.*)$/.exec(stripBullet(line))
  return match ? Number(match[1]) : null
}

/** 在 `接下来` 加 `- 第 NN 张：<标题>`；同一 NN 只留一行，`- 无` 被替换。 */
export function addNextTicket(body, number, title) {
  const nn = formatTicketNumber(number)
  const plainTitle = stripTicketNumber(title)
  const target = `第 ${nn} 张：${plainTitle}`
  const section = sectionText(body, '接下来')
  if (section === null) throw new MapClearingError('地图缺「接下来」段')
  const lines = section
    .split('\n')
    .filter((line) => line.trim() && stripBullet(line) !== '无')
  const matches = []
  lines.forEach((line, index) => {
    if (nextItemNumberOf(line) === Number(nn)) matches.push(index)
  })
  if (matches.length === 0) {
    lines.push(`- ${target}`)
  } else {
    if (matches.length === 1 && stripBullet(lines[matches[0]]) === target) {
      return normalizeText(body)
    }
    lines[matches[0]] = `- ${target}`
    for (let index = lines.length - 1; index > matches[0]; index -= 1) {
      if (nextItemNumberOf(lines[index]) === Number(nn)) lines.splice(index, 1)
    }
  }
  return replaceSection(body, '接下来', lines.join('\n'))
}

/** 从 `接下来` 按 NN 删行，找不到时原样返回。 */
export function removeNextTicket(body, number) {
  if (number === null || number === undefined) return normalizeText(body)
  const target = Number(number)
  const section = sectionText(body, '接下来')
  if (section === null) return normalizeText(body)
  const lines = section.split('\n')
  const index = lines.findIndex((line) => nextItemNumberOf(line) === target)
  if (index === -1) return normalizeText(body)
  lines.splice(index, 1)
  return replaceSection(body, '接下来', lines.join('\n').trim())
}

/** `Out of scope` 的行格式：`- <原文>（本版不做：<理由>）`。 */
export function outOfScopeLine(item, reason) {
  return `- ${String(item ?? '').trim()}（本版不做：${String(reason ?? '').trim()}）`
}

/** `Notes` 未定行格式：`- 未定：<原文>（<谁回话>，<下一步>）`。 */
export function unsettledLine(item, who, next) {
  return (
    `- 未定：${String(item ?? '').trim()}` +
    `（${String(who ?? '').trim()}，${String(next ?? '').trim()}）`
  )
}

/** `Out of scope` 追加 `- <原文>（本版不做：<理由>）`。 */
export function appendOutOfScope(body, item, reason) {
  const line = outOfScopeLine(item, reason)
  const section = sectionText(body, 'Out of scope')
  if (section === null) throw new MapClearingError('地图缺「Out of scope」段')
  const lines = section ? section.split('\n').filter((row) => row.trim()) : []
  if (lines.some((row) => stripBullet(row) === stripBullet(line))) return normalizeText(body)
  lines.push(line)
  return replaceSection(body, 'Out of scope', lines.join('\n'))
}

/** `Notes` 追加 `- 未定：<原文>（<谁回话>，<下一步>）`。 */
export function appendUnsettledNote(body, item, who, next) {
  const line = unsettledLine(item, who, next)
  const section = sectionText(body, 'Notes')
  if (section === null) throw new MapClearingError('地图缺「Notes」段')
  const lines = section ? section.split('\n').filter((row) => row.trim()) : []
  if (lines.some((row) => stripBullet(row) === stripBullet(line))) return normalizeText(body)
  lines.push(line)
  return replaceSection(body, 'Notes', lines.join('\n'))
}

/** 行首票号前缀，两位补零（`01 `）；标题没有票号返回 null。 */
function decisionNumberPrefix(title) {
  const number = ticketNumberOf(title)
  return number === null ? null : `${formatTicketNumber(number)} `
}

/** 保留旧行冒号前的标题部分，换上新结论；旧行没有冒号时整行当标题。 */
function decisionLineWith(row, conclusion) {
  const stripped = stripBullet(row)
  const match = /^[^：:]*[：:]/.exec(stripped)
  const titlePart = match ? match[0].slice(0, -1) : stripped
  return `- ${titlePart}：${conclusion}`
}

/**
 * `Decisions so far` 写 `- <标题>：<结论>`。
 *
 * 先按票号前缀（`01 `）匹配旧行：命中时保留地图原来的短名，只换冒号后的结论；
 * 同一票号多行只留一行，用这次写入的结论。找不到票号再按完整标题匹配，
 * 最后才追加。
 */
export function appendDecision(body, title, conclusion) {
  const cleanTitle = String(title ?? '').trim()
  const cleanConclusion = String(conclusion ?? '').trim()
  const line = `- ${cleanTitle}：${cleanConclusion}`
  const target = stripBullet(line)
  const titleMatches = (row) => {
    const stripped = stripBullet(row)
    return (
      stripped.startsWith(`${cleanTitle}：`) ||
      stripped.startsWith(`${cleanTitle}:`) ||
      stripped === target
    )
  }
  const numberPrefix = decisionNumberPrefix(cleanTitle)
  const numberMatches = (row) =>
    numberPrefix !== null && stripBullet(row).startsWith(numberPrefix)
  const section = sectionText(body, 'Decisions so far')
  if (section === null) throw new MapClearingError('地图缺「Decisions so far」段')
  const lines = section ? section.split('\n').filter((row) => row.trim()) : []
  const byNumber = numberPrefix !== null && lines.some(numberMatches)
  const matches = byNumber ? numberMatches : titleMatches
  const firstIndex = lines.findIndex(matches)
  if (firstIndex === -1) {
    lines.push(line)
  } else {
    const nextLine = byNumber ? decisionLineWith(lines[firstIndex], cleanConclusion) : line
    const extras = lines.some((row, index) => index > firstIndex && matches(row))
    if (!extras && stripBullet(lines[firstIndex]) === stripBullet(nextLine)) {
      return normalizeText(body)
    }
    lines[firstIndex] = nextLine
    for (let index = lines.length - 1; index > firstIndex; index -= 1) {
      if (matches(lines[index])) lines.splice(index, 1)
    }
  }
  return replaceSection(body, 'Decisions so far', lines.join('\n'))
}

/** 现有决定票标题开头的最大编号加一，两位补零。 */
export function nextTicketNumber(titles = []) {
  let max = 0
  for (const title of titles) {
    const number = ticketNumberOf(title)
    if (number !== null) max = Math.max(max, number)
  }
  return formatTicketNumber(max + 1)
}

/** 新决定票：标题 `NN <标题>`，正文 `## Question`、空 `## 评论`、空 `## 结论`。 */
export function renderDecisionTicket({ number, title, question }) {
  const nn = formatTicketNumber(number)
  const plainTitle = stripTicketNumber(title)
  return {
    title: `${nn} ${plainTitle}`,
    body: ['## Question', '', String(question ?? '').trim(), '', '## 评论', '', '## 结论'].join('\n'),
  }
}

/** 第一条评论第一行的 `结论：` 后面的文本；没有返回空串。 */
export function conclusionOf(comments = []) {
  for (const comment of comments || []) {
    const body = typeof comment === 'string' ? comment : String(comment?.body ?? '')
    const firstLine = body.split('\n')[0].trim()
    const match = /^结论[：:]\s*(.*)$/.exec(firstLine)
    if (match) return match[1].trim()
  }
  return ''
}

function commentsFor(source, number) {
  if (!source) return []
  if (source instanceof Map) return source.get(number) ?? source.get(String(number)) ?? []
  return source[number] ?? source[String(number)] ?? []
}

/** 关闭的决定票在 decisions 里有没有对应行；有票号时按票号加结论匹配，地图短名也算。 */
function hasDecisionLine(decisions, title, conclusion) {
  if (decisions.includes(`${title}：${conclusion}`)) return true
  const prefix = decisionNumberPrefix(title)
  if (prefix === null) return false
  return decisions.some((row) => {
    if (!row.startsWith(prefix)) return false
    const match = /^[^：:]*[：:]/.exec(row)
    return Boolean(match) && row.slice(match[0].length) === conclusion
  })
}

/**
 * 带清图协议的严格门禁。
 *
 * `subIssues` 是地图下的子票，`commentsByTicket` 是票编号到评论的映射，
 * 用来注入测试数据；不传时调用方自己读。
 */
export function strictGate({ body, subIssues = [], commentsByTicket = {} } = {}) {
  const blockers = []

  const fog = sectionText(body, 'Not yet specified')
  if (fog === null) {
    blockers.push({ kind: 'missing-section', text: '地图缺「Not yet specified」段' })
  } else {
    for (const text of itemsOf(fog)) blockers.push({ kind: 'not-yet-specified', text })
  }

  for (const row of subIssues.filter((ticket) => ticket.state !== 'closed')) {
    blockers.push({ kind: 'open-ticket', text: `#${row.number} ${row.title}`, number: row.number })
  }

  const decisions = itemsOf(sectionText(body, 'Decisions so far') || '')
  for (const row of subIssues.filter((ticket) => ticket.state === 'closed')) {
    const conclusion = conclusionOf(commentsFor(commentsByTicket, row.number))
    if (!conclusion) {
      blockers.push({ kind: 'missing-conclusion', text: `#${row.number} ${row.title}`, number: row.number })
      continue
    }
    const line = `${row.title}：${conclusion}`
    if (!hasDecisionLine(decisions, row.title, conclusion)) {
      blockers.push({ kind: 'decisions-missing', text: line, number: row.number })
    }
  }

  const nextItems = itemsOf(sectionText(body, '接下来') || '').filter((item) => item !== '无')
  if (nextItems.length) {
    blockers.push({ kind: 'next-not-empty', text: nextItems.join('；') })
  }

  const notes = sectionText(body, 'Notes') || ''
  for (const line of notes.split('\n')) {
    const match = /^\s*-\s*未定[：:](.*)$/.exec(line)
    if (!match) continue
    const tail = /[（(]([^（()）]*)[）)]\s*$/.exec(match[1])
    if (!tail || !tail[1].trim()) {
      blockers.push({ kind: 'unsettled-without-next', text: line.trim() })
    }
  }

  return { ready: blockers.length === 0, blockers }
}
