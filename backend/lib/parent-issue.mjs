/**
 * 从回传件的一个需求目录渲染父工单标题和五段。
 *
 * 来源固定，见 `docs/工单模型.md` 第二节：
 * - 标题和客户原话：`问答记录.md` 的 `## 客户原话`；没有时用 `需求草稿.md` 第 1 段第一条
 * - 客户确认的结论：走地图取 `map.md` 的 `## Decisions so far`，小需求取 `需求草稿.md` 第 3 段
 * - 验收条件：`验收场景.md` 的条目
 * - 不做清单：走地图取 `## Out of scope`，小需求取 `需求草稿.md` 第 5 段
 * - 需求全文：客户简称、需求名和完整 URL
 *
 * 地图 Decisions 里行首出现「已废」或「已被取代」时返回 `deprecated: true`，
 * 调用方不建单，只存快照并报运营者。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { customerQuoteFrom, numberedSectionBody } from './protocol.mjs'

async function readOptional(path) {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

function sectionBody(text, heading) {
  if (!text) return null
  const marker = new RegExp(`^##\\s*${heading}\\s*$`, 'm')
  const match = marker.exec(text)
  if (!match) return null
  const rest = text.slice(match.index + match[0].length)
  const next = /^##\s/m.exec(rest)
  return (next ? rest.slice(0, next.index) : rest).trim()
}

function bulletLines(body) {
  if (!body) return []
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
}

function stripBullet(line) {
  return line.replace(/^[-*]\s+/, '').trim()
}

function stripTrailingRevision(text) {
  return text.replace(/\s*[（(]?\s*按第\s*\d+\s*张改\s*[）)]?\s*$/, '').trim()
}

function stripLinks(text) {
  return text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
}

/** 取样例里的写法：结论是一句完整的话，补句号；还等人确认的不补。 */
function endSentence(text) {
  if (!text) return ''
  if (/[。！？…]$/.test(text)) return text
  if (/(?:确认|待定|再说|未定)$/.test(text)) return text
  return `${text}。`
}

function mapDecisions(map) {
  const body = sectionBody(map, 'Decisions so far')
  return bulletLines(body)
    .map((line) => {
      let text = stripBullet(line)
      text = text.replace(/^\[[^\]]*\]\([^)]*\)\s*/, '')
      const colon = text.search(/[：:]/)
      if (colon !== -1) text = text.slice(colon + 1)
      text = stripLinks(text)
      text = stripTrailingRevision(text)
      return endSentence(text)
    })
    .filter(Boolean)
    .map((item) => `- ${item}`)
}

function hasDeprecatedDecision(map) {
  const body = sectionBody(map, 'Decisions so far')
  if (!body) return false
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => /^[-*]?\s*(已废|已被取代)/.test(line))
}

function listItems(body) {
  const items = bulletLines(body)
    .map((line) => stripTrailingRevision(stripBullet(line)))
    .filter((line) => line && line !== '（空）')
  if (!items.length) return ['- 无']
  return items.map((item) => `- ${item}`)
}

function acceptanceItems(markdown) {
  const items = bulletLines(markdown)
    .map((line) => stripBullet(line).replace(/^\[[ xX]\]\s*/, ''))
    .map((line) => stripTrailingRevision(line))
    .filter(Boolean)
  if (!items.length) return ['- 无']
  return items.map((item) => `- [ ] ${item}`)
}

function draftSection(draft, number, keywords) {
  return numberedSectionBody(draft, number, keywords)
}

function draftConclusions(draft) {
  const body = draftSection(draft, 3, ['已经定下的'])
  return bulletLines(body)
    .map((line) => stripTrailingRevision(stripBullet(line)))
    .filter(Boolean)
    .map((item) => `- ${item}`)
}

/**
 * @param {object} options
 * @param {string} options.scratchDir 回传件里的 `.scratch/<需求名>` 目录
 * @param {string} options.shortName 客户简称
 * @param {string} options.requirement 需求名
 * @param {string} options.owner GitHub owner
 * @param {string} options.repo 客户仓名
 * @returns {Promise<{title: string, body: string, small: boolean, deprecated: boolean}>}
 */
export async function renderParentIssue({ scratchDir, shortName, requirement, owner, repo }) {
  const draft = await readOptional(join(scratchDir, '需求草稿.md'))
  const map = await readOptional(join(scratchDir, 'map.md'))
  const questions = await readOptional(join(scratchDir, '问答记录.md'))
  const acceptance = await readOptional(join(scratchDir, '验收场景.md'))

  if (draft === null && map === null) {
    throw new Error(`需求目录 ${scratchDir} 里找不到 map.md 或 需求草稿.md，不硬凑父工单`)
  }

  const small = draft !== null
  const { quote = '', date = '' } = customerQuoteFrom({ questions, draft }) || {}
  if (!quote) {
    throw new Error(`需求目录 ${scratchDir} 里读不到客户原话，不硬凑父工单`)
  }

  const conclusions = small ? draftConclusions(draft) : mapDecisions(map)
  const notDoing = small
    ? listItems(draftSection(draft, 5, ['以后再说', '不做清单', '不做']))
    : listItems(sectionBody(map, 'Out of scope'))
  const acceptanceLines = acceptanceItems(acceptance)

  const quoteBlock = quote.split(/\r?\n/).join('\n> ')
  const blocks = [
    `## 客户原话\n\n> 「${quoteBlock}」${date ? `\n\n日期：${date}` : ''}`,
    `## 客户确认的结论\n\n${conclusions.length ? conclusions.join('\n') : '- 无'}`,
    `## 验收条件\n\n${acceptanceLines.join('\n')}`,
    `## 不做清单\n\n${notDoing.join('\n')}`,
    [
      '## 需求全文',
      '',
      `- 客户简称：${shortName}`,
      `- 需求名：${requirement}`,
      `- 全文：https://github.com/${owner}/${repo}/tree/main/docs/requirements/${requirement}/`,
    ].join('\n'),
  ]

  return {
    title: quote,
    body: blocks.join('\n\n'),
    small,
    deprecated: hasDeprecatedDecision(map),
  }
}
