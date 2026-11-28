/**
 * 补缺口：从回传件列题、写 `提案：补缺口`，检查地图后写 `点头：补缺口`。
 *
 * 技术题从 `pending.md` 读，业务题从地图的 `Not yet specified` 和开放的
 * 决定票读。地图补没补完由 `gateReady` 判；`未定事项.md` 不在代码里读，
 * 由 agent 作业说明要求人工核。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { latestGate } from './gate.mjs'
import { ensureCommentOnce } from './issues.mjs'
import { hasProtocol, strictGate } from './map-clearing.mjs'
import { mapBelongsToParent } from './map-issues.mjs'

export class GateNotReadyError extends Error {
  constructor(blockers) {
    super('地图还没补完，不能写点头：补缺口')
    this.name = 'GateNotReadyError'
    this.blockers = blockers
  }
}

export class GateConflictError extends Error {
  constructor(kind, message) {
    super(message)
    this.name = 'GateConflictError'
    this.kind = kind
  }
}

const GATE_REMINDER =
  '提醒：补缺口\n\n地图还没补完，暂不写点头。Not yet specified 要清空，开放的决定票要全关。' +
  '带清图协议的地图还要看决定票结论、接下来和 Decisions so far。'

const DEFAULT_COMPLIANCE = '按本单实际收集的信息判断；收个人信息要写明用途和保存期限'

const GATE_CHECKS = [
  ['技术栈', '用默认技术栈，照模板仓已有的写法。'],
  ['部署到哪', '我们管理的香港服务器，客户不用买、不用备案、不用碰 DNS。'],
  ['第三方服务与账号', '默认不接；要用由运营者开账号，客户不自己注册。'],
  ['数据怎么存', '用默认技术栈自带的数据存储。'],
  ['每月花多少', '按最低配置起步，账单由运营者盯。'],
  ['合规', DEFAULT_COMPLIANCE],
  ['接缝', '测试打在一层，按项目默认边界。'],
  ['词汇表', '先读客户工作区 GLOSSARY.md；命名由运营者确认后写进客户仓 GLOSSARY.md。'],
  ['查重', '先搜 open 和 closed 工单，有重复就停下报运营者。'],
]

function normalizeText(text) {
  return String(text || '').replace(/^﻿/, '').replace(/\r\n/g, '\n')
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function sectionText(text, heading) {
  const source = normalizeText(text)
  const marker = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, 'm')
  const match = marker.exec(source)
  if (!match) return null
  const rest = source.slice(match.index + match[0].length)
  const next = /^##\s+/m.exec(rest)
  return (next ? rest.slice(0, next.index) : rest).trim()
}

function stripBullet(line) {
  return line.replace(/^\s*[-*]\s+/, '').trim()
}

function itemsOf(text) {
  return normalizeText(text)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('<!--') && line !== '（空）')
    .map(stripBullet)
    .filter(Boolean)
}

function pendingQuestions(pendingText) {
  const source = normalizeText(pendingText)
  const headings = [...source.matchAll(/^##\s+(\d+)\s+(.+?)\s*$/gm)]
  const questions = []
  headings.forEach((heading, index) => {
    const body = source.slice(
      heading.index + heading[0].length,
      index + 1 < headings.length ? headings[index + 1].index : source.length,
    )
    const fields = {}
    for (const line of body.split('\n')) {
      const match = /^\s*[-*]\s*([^：:]+)[：:]\s*(.*)$/.exec(line)
      if (match) fields[match[1].trim()] = match[2].trim()
    }
    if (!fields['题目原文']) return
    questions.push({
      source: `pending.md ${heading[1]} ${heading[2].trim()}`,
      question: fields['题目原文'],
      recommended: fields['推荐答案'] || '',
      tag: fields['标签'] || '',
    })
  })
  return questions
}

function businessQuestions(map, tickets) {
  const questions = []
  for (const line of itemsOf(map.notYetSpecified)) {
    if (!line.includes('你答')) continue
    questions.push({
      source: 'map.md Not yet specified',
      question: line.replace(/\s*[（(]你答[）)]\s*$/, '').trim(),
      recommended: '',
      tag: '你答',
    })
  }
  for (const ticket of tickets) {
    if (ticket.status !== 'claimed') continue
    questions.push({
      source: `票 ${ticket.title}`,
      question: ticket.question,
      recommended: '',
      tag: 'claimed',
    })
  }
  return questions
}

function renderQuestions(questions, start = 1) {
  return questions
    .map((question, index) =>
      [
        `${start + index}. 题目：${question.question}`,
        `   推荐：${question.recommended || '（待你定）'}`,
        ...(question.tag ? [`   标签：${question.tag}`] : []),
        `   出处：${question.source}`,
      ].join('\n'),
    )
    .join('\n\n')
}

/** 生成 `提案：补缺口` 的正文和结构化题目。 */
export async function draftProposal({
  scratchDir,
  map,
  tickets = [],
  mapUrl = '',
  recommendations = {},
  compliance = '',
}) {
  let pendingText = ''
  try {
    pendingText = await readFile(join(scratchDir, 'pending.md'), 'utf8')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }

  const recommend = (question) =>
    recommendations[question.question] || recommendations[question.source] || question.recommended || ''
  const technical = pendingQuestions(pendingText).map((question) => ({
    ...question,
    recommended: recommend(question),
  }))
  const business = businessQuestions(map, tickets).map((question) => ({
    ...question,
    recommended: recommend(question),
  }))
  const questions = [...technical, ...business]
  const complianceLine = String(compliance || '').trim() || DEFAULT_COMPLIANCE

  const parts = ['提案：补缺口']
  if (mapUrl) parts.push('', `地图已还原：${mapUrl}；剩余项在 map 上。`)
  if (technical.length) parts.push('', '## 技术题', '', renderQuestions(technical, 1))
  if (business.length) {
    parts.push('', '## 业务题', '', renderQuestions(business, technical.length + 1))
  }
  parts.push(
    '',
    '## 闸门检查',
    '',
    ...GATE_CHECKS.map(
      ([name, recommendation]) =>
        `- ${name}：${name === '合规' ? complianceLine : recommendation}`,
    ),
    '',
    '出处：docs/工厂流程.md 第八节 C1。客户的答案当推荐值；和这里不同就按客户的改。',
  )
  return { questions, body: parts.join('\n') }
}

