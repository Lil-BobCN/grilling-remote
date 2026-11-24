/**
 * 客户地图和决定票：按回传原文建 GitHub issue。
 *
 * 输入是回传件里的 `map.md` 和 `issues/NN-*.md`；格式不对抛 `MapFormatError`，
 * 调用方停下报运营者，不改回传件。建图规则见 `docs/客户工作区.md` 第七节。
 */
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { ensureCommentOnce, ensureLabel, ensureSubIssue } from './issues.mjs'

export const MAP_SECTIONS = [
  'Destination',
  'Notes',
  '接下来',
  'Decisions so far',
  'Not yet specified',
  'Out of scope',
]

export const TICKET_TYPES = ['grilling', 'research', 'prototype', 'task']

export class MapFormatError extends Error {
  constructor(message, { code = 'map-format' } = {}) {
    super(message)
    this.name = 'MapFormatError'
    this.code = code
  }
}

function normalizeText(text) {
  return String(text || '').replace(/^﻿/, '').replace(/\r\n/g, '\n')
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function sectionText(text, heading) {
  const marker = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, 'm')
  const match = marker.exec(text)
  if (!match) return null
  const rest = text.slice(match.index + match[0].length)
  const next = /^##\s+/m.exec(rest)
  return (next ? rest.slice(0, next.index) : rest).trim()
}

/** 解析 `map.md` 六段。缺任何一段都算格式错误。 */
export function parseMap(mapText) {
  const text = normalizeText(mapText)
  const titleMatch = /^#\s+(.+?)\s*$/m.exec(text)
  const map = {
    title: titleMatch ? titleMatch[1].trim() : '',
    destination: '',
    notes: '',
    next: '',
    decisions: '',
    notYetSpecified: '',
    outOfScope: '',
  }
  const keys = {
    Destination: 'destination',
    Notes: 'notes',
    接下来: 'next',
    'Decisions so far': 'decisions',
    'Not yet specified': 'notYetSpecified',
    'Out of scope': 'outOfScope',
  }
  for (const heading of MAP_SECTIONS) {
    const body = sectionText(text, heading)
    if (body === null) throw new MapFormatError(`地图缺「${heading}」段`)
    map[keys[heading]] = body
  }
  return map
}

function ticketNumber(title) {
  const match = /^(\d+)(?:\s|$)/.exec(String(title || '').trim())
  return match ? match[1] : null
}

function normalizeNumber(value) {
  return String(Number(value))
}

