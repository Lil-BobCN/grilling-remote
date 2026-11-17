/**
 * 小需求：不建图，补缺口提案末尾列出实现票；点头时先建票、再写点头。
 *
 * 契约见 `docs/工单模型.md` 第三节「小需求的实现票」和第五节迁移表。
 * 小需求只有 `需求草稿.md`，没有 `map.md`。
 */
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { draftProposal, renderPoint } from './gap.mjs'
import { ensureCommentOnce, ensureLabel, ensureSubIssue } from './issues.mjs'
import { parseParentAcceptance, QUEUE_LABEL } from './tickets.mjs'

const SMALL_LABEL = '大小:小需求'
const SMALL_SLICE = '整张小需求一次做完'

export class SmallRequirementError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'SmallRequirementError'
    this.code = code
    this.details = details
  }
}

async function isFile(path) {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/** 有 `需求草稿.md`，没有 `map.md`。 */
export async function isSmallRequirement(scratchDir) {
  return (
    (await isFile(join(scratchDir, '需求草稿.md'))) &&
    !(await isFile(join(scratchDir, 'map.md')))
  )
}

/** 实现票标题用父工单标题；标题空时退回正文里的客户原话。 */
function parentTitle(parentIssue) {
  const title = String(parentIssue?.title || '').trim()
  if (title) return title
  const quoted = /「([\s\S]*?)」/.exec(String(parentIssue?.body || ''))
  const text = quoted ? quoted[1].trim() : ''
  if (!text) {
    throw new SmallRequirementError('missing_title', '父工单没有标题，也没有客户原话，不建实现票')
  }
  return text
}

/**
 * `提案：补缺口` 末尾加一节 `## 实现票`。
 * 技术题仍从 `pending.md` 读；小需求没有地图，所以没有业务题。
 */
export async function renderSmallProposal({ scratchDir, parentIssue }) {
  const proposal = await draftProposal({
    scratchDir,
    map: { notYetSpecified: '' },
    tickets: [],
  })
  const acceptance = parseParentAcceptance(parentIssue?.body)
  const lines = [
    '## 实现票',
    '',
    `标题：${parentTitle(parentIssue)}`,
    '',
    '验收条件：',
    '',
    ...(acceptance.length ? acceptance.map((item) => `- [ ] ${item}`) : ['- 无']),
  ]
  return {
    questions: proposal.questions,
    body: `${proposal.body}\n\n${lines.join('\n')}`,
  }
}

/** `点头：补缺口` 两段照旧，末行写实现票编号。 */
export function renderSmallPoint({ ticketNumber, answers = [], impacts = [] }) {
  const number = Number(ticketNumber)
  if (!Number.isInteger(number) || number <= 0) {
    throw new SmallRequirementError('missing_ticket', '点头里没有实现票编号')
  }
  return `${renderPoint({ answers, impacts })}\n\n实现票：#${number}`
}

function hasLabel(issue, name) {
  return (issue?.labels || [])
    .map((row) => (typeof row === 'string' ? row : row?.name))
    .includes(name)
}

function parentNumber(parent) {
  const number = typeof parent === 'object' ? parent?.number : Number(parent)
  if (!Number.isInteger(number) || number <= 0) {
    throw new SmallRequirementError('missing_parent', '缺父工单编号')
  }
  return number
}

/**
 * 实现票正文：两段，没有 `## 阻塞`。
 * `## 垂直切片` 固定写「整张小需求一次做完」；验收条件逐条抄父工单。
 */
export function renderSmallTicketBody(acceptance) {
  return [
    `## 垂直切片\n\n${SMALL_SLICE}`,
    `## 验收条件\n\n${acceptance.map((item) => `- [ ] ${item}`).join('\n')}`,
  ].join('\n\n')
}

/**
 * 建小需求的实现票：父工单必须带 `大小:小需求`，并且还没有别的子票。
 * 已有同名子票就复用，重跑不建第二张。
 * 返回 `{number, id}`。
 */
export async function createSmallImplementationTicket({ gh, owner, repo, parent }) {
  const number = parentNumber(parent)
  const parentIssue = await gh.getIssue({ owner, repo, number })
  if (!hasLabel(parentIssue, SMALL_LABEL)) {
    throw new SmallRequirementError(
      'not_small',
      `父工单 #${number} 没有「${SMALL_LABEL}」标签，不建实现票`,
    )
  }

  const title = parentTitle(parentIssue)
  const children = await gh.listSubIssues({ owner, repo, number })
  const existing = children.find((child) => child.title === title)
  if (existing) return { number: existing.number, id: existing.id }
  if (children.length) {
    throw new SmallRequirementError(
      'unexpected_child',
      `父工单 #${number} 已有子票，却没有同名实现票，不猜`,
    )
  }

  const acceptance = parseParentAcceptance(parentIssue.body)
  if (!acceptance.length) {
    throw new SmallRequirementError(
      'acceptance_empty',
      `父工单 #${number} 没有验收条件，不建实现票`,
    )
  }

  await ensureLabel(gh, {
    owner,
    repo,
    name: QUEUE_LABEL,
    color: 'fbca04',
    description: '轮到了，等点火',
  })
  const issue = await gh.createIssue({
    owner,
    repo,
    title,
    body: renderSmallTicketBody(acceptance),
    labels: [QUEUE_LABEL],
  })
  await ensureSubIssue(gh, { owner, repo, parent: number, childId: issue.id })
  return { number: issue.number, id: issue.id }
}

function normalizeAnswers(input) {
  if (Array.isArray(input)) return { answers: input, impacts: [] }
  return { answers: input?.answers || [], impacts: input?.impacts || [] }
}

/**
 * 小需求点头：先建实现票，成功后才写 `点头：补缺口`。
 *
 * 顺序由函数内部的阶段表约束：只允许 start → create-ticket → write-point。
 * 建票失败时阶段不会进入 write-point，也就不会写点头。
 */
export async function pointSmallRequirement({
  gh,
  owner,
  repo,
  parent,
  scratchDir,
  operatorAnswers,
}) {
  if (!(await isSmallRequirement(scratchDir))) {
    throw new SmallRequirementError(
      'not_small_scratch',
      `${scratchDir} 不是小需求目录，不走小需求点头`,
    )
  }
  const number = parentNumber(parent)
  const { answers, impacts } = normalizeAnswers(operatorAnswers)

  const nextStep = new Map([
    ['start', 'create-ticket'],
    ['create-ticket', 'write-point'],
  ])
  const phase = { current: 'start' }
  const enter = (step) => {
    if (nextStep.get(phase.current) !== step) {
      throw new SmallRequirementError(
        'wrong_order',
        `顺序错了：当前在 ${phase.current}，不能直接做 ${step}`,
      )
    }
    phase.current = step
  }

  enter('create-ticket')
  const ticket = await createSmallImplementationTicket({ gh, owner, repo, parent: number })
  const pointBody = renderSmallPoint({ ticketNumber: ticket.number, answers, impacts })

  enter('write-point')
  const posted = await ensureCommentOnce(gh, { owner, repo, number, body: pointBody })
  return { ticket, pointBody, posted }
}