/**
 * 地图补完才放行。
 *
 * 老地图（Notes 没有 `- 清图协议：v1`）只查原两条：Not yet specified 为空、
 * 决定票全关。带协议标记的地图跑 `strictGate`，还要看结论、接下来和
 * Decisions so far。`commentsByTicket` 用来注入测试数据，不传就现读。
 */
export async function gateReady({
  gh,
  owner,
  repo,
  mapIssueNumber,
  mapBody,
  commentsByTicket,
}) {
  const children = await gh.listSubIssues({ owner, repo, number: mapIssueNumber })
  if (hasProtocol(mapBody)) {
    let comments = commentsByTicket
    if (!comments) {
      comments = {}
      for (const row of children.filter((child) => child.state === 'closed')) {
        comments[row.number] = await gh.listComments({ owner, repo, number: row.number })
      }
    }
    return strictGate({ body: mapBody, subIssues: children, commentsByTicket: comments })
  }

  const fog = sectionText(mapBody, 'Not yet specified')
  const blockers = [
    ...(fog === null
      ? [{ kind: 'missing-section', text: '地图缺「Not yet specified」段' }]
      : itemsOf(fog).map((text) => ({ kind: 'not-yet-specified', text }))),
    ...children
      .filter((row) => row.state !== 'closed')
      .map((row) => ({ kind: 'open-ticket', text: `#${row.number} ${row.title}`, number: row.number })),
  ]
  return { ready: blockers.length === 0, blockers }
}

/** `点头：补缺口` 两段：最终答案，正文影响。 */
export function renderPoint({ answers = [], impacts = [] } = {}) {
  const answerLines = answers.map((item) => String(item).trim()).filter(Boolean)
  const impactLines = impacts.map((item) => String(item).trim()).filter(Boolean)
  return [
    '点头：补缺口',
    '',
    '## 最终答案',
    '',
    ...(answerLines.length ? answerLines.map((line) => (line.startsWith('- ') ? line : `- ${line}`)) : ['- 无']),
    '',
    '## 正文影响',
    '',
    ...(impactLines.length ? impactLines.map((line) => (line.startsWith('- ') ? line : `- ${line}`)) : ['无']),
  ].join('\n')
}

