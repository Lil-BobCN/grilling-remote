import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createGithub } from '../lib/github.mjs'
import { ensureLabel } from '../lib/issues.mjs'
import { progressLine } from '../lib/progress.mjs'
import {
  STATE_LABELS,
  collectRepos,
  collectSnapshot,
  digestEvent,
  dueDigest,
  pendingReminder,
  routeParent,
  runLoop,
  runOnce,
} from '../lib/scheduler.mjs'
import { startFakeGithub } from './fake-github.mjs'

const NOW = new Date('2026-11-17T10:00:00+08:00')

function parentBody({ customer = 'acme', requirement = 'yuyue-quhuo' } = {}) {
  return [
    '## 客户原话',
    '',
    '> 「要个预约取货」',
    '',
    '## 需求全文',
    '',
    `- 客户简称：${customer}`,
    `- 需求名：${requirement}`,
    `- 全文：https://github.com/acme/demo/tree/main/docs/requirements/${requirement}/`,
    '',
    '<!-- factory:order=o-0001 -->',
  ].join('\n')
}

function parent(overrides = {}) {
  return {
    number: 42,
    id: 4200,
    title: '要个预约取货',
    body: parentBody(),
    labels: [{ name: '状态:已提交' }],
    state: 'open',
    html_url: 'https://github.com/acme/demo/issues/42',
    ...overrides,
  }
}

function labels(...names) {
  return names.map((name) => ({ name }))
}

function gate(body, createdAt = '2026-11-16T09:00:00+08:00') {
  return { id: 1, body, created_at: createdAt }
}

function sub(overrides = {}) {
  return {
    number: 51,
    id: 5100,
    title: '子票一',
    state: 'open',
    labels: [],
    blockedBy: [],
    ...overrides,
  }
}

function route({ stateLabel = '状态:已提交', small = false, comments = [], subIssues = [], spec = null, closedNumbers = [], activeCount = 0, maxActive = 5, repoBusy = false } = {}) {
  const names = [stateLabel]
  if (small) names.push('大小:小需求')
  return routeParent({
    parent: parent({ labels: labels(...names) }),
    comments,
    subIssues,
    spec,
    closedNumbers,
    now: NOW,
    activeCount,
    maxActive,
    repoBusy,
  })
}

function types(actions) {
  return actions.map((action) => action.type)
}

test('其余单已提交+点头：补缺口 → 排队中，写安排中进度，推该跑 to-spec', () => {
  const actions = route({ comments: [gate('点头：补缺口\n\n## 最终答案')] })
  assert.deepEqual(types(actions), ['setState', 'comment', 'notify'])
  assert.equal(actions[0].from, '已提交')
  assert.equal(actions[0].to, '排队中')
  assert.match(actions[1].body, /^进度 v1｜路径：其余｜客户档：安排中｜细阶段：\S+｜轮次：1｜卡住：否$/)
  assert.equal(actions[2].event, '该跑 to-spec')
  assert.equal(actions[2].data.customer, 'acme')
  assert.equal(actions[2].data.requirement, 'yuyue-quhuo')
})

test('其余单排队中+有 spec+没有子票 → 叫拆票', () => {
  const actions = route({
    stateLabel: '状态:排队中',
    comments: [gate('点头：补缺口')],
    spec: { number: 60, title: 'spec yuyue-quhuo' },
  })
  assert.deepEqual(types(actions), ['runDecompose'])
})

test('排队中+spec+没有子票，就算已经有拆票点头也再叫一次拆票', () => {
  const actions = route({
    stateLabel: '状态:排队中',
    comments: [gate('点头：拆票')],
    spec: { number: 60, title: 'spec yuyue-quhuo' },
  })
  assert.deepEqual(types(actions), ['runDecompose'])
})

test('其余单排队中+有 open 子票+点头：拆票 → 开发中并点火第一张无阻塞子票', () => {
  const actions = route({
    stateLabel: '状态:排队中',
    comments: [gate('点头：拆票')],
    spec: { number: 60, title: 'spec' },
    subIssues: [sub({ number: 51, blockedBy: [52] }), sub({ number: 52, title: '子票二' })],
  })
  assert.deepEqual(types(actions), ['setState', 'comment', 'ignite'])
  assert.equal(actions[0].to, '开发中')
  assert.equal(actions[2].ticket.number, 52)
  assert.equal(actions[1].body.includes('客户档：开发中'), true)
})

test('待验收的子票不再点火', () => {
  const actions = route({
    stateLabel: '状态:排队中',
    comments: [gate('点头：拆票')],
    spec: { number: 60 },
    subIssues: [sub({ labels: labels('状态:待验收') })],
  })
  assert.deepEqual(actions, [])
})

test('所有子票都被未关闭的票挡着就不点，等阻塞解除', () => {
  const actions = route({
    stateLabel: '状态:排队中',
    comments: [gate('点头：拆票')],
    spec: { number: 60 },
    subIssues: [
      sub({ number: 51, blockedBy: [53] }),
      sub({ number: 52, blockedBy: [53] }),
    ],
  })
  assert.deepEqual(actions, [])
})

test('其余单排队中+点头：补缺口+没 spec → 停，等手动跑 to-spec', () => {
  assert.deepEqual(route({ stateLabel: '状态:排队中', comments: [gate('点头：补缺口')] }), [])
})

test('其余单排队中+有子票但最新不是点头：拆票 → 停，等点头', () => {
  const actions = route({
    stateLabel: '状态:排队中',
    comments: [gate('提案：拆票')],
    spec: { number: 60 },
    subIssues: [sub()],
  })
  assert.deepEqual(actions, [])
})

test('已提交+提案：补缺口 → 停，不猜', () => {
  assert.deepEqual(route({ comments: [gate('提案：补缺口')] }), [])
})

test('已提交+没有关口评论 → 停', () => {
  assert.deepEqual(route({ comments: [] }), [])
})

test('已提交+驳回：补缺口 → 停，等下一次点头', () => {
  assert.deepEqual(route({ comments: [gate('驳回：补缺口')] }), [])
})

test('已提交+改口： → 停', () => {
  assert.deepEqual(route({ comments: [gate('改口：重传')] }), [])
})

test('小需求已提交+点头：补缺口+一张 open 子票 → 开发中并点火', () => {
  const actions = route({
    small: true,
    comments: [gate('点头：补缺口')],
    subIssues: [sub()],
  })
  assert.deepEqual(types(actions), ['setState', 'comment', 'ignite'])
  assert.equal(actions[0].to, '开发中')
  assert.equal(actions[2].ticket.number, 51)
  assert.match(actions[1].body, /路径：小需求/)
})