function parseTicket(text, file) {
  const source = normalizeText(text)
  const titleMatch = /^#\s+(.+?)\s*$/m.exec(source)
  const fileNumber = /^(\d+)[-_ ]/.exec(file)?.[1] || null
  const fromFile = file.replace(/\.md$/, '').replace(/^(\d+)[-_ ]\s*/, '$1 ')
  let title = titleMatch ? titleMatch[1].trim() : fromFile
  if (titleMatch && !ticketNumber(title) && fileNumber) title = `${fileNumber} ${title}`
  const number = ticketNumber(title)
  if (!number) throw new MapFormatError(`票「${file}」缺编号标题`)
  if (fileNumber && normalizeNumber(fileNumber) !== normalizeNumber(number)) {
    throw new MapFormatError(`票「${file}」的文件名编号和标题编号不一致`)
  }

  const headingMatches = [...source.matchAll(/^##\s+(.+?)\s*$/gm)]
  const headerEnd = headingMatches[0]?.index ?? source.length
  const header = source.slice(titleMatch ? titleMatch.index + titleMatch[0].length : 0, headerEnd)
  const sections = {}
  headingMatches.forEach((match, index) => {
    const start = match.index + match[0].length
    const end = index + 1 < headingMatches.length ? headingMatches[index + 1].index : source.length
    sections[match[1].trim()] = source.slice(start, end).trim()
  })

  const headerFields = []
  for (const rawLine of header.split('\n')) {
    const match = /^([A-Za-z][A-Za-z ]*?):\s*(.*)$/.exec(rawLine.trim())
    if (match) headerFields.push({ key: match[1].trim(), value: match[2].trim(), raw: rawLine.trim() })
  }
  const field = (name) => headerFields.find((row) => row.key.toLowerCase() === name.toLowerCase())

  const typeField = field('Type')
  const type = typeField ? typeField.value.toLowerCase() : ''
  if (!TICKET_TYPES.includes(type)) {
    throw new MapFormatError(`票「${file}」的 Type 不是四种之一：${type || '缺 Type'}`)
  }
  if (!('Question' in sections)) {
    throw new MapFormatError(`票「${file}」缺「## Question」`)
  }

  const publishedHeader = headerFields
    .filter((row) => ['Type', 'Status', 'Blocked by'].includes(row.key))
    .map((row) => (row.key.toLowerCase() === 'type' ? `Type: ${type}` : row.raw))
  const body = [...publishedHeader, '', '## Question', '', sections.Question].join('\n').trim()

  const comments = (sections['评论'] || '')
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean)

  const conclusionText = (sections['结论'] || '')
    .split('\n')
    .filter((line) => !/^\s*-?\s*产出文件：/.test(line))
    .join('\n')
    .trim()
  const conclusion = /^[（(]?\s*做完才写\s*[）)]?$/.test(conclusionText) ? '' : conclusionText

  return {
    number,
    title,
    type,
    status: (field('Status')?.value || 'open').toLowerCase(),
    blockedBy: field('Blocked by')?.value || '',
    question: sections.Question,
    comments,
    conclusion,
    body,
    file,
  }
}

/** 读 `issues/NN-*.md`，按编号排序。任何格式问题都抛 MapFormatError。 */
export async function readDecisionTickets(dir) {
  let names = []
  try {
    names = await readdir(dir)
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
  const files = names
    .filter((name) => /^\d+[-_ ].*\.md$/.test(name))
    .sort((a, b) => Number(/^(\d+)/.exec(a)[1]) - Number(/^(\d+)/.exec(b)[1]) || a.localeCompare(b))

  const seen = new Map()
  const tickets = []
  for (const file of files) {
    const ticket = parseTicket(await readFile(join(dir, file), 'utf8'), file)
    const key = normalizeNumber(ticket.number)
    if (seen.has(key)) {
      throw new MapFormatError(`编号 ${ticket.number} 重复：${seen.get(key)} 和 ${file}`)
    }
    seen.set(key, file)
    tickets.push(ticket)
  }
  return tickets
}

const MAP_LABEL = { name: 'wayfinder:map', color: '5319e7', description: '客户地图，决定票挂在下面' }
const TYPE_LABELS = {
  grilling: { color: 'fbca04', description: '决定票：和客户聊' },
  research: { color: '1d76db', description: '决定票：查资料' },
  prototype: { color: 'd4c5f9', description: '决定票：看原型' },
  task: { color: '0e8a16', description: '决定票：动手做一步' },
}

async function readOptional(path) {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

function issueNumberFromUrl(url) {
  const match = /\/issues\/(\d+)(?:[#?].*)?\/?$/.exec(String(url || '').trim())
  return match ? Number(match[1]) : null
}

function renderMapBody(map, parentIssueUrl) {
  const notes = [`- 父工单：${parentIssueUrl}`, map.notes].filter(Boolean).join('\n')
  const bodies = {
    Destination: map.destination,
    Notes: notes,
    接下来: map.next,
    'Decisions so far': map.decisions,
    'Not yet specified': map.notYetSpecified,
    'Out of scope': map.outOfScope,
  }
  const body = MAP_SECTIONS.map((heading) => `## ${heading}\n\n${bodies[heading]}`.trimEnd()).join('\n\n')
  return `${body}\n\n<!-- factory:parent=${parentIssueUrl} -->\n`
}

/** 在父工单 `## 需求全文` 段补一行地图链接；已有同链接就跳过，不同就换成新链接。 */
export function appendMapLink(parentBody, mapIssueUrl) {
  const body = String(parentBody || '')
  const marker = /^##\s+需求全文\s*$/m.exec(body)
  if (!marker) throw new MapFormatError('父工单缺「## 需求全文」段')
  const start = marker.index + marker[0].length
  const rest = body.slice(start)
  const next = /^##\s+/m.exec(rest)
  const end = next ? start + next.index : body.length
  const section = body.slice(start, end)
  const linkLine = /^(\s*-\s*地图：)(\S+)(.*)$/m.exec(section)
  if (linkLine) {
    if (linkLine[2] === mapIssueUrl) return body
    const replaced = `${section.slice(0, linkLine.index)}${linkLine[1]}${mapIssueUrl}${linkLine[3]}${section.slice(linkLine.index + linkLine[0].length)}`
    return `${body.slice(0, start)}${replaced}${body.slice(end)}`
  }
  const lines = section.replace(/\s+$/, '').split('\n')
  lines.push(`- 地图：${mapIssueUrl}`)
  return `${body.slice(0, start)}${lines.join('\n')}\n\n${body.slice(end)}`
}

function nextTicketNumbers(map) {
  return map.next
    .split('\n')
    .map((line) => /^\s*[-*]\s+(?:\[)?(\d+)\b/.exec(line)?.[1])
    .filter(Boolean)
}

function validateTicketsAgainstNext(map, tickets) {
  const numbers = new Set(tickets.map((ticket) => normalizeNumber(ticket.number)))
  const next = new Set(nextTicketNumbers(map).map(normalizeNumber))
  for (const number of next) {
    if (!numbers.has(number)) {
      throw new MapFormatError(`地图「接下来」提到第 ${number} 张，但 issues/ 里没有这张票`)
    }
  }
  for (const ticket of tickets) {
    if (ticket.status !== 'resolved' && !next.has(normalizeNumber(ticket.number))) {
      throw new MapFormatError(`票「${ticket.title}」还没做完，但没列进地图「接下来」`)
    }
  }
}

async function syncTypeLabel(gh, { owner, repo, issue, type }) {
  const wanted = `wayfinder:${type}`
  const current = (issue.labels || []).map((row) => row.name || row)
  if (!current.includes(wanted)) {
    await gh.addLabels({ owner, repo, number: issue.number, labels: [wanted] })
  }
  for (const name of current) {
    if (name.startsWith('wayfinder:') && name !== wanted && name !== 'wayfinder:map') {
      await gh.removeLabel({ owner, repo, number: issue.number, name })
    }
  }
}

/**
 * 按 `map.md` 和 `issues/NN-*.md` 建地图 issue 和决定票。
 *
 * - 重跑按编号配对，已有票更新正文、补缺的评论，不建第二套。
 * - `mode='replace'` 用于点头前重传：换地图正文，按编号换票，
 *   新包没有的票写 `作废：重传` 再关，运营者自己开的票标 `待复查：重传`。
 * - 小需求（只有 `需求草稿.md`）返回 `{skipped: 'small'}`。
 * - 格式问题在任何 GitHub 写操作之前抛出 `MapFormatError`。
 */
export async function ensureMapIssues({
  gh,
  owner,
  repo,
  requirement,
  scratchDir,
  parentIssueUrl,
  mode = 'add',
}) {
  if (!['add', 'replace'].includes(mode)) throw new Error(`未知的 mode：${mode}`)

  const mapText = await readOptional(join(scratchDir, 'map.md'))
  if (mapText === null) {
    if ((await readOptional(join(scratchDir, '需求草稿.md'))) !== null) return { skipped: 'small' }
    throw new MapFormatError('回传目录里既没有 map.md，也没有需求草稿.md')
  }
  const map = parseMap(mapText)
  const tickets = await readDecisionTickets(join(scratchDir, 'issues'))
  validateTicketsAgainstNext(map, tickets)

  const parentNumber = issueNumberFromUrl(parentIssueUrl)
  if (!parentNumber) throw new MapFormatError(`父工单链接读不出编号：${parentIssueUrl}`)
  const parent = await gh.getIssue({ owner, repo, number: parentNumber })
  if (!/^##\s+需求全文\s*$/m.test(parent.body || '')) {
    throw new MapFormatError('父工单缺「## 需求全文」段')
  }

  const existingMaps = await gh.listIssues({ owner, repo, state: 'all', labels: MAP_LABEL.name })
  const existingMap = existingMaps.find((row) => String(row.body || '').includes(parentIssueUrl)) || null

  await ensureLabel(gh, { owner, repo, ...MAP_LABEL })
  for (const type of TICKET_TYPES) {
    await ensureLabel(gh, { owner, repo, name: `wayfinder:${type}`, ...TYPE_LABELS[type] })
  }

  let mapIssue = existingMap
  if (!mapIssue) {
    mapIssue = await gh.createIssue({
      owner,
      repo,
      title: map.title || `${requirement} 地图`,
      body: renderMapBody(map, parentIssueUrl),
      labels: [MAP_LABEL.name],
    })
  } else if (mode === 'replace') {
    mapIssue = await gh.updateIssue({
      owner,
      repo,
      number: mapIssue.number,
      body: renderMapBody(map, parentIssueUrl),
    })
  }

  const nextParentBody = appendMapLink(parent.body || '', mapIssue.html_url)
  if (nextParentBody !== parent.body) {
    await gh.updateIssue({ owner, repo, number: parentNumber, body: nextParentBody })
  }

  const existingChildren = existingMap
    ? await gh.listSubIssues({ owner, repo, number: mapIssue.number })
    : []
  const byNumber = new Map()
  for (const child of existingChildren) {
    const number = ticketNumber(child.title)
    if (number) byNumber.set(normalizeNumber(number), child)
  }
  const matchedIds = new Set()

  const savedTickets = []
  for (const ticket of tickets) {
    const wantedLabel = `wayfinder:${ticket.type}`
    let issue = byNumber.get(normalizeNumber(ticket.number))
    const created = !issue
    if (!issue) {
      issue = await gh.createIssue({
        owner,
        repo,
        title: ticket.title,
        body: ticket.body,
        labels: [wantedLabel],
      })
    } else {
      matchedIds.add(issue.id)
      if (issue.body !== ticket.body) {
        issue = await gh.updateIssue({ owner, repo, number: issue.number, body: ticket.body })
      }
      await syncTypeLabel(gh, { owner, repo, issue, type: ticket.type })
    }
    for (const comment of ticket.comments) {
      await ensureCommentOnce(gh, { owner, repo, number: issue.number, body: comment })
    }
    if (mode === 'replace' && ticket.status === 'resolved' && ticket.conclusion) {
      await ensureCommentOnce(gh, { owner, repo, number: issue.number, body: ticket.conclusion })
    }
    await ensureSubIssue(gh, { owner, repo, parent: mapIssue.number, childId: issue.id })
    savedTickets.push({ number: ticket.number, title: ticket.title, issue, created })
  }

  const review = []
  if (mode === 'replace') {
    const extras = existingChildren.filter((child) => !matchedIds.has(child.id))
    for (const extra of extras) {
      const fromReturn = /^Type:\s*(grilling|research|prototype|task)\s*$/m.test(String(extra.body || ''))
      if (fromReturn) {
        await ensureCommentOnce(gh, { owner, repo, number: extra.number, body: '作废：重传' })
        if (extra.state !== 'closed') {
          await gh.closeIssue({ owner, repo, number: extra.number })
        }
      } else {
        await ensureCommentOnce(gh, { owner, repo, number: extra.number, body: '待复查：重传' })
        review.push(extra)
      }
    }
    const today = new Date().toISOString().slice(0, 10)
    const reviewLines = review.length
      ? review.map((row) => `- #${row.number} ${row.title}`)
      : ['- 无']
    await ensureCommentOnce(gh, {
      owner,
      repo,
      number: mapIssue.number,
      body: [`重传：${today}`, '', '下面这些票不是新包里的，去留待复查：', ...reviewLines].join('\n'),
    })
  }

  return { mapIssue, tickets: savedTickets, parentIssue: parent }
}

