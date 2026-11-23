import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { run } from '../bin/gap.mjs'
import { createGithub } from '../lib/github.mjs'
import { ensureLabel } from '../lib/issues.mjs'
import { STATE_LABELS, routeParent, runOnce } from '../lib/scheduler.mjs'
import {
  createSmallImplementationTicket,
  isSmallRequirement,
  pointSmallRequirement,
  renderSmallPoint,
  renderSmallProposal,
} from '../lib/small.mjs'
import { startFakeGithub } from './fake-github.mjs'

const OWNER = 'acme'
const REPO = 'acme-demo'

const PARENT_BODY = `## 客户原话

> 「想要个预约取货的小程序，顾客选时间来店里拿。」

日期：2026-11-17

## 客户确认的结论

- 只做到店取
- 顾客留手机号，不用微信登录

## 验收条件

- [ ] 顾客打开链接，选一个取货时间。
- [ ] 店里看到今天的预约名单。

## 不做清单

- 无

## 需求全文

- 客户简称：acme
- 需求名：yuyue
- 全文：https://github.com/acme/acme-demo/tree/main/docs/requirements/yuyue/
`

const TITLE = '想要个预约取货的小程序，顾客选时间来店里拿。'

const PENDING = `# 技术题

## 1 顾客怎么预约

- 题目原文：顾客预约要不要用微信登录？
- 推荐答案：不用，留手机号就行
- 标签：客户不懂
`

async function scratch(t, { draft = true, map = false, pending = PENDING } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'small-470-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  if (draft) await writeFile(join(dir, '需求草稿.md'), '# yuyue 需求草稿\n\nStatus: 已问完\n')
  if (map) await writeFile(join(dir, 'map.md'), '# yuyue 地图\n')
  if (pending !== null) await writeFile(join(dir, 'pending.md'), pending)
  return dir
}

async function setup(t, { labels = ['状态:已提交', '大小:小需求'], body = PARENT_BODY } = {}) {
  const fake = await startFakeGithub({
    repos: [{ owner: OWNER, name: REPO }],
    issues: [{ owner: OWNER, repo: REPO, title: TITLE, body, labels }],
  })
  t.after(() => fake.close())
  const gh = createGithub({ apiBase: fake.base, token: 'test' })
  for (const [name, meta] of Object.entries(STATE_LABELS)) {
    await ensureLabel(gh, { owner: OWNER, repo: REPO, name, ...meta })
  }
  for (const name of ['大小:小需求', 'needs-info', 'Sandcastle']) {
    await ensureLabel(gh, { owner: OWNER, repo: REPO, name })
  }
  const parent = await gh.getIssue({ owner: OWNER, repo: REPO, number: 1 })
  return { fake, gh, parent }
}

async function proposalOn(gh, parent) {
  await gh.createComment({
    owner: OWNER,
    repo: REPO,
    number: parent.number,
    body: '提案：补缺口\n\n1. 题：顾客预约要不要用微信登录？\n   推荐：不用，留手机号就行',
  })
}

test('isSmallRequirement：有需求草稿、没有地图才是小需求', async (t) => {
  assert.equal(await isSmallRequirement(await scratch(t)), true)
  assert.equal(await isSmallRequirement(await scratch(t, { map: true })), false)
  assert.equal(await isSmallRequirement(await scratch(t, { draft: false })), false)
  assert.equal(await isSmallRequirement(await scratch(t, { draft: false, map: true })), false)
})