export async function postProposal({ gh, owner, repo, number, body }) {
  return ensureCommentOnce(gh, { owner, repo, number, body })
}

function sameBody(left, right) {
  return String(left || '').trim() === String(right || '').trim()
}

const SMALL_TICKET_LINE = /\n\n实现票：#[^\n]*\s*$/

/**
 * 写 `点头：补缺口` 前复查父工单最新关口。
 *
 * 最新是 `提案：补缺口` 才放行。最新是同一条点头时返回 `idempotent: true`，
 * 调用方不重写；正文不同、遇到 `改口：`、拆票或没有提案都抛 GateConflictError。
 * 小需求传 `ignoreTicketLine`：先拿不含末行 `实现票：#N` 的正文比对，
 * 避免在旧包或旧提案上建票。
 */
export async function assertPointGate({
  gh,
  owner,
  repo,
  number,
  body,
  ignoreTicketLine = false,
}) {
  const comments = await gh.listComments({ owner, repo, number })
  const gate = latestGate(Array.isArray(comments) ? comments : [])
  if (!gate) {
    throw new GateConflictError(null, '父工单还没有 `提案：补缺口`，不能写点头')
  }
  if (gate.kind === '点头：补缺口') {
    const gateBody = ignoreTicketLine
      ? String(gate.body).replace(SMALL_TICKET_LINE, '')
      : String(gate.body)
    if (sameBody(gateBody, body)) return { idempotent: true, gate }
    throw new GateConflictError(
      gate.kind,
      '最新关口是另一条 `点头：补缺口`，答案变了；先写 `改口：重传`，等新的 `提案：补缺口` 再点头',
    )
  }
  if (gate.kind.startsWith('改口：')) {
    throw new GateConflictError(
      gate.kind,
      '最新关口是 `改口：`，等新的 `提案：补缺口` 再点头',
    )
  }
  if (gate.kind === '提案：拆票' || gate.kind === '点头：拆票') {
    throw new GateConflictError(
      gate.kind,
      '最新关口是拆票，已经过拆票阶段，不能再补缺口点头',
    )
  }
  if (gate.kind === '提案：补缺口') return { idempotent: false, gate }
  throw new GateConflictError(
    gate.kind,
    `最新关口是「${gate.kind}」，等新的 \`提案：补缺口\` 再点头`,
  )
}

/**
 * 写 `点头：补缺口` 前先查最新关口，再查地图。没补完就抛 GateNotReadyError，
 * 并在父工单留一条提醒；提醒用固定正文，重复跑不会刷屏。
 * `parentIssueUrl` 必填：校验地图正文的 `- 父工单：` 行指向当前父工单；
 * 指向别处说明父工单里的地图链接是旧的，抛错且什么都不写。
 */
export async function postPoint({
  gh,
  owner,
  repo,
  number,
  mapIssueNumber,
  mapBody,
  parentIssueUrl,
  answers = [],
  impacts = [],
}) {
  if (!String(parentIssueUrl || '').trim()) {
    throw new Error('缺父工单链接，查不了地图属于哪张父工单')
  }
  const pointBody = renderPoint({ answers, impacts })
  const check = await assertPointGate({ gh, owner, repo, number, body: pointBody })
  if (check.idempotent) return false

  let body = mapBody
  if (!body) {
    if (!mapIssueNumber) throw new Error('缺地图编号，查不了地图是否补完')
    body = (await gh.getIssue({ owner, repo, number: mapIssueNumber })).body
  }
  if (!mapBelongsToParent(body, parentIssueUrl)) {
    throw new Error(
      `地图 #${mapIssueNumber} 的正文不含当前父工单链接 ${parentIssueUrl}：` +
        '父工单里的地图链接可能指向旧图。先修父工单正文里的地图链接，或重跑 apply-map',
    )
  }
  const gate = await gateReady({ gh, owner, repo, mapIssueNumber, mapBody: body })
  if (!gate.ready) {
    await ensureCommentOnce(gh, { owner, repo, number, body: GATE_REMINDER })
    throw new GateNotReadyError(gate.blockers)
  }
  return ensureCommentOnce(gh, {
    owner,
    repo,
    number,
    body: pointBody,
  })
}