test('小需求已提交+点头：补缺口+没有 open 子票 → needs-info，推需要人看', () => {
  const actions = route({ small: true, comments: [gate('点头：补缺口')] })
  assert.deepEqual(types(actions), ['addLabel', 'comment', 'notify'])
  assert.equal(actions[0].name, 'needs-info')
  assert.equal(actions[1].body.includes('卡住：是'), true)
  assert.equal(actions[2].event, 'needs-info')
})

test('小需求却是排队中 → needs-info', () => {
  const actions = route({ small: true, stateLabel: '状态:排队中', comments: [gate('点头：补缺口')] })
  assert.deepEqual(types(actions), ['addLabel', 'comment', 'notify'])
})

test('待验收+驳回： → 回开发中，写已驳回进度，另开修复子票', () => {
  const rejection = gate('驳回：客户说取货时间不能选。')
  const actions = route({ stateLabel: '状态:待验收', comments: [rejection] })
  assert.deepEqual(types(actions), ['setState', 'comment', 'createFixTicket'])
  assert.equal(actions[0].from, '待验收')
  assert.equal(actions[0].to, '开发中')
  assert.match(actions[1].body, /客户档：已驳回｜细阶段：记驳回/)
  assert.equal(actions[2].rejection.body.includes('取货时间不能选'), true)
})

test('待验收没有驳回 → 停在等客户，不猜', () => {
  assert.deepEqual(route({ stateLabel: '状态:待验收', comments: [gate('点头：拆票')] }), [])
})

test('驳回之后已经写过进度行，不再重复开修复子票', () => {
  const actions = route({
    stateLabel: '状态:待验收',
    comments: [
      gate('驳回：客户说不行', '2026-11-16T09:00:00+08:00'),
      gate('进度 v1｜路径：其余｜客户档：已驳回｜细阶段：记驳回｜轮次：1｜卡住：否', '2026-11-16T09:01:00+08:00'),
    ],
  })
  assert.deepEqual(actions, [])
})

test('开发中 → 停', () => {
  assert.deepEqual(route({ stateLabel: '状态:开发中', comments: [gate('点头：拆票')] }), [])
})

function progressComment(tier, step, round) {
  return gate(progressLine({ path: '其余', tier, step, round, stuck: false }))
}

test('排队中：三圈同进度 → needs-info 和出事，不点火', () => {
  const actions = route({
    stateLabel: '状态:排队中',
    comments: [
      progressComment('开发中', '开工', 1),
      progressComment('开发中', '开工', 2),
      progressComment('开发中', '开工', 3),
      gate('点头：拆票'),
    ],
    subIssues: [sub()],
  })
  assert.deepEqual(types(actions), ['addLabel', 'comment', 'notify', 'notify'])
  assert.ok(!types(actions).includes('ignite'))
  assert.ok(actions.some((action) => action.type === 'addLabel' && action.name === 'needs-info'))
  const incident = actions.find((action) => action.type === 'notify' && action.event === '出事')
  assert.equal(incident.data.reason, '三圈没进展')
  assert.equal(incident.key, '#42:出事:三圈没进展')
  assert.match(incident.data.tried, /连续 3 轮/)
  assert.match(actions.find((action) => action.type === 'comment').body, /备注：三圈没进展/)
})