test('renderSmallProposal：提案末尾列实现票，标题和验收条件抄父工单', async (t) => {
  const dir = await scratch(t)
  const parent = { number: 1, title: TITLE, body: PARENT_BODY }
  const proposal = await renderSmallProposal({ scratchDir: dir, parentIssue: parent })
  const body = proposal.body

  assert.equal(body.split('\n')[0], '提案：补缺口')
  assert.ok(body.includes('顾客预约要不要用微信登录？'))
  assert.ok(body.includes('不用，留手机号就行'))
  assert.doesNotMatch(body, /地图已还原/)

  const marker = body.indexOf('## 实现票')
  assert.ok(marker !== -1, '末尾要有「## 实现票」')
  const tail = body.slice(marker)
  assert.equal((tail.match(/^## /gm) || []).length, 1, '实现票是最后一节')
  assert.match(tail, new RegExp(`^标题：${TITLE}$`, 'm'))
  assert.match(tail, /验收条件：\n\n- \[ \] 顾客打开链接，选一个取货时间。\n- \[ \] 店里看到今天的预约名单。/)
  assert.equal(proposal.questions.length, 1)
})

test('renderSmallPoint：两段照旧，末行写实现票编号', () => {
  const body = renderSmallPoint({
    ticketNumber: 12,
    answers: ['顾客不用微信登录，留手机号'],
    impacts: [],
  })
  assert.equal(body.split('\n')[0], '点头：补缺口')
  assert.match(body, /## 最终答案\n\n- 顾客不用微信登录，留手机号/)
  assert.match(body, /## 正文影响\n\n无/)
  assert.equal(body.trimEnd().split('\n').at(-1), '实现票：#12')

  const changed = renderSmallPoint({
    ticketNumber: 13,
    answers: ['第 2 题作废'],
    impacts: ['「要微信登录」：第 2 题作废，正文未改，以本条评论为准。'],
  })
  assert.match(changed, /## 正文影响\n\n- 「要微信登录」/)
  assert.equal(changed.trimEnd().split('\n').at(-1), '实现票：#13')
})

test('createSmallImplementationTicket：只挂状态:排队中，正文两段不写阻塞，挂成子票', async (t) => {
  const { fake, gh, parent } = await setup(t)
  const ticket = await createSmallImplementationTicket({
    gh,
    owner: OWNER,
    repo: REPO,
    parent: parent.number,
  })

  const store = fake.state.issues.get(`${OWNER}/${REPO}`)
  const stored = store.find((row) => row.number === ticket.number)
  assert.equal(stored.id, ticket.id)
  assert.equal(stored.title, TITLE)
  assert.equal(
    stored.body,
    [
      '## 垂直切片',
      '',
      '整张小需求一次做完',
      '',
      '## 验收条件',
      '',
      '- [ ] 顾客打开链接，选一个取货时间。',
      '- [ ] 店里看到今天的预约名单。',
    ].join('\n'),
  )
  assert.doesNotMatch(stored.body, /## 阻塞/)
  assert.deepEqual(stored.labels, ['状态:排队中'])
  assert.deepEqual(store.find((row) => row.number === parent.number).subIssues, [ticket.id])
})

test('createSmallImplementationTicket：重跑复用同一张票，不建第二张', async (t) => {
  const { fake, gh, parent } = await setup(t)
  const first = await createSmallImplementationTicket({ gh, owner: OWNER, repo: REPO, parent: parent.number })
  const second = await createSmallImplementationTicket({ gh, owner: OWNER, repo: REPO, parent: parent.number })
  assert.deepEqual(second, first)
  const sameTitle = fake.state.issues
    .get(`${OWNER}/${REPO}`)
    .filter((row) => row.title === TITLE && row.number !== parent.number)
  assert.equal(sameTitle.length, 1)
})

test('createSmallImplementationTicket：父工单没有大小:小需求就拒绝', async (t) => {
  const { fake, gh, parent } = await setup(t, { labels: ['状态:已提交'] })
  await assert.rejects(
    createSmallImplementationTicket({ gh, owner: OWNER, repo: REPO, parent: parent.number }),
    (error) => error.code === 'not_small' && /大小:小需求/.test(error.message),
  )
  const created = fake.state.issues
    .get(`${OWNER}/${REPO}`)
    .filter((row) => row.title === TITLE)
  assert.equal(created.length, 1, '只留下父工单')
})

test('createSmallImplementationTicket：父工单已有别的子票就停，不猜', async (t) => {
  const { fake, gh, parent } = await setup(t)
  const other = await gh.createIssue({
    owner: OWNER,
    repo: REPO,
    title: '别的票',
    body: '',
    labels: ['状态:排队中'],
  })
  await gh.addSubIssue({ owner: OWNER, repo: REPO, number: parent.number, subIssueId: other.id })

  await assert.rejects(
    createSmallImplementationTicket({ gh, owner: OWNER, repo: REPO, parent: parent.number }),
    (error) => error.code === 'unexpected_child',
  )
  const created = fake.state.issues
    .get(`${OWNER}/${REPO}`)
    .filter((row) => row.title === TITLE && row.number !== parent.number)
  assert.equal(created.length, 0, '没有新建实现票')
})

test('createSmallImplementationTicket：父工单没有验收条件就停，不建空票', async (t) => {
  const body = PARENT_BODY.replace(
    '## 验收条件\n\n- [ ] 顾客打开链接，选一个取货时间。\n- [ ] 店里看到今天的预约名单。\n\n',
    '',
  )
  const { fake, gh, parent } = await setup(t, { body })
  await assert.rejects(
    createSmallImplementationTicket({ gh, owner: OWNER, repo: REPO, parent: parent.number }),
    (error) => error.code === 'acceptance_empty',
  )
  const created = fake.state.issues
    .get(`${OWNER}/${REPO}`)
    .filter((row) => row.title === TITLE && row.number !== parent.number)
  assert.equal(created.length, 0)
})

test('pointSmallRequirement：先建票、再写点头，末行是实现票编号', async (t) => {
  const { fake, gh, parent } = await setup(t)
  const dir = await scratch(t)
  await proposalOn(gh, parent)
  fake.state.requests.length = 0

  const result = await pointSmallRequirement({
    gh,
    owner: OWNER,
    repo: REPO,
    parent: parent.number,
    scratchDir: dir,
    operatorAnswers: { answers: ['顾客不用微信登录，留手机号'], impacts: [] },
  })

  const store = fake.state.issues.get(`${OWNER}/${REPO}`)
  const storedParent = store.find((row) => row.number === parent.number)
  const ticket = store.find((row) => row.number === result.ticket.number)
  assert.equal(ticket.title, TITLE)
  assert.deepEqual(storedParent.subIssues, [ticket.id])
  const points = storedParent.comments.filter((row) => row.body.startsWith('点头：补缺口'))
  assert.equal(points.length, 1)
  assert.equal(points[0].body, result.pointBody)
  assert.equal(result.pointBody.trimEnd().split('\n').at(-1), `实现票：#${ticket.number}`)

  const createIndex = fake.state.requests.findIndex(
    (row) => row.method === 'POST' && row.path === `/repos/${OWNER}/${REPO}/issues`,
  )
  const commentIndex = fake.state.requests.findIndex(
    (row) =>
      row.method === 'POST' &&
      row.path === `/repos/${OWNER}/${REPO}/issues/${parent.number}/comments`,
  )
  assert.ok(createIndex !== -1, '建了实现票')
  assert.ok(commentIndex !== -1, '写了点头评论')
  assert.ok(createIndex < commentIndex, '建票请求必须排在点头评论之前')
})

test('pointSmallRequirement：建票失败就不写点头', async (t) => {
  const { fake, gh, parent } = await setup(t)
  const dir = await scratch(t)
  await proposalOn(gh, parent)
  const broken = Object.create(gh)
  broken.createIssue = async () => {
    throw new Error('建票失败')
  }

  await assert.rejects(
    pointSmallRequirement({
      gh: broken,
      owner: OWNER,
      repo: REPO,
      parent: parent.number,
      scratchDir: dir,
      operatorAnswers: ['顾客不用微信登录'],
    }),
    /建票失败/,
  )

  const storedParent = fake.state.issues
    .get(`${OWNER}/${REPO}`)
    .find((row) => row.number === parent.number)
  assert.equal(storedParent.comments.filter((row) => row.body.startsWith('点头：补缺口')).length, 0)
  assert.deepEqual(storedParent.subIssues, [])
})

test('pointSmallRequirement：重跑不建第二张票，也不写第二条点头', async (t) => {
  const { fake, gh, parent } = await setup(t)
  const dir = await scratch(t)
  await proposalOn(gh, parent)
  const args = {
    gh,
    owner: OWNER,
    repo: REPO,
    parent: parent.number,
    scratchDir: dir,
    operatorAnswers: ['顾客不用微信登录'],
  }
  const first = await pointSmallRequirement(args)
  const second = await pointSmallRequirement(args)

  assert.deepEqual(second.ticket, first.ticket)
  const store = fake.state.issues.get(`${OWNER}/${REPO}`)
  const storedParent = store.find((row) => row.number === parent.number)
  assert.equal(store.filter((row) => row.title === TITLE && row.number !== parent.number).length, 1)
  assert.equal(storedParent.subIssues.length, 1)
  assert.equal(storedParent.comments.filter((row) => row.body.startsWith('点头：补缺口')).length, 1)
  const creates = fake.state.requests.filter(
    (row) =>
      row.method === 'POST' &&
      row.path === `/repos/${OWNER}/${REPO}/issues` &&
      row.body.title === TITLE,
  )
  assert.equal(creates.length, 1)
  assert.equal(first.posted, true)
  assert.equal(second.posted, false)
})

test('pointSmallRequirement：父工单出现改口：时拒绝，不建实现票', async (t) => {
  const { fake, gh, parent } = await setup(t)
  const dir = await scratch(t)
  await proposalOn(gh, parent)
  await gh.createComment({
    owner: OWNER,
    repo: REPO,
    number: parent.number,
    body: '改口：重传 2026-11-24T10:00:00.000Z，旧的提案和点头作废。',
  })

  await assert.rejects(
    pointSmallRequirement({
      gh,
      owner: OWNER,
      repo: REPO,
      parent: parent.number,
      scratchDir: dir,
      operatorAnswers: ['顾客不用微信登录'],
    }),
    (error) => error.name === 'GateConflictError' && error.kind === '改口：',
  )

  const store = fake.state.issues.get(`${OWNER}/${REPO}`)
  assert.equal(store.filter((row) => row.title === TITLE && row.number !== parent.number).length, 0)
  assert.equal(
    store
      .find((row) => row.number === parent.number)
      .comments.filter((row) => row.body.startsWith('点头：补缺口')).length,
    0,
  )
})

// ---- 调度器：只核对 #463 的路由，不改它 ----

const NOW = new Date('2026-11-17T10:00:00+08:00')

function routeParentIssue({ state = '已提交', small = true } = {}) {
  return {
    number: 42,
    id: 4200,
    title: TITLE,
    body: `${PARENT_BODY}\n<!-- factory:order=o-0001 -->\n`,
    labels: [
      { name: `状态:${state}` },
      ...(small ? [{ name: '大小:小需求' }] : []),
    ],
    state: 'open',
    html_url: `https://github.com/${OWNER}/${REPO}/issues/42`,
  }
}

function route({ state = '已提交', small = true, comments = [], subIssues = [] } = {}) {
  return routeParent({
    parent: routeParentIssue({ state, small }),
    comments,
    subIssues,
    now: NOW,
    owner: OWNER,
    repo: REPO,
  })
}

function openChild(number = 51) {
  return {
    number,
    id: 5100 + number,
    title: TITLE,
    state: 'open',
    labels: [{ name: '状态:排队中' }],
    blockedBy: [],
  }
}

function gate(body) {
  return { id: 1, body, created_at: '2026-11-16T09:00:00+08:00' }
}

test('调度器：小需求已提交+点头+一张 open 子票 → 开发中并点火', () => {
  const actions = route({ comments: [gate('点头：补缺口')], subIssues: [openChild()] })
  assert.deepEqual(actions.map((action) => action.type), ['setState', 'comment', 'ignite'])
  assert.equal(actions[0].from, '已提交')
  assert.equal(actions[0].to, '开发中')
  assert.equal(actions[2].ticket.number, 51)
  assert.match(actions[1].body, /路径：小需求/)
})

test('调度器：小需求已提交+点头+没有 open 子票 → needs-info，不猜', () => {
  const actions = route({ comments: [gate('点头：补缺口')] })
  assert.deepEqual(actions.map((action) => action.type), ['addLabel', 'comment', 'notify'])
  assert.equal(actions[0].name, 'needs-info')
  assert.equal(actions[2].event, 'needs-info')
})

test('调度器：小需求却是排队中 → needs-info，不按其余单走', () => {
  const actions = route({ state: '排队中', comments: [gate('点头：补缺口')] })
  assert.deepEqual(actions.map((action) => action.type), ['addLabel', 'comment', 'notify'])
  assert.equal(actions[0].name, 'needs-info')
})

test('调度器：其余单已提交+点头不走小需求分支，不点火', () => {
  const actions = route({ small: false, comments: [gate('点头：补缺口')] })
  assert.deepEqual(actions.map((action) => action.type), ['setState', 'comment', 'notify'])
  assert.equal(actions[0].to, '排队中')
  assert.equal(actions.some((action) => action.type === 'ignite'), false)
})

test('调度器 runOnce：小需求点头后真改父工单、贴 Sandcastle 并点火那张票', async (t) => {
  const { fake, gh } = await setup(t)
  const parent = await gh.createIssue({
    owner: OWNER,
    repo: REPO,
    title: TITLE,
    body: `${PARENT_BODY}\n<!-- factory:order=o-0001 -->\n`,
    labels: ['状态:已提交', '大小:小需求'],
  })
  const child = await gh.createIssue({
    owner: OWNER,
    repo: REPO,
    title: TITLE,
    body: '## 垂直切片\n\n整张小需求一次做完',
    labels: ['状态:排队中'],
  })
  await gh.addSubIssue({ owner: OWNER, repo: REPO, number: parent.number, subIssueId: child.id })
  await gh.createComment({
    owner: OWNER,
    repo: REPO,
    number: parent.number,
    body: '点头：补缺口\n\n## 最终答案\n\n- 顾客不用微信登录',
  })

  const delivered = []
  const ignited = []
  const dir = await mkdtemp(join(tmpdir(), 'small-lock-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const config = { owner: OWNER, lockDir: dir, maxActive: 5 }

  await runOnce({
    gh,
    customers: [{ id: 'c-0001', short_name: 'acme', status: 'active', repos: { demo: REPO } }],
    notifier: { async send(event) { delivered.push(event); return { code: 0 } } },
    ignite: async (args) => { ignited.push(args); return { started: true } },
    clock: () => NOW,
    config,
  })

  const store = fake.state.issues.get(`${OWNER}/${REPO}`)
  const storedParent = store.find((row) => row.number === parent.number)
  const storedChild = store.find((row) => row.number === child.number)
  assert.deepEqual(storedParent.labels.sort(), ['大小:小需求', '状态:开发中'].sort())
  assert.deepEqual(storedChild.labels.sort(), ['Sandcastle', '状态:排队中'].sort())
  assert.equal(ignited.length, 1)
  assert.equal(ignited[0].ticket.number, child.number)
  assert.equal(delivered.length, 0, '点火不额外发通知')
})

// ---- 命令行 ----

test('CLI 小需求：propose 末尾列实现票，point-small 先建票再写点头', async (t) => {
  const { gh, parent } = await setup(t)
  const dir = await scratch(t)
  const sink = { log() {} }

  const proposed = await run(
    ['propose', '--scratch', dir, '--owner', OWNER, '--repo', REPO, '--parent', parent.html_url],
    { gh, log: sink },
  )
  assert.equal(proposed.small, true)
  assert.equal(proposed.parent, parent.number)
  let comments = await gh.listComments({ owner: OWNER, repo: REPO, number: parent.number })
  const proposal = comments.find((row) => row.body.startsWith('提案：补缺口'))
  assert.ok(proposal)
  assert.match(proposal.body, /## 实现票/)
  assert.match(proposal.body, new RegExp(`标题：${TITLE}`))

  const pointed = await run(
    [
      'point-small',
      '--owner',
      OWNER,
      '--repo',
      REPO,
      '--parent',
      String(parent.number),
      '--scratch',
      dir,
      '--answers',
      JSON.stringify({ answers: ['顾客不用微信登录'], impacts: [] }),
    ],
    { gh, log: sink },
  )
  assert.equal(pointed.posted, true)
  assert.equal(typeof pointed.ticket, 'number')
  comments = await gh.listComments({ owner: OWNER, repo: REPO, number: parent.number })
  const point = comments.find((row) => row.body.startsWith('点头：补缺口'))
  assert.ok(point)
  assert.equal(point.body.trimEnd().split('\n').at(-1), `实现票：#${pointed.ticket}`)
  const children = await gh.listSubIssues({ owner: OWNER, repo: REPO, number: parent.number })
  assert.equal(children.length, 1)
  assert.equal(children[0].number, pointed.ticket)
})