test('开发中：同类问题跨票两次 → needs-info 和出事', () => {
  const trails = [
    {
      ticket: 51,
      rows: [{ phase: 'review', decision: '标准', evidence: '漏了错误处理', result: 'fail' }],
    },
    {
      ticket: 52,
      rows: [{ phase: 'review', decision: 'spec', evidence: '漏了错误处理。', result: 'fail' }],
    },
  ]
  const actions = routeParent({
    parent: parent({ labels: labels('状态:开发中') }),
    comments: [],
    subIssues: [sub({ number: 51 }), sub({ number: 52 })],
    trails,
    now: NOW,
  })
  assert.deepEqual(types(actions), ['addLabel', 'comment', 'notify', 'notify'])
  const incident = actions.find((action) => action.type === 'notify' && action.event === '出事')
  assert.equal(incident.data.reason, '同类两次')
  assert.equal(incident.key, '#42:出事:同类两次')
  assert.match(incident.data.tried, /漏了错误处理/)
  assert.match(incident.data.tried, /#51、#52/)
})

test('排队中：进度有推进就继续点火', () => {
  const actions = route({
    stateLabel: '状态:排队中',
    comments: [
      progressComment('安排中', '写规格', 1),
      progressComment('开发中', '开工', 2),
      progressComment('开发中', '合分支', 3),
      gate('点头：拆票'),
    ],
    subIssues: [sub()],
  })
  assert.equal(actions[0].type, 'setState')
  assert.ok(types(actions).includes('ignite'))
})

test('开发中：有 open 子票、没有 Sandcastle → 点火第一张 frontier', () => {
  const actions = route({
    stateLabel: '状态:开发中',
    comments: [],
    subIssues: [sub({ number: 51 }), sub({ number: 52 })],
  })
  assert.deepEqual(types(actions), ['ignite'])
  assert.equal(actions[0].ticketNumber, 51)
})

test('开发中：已有 Sandcastle 票不点第二张', () => {
  const actions = route({
    stateLabel: '状态:开发中',
    comments: [],
    subIssues: [
      sub({ number: 51, labels: labels('Sandcastle') }),
      sub({ number: 52 }),
    ],
  })
  assert.deepEqual(actions, [])
})

test('开发中：没有 open 子票就不点', () => {
  const actions = route({
    stateLabel: '状态:开发中',
    comments: [],
    subIssues: [sub({ number: 51, state: 'closed' })],
  })
  assert.deepEqual(actions, [])
})

test('没有状态标签 → needs-info', () => {
  const actions = routeParent({
    parent: parent({ labels: [] }),
    comments: [],
    subIssues: [],
    spec: null,
    closedNumbers: [],
    now: NOW,
    activeCount: 0,
    maxActive: 5,
  })
  assert.deepEqual(types(actions), ['addLabel', 'comment', 'notify'])
  assert.equal(actions[2].event, 'needs-info')
})

test('两个状态标签 → needs-info，不挑一个猜', () => {
  const actions = routeParent({
    parent: parent({ labels: labels('状态:已提交', '状态:开发中') }),
    comments: [gate('点头：补缺口')],
    subIssues: [],
    spec: null,
    closedNumbers: [],
    now: NOW,
    activeCount: 0,
    maxActive: 5,
  })
  assert.deepEqual(types(actions), ['addLabel', 'comment', 'notify'])
})

test('并发满五单时排队中的单不动，等到有名额', () => {
  const actions = route({
    stateLabel: '状态:排队中',
    comments: [gate('点头：拆票')],
    spec: { number: 60 },
    subIssues: [sub()],
    activeCount: 5,
    maxActive: 5,
  })
  assert.deepEqual(actions, [])
})

test('子票已贴 Sandcastle（点火后崩溃）→ 只补状态，不再点一次', () => {
  const actions = route({
    stateLabel: '状态:排队中',
    comments: [gate('点头：拆票')],
    spec: { number: 60 },
    subIssues: [sub({ labels: labels('Sandcastle') })],
  })
  assert.deepEqual(types(actions), ['setState', 'comment'])
})

test('同一仓还在跑另一张 → 不点第二张', () => {
  const actions = route({
    stateLabel: '状态:排队中',
    comments: [gate('点头：拆票')],
    spec: { number: 60 },
    subIssues: [sub()],
    repoBusy: true,
  })
  assert.deepEqual(actions, [])
})

test('轮次取最近一条进度行；驳回那行是 N，下一次开工写 N+1', () => {
  const previous = gate('进度 v1｜路径：其余｜客户档：安排中｜细阶段：点头｜轮次：3｜卡住：否')
  const actions = route({ comments: [previous, gate('点头：补缺口')] })
  assert.match(actions[1].body, /轮次：3/)

  const rejected = route({
    stateLabel: '状态:待验收',
    comments: [
      gate('进度 v1｜路径：其余｜客户档：开发中｜细阶段：合主干｜轮次：3｜卡住：否'),
      gate('驳回：客户说不行'),
    ],
  })
  assert.match(rejected[1].body, /轮次：3/)

  const nextRound = route({
    comments: [
      gate('进度 v1｜路径：其余｜客户档：已驳回｜细阶段：记驳回｜轮次：3｜卡住：否'),
      gate('点头：补缺口'),
    ],
  })
  assert.match(nextRound[1].body, /轮次：4/)
})

test('24 小时待办：提案：补缺口，带已等天数和新 key', () => {
  const reminder = pendingReminder({
    parent: parent({ comments: [] }),
    latestGate: { kind: '提案：补缺口', comment: gate('提案：补缺口', '2026-11-15T10:00:00+08:00') },
    now: NOW,
  })
  assert.equal(reminder.event, '补缺口提案')
  assert.equal(reminder.days_waited, 2)
  assert.match(reminder.key, /#42:补缺口提案:2/)
})

test('24 小时待办：点头：补缺口但仓库没 spec，该跑 to-spec', () => {
  const reminder = pendingReminder({
    parent: parent({ labels: labels('状态:排队中'), spec: null }),
    latestGate: { kind: '点头：补缺口', comment: gate('点头：补缺口', '2026-11-16T10:00:00+08:00') },
    now: NOW,
  })
  assert.equal(reminder.event, '该跑 to-spec')
  assert.equal(reminder.days_waited, 1)
})

test('点头：补缺口不到 24 小时不重发，初次由转档那条负责', () => {
  const reminder = pendingReminder({
    parent: parent({ labels: labels('状态:排队中'), spec: null }),
    latestGate: { kind: '点头：补缺口', comment: gate('点头：补缺口', '2026-11-17T09:00:00+08:00') },
    now: NOW,
  })
  assert.equal(reminder, null)
})

test('点头：补缺口但已经有 spec，不再提醒', () => {
  const reminder = pendingReminder({
    parent: parent({ spec: { number: 60 } }),
    latestGate: { kind: '点头：补缺口', comment: gate('点头：补缺口', '2026-11-15T10:00:00+08:00') },
    now: NOW,
  })
  assert.equal(reminder, null)
})

test('24 小时待办：提案：拆票和需要你答', () => {
  const split = pendingReminder({
    parent: parent(),
    latestGate: { kind: '提案：拆票', comment: gate('提案：拆票', '2026-11-16T10:00:00+08:00') },
    now: NOW,
  })
  assert.equal(split.event, '拆票提案')

  const answer = pendingReminder({
    parent: parent(),
    latestGate: { kind: '点头：拆票', comment: gate('点头：拆票', '2026-11-16T10:00:00+08:00') },
    now: NOW,
    needsAnswer: [
      {
        key: 'PR-123:ticket-51',
        question: '闸门第三题选哪个方案',
        recommended: '方案 A',
        link: 'https://github.com/acme/demo/pull/123',
        opened_at: '2026-11-16T10:00:00+08:00',
      },
    ],
  })
  assert.equal(answer.event, '需要你答')
  assert.equal(answer.days_waited, 1)
  assert.match(answer.key, /需要你答/)
})

test('点头：拆票、没有待答的问题 → 不再提醒', () => {
  const reminder = pendingReminder({
    parent: parent(),
    latestGate: { kind: '点头：拆票', comment: gate('点头：拆票', '2026-11-15T10:00:00+08:00') },
    now: NOW,
  })
  assert.equal(reminder, null)
})

test('每天 8:30 到点，今天没发过才发', () => {
  assert.equal(dueDigest({ now: new Date('2026-11-17T08:29:00+08:00'), lastSentDate: null }), false)
  assert.equal(dueDigest({ now: new Date('2026-11-17T08:30:00+08:00'), lastSentDate: null }), true)
  assert.equal(dueDigest({ now: new Date('2026-11-17T09:00:00+08:00'), lastSentDate: '2026-11-17' }), false)
  assert.equal(dueDigest({ now: new Date('2026-11-18T08:30:00+08:00'), lastSentDate: '2026-11-17' }), true)
})

test('每日抽样事件只列客户简称、需求名和 PR，没有合并不发', () => {
  const event = digestEvent({
    date: '2026-11-16',
    items: [
      { customer: 'acme', requirement: 'yuyue-quhuo', pr: 12, url: 'https://github.com/acme/demo/pull/12' },
      { customer: 'b店', requirement: 'kucun', pr: 13 },
    ],
  })
  assert.equal(event.v, 1)
  assert.equal(event.event, '每日抽样')
  assert.deepEqual(event.data.items.map((item) => item.pr), [12, 13])
  assert.equal(event.data.date, '2026-11-16')
  assert.match(event.key, /每日抽样:2026-11-16/)
  assert.equal(digestEvent({ date: '2026-11-16', items: [] }), null)
})

// ---- 从假 GitHub 读快照、跑一轮 ----

const OWNER = 'acme'
const REPO = 'acme-demo'

async function repoLabels(gh, owner = OWNER, repo = REPO) {
  for (const [name, meta] of Object.entries(STATE_LABELS)) {
    await ensureLabel(gh, { owner, repo, name, ...meta })
  }
  for (const name of ['Sandcastle', 'needs-info', '大小:小需求', 'ready-for-agent', 'wayfinder:map', 'wayfinder:grilling']) {
    await ensureLabel(gh, { owner, repo, name })
  }
}

async function setupRepo(t) {
  const fake = await startFakeGithub({ repos: [{ owner: OWNER, name: REPO }] })
  t.after(() => fake.close())
  const gh = createGithub({ apiBase: fake.base, token: 'test' })
  await repoLabels(gh)
  return { fake, gh }
}

async function createParent(gh, { state = '已提交', small = false, title = '要个预约取货' } = {}) {
  return gh.createIssue({
    owner: OWNER,
    repo: REPO,
    title,
    body: parentBody(),
    labels: [`状态:${state}`, ...(small ? ['大小:小需求'] : [])],
  })
}

async function createChild(gh, parent, { title = '子票一', labels = ['状态:排队中'] } = {}) {
  const child = await gh.createIssue({ owner: OWNER, repo: REPO, title, body: '', labels })
  await gh.addSubIssue({ owner: OWNER, repo: REPO, number: parent.number, subIssueId: child.id })
  return child
}

async function createSpec(gh, { title = 'spec yuyue-quhuo' } = {}) {
  return gh.createIssue({
    owner: OWNER,
    repo: REPO,
    title,
    body: '## Problem Statement\n\n预约取货。',
    labels: ['ready-for-agent'],
  })
}

async function createMap(gh, parent) {
  return gh.createIssue({
    owner: OWNER,
    repo: REPO,
    title: '地图',
    body: [
      '## Destination',
      '',
      '预约取货。',
      '',
      '## Notes',
      '',
      `- 父工单：${parent.html_url}`,
      '',
      `<!-- factory:parent=${parent.html_url} -->`,
    ].join('\n'),
    labels: ['wayfinder:map'],
  })
}

function customers(rows = [{ id: 'c-0001', short_name: 'acme', status: 'active', repos: { demo: REPO } }]) {
  return rows
}

function fakeNotifier() {
  const delivered = new Map()
  const calls = []
  return {
    delivered,
    calls,
    async send(event) {
      calls.push(event)
      if (!delivered.has(event.key)) delivered.set(event.key, event)
      return { code: 0, stdout: '{}' }
    },
  }
}

function fakeIgnite() {
  const calls = []
  return {
    calls,
    async ignite(args) {
      calls.push(args)
      return { started: true }
    },
  }
}

async function lockDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'afk-scheduler-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

function labelsOf(fake, owner, repo, number) {
  const issue = fake.state.issues.get(`${owner}/${repo}`).find((row) => row.number === number)
  return issue.labels
}

function commentsOf(fake, owner, repo, number) {
  const issue = fake.state.issues.get(`${owner}/${repo}`).find((row) => row.number === number)
  return issue.comments.map((comment) => comment.body)
}

test('collectRepos 只服务 customers.json 里 active 且 repos 非空的行，不扫前缀', () => {
  const rows = collectRepos({
    gh: null,
    owner: 'acme',
    customers: {
      customers: [
        { id: 'c-0001', short_name: 'acme', status: 'active', repos: { shuiguo: 'acme-shuiguo', kucun: 'acme-kucun' } },
        { id: 'c-0002', short_name: 'off', status: 'disabled', repos: { demo: 'off-demo' } },
        { id: 'c-0003', short_name: 'empty', status: 'active', repos: {} },
        { id: 'c-0004', short_name: 'nul', status: 'active', repos: { demo: null } },
        { id: 'c-0005', short_name: 'other', status: 'active', repos: { demo: 'someone/else' } },
        { id: 'c-0006', short_name: 'dup', status: 'active', repos: { shuiguo: 'acme-shuiguo' } },
      ],
    },
  })
  assert.deepEqual(rows.map((row) => row.fullName), ['acme/acme-shuiguo', 'acme/acme-kucun'])
  assert.deepEqual(collectRepos({ gh: null, owner: 'acme', customers: [] }), [])
})

test('collectSnapshot 分出地图、决定票、父工单和 spec，读评论、子票和阻塞边，只读不改', async (t) => {
  const { fake, gh } = await setupRepo(t)
  const decision = await gh.createIssue({ owner: OWNER, repo: REPO, title: '01 空档怎么放', body: '', labels: ['wayfinder:grilling'] })
  const parent = await createParent(gh, { state: '排队中' })
  const map = await createMap(gh, parent)
  await gh.createComment({ owner: OWNER, repo: REPO, number: map.number, body: '重传：2026-11-17' })
  const spec = await createSpec(gh)
  await gh.createComment({ owner: OWNER, repo: REPO, number: parent.number, body: '点头：拆票' })
  const first = await createChild(gh, parent, { title: '子票一' })
  const second = await createChild(gh, parent, { title: '子票二' })
  const blocked = await gh.createIssue({ owner: OWNER, repo: REPO, title: '被挡的票', body: '', labels: ['状态:排队中'] })
  await gh.closeIssue({ owner: OWNER, repo: REPO, number: blocked.number })
  await gh.addBlockedBy({ owner: OWNER, repo: REPO, number: first.number, issueId: blocked.id })

  fake.state.requests.length = 0
  const snapshot = await collectSnapshot({ gh, owner: OWNER, repo: REPO })

  assert.deepEqual(snapshot.maps.map((row) => row.number), [map.number])
  assert.equal(snapshot.maps[0].comments[0].body, '重传：2026-11-17')
  assert.deepEqual(snapshot.decisions.map((row) => row.number), [decision.number])
  assert.equal(snapshot.parents.length, 1)
  const row = snapshot.parents[0]
  assert.equal(row.number, parent.number)
  assert.equal(row.spec.number, spec.number)
  assert.equal(row.comments[0].body, '点头：拆票')
  assert.deepEqual(row.subIssues.map((child) => child.number).sort((a, b) => a - b), [first.number, second.number].sort((a, b) => a - b))
  assert.deepEqual(row.subIssues.find((child) => child.number === first.number).blockedBy, [blocked.number])
  assert.deepEqual(row.closedNumbers, [blocked.number])
  assert.ok(fake.state.requests.every((request) => request.method === 'GET'), 'collectSnapshot 只读')
})

test('runOnce：已提交+点头：补缺口 → 排队中，写进度，推该跑 to-spec；再跑不重复', async (t) => {
  const { fake, gh } = await setupRepo(t)
  const parent = await createParent(gh)
  await gh.createComment({ owner: OWNER, repo: REPO, number: parent.number, body: '点头：补缺口\n\n## 最终答案' })
  const notifier = fakeNotifier()
  const config = { owner: OWNER, lockDir: await lockDir(t), maxActive: 5 }

  await runOnce({ gh, customers: customers(), notifier, clock: () => NOW, config })

  assert.deepEqual(labelsOf(fake, OWNER, REPO, parent.number), ['状态:排队中'])
  const progress = commentsOf(fake, OWNER, REPO, parent.number).filter((body) => body.startsWith('进度 v1｜'))
  assert.equal(progress.length, 1)
  assert.match(progress[0], /^进度 v1｜路径：其余｜客户档：安排中｜细阶段：\S+｜轮次：1｜卡住：否$/)
  assert.equal(notifier.delivered.size, 1)
  assert.equal([...notifier.delivered.values()][0].event, '该跑 to-spec')

  await runOnce({ gh, customers: customers(), notifier, clock: () => NOW, config })

  assert.equal(commentsOf(fake, OWNER, REPO, parent.number).filter((body) => body.startsWith('进度 v1｜')).length, 1)
  assert.deepEqual(labelsOf(fake, OWNER, REPO, parent.number), ['状态:排队中'])
  assert.equal(notifier.delivered.size, 1)
})

test('小需求：点头+一张子票 → 开发中，贴 Sandcastle 并点火；重启不再点第二次', async (t) => {
  const { fake, gh } = await setupRepo(t)
  const parent = await createParent(gh, { small: true })
  const child = await createChild(gh, parent)
  await gh.createComment({ owner: OWNER, repo: REPO, number: parent.number, body: '点头：补缺口' })
  const notifier = fakeNotifier()
  const ignite = fakeIgnite()
  const firstConfig = { owner: OWNER, lockDir: await lockDir(t), maxActive: 5 }

  await runOnce({ gh, customers: customers(), notifier, ignite: ignite.ignite, clock: () => NOW, config: firstConfig })

  assert.deepEqual(labelsOf(fake, OWNER, REPO, parent.number).sort(), ['状态:开发中', '大小:小需求'].sort())
  assert.deepEqual(labelsOf(fake, OWNER, REPO, child.number).sort(), ['Sandcastle', '状态:排队中'].sort())
  assert.equal(ignite.calls.length, 1)
  assert.equal(ignite.calls[0].ticket.number, child.number)
  assert.equal(commentsOf(fake, OWNER, REPO, parent.number).filter((body) => body.startsWith('进度 v1｜')).length, 1)

  // 新实例：新的通知器、新的锁目录、新的内存去重集合。
  const restarted = { owner: OWNER, lockDir: await lockDir(t), maxActive: 5 }
  await runOnce({ gh, customers: customers(), notifier: fakeNotifier(), ignite: ignite.ignite, clock: () => NOW, config: restarted })

  assert.equal(ignite.calls.length, 1, '重启后不重复点火')
  assert.equal(commentsOf(fake, OWNER, REPO, parent.number).filter((body) => body.startsWith('进度 v1｜')).length, 1)
  assert.equal(labelsOf(fake, OWNER, REPO, child.number).filter((name) => name === 'Sandcastle').length, 1)
})

test('其余单：只点 frontier，贴 Sandcastle；子票进待验收后摘掉', async (t) => {
  const { fake, gh } = await setupRepo(t)
  const parent = await createParent(gh, { state: '排队中' })
  await createSpec(gh)
  const first = await createChild(gh, parent, { title: '子票一' })
  const second = await createChild(gh, parent, { title: '子票二' })
  await gh.addBlockedBy({ owner: OWNER, repo: REPO, number: first.number, issueId: second.id })
  await gh.createComment({ owner: OWNER, repo: REPO, number: parent.number, body: '点头：拆票' })
  const notifier = fakeNotifier()
  const ignite = fakeIgnite()
  const config = { owner: OWNER, lockDir: await lockDir(t), maxActive: 5 }

  await runOnce({ gh, customers: customers(), notifier, ignite: ignite.ignite, clock: () => NOW, config })

  assert.equal(ignite.calls.length, 1)
  assert.equal(ignite.calls[0].ticket.number, second.number)
  assert.ok(labelsOf(fake, OWNER, REPO, second.number).includes('Sandcastle'))
  assert.ok(!labelsOf(fake, OWNER, REPO, first.number).includes('Sandcastle'))
  assert.ok(labelsOf(fake, OWNER, REPO, parent.number).includes('状态:开发中'))

  await gh.addLabels({ owner: OWNER, repo: REPO, number: second.number, labels: ['状态:待验收'] })
  await runOnce({ gh, customers: customers(), notifier, ignite: ignite.ignite, clock: () => NOW, config })
  assert.ok(!labelsOf(fake, OWNER, REPO, second.number).includes('Sandcastle'), '进待验收后摘掉队列标签')

  // 关闭的子票也要摘掉。
  await gh.closeIssue({ owner: OWNER, repo: REPO, number: second.number })
  await gh.addLabels({ owner: OWNER, repo: REPO, number: second.number, labels: ['Sandcastle'] })
  await runOnce({ gh, customers: customers(), notifier, ignite: ignite.ignite, clock: () => NOW, config })
  assert.ok(!labelsOf(fake, OWNER, REPO, second.number).includes('Sandcastle'), '关闭后摘掉队列标签')
})

test('开发中：驳回建的修复票有 open 子票就点火', async (t) => {
  const { fake, gh } = await setupRepo(t)
  const parent = await createParent(gh, { state: '开发中' })
  const fix = await createChild(gh, parent, { title: '按驳回修好' })
  const ignite = fakeIgnite()
  const config = { owner: OWNER, lockDir: await lockDir(t), maxActive: 5 }

  await runOnce({
    gh,
    customers: customers(),
    notifier: fakeNotifier(),
    ignite: ignite.ignite,
    clock: () => NOW,
    config,
  })

  assert.equal(ignite.calls.length, 1)
  assert.equal(ignite.calls[0].ticket.number, fix.number)
  assert.ok(labelsOf(fake, OWNER, REPO, fix.number).includes('Sandcastle'))
})

test('同一仓已有 Sandcastle 票，不点第二张', async (t) => {
  const { fake, gh } = await setupRepo(t)
  const runningParent = await createParent(gh, { state: '开发中', title: '正在做的单' })
  const runningChild = await createChild(gh, runningParent, { labels: ['状态:排队中', 'Sandcastle'] })
  const waitingParent = await createParent(gh, { state: '排队中', title: '排队的单' })
  await createSpec(gh, { title: 'spec another' })
  const waitingChild = await createChild(gh, waitingParent, { title: '另一张子票' })
  await gh.createComment({ owner: OWNER, repo: REPO, number: waitingParent.number, body: '点头：拆票' })
  const ignite = fakeIgnite()
  const config = { owner: OWNER, lockDir: await lockDir(t), maxActive: 5 }

  await runOnce({ gh, customers: customers(), notifier: fakeNotifier(), ignite: ignite.ignite, clock: () => NOW, config })

  assert.equal(ignite.calls.length, 0)
  assert.ok(!labelsOf(fake, OWNER, REPO, waitingChild.number).includes('Sandcastle'))
  assert.ok(labelsOf(fake, OWNER, REPO, waitingParent.number).includes('状态:排队中'), '等这一仓空出来再动')
})

test('同时最多五单：已经有五张 Sandcastle，第六张不点', async (t) => {
  const repos = Array.from({ length: 6 }, (_, index) => ({ owner: OWNER, name: `acme-r${index + 1}` }))
  const fake = await startFakeGithub({ repos })
  t.after(() => fake.close())
  const gh = createGithub({ apiBase: fake.base, token: 'test' })
  for (const row of repos) await repoLabels(gh, OWNER, row.name)

  for (let index = 0; index < 5; index += 1) {
    const repo = repos[index].name
    const parent = await gh.createIssue({
      owner: OWNER,
      repo,
      title: `跑着的单 ${index}`,
      body: parentBody(),
      labels: ['状态:开发中'],
    })
    const child = await gh.createIssue({ owner: OWNER, repo, title: `子票 ${index}`, body: '', labels: ['状态:排队中', 'Sandcastle'] })
    await gh.addSubIssue({ owner: OWNER, repo, number: parent.number, subIssueId: child.id })
  }

  const last = repos[5].name
  const lastParent = await gh.createIssue({ owner: OWNER, repo: last, title: '第六单', body: parentBody(), labels: ['状态:排队中'] })
  await gh.createIssue({ owner: OWNER, repo: last, title: 'spec yuyue-quhuo', body: '', labels: ['ready-for-agent'] })
  const lastChild = await gh.createIssue({ owner: OWNER, repo: last, title: '第六张子票', body: '', labels: ['状态:排队中'] })
  await gh.addSubIssue({ owner: OWNER, repo: last, number: lastParent.number, subIssueId: lastChild.id })
  await gh.createComment({ owner: OWNER, repo: last, number: lastParent.number, body: '点头：拆票' })

  const rows = repos.map((row, index) => ({
    id: `c-000${index + 1}`,
    short_name: `c${index + 1}`,
    status: 'active',
    repos: { demo: row.name },
  }))
  const ignite = fakeIgnite()
  const config = { owner: OWNER, lockDir: await lockDir(t), maxActive: 5 }

  await runOnce({ gh, customers: rows, notifier: fakeNotifier(), ignite: ignite.ignite, clock: () => NOW, config })

  assert.equal(ignite.calls.length, 0)
  assert.ok(!labelsOf(fake, OWNER, last, lastChild.number).includes('Sandcastle'))
  assert.ok(labelsOf(fake, OWNER, last, lastParent.number).includes('状态:排队中'))
})

test('待验收+驳回： → 回开发中，写已驳回进度，另开修复子票', async (t) => {
  const { fake, gh } = await setupRepo(t)
  const parent = await createParent(gh, { state: '待验收' })
  await gh.createComment({ owner: OWNER, repo: REPO, number: parent.number, body: '驳回：客户说取货时间不能选。' })
  const fix = { calls: [], async createFixTicket(args) { this.calls.push(args) } }
  const config = { owner: OWNER, lockDir: await lockDir(t), maxActive: 5 }

  await runOnce({ gh, customers: customers(), notifier: fakeNotifier(), createFixTicket: fix.createFixTicket.bind(fix), clock: () => NOW, config })

  assert.ok(labelsOf(fake, OWNER, REPO, parent.number).includes('状态:开发中'))
  const progress = commentsOf(fake, OWNER, REPO, parent.number).filter((body) => body.startsWith('进度 v1｜'))
  assert.equal(progress.length, 1)
  assert.match(progress[0], /客户档：已驳回｜细阶段：记驳回/)
  assert.equal(fix.calls.length, 1)
  assert.match(fix.calls[0].rejection.body, /取货时间不能选/)

  // 修完再进待验收，旧的驳回评论还在，不能把它再当一次新驳回。
  await gh.removeLabel({ owner: OWNER, repo: REPO, number: parent.number, name: '状态:开发中' })
  await gh.addLabels({ owner: OWNER, repo: REPO, number: parent.number, labels: ['状态:待验收'] })
  await runOnce({ gh, customers: customers(), notifier: fakeNotifier(), createFixTicket: fix.createFixTicket.bind(fix), clock: () => NOW, config })
  assert.equal(fix.calls.length, 1)
})

test('小需求却是排队中 → needs-info，写卡住进度并推需要人看；重复跑不重复', async (t) => {
  const { fake, gh } = await setupRepo(t)
  const parent = await createParent(gh, { state: '排队中', small: true })
  const notifier = fakeNotifier()
  const config = { owner: OWNER, lockDir: await lockDir(t), maxActive: 5 }

  await runOnce({ gh, customers: customers(), notifier, clock: () => NOW, config })

  assert.ok(labelsOf(fake, OWNER, REPO, parent.number).includes('needs-info'))
  const progress = commentsOf(fake, OWNER, REPO, parent.number).filter((body) => body.startsWith('进度 v1｜'))
  assert.equal(progress.length, 1)
  assert.match(progress[0], /卡住：是/)
  assert.equal([...notifier.delivered.values()][0].event, 'needs-info')

  await runOnce({ gh, customers: customers(), notifier, clock: () => NOW, config })
  assert.equal(commentsOf(fake, OWNER, REPO, parent.number).filter((body) => body.startsWith('进度 v1｜')).length, 1)
  assert.equal(labelsOf(fake, OWNER, REPO, parent.number).filter((name) => name === 'needs-info').length, 1)
  assert.equal(notifier.delivered.size, 1)
})

test('排队中三圈同进度：runOnce 推 needs-info 和出事，不点火，再跑不重复', async (t) => {
  const { fake, gh } = await setupRepo(t)
  const parent = await createParent(gh, { state: '排队中' })
  const child = await createChild(gh, parent)
  for (const round of [1, 2, 3]) {
    await gh.createComment({
      owner: OWNER,
      repo: REPO,
      number: parent.number,
      body: progressLine({ path: '其余', tier: '开发中', step: '开工', round, stuck: false }),
    })
  }
  await gh.createComment({ owner: OWNER, repo: REPO, number: parent.number, body: '点头：拆票' })
  const notifier = fakeNotifier()
  const config = { owner: OWNER, lockDir: await lockDir(t), maxActive: 5 }

  await runOnce({ gh, customers: customers(), notifier, clock: () => NOW, config })

  assert.ok(labelsOf(fake, OWNER, REPO, parent.number).includes('needs-info'))
  assert.ok(!labelsOf(fake, OWNER, REPO, child.number).includes('Sandcastle'))
  const events = [...notifier.delivered.values()]
  assert.equal(events.filter((event) => event.event === 'needs-info').length, 1)
  const incident = events.find((event) => event.event === '出事')
  assert.ok(incident, '没有发出事通知')
  assert.equal(incident.key, `#${parent.number}:出事:三圈没进展`)
  assert.equal(incident.data.reason, '三圈没进展')
  assert.match(incident.data.tried, /连续 3 轮/)

  const progressAfterFirst = commentsOf(fake, OWNER, REPO, parent.number).filter((body) =>
    body.startsWith('进度 v1｜'),
  ).length
  assert.equal(progressAfterFirst, 4)
  await runOnce({ gh, customers: customers(), notifier, clock: () => NOW, config })
  assert.equal(notifier.delivered.size, 2)
  assert.equal(
    commentsOf(fake, OWNER, REPO, parent.number).filter((body) => body.startsWith('进度 v1｜')).length,
    progressAfterFirst,
  )
})

test('新单进队列：已提交且没有评论时推一次，同一轮再跑不重复', async (t) => {
  const { fake, gh } = await setupRepo(t)
  const parent = await createParent(gh)
  const notifier = fakeNotifier()
  const config = { owner: OWNER, lockDir: await lockDir(t), maxActive: 5 }

  await runOnce({ gh, customers: customers(), notifier, clock: () => NOW, config })

  const events = notifier.calls.filter((event) => event.event === '新单进队列')
  assert.equal(events.length, 1)
  assert.equal(events[0].key, `#${parent.number}:新单进队列`)
  assert.equal(events[0].data.customer, 'acme')
  assert.equal(events[0].data.requirement, 'yuyue-quhuo')
  assert.equal(labelsOf(fake, OWNER, REPO, parent.number).length, 1)

  await runOnce({ gh, customers: customers(), notifier, clock: () => NOW, config })
  assert.equal(notifier.calls.filter((event) => event.event === '新单进队列').length, 1)

  // 重启后 key 不变，通知模块按 key 去重。
  const restarted = { owner: OWNER, lockDir: await lockDir(t), maxActive: 5 }
  const second = fakeNotifier()
  await runOnce({ gh, customers: customers(), notifier: second, clock: () => NOW, config: restarted })
  assert.equal(second.calls[0].key, events[0].key)
})

test('已有评论的父工单不再推新单进队列', async (t) => {
  const { fake, gh } = await setupRepo(t)
  const parent = await createParent(gh)
  await gh.createComment({ owner: OWNER, repo: REPO, number: parent.number, body: '点头：补缺口' })
  const notifier = fakeNotifier()
  await runOnce({
    gh,
    customers: customers(),
    notifier,
    clock: () => NOW,
    config: { owner: OWNER, lockDir: await lockDir(t), maxActive: 5 },
  })
  assert.equal(notifier.calls.filter((event) => event.event === '新单进队列').length, 0)
})

test('每日 preview-sweep：一天只调一次，失败只记错误', async (t) => {
  const { gh } = await setupRepo(t)
  const calls = []
  const notifier = fakeNotifier()
  const config = {
    owner: OWNER,
    lockDir: await lockDir(t),
    maxActive: 5,
    previewSweep: async () => {
      calls.push('sweep')
      return { output: '' }
    },
  }

  await runOnce({ gh, customers: customers(), notifier, clock: () => NOW, config })
  assert.equal(calls.length, 1)
  await runOnce({ gh, customers: customers(), notifier, clock: () => NOW, config })
  assert.equal(calls.length, 1)

  const bad = {
    owner: OWNER,
    lockDir: await lockDir(t),
    maxActive: 5,
    previewSweep: async () => {
      throw new Error('helper 不在')
    },
  }
  const report = await runOnce({ gh, customers: customers(), notifier, clock: () => NOW, config: bad })
  assert.equal(report.previewSweep.ok, false)
  assert.ok(report.errors.some((row) => row.previewSweep))
})

test('每日抽样：8:30 推前一天合并的单，当天只发一次；没有合并不发', async (t) => {
  const { gh } = await setupRepo(t)
  const notifier = fakeNotifier()
  const items = [
    { customer: 'acme', requirement: 'yuyue-quhuo', pr: 12, url: 'https://github.com/acme/demo/pull/12' },
  ]
  const config = {
    owner: OWNER,
    lockDir: await lockDir(t),
    maxActive: 5,
    lastSentDate: null,
    listMergedYesterday: async () => items,
  }
  const eightThirty = new Date('2026-11-17T08:30:00+08:00')

  await runOnce({ gh, customers: [], notifier, clock: () => eightThirty, config })
  const digest = [...notifier.delivered.values()].find((event) => event.event === '每日抽样')
  assert.ok(digest)
  assert.equal(digest.data.date, '2026-11-16')
  assert.equal(digest.data.items[0].pr, 12)

  await runOnce({ gh, customers: [], notifier, clock: () => eightThirty, config })
  assert.equal([...notifier.delivered.values()].filter((event) => event.event === '每日抽样').length, 1)

  const empty = { ...config, lastSentDate: null, listMergedYesterday: async () => [] }
  const emptyNotifier = fakeNotifier()
  await runOnce({ gh, customers: [], notifier: emptyNotifier, clock: () => eightThirty, config: empty })
  assert.equal([...emptyNotifier.delivered.values()].filter((event) => event.event === '每日抽样').length, 0)
})

test('没接入点火实现时整组动作都跳过，不先改状态', async (t) => {
  const { fake, gh } = await setupRepo(t)
  const parent = await createParent(gh, { small: true })
  await createChild(gh, parent)
  await gh.createComment({ owner: OWNER, repo: REPO, number: parent.number, body: '点头：补缺口' })
  const config = { owner: OWNER, lockDir: await lockDir(t), maxActive: 5 }

  const report = await runOnce({
    gh,
    customers: customers(),
    notifier: fakeNotifier(),
    clock: () => NOW,
    config,
  })

  assert.deepEqual(labelsOf(fake, OWNER, REPO, parent.number).sort(), ['状态:已提交', '大小:小需求'].sort())
  assert.equal(commentsOf(fake, OWNER, REPO, parent.number).filter((body) => body.startsWith('进度 v1｜')).length, 0)
  assert.equal(report.repos[0].parents[0].decision, 'develop')
  assert.equal(report.repos[0].parents[0].executed.skipped, 'ignite')
})

test('新的点头盖掉旧的普通驳回', () => {
  const actions = route({
    comments: [gate('驳回：客户说先不要了'), gate('点头：补缺口')],
  })
  assert.equal(actions[0].type, 'setState')
  assert.equal(actions[0].to, '排队中')
})

test('抢不到仓锁时整张票不动，等下一轮', async (t) => {
  const { fake, gh } = await setupRepo(t)
  const parent = await createParent(gh, { small: true })
  await createChild(gh, parent)
  await gh.createComment({ owner: OWNER, repo: REPO, number: parent.number, body: '点头：补缺口' })
  const dir = await lockDir(t)
  await writeFile(join(dir, `${OWNER}__${REPO}.lock`), String(process.pid))
  const ignite = fakeIgnite()
  const config = { owner: OWNER, lockDir: dir, maxActive: 5 }

  const report = await runOnce({
    gh,
    customers: customers(),
    notifier: fakeNotifier(),
    ignite: ignite.ignite,
    clock: () => NOW,
    config,
  })

  assert.equal(ignite.calls.length, 0)
  assert.deepEqual(labelsOf(fake, OWNER, REPO, parent.number).sort(), ['状态:已提交', '大小:小需求'].sort())
  assert.equal(commentsOf(fake, OWNER, REPO, parent.number).filter((body) => body.startsWith('进度 v1｜')).length, 0)
  assert.equal(report.repos[0].parents[0].executed.skipped, 'locked')
})

test('读到提案：补缺口先推一条，带题数和已等天数；同一天不重复推', async (t) => {
  const { gh } = await setupRepo(t)
  const parent = await createParent(gh)
  await gh.createComment({
    owner: OWNER,
    repo: REPO,
    number: parent.number,
    body: '提案：补缺口\n\n1. 题目：技术栈选哪个\n   推荐：默认\n\n2. 题目：部署到哪\n   推荐：香港服务器',
  })
  const notifier = fakeNotifier()
  const config = { owner: OWNER, lockDir: await lockDir(t), maxActive: 5 }

  await runOnce({ gh, customers: customers(), notifier, clock: () => NOW, config })
  const event = [...notifier.delivered.values()].find((row) => row.event === '补缺口提案')
  assert.ok(event)
  assert.equal(event.data.question_count, 2)
  assert.equal(event.data.days_waited, 0)
  assert.match(event.key, /补缺口提案:0/)

  await runOnce({ gh, customers: customers(), notifier, clock: () => NOW, config })
  assert.equal([...notifier.delivered.values()].filter((row) => row.event === '补缺口提案').length, 1)
})

test('runLoop 单轮出错记日志，不退出；收到停止信号才结束', async () => {
  const controller = new AbortController()
  const logs = []
  let runs = 0
  await runLoop({
    intervalMs: 1,
    signal: controller.signal,
    log: (line) => logs.push(line),
    run: async () => {
      runs += 1
      if (runs === 2) controller.abort()
      throw new Error('boom')
    },
  })
  assert.equal(runs, 2)
  assert.equal(logs.length, 2)
  assert.equal(logs[0].level, 'error')
})

test('需要你答由注入的数据源提供，带问题和推荐，重启后不重复', async (t) => {
  const { gh } = await setupRepo(t)
  const parent = await createParent(gh, { state: '开发中' })
  await gh.createComment({ owner: OWNER, repo: REPO, number: parent.number, body: '点头：拆票' })
  const notifier = fakeNotifier()
  const config = {
    owner: OWNER,
    lockDir: await lockDir(t),
    maxActive: 5,
    needsAnswer: [
      {
        key: 'PR-9:51',
        question: '闸门第三题选哪个方案',
        recommended: '方案 A',
        link: 'https://github.com/acme/acme-demo/pull/9',
        opened_at: '2026-11-15T10:00:00+08:00',
      },
    ],
  }

  await runOnce({ gh, customers: customers(), notifier, clock: () => NOW, config })

  const event = [...notifier.delivered.values()].find((row) => row.event === '需要你答')
  assert.ok(event)
  assert.equal(event.data.question, '闸门第三题选哪个方案')
  assert.equal(event.data.recommended, '方案 A')
  assert.equal(event.data.days_waited, 2)
  assert.equal(event.link, 'https://github.com/acme/acme-demo/pull/9')
  assert.match(event.key, /#\d+:需要你答:PR-9:51:2/)

  await runOnce({ gh, customers: customers(), notifier, clock: () => NOW, config })
  assert.equal([...notifier.delivered.values()].filter((row) => row.event === '需要你答').length, 1)
})

test('地图重传评论 → 推重传地图已更新；同一日期不重复推', async (t) => {
  const { gh } = await setupRepo(t)
  const parent = await createParent(gh, { state: '排队中' })
  const map = await createMap(gh, parent)
  await gh.createComment({ owner: OWNER, repo: REPO, number: map.number, body: '重传：2026-11-17\n\n待复查：01、02' })
  const notifier = fakeNotifier()
  const config = { owner: OWNER, lockDir: await lockDir(t), maxActive: 5 }

  await runOnce({ gh, customers: customers(), notifier, clock: () => NOW, config })

  const events = [...notifier.delivered.values()].filter((event) => event.event === '重传地图已更新')
  assert.equal(events.length, 1)
  assert.equal(events[0].data.customer, 'acme')
  assert.equal(events[0].data.requirement, 'yuyue-quhuo')
  assert.equal(events[0].link, `https://github.com/${OWNER}/${REPO}/issues/${map.number}`)
  assert.equal(events[0].key, `#${map.number}:重传地图已更新:2026-11-17`)

  await runOnce({ gh, customers: customers(), notifier, clock: () => NOW, config })
  assert.equal(
    [...notifier.delivered.values()].filter((event) => event.event === '重传地图已更新').length,
    1,
  )

  // 重启：调度器内存没了，通知模块的 key 去重还在。
  await runOnce({
    gh,
    customers: customers(),
    notifier,
    clock: () => NOW,
    config: { owner: OWNER, lockDir: await lockDir(t), maxActive: 5 },
  })
  assert.equal(
    [...notifier.delivered.values()].filter((event) => event.event === '重传地图已更新').length,
    1,
  )
})

test('地图没有重传评论不发；有两条时用最新日期', async (t) => {
  const { gh } = await setupRepo(t)
  const parent = await createParent(gh, { state: '排队中' })
  const quiet = await createMap(gh, parent)
  const notifier = fakeNotifier()
  const config = { owner: OWNER, lockDir: await lockDir(t), maxActive: 5 }

  await runOnce({ gh, customers: customers(), notifier, clock: () => NOW, config })
  assert.equal([...notifier.delivered.values()].filter((event) => event.event === '重传地图已更新').length, 0)

  const updated = await createMap(gh, parent)
  await gh.createComment({ owner: OWNER, repo: REPO, number: updated.number, body: '重传：2026-11-15' })
  await gh.createComment({ owner: OWNER, repo: REPO, number: updated.number, body: '重传：2026-11-18\n\n又改了一轮' })
  await runOnce({ gh, customers: customers(), notifier, clock: () => NOW, config })

  const events = [...notifier.delivered.values()].filter((event) => event.event === '重传地图已更新')
  assert.equal(events.length, 1)
  assert.equal(events[0].key, `#${updated.number}:重传地图已更新:2026-11-18`)
  assert.equal(quiet.number < updated.number, true)
})
