import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createGithub } from '../lib/github.mjs'
import { commitAll, git, initRepo } from '../lib/git.mjs'
import { ensureLabel } from '../lib/issues.mjs'
import { createJobStore, findJob } from '../lib/job.mjs'
import { progressLine } from '../lib/progress.mjs'
import { createFixTicket as createFixTicketJob } from '../lib/scheduler-jobs.mjs'
import {
  STATE_LABELS,
  StepTimeoutError,
  collectRepos,
  collectSnapshot,
  createWatchdog,
  digestEvent,
  dueDigest,
  pendingReminder,
  routeParent,
  runJobStep,
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

function route({ stateLabel = '状态:已提交', small = false, comments = [], subIssues = [], spec = null, closedNumbers = [], activeCount = 0, maxActive = 5, repoBusy = false, jobs = [], jobPolicy = {} } = {}) {
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
    jobs,
    jobPolicy,
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

test('已提交+没有关口评论 → 叫补缺口提案', () => {
  assert.deepEqual(types(route({ comments: [] })), ['runGapProposal'])
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

test('开发中：子票全关且都已合进 req 分支 → 叫 finish，成功后转待验收', () => {
  const actions = routeParent({
    parent: parent({
      labels: labels('状态:开发中'),
      order: 'o-0001',
      branchesMerged: true,
    }),
    comments: [],
    subIssues: [sub({ number: 51, state: 'closed' }), sub({ number: 52, state: 'closed' })],
    closedNumbers: [51, 52],
    now: NOW,
  })
  assert.deepEqual(types(actions), ['finish', 'setState'])
  assert.equal(actions[0].reqBranch, 'req/o-0001')
  assert.equal(actions[1].from, '开发中')
  assert.equal(actions[1].to, '待验收')
})

test('小需求开发中：子票全关且已合进 req 分支 → 也叫 finish', () => {
  const actions = routeParent({
    parent: parent({
      labels: labels('状态:开发中', '大小:小需求'),
      order: 'o-0001',
      branchesMerged: true,
    }),
    comments: [],
    subIssues: [sub({ number: 51, state: 'closed' })],
    closedNumbers: [51],
    now: NOW,
  })
  assert.deepEqual(types(actions), ['finish', 'setState'])
})

test('开发中：分支没合齐或还有 open 子票，不叫 finish', () => {
  const notMerged = routeParent({
    parent: parent({ labels: labels('状态:开发中'), order: 'o-0001', branchesMerged: false }),
    comments: [],
    subIssues: [sub({ number: 51, state: 'closed' })],
    closedNumbers: [51],
    now: NOW,
  })
  assert.ok(!types(notMerged).includes('finish'))

  const stillOpen = routeParent({
    parent: parent({ labels: labels('状态:开发中'), order: 'o-0001', branchesMerged: true }),
    comments: [],
    subIssues: [sub({ number: 51, state: 'closed' }), sub({ number: 52 })],
    closedNumbers: [51],
    now: NOW,
  })
  assert.ok(!types(stillOpen).includes('finish'))
})

test('部署失败停了 finish：下一轮不再叫收尾，也不转待验收', () => {
  const jobs = [
    { action: 'finish', ticket: null, attempt: 1, stop: 'deploy-failed', reason: '部署失败', lastBeat: NOW.toISOString() },
  ]
  const actions = routeParent({
    parent: parent({
      labels: labels('状态:开发中'),
      order: 'o-0001',
      branchesMerged: true,
    }),
    comments: [],
    subIssues: [sub({ number: 51, state: 'closed' })],
    closedNumbers: [51],
    now: NOW,
    jobs,
  })
  assert.deepEqual(actions, [])
})

test('finish 失败后退避：没到时间不重发，过了退避再试', () => {
  const jobs = [
    { action: 'finish', ticket: null, attempt: 1, stop: '', reason: '评审没过', lastBeat: NOW.toISOString() },
  ]
  const options = {
    parent: parent({ labels: labels('状态:开发中'), order: 'o-0001', branchesMerged: true }),
    comments: [],
    subIssues: [sub({ number: 51, state: 'closed' })],
    closedNumbers: [51],
    now: NOW,
    jobs,
    jobPolicy: { maxAttempts: 3, backoffBaseMs: 10 * 60 * 1000 },
  }
  assert.deepEqual(routeParent(options), [], '刚失败过，退避期间不重发')

  jobs[0].lastBeat = new Date(NOW.getTime() - 11 * 60 * 1000).toISOString()
  assert.deepEqual(types(routeParent(options)), ['finish', 'setState'], '过了退避时间再试')
})

test('已提交父工单贴 needs-info：补缺口不再跑', () => {
  const blocked = routeParent({
    parent: parent({ labels: labels('状态:已提交', 'needs-info') }),
    comments: [],
    subIssues: [],
    closedNumbers: [],
    now: NOW,
  })
  assert.deepEqual(blocked, [])
})

test('needs-info 写了 stop：补缺口和 finish 都认，重启后一样', () => {
  const jobs = [
    { action: 'needs-info', ticket: null, attempt: 0, stop: 'needs-info', reason: '认证失败', lastBeat: NOW.toISOString() },
  ]
  const gap = route({ jobs })
  assert.deepEqual(gap, [], '已提交的单不再跑补缺口')

  const finish = routeParent({
    parent: parent({ labels: labels('状态:开发中'), order: 'o-0001', branchesMerged: true }),
    comments: [],
    subIssues: [sub({ number: 51, state: 'closed' })],
    closedNumbers: [51],
    now: NOW,
    jobs,
  })
  assert.deepEqual(finish, [], '开发中的单不再收尾')
})

test('补缺口失败后退避：没到时间不重发，过了退避再试', () => {
  const jobs = [
    { action: 'gap-proposal', ticket: null, attempt: 1, stop: '', reason: 'agent 退出码 1', lastBeat: NOW.toISOString() },
  ]
  assert.deepEqual(route({ jobs, jobPolicy: { maxAttempts: 3, backoffBaseMs: 10 * 60 * 1000 } }), [])

  jobs[0].lastBeat = new Date(NOW.getTime() - 11 * 60 * 1000).toISOString()
  assert.deepEqual(
    types(route({ jobs, jobPolicy: { maxAttempts: 3, backoffBaseMs: 10 * 60 * 1000 } })),
    ['runGapProposal'],
  )
})

test('点火退避只挡那张票，下一张没失败的照常点', () => {
  const jobs = [
    { action: 'ignite', ticket: 51, attempt: 1, stop: '', reason: '点火失败', lastBeat: NOW.toISOString() },
  ]
  const actions = route({
    stateLabel: '状态:开发中',
    comments: [],
    subIssues: [sub({ number: 51 }), sub({ number: 52 })],
    jobs,
    jobPolicy: { maxAttempts: 3, backoffBaseMs: 10 * 60 * 1000 },
  })
  assert.deepEqual(types(actions), ['ignite'])
  assert.equal(actions[0].ticketNumber, 52)
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

/** 本地仓 fixture：main 上建 req/o-0001，再把每张票的 ticket/<n> 合进去。 */
async function makeRequirementRepo(t, ticketNumbers) {
  const root = await mkdtemp(join(tmpdir(), 'afk-scheduler-finish-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const repoDir = join(root, REPO)
  await initRepo(repoDir)
  await writeFile(join(repoDir, 'README.md'), 'base\n')
  await commitAll(repoDir, 'FACTORY: 初始提交')
  await git(repoDir, ['checkout', '-b', 'req/o-0001'])
  for (const number of ticketNumbers) {
    await git(repoDir, ['checkout', '-B', `ticket/${number}`, 'req/o-0001'])
    await writeFile(join(repoDir, `ticket-${number}.txt`), `票 ${number}\n`)
    await commitAll(repoDir, `FACTORY: 票 ${number}`)
    await git(repoDir, ['checkout', 'req/o-0001'])
    await git(repoDir, ['merge', '--no-ff', '--no-edit', `ticket/${number}`])
  }
  return { root, repoDir }
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

/** 跑一轮但给个上限：点火阻塞轮次时测试失败，而不是一直挂着。 */
function withTimeout(promise, ms = 2000, message = '调度轮次被点火阻塞') {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
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

async function assertRejectionIgnitesFixTicket(t, { small }) {
  const { fake, gh } = await setupRepo(t)
  const parent = await createParent(gh, { state: '待验收', small })
  await gh.createComment({
    owner: OWNER,
    repo: REPO,
    number: parent.number,
    body: '驳回：客户说取货时间不能选。',
  })
  const fixTicket = createFixTicketJob({ gh })
  const ignite = fakeIgnite()
  const config = { owner: OWNER, lockDir: await lockDir(t), maxActive: 5 }

  await runOnce({
    gh,
    customers: customers(),
    notifier: fakeNotifier(),
    createFixTicket: fixTicket,
    ignite: ignite.ignite,
    clock: () => NOW,
    config,
  })

  assert.ok(labelsOf(fake, OWNER, REPO, parent.number).includes('状态:开发中'))
  let children = await gh.listSubIssues({ owner: OWNER, repo: REPO, number: parent.number })
  assert.equal(children.length, 1, '第一轮建一张修复子票')
  const fix = children[0]
  assert.equal(fix.title, '客户说取货时间不能选')
  assert.deepEqual(
    fix.labels.map((label) => (typeof label === 'string' ? label : label.name)),
    ['状态:排队中'],
  )
  assert.equal(ignite.calls.length, 0, '第一轮只建票，不点火')

  // 同一张父工单、同一批评论：驳回后面已经有进度行，第二轮接着点火。
  await runOnce({
    gh,
    customers: customers(),
    notifier: fakeNotifier(),
    createFixTicket: fixTicket,
    ignite: ignite.ignite,
    clock: () => NOW,
    config,
  })

  children = await gh.listSubIssues({ owner: OWNER, repo: REPO, number: parent.number })
  assert.equal(children.length, 1, '第二轮不重复建票')
  assert.equal(ignite.calls.length, 1)
  assert.equal(ignite.calls[0].ticket.number, fix.number)
  assert.ok(labelsOf(fake, OWNER, REPO, fix.number).includes('Sandcastle'))
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

test('runOnce：已提交+没有关口评论 → 跑补缺口提案，写进提案后不再跑；失败打 needs-info', async (t) => {
  const { fake, gh } = await setupRepo(t)
  const parent = await createParent(gh)
  const calls = []
  let fail = false
  const gapProposal = async ({ owner, repo, parent: row }) => {
    calls.push(row.number)
    if (fail) return { ok: false, code: 1, stdout: '', stderr: '地图没建起来' }
    await gh.createComment({
      owner,
      repo,
      number: row.number,
      body: '提案：补缺口\n\n## 技术题\n\n1. 题目：部署到哪',
    })
    return { ok: true, code: 0, stdout: 'MAP-OK', stderr: '' }
  }
  const config = { owner: OWNER, lockDir: await lockDir(t), maxActive: 5 }

  await runOnce({ gh, customers: customers(), notifier: fakeNotifier(), gapProposal, clock: () => NOW, config })
  await runOnce({ gh, customers: customers(), notifier: fakeNotifier(), gapProposal, clock: () => NOW, config })

  assert.deepEqual(calls, [parent.number])
  assert.ok(!labelsOf(fake, OWNER, REPO, parent.number).includes('needs-info'))

  const failedParent = await createParent(gh, { title: '第二个单' })
  fail = true
  await runOnce({ gh, customers: customers(), notifier: fakeNotifier(), gapProposal, clock: () => NOW, config })

  assert.deepEqual(calls, [parent.number, failedParent.number])
  assert.ok(labelsOf(fake, OWNER, REPO, failedParent.number).includes('needs-info'))
})

test('runOnce：把仓库快照交给 D3/D4/D5 流水线', async (t) => {
  const { gh } = await setupRepo(t)
  const parent = await createParent(gh, { state: '开发中' })
  await createChild(gh, parent, { labels: ['状态:排队中', 'Sandcastle'] })
  const calls = []
  const ticketPipeline = async (args) => {
    calls.push(args)
    return { runs: [] }
  }
  const config = {
    owner: OWNER,
    lockDir: await lockDir(t),
    maxActive: 5,
    repoRoot: join(tmpdir(), 'afk-no-such-repos'),
  }

  await runOnce({
    gh,
    customers: customers(),
    notifier: fakeNotifier(),
    ticketPipeline,
    clock: () => NOW,
    config,
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].repo, REPO)
  assert.equal(calls[0].parents.length, 1)
  assert.equal(calls[0].repoDir, join(config.repoRoot, REPO))
})

test('runOnce：开发中、子票全关且都合进 req 分支 → 叫一次 finish，父工单转待验收', async (t) => {
  const { fake, gh } = await setupRepo(t)
  const parent = await createParent(gh, { state: '开发中' })
  const first = await createChild(gh, parent)
  const second = await createChild(gh, parent)
  await gh.closeIssue({ owner: OWNER, repo: REPO, number: first.number })
  await gh.closeIssue({ owner: OWNER, repo: REPO, number: second.number })
  const { root } = await makeRequirementRepo(t, [first.number, second.number])
  const calls = []
  const finish = async (args) => {
    calls.push(args)
    return { ok: true }
  }
  const config = { owner: OWNER, lockDir: await lockDir(t), maxActive: 5, repoRoot: root }

  await runOnce({
    gh,
    customers: customers(),
    notifier: fakeNotifier(),
    finish,
    clock: () => NOW,
    config,
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].parent.number, parent.number)
  assert.equal(calls[0].reqBranch, 'req/o-0001')
  assert.deepEqual(labelsOf(fake, OWNER, REPO, parent.number), ['状态:待验收'])

  await runOnce({
    gh,
    customers: customers(),
    notifier: fakeNotifier(),
    finish,
    clock: () => NOW,
    config,
  })

  assert.equal(calls.length, 1, '收尾成功后不再重复叫')
})

test('runOnce：票分支还没合进 req 分支就不叫 finish', async (t) => {
  const { gh } = await setupRepo(t)
  const parent = await createParent(gh, { state: '开发中' })
  const first = await createChild(gh, parent)
  const second = await createChild(gh, parent)
  await gh.closeIssue({ owner: OWNER, repo: REPO, number: first.number })
  await gh.closeIssue({ owner: OWNER, repo: REPO, number: second.number })
  const { root } = await makeRequirementRepo(t, [first.number])
  const calls = []
  const finish = async (args) => {
    calls.push(args)
    return { ok: true }
  }
  const config = { owner: OWNER, lockDir: await lockDir(t), maxActive: 5, repoRoot: root }

  await runOnce({
    gh,
    customers: customers(),
    notifier: fakeNotifier(),
    finish,
    clock: () => NOW,
    config,
  })

  assert.equal(calls.length, 0)
})

async function jobFile(t) {
  const dir = await mkdtemp(join(tmpdir(), 'afk-scheduler-jobs-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return join(dir, 'jobs.json')
}

async function loadStore(filePath) {
  const store = createJobStore({ filePath })
  await store.load()
  return store
}

test('runOnce：部署失败写 stop，下一轮不再收尾、不开重复 PR', async (t) => {
  const { fake, gh } = await setupRepo(t)
  const parent = await createParent(gh, { state: '开发中' })
  const first = await createChild(gh, parent)
  const second = await createChild(gh, parent)
  await gh.closeIssue({ owner: OWNER, repo: REPO, number: first.number })
  await gh.closeIssue({ owner: OWNER, repo: REPO, number: second.number })
  const { root } = await makeRequirementRepo(t, [first.number, second.number])
  let calls = 0
  const finish = async () => {
    calls += 1
    return { ok: false, reason: '部署失败', deploy: { ok: false, reason: 'bad_address', error: '地址不通' } }
  }
  const jobs = await loadStore(await jobFile(t))
  const config = { owner: OWNER, lockDir: await lockDir(t), maxActive: 5, repoRoot: root, jobs }

  const firstReport = await runOnce({
    gh,
    customers: customers(),
    notifier: fakeNotifier(),
    finish,
    clock: () => NOW,
    config,
  })
  assert.equal(calls, 1)
  assert.ok(firstReport.errors.length === 0)
  const row = jobs.get([...Object.keys(jobs.table.jobs)][0])
  assert.equal(row.stop, 'deploy-failed')
  assert.match(row.reason, /部署失败/)

  await runOnce({
    gh,
    customers: customers(),
    notifier: fakeNotifier(),
    finish,
    clock: () => NOW,
    config,
  })
  assert.equal(calls, 1, '下一轮不再叫收尾')
  const names = labelsOf(fake, OWNER, REPO, parent.number)
  assert.ok(names.includes('状态:开发中'), '不转待验收')
  assert.ok(names.includes('needs-info'), '停线要让人看到')
  assert.ok(!names.includes('状态:待验收'))
})

test('runOnce：重复 finish 按 attempt 退避，重启后 attempt 和 stop 还在', async (t) => {
  const { fake, gh } = await setupRepo(t)
  const parent = await createParent(gh, { state: '开发中' })
  const first = await createChild(gh, parent)
  await gh.closeIssue({ owner: OWNER, repo: REPO, number: first.number })
  const { root } = await makeRequirementRepo(t, [first.number])
  let calls = 0
  const finish = async () => {
    calls += 1
    return { ok: false, reason: 'review_failed', findings: ['差一处'] }
  }
  const jobsPath = await jobFile(t)
  const clock = new Date(NOW)
  const policy = { maxAttempts: 2, backoffBaseMs: 60_000 }
  const run = async (store) =>
    runOnce({
      gh,
      customers: customers(),
      notifier: fakeNotifier(),
      finish,
      clock: () => clock,
      config: {
        owner: OWNER,
        lockDir: await lockDir(t),
        maxActive: 5,
        repoRoot: root,
        jobs: store,
        jobPolicy: policy,
      },
    })

  await run(await loadStore(jobsPath))
  assert.equal(calls, 1, '第一次失败照常叫收尾')

  // 重启：新 store 从同一个文件读，退避期间不重发。
  const second = await loadStore(jobsPath)
  await run(second)
  assert.equal(calls, 1, '退避期间不重发同一个动作')
  const row = findJob(second.rowsFor({ owner: OWNER, repo: REPO, parent: parent.number }), {
    action: 'finish',
  })
  assert.equal(row.attempt, 1)

  clock.setTime(NOW.getTime() + 61_000)
  const third = await loadStore(jobsPath)
  await run(third)
  assert.equal(calls, 2, '过了退避再试一次')
  const stopped = findJob(third.rowsFor({ owner: OWNER, repo: REPO, parent: parent.number }), {
    action: 'finish',
  })
  assert.equal(stopped.attempt, 2)
  assert.equal(stopped.stop, 'retry-exhausted')

  clock.setTime(NOW.getTime() + 10 * 61_000)
  const fourth = await loadStore(jobsPath)
  await run(fourth)
  assert.equal(calls, 2, '到上限后停线，重启也不再叫收尾')
})

test('runOnce：收尾实现抛错也记 attempt，下一轮退避不重发', async (t) => {
  const { gh } = await setupRepo(t)
  const parent = await createParent(gh, { state: '开发中' })
  const first = await createChild(gh, parent)
  await gh.closeIssue({ owner: OWNER, repo: REPO, number: first.number })
  const { root } = await makeRequirementRepo(t, [first.number])
  let calls = 0
  const finish = async () => {
    calls += 1
    throw new Error('gh 502')
  }
  const jobs = await loadStore(await jobFile(t))
  const config = {
    owner: OWNER,
    lockDir: await lockDir(t),
    maxActive: 5,
    repoRoot: root,
    jobs,
    jobPolicy: { maxAttempts: 3, backoffBaseMs: 60_000 },
  }

  await runOnce({ gh, customers: customers(), notifier: fakeNotifier(), finish, clock: () => NOW, config })
  assert.equal(calls, 1)
  const row = findJob(jobs.rowsFor({ owner: OWNER, repo: REPO, parent: parent.number }), {
    action: 'finish',
  })
  assert.equal(row.attempt, 1)
  assert.match(row.reason, /gh 502/)

  await runOnce({ gh, customers: customers(), notifier: fakeNotifier(), finish, clock: () => NOW, config })
  assert.equal(calls, 1, '退避期间不重发')
})

test('runOnce：执行动作超时也记 attempt，下一轮退避不重发', async (t) => {
  const { gh } = await setupRepo(t)
  const parent = await createParent(gh, { state: '开发中' })
  const first = await createChild(gh, parent)
  await gh.closeIssue({ owner: OWNER, repo: REPO, number: first.number })
  const { root } = await makeRequirementRepo(t, [first.number])
  let calls = 0
  const finish = () => {
    calls += 1
    throw new StepTimeoutError('执行父工单 #42 的动作', 20)
  }
  const jobs = await loadStore(await jobFile(t))
  const config = {
    owner: OWNER,
    lockDir: await lockDir(t),
    maxActive: 5,
    repoRoot: root,
    jobs,
    jobPolicy: { maxAttempts: 3, backoffBaseMs: 60_000 },
  }

  const report = await runOnce({
    gh,
    customers: customers(),
    notifier: fakeNotifier(),
    finish,
    clock: () => NOW,
    config,
  })
  assert.equal(calls, 1)
  assert.ok(report.errors.some((error) => /超时/.test(error.message)))
  const row = findJob(jobs.rowsFor({ owner: OWNER, repo: REPO, parent: parent.number }), {
    action: 'finish',
  })
  assert.equal(row.attempt, 1)
  assert.match(row.reason, /超时/)

  await runOnce({ gh, customers: customers(), notifier: fakeNotifier(), finish, clock: () => NOW, config })
  assert.equal(calls, 1, '超时后下一轮先退避，不叠着跑')
})

test('runOnce：已提交父工单贴 needs-info 后补缺口不再跑', async (t) => {
  const { gh } = await setupRepo(t)
  const parent = await createParent(gh)
  await gh.addLabels({ owner: OWNER, repo: REPO, number: parent.number, labels: ['needs-info'] })
  let calls = 0
  const gapProposal = async () => {
    calls += 1
    return { ok: true }
  }
  const jobs = await loadStore(await jobFile(t))

  await runOnce({
    gh,
    customers: customers(),
    notifier: fakeNotifier(),
    gapProposal,
    clock: () => NOW,
    config: { owner: OWNER, lockDir: await lockDir(t), maxActive: 5, jobs },
  })

  assert.equal(calls, 0)
})

test('runOnce：补缺口失败写 needs-info stop，重启后还在，摘标签才恢复', async (t) => {
  const { fake, gh } = await setupRepo(t)
  const parent = await createParent(gh)
  let calls = 0
  const gapProposal = async () => {
    calls += 1
    return { ok: false, code: 1, stdout: '', stderr: '403 没权限' }
  }
  const jobsPath = await jobFile(t)
  const configFor = (jobs) => ({ owner: OWNER, lockDir: null, maxActive: 5, jobs })

  const first = await loadStore(jobsPath)
  await runOnce({
    gh,
    customers: customers(),
    notifier: fakeNotifier(),
    gapProposal,
    clock: () => NOW,
    config: configFor(first),
  })
  assert.equal(calls, 1)
  assert.ok(labelsOf(fake, OWNER, REPO, parent.number).includes('needs-info'))
  const row = findJob(first.rowsFor({ owner: OWNER, repo: REPO, parent: parent.number }), {
    action: 'needs-info',
  })
  assert.equal(row.stop, 'needs-info')
  assert.match(row.reason, /403 没权限/)

  // 重启后标签和 stop 都还在，仍然不跑。
  const second = await loadStore(jobsPath)
  const reloaded = findJob(second.rowsFor({ owner: OWNER, repo: REPO, parent: parent.number }), {
    action: 'needs-info',
  })
  assert.equal(reloaded.stop, 'needs-info', '重启后 stop 还在')
  await runOnce({
    gh,
    customers: customers(),
    notifier: fakeNotifier(),
    gapProposal,
    clock: () => NOW,
    config: configFor(second),
  })
  assert.equal(calls, 1, '标签还在，不再重跑补缺口')

  // 运营者摘掉 needs-info，表示放行；下一轮清 stop 并重跑。
  await gh.removeLabel({ owner: OWNER, repo: REPO, number: parent.number, name: 'needs-info' })
  const third = await loadStore(jobsPath)
  await runOnce({
    gh,
    customers: customers(),
    notifier: fakeNotifier(),
    gapProposal,
    clock: () => NOW,
    config: configFor(third),
  })
  assert.equal(calls, 2, '摘掉标签后恢复')
})

test('runOnce：管线认证失败写 auth-failed stop', async (t) => {
  const { gh } = await setupRepo(t)
  const parent = await createParent(gh, { state: '开发中' })
  const child = await createChild(gh, parent, { labels: ['状态:排队中', 'Sandcastle'] })
  const jobs = await loadStore(await jobFile(t))
  const ticketPipeline = async () => ({
    runs: [{ ticket: child.number, ok: false, reason: 'auth_failed', problems: ['401 未授权'] }],
  })

  await runOnce({
    gh,
    customers: customers(),
    notifier: fakeNotifier(),
    ticketPipeline,
    clock: () => NOW,
    config: {
      owner: OWNER,
      lockDir: await lockDir(t),
      maxActive: 5,
      repoRoot: join(tmpdir(), 'afk-no-such-repos'),
      jobs,
    },
  })

  const row = findJob(jobs.rowsFor({ owner: OWNER, repo: REPO, parent: parent.number }), {
    action: 'pipeline',
  })
  assert.equal(row.stop, 'auth-failed')
  assert.match(row.reason, /401 未授权/)
})

test('runOnce：一轮开始写心跳，结束记完成时间', async (t) => {
  const { gh } = await setupRepo(t)
  const parent = await createParent(gh)
  await gh.createComment({ owner: OWNER, repo: REPO, number: parent.number, body: '点头：补缺口' })
  const jobs = await loadStore(await jobFile(t))

  const report = await runOnce({
    gh,
    customers: customers(),
    notifier: fakeNotifier(),
    clock: () => NOW,
    config: { owner: OWNER, lockDir: await lockDir(t), maxActive: 5, jobs },
  })

  assert.equal(report.errors.length, 0)
  assert.equal(jobs.heartbeat.roundStart, null, '跑完就清掉进行中标记')
  assert.equal(jobs.heartbeat.lastBeat, NOW.toISOString())
  assert.equal(jobs.heartbeat.lastEnd, NOW.toISOString())
})

test('runOnce：单步超时只记错误，这一轮照样结束', async (t) => {
  const { gh } = await setupRepo(t)
  await createParent(gh)
  const jobs = await loadStore(await jobFile(t))
  // 直接抛超时错误，等价于这一步到了超时点；不跟真实计时器赛跑。
  const timedOut = () => Promise.reject(new StepTimeoutError('跑流水线', 30))

  const report = await runOnce({
    gh,
    customers: customers(),
    notifier: fakeNotifier(),
    ticketPipeline: timedOut,
    clock: () => NOW,
    config: {
      owner: OWNER,
      lockDir: await lockDir(t),
      maxActive: 5,
      repoRoot: join(tmpdir(), 'afk-no-such-repos'),
      jobs,
    },
  })

  assert.ok(report.errors.some((error) => error.pipeline && /超时/.test(error.message)))
  assert.equal(jobs.heartbeat.roundStart, null, '超时后这一轮仍然收尾')
})

test('runOnce：慢管线在步超时以内跑完，不误判成卡住', async (t) => {
  const { gh } = await setupRepo(t)
  await createParent(gh)
  const jobs = await loadStore(await jobFile(t))
  // 用一串微任务模拟长管线，不依赖真实时间窗口。
  const slow = async () => {
    for (let index = 0; index < 200; index += 1) await Promise.resolve()
    return { runs: [] }
  }

  const report = await runOnce({
    gh,
    customers: customers(),
    notifier: fakeNotifier(),
    ticketPipeline: slow,
    clock: () => NOW,
    config: {
      owner: OWNER,
      lockDir: await lockDir(t),
      maxActive: 5,
      repoRoot: join(tmpdir(), 'afk-no-such-repos'),
      jobs,
    },
  })
  assert.equal(report.errors.length, 0)

  // 一轮已经结束，之后再久也不该报「轮次超时」。
  const watchdog = createWatchdog({
    jobs,
    notifier: fakeNotifier(),
    clock: () => new Date(NOW.getTime() + 30 * 60_000),
    stallMs: 10 * 60_000,
    log: () => {},
  })
  assert.equal(await watchdog.tick(), null)
})

test('看门狗：一轮挂住超过阈值发一次出事，结束一轮后不再发', async (t) => {
  const jobs = await loadStore(await jobFile(t))
  let now = NOW.getTime()
  const clock = () => new Date(now)
  await jobs.startRound({ now: clock() })
  now += 11 * 60_000
  const notifier = fakeNotifier()
  const config = {}
  const watchdog = createWatchdog({
    jobs,
    notifier,
    clock,
    stallMs: 10 * 60_000,
    log: () => {},
    config,
  })

  const event = await watchdog.tick()
  assert.equal(event.event, '出事')
  assert.match(event.data.reason, /轮次超时/)
  assert.equal(event.key, `调度器:出事:轮次超时:${jobs.heartbeat.roundStart}`)
  assert.ok(config.notifiedKeys.has(event.key), '探活发送要留下 sent 记录')
  assert.equal(event.data.customer, '工厂')
  assert.match(event.link, /^file:\/\//, '出事通知必须带 link，否则真 notifier 拒收')
  assert.equal(notifier.calls.length, 1)

  assert.equal(await watchdog.tick(), null, '同一轮只发一次')
  assert.equal(notifier.calls.length, 1)

  await jobs.endRound({ now: clock() })
  assert.equal(await watchdog.tick(), null)
})

test('runJobStep 在长步骤里按时写心跳', async () => {
  let beats = 0
  let heartbeat = null
  const timers = {
    setInterval(fn) {
      heartbeat = fn
      return 1
    },
    clearInterval() {
      heartbeat = null
    },
  }
  const jobs = {
    async beat() {
      beats += 1
    },
  }
  let release
  const running = runJobStep({
    jobs,
    config: { jobHeartbeatMs: 10, stepTimeoutMs: 0, timers },
    label: '长步骤',
    task: () =>
      new Promise((done) => {
        release = done
      }),
  })
  await Promise.resolve()
  assert.equal(typeof heartbeat, 'function')
  heartbeat()
  heartbeat()
  release()
  await running
  assert.equal(beats, 2, '任务运行期间按心跳间隔写')
  assert.equal(heartbeat, null, '步骤结束清掉心跳定时器')
})

test('runJobStep 到点抛 StepTimeoutError，并清掉定时器', async () => {
  let fire = null
  let cleared = 0
  const timers = {
    setTimeout(fn) {
      fire = fn
      return 7
    },
    clearTimeout() {
      cleared += 1
    },
    setInterval() {
      return 8
    },
    clearInterval() {},
  }
  const running = runJobStep({
    config: { stepTimeoutMs: 50, jobHeartbeatMs: 0, timers },
    label: '读快照',
    task: () => new Promise(() => {}),
  })
  await Promise.resolve()
  assert.equal(typeof fire, 'function')
  fire()
  await assert.rejects(running, /读快照超时：50 毫秒没跑完/)
  assert.equal(cleared, 1, '超时后清掉计时器')
})

test('runLoop 自动看门狗：一轮挂住会发「出事」', async (t) => {
  const jobs = await loadStore(await jobFile(t))
  const notifier = fakeNotifier()
  const controller = new AbortController()
  let now = NOW.getTime()
  const clock = () => new Date(now)
  let intervalFn = null
  const timers = {
    setInterval(fn) {
      intervalFn = fn
      return 1
    },
    clearInterval() {
      intervalFn = null
    },
  }
  let markStarted
  const started = new Promise((resolve) => {
    markStarted = resolve
  })
  const config = {
    jobs,
    notifier,
    roundTimeoutMs: 20,
    watchdogIntervalMs: 10,
    timers,
  }
  const loop = runLoop({
    intervalMs: 1000,
    signal: controller.signal,
    clock,
    log: () => {},
    run: async () => {
      await jobs.startRound({ now: clock() })
      markStarted()
      await new Promise((resolve) =>
        controller.signal.addEventListener('abort', resolve, { once: true }),
      )
      return { now: clock().toISOString(), repos: [], errors: [] }
    },
    onReport: async () => {},
    config,
  })

  await started
  assert.equal(typeof intervalFn, 'function', 'runLoop 自己起了看门狗')
  now += 21
  intervalFn()
  for (let index = 0; index < 20 && notifier.calls.length === 0; index += 1) {
    await Promise.resolve()
  }
  assert.equal(notifier.calls.length, 1, '同一轮只发一次')
  assert.equal(notifier.calls[0].event, '出事')
  assert.match(notifier.calls[0].data.reason, /轮次超时/)
  assert.match(notifier.calls[0].link, /^file:\/\//)

  controller.abort()
  await loop
  assert.equal(intervalFn, null, '轮次结束后看门狗停掉')
})

test('runLoop 启动和停掉看门狗', async () => {
  const controller = new AbortController()
  const calls = []
  const watchdog = {
    start() {
      calls.push('start')
    },
    stop() {
      calls.push('stop')
    },
  }
  await runLoop({
    intervalMs: 1000,
    signal: controller.signal,
    log: () => {},
    run: async () => {
      controller.abort()
      return { now: NOW.toISOString(), repos: [], errors: [] }
    },
    onReport: async () => {},
    watchdog,
  })
  assert.deepEqual(calls, ['start', 'stop'])
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

test('两个仓同时点火：第二个仓不被第一个仓跑着的实现阻塞', async (t) => {
  const other = 'acme-two'
  const fake = await startFakeGithub({
    repos: [
      { owner: OWNER, name: REPO },
      { owner: OWNER, name: other },
    ],
  })
  t.after(() => fake.close())
  const gh = createGithub({ apiBase: fake.base, token: 'test' })
  await repoLabels(gh, OWNER, REPO)
  await repoLabels(gh, OWNER, other)

  async function ready(repo, title) {
    const parent = await gh.createIssue({
      owner: OWNER,
      repo,
      title,
      body: parentBody(),
      labels: ['状态:已提交', '大小:小需求'],
    })
    const child = await gh.createIssue({
      owner: OWNER,
      repo,
      title: `${title}子票`,
      body: '',
      labels: ['状态:排队中'],
    })
    await gh.addSubIssue({ owner: OWNER, repo, number: parent.number, subIssueId: child.id })
    await gh.createComment({ owner: OWNER, repo, number: parent.number, body: '点头：补缺口' })
    return { parent, child }
  }

  const first = await ready(REPO, '仓一')
  const second = await ready(other, '仓二')

  const calls = []
  let firstFinished = false
  let releaseFirst
  const firstRunning = new Promise((resolve) => {
    releaseFirst = resolve
  })
  async function ignite(args) {
    calls.push(args)
    if (args.repo === REPO) await firstRunning
    if (args.repo === REPO) firstFinished = true
    return { started: true }
  }

  const rows = [
    { id: 'c-0001', short_name: 'acme', status: 'active', repos: { demo: REPO } },
    { id: 'c-0002', short_name: 'acme', status: 'active', repos: { demo: other } },
  ]

  await withTimeout(
    runOnce({
      gh,
      customers: rows,
      notifier: fakeNotifier(),
      ignite,
      clock: () => NOW,
      config: { owner: OWNER, lockDir: await lockDir(t), maxActive: 5 },
    }),
  )

  assert.equal(calls.length, 2, '两个仓都点了火')
  assert.deepEqual(calls.map((row) => row.repo).sort(), [REPO, other].sort())
  assert.ok(calls.some((row) => row.ticket.number === first.child.number))
  assert.ok(calls.some((row) => row.ticket.number === second.child.number))
  assert.equal(firstFinished, false, '第一张还在跑时这一轮已经结束')

  releaseFirst()
  await new Promise((resolve) => setTimeout(resolve, 0))
})

test('同一仓第一张在后台跑时，第二张仍等待；新实例不重复点火', async (t) => {
  const { fake, gh } = await setupRepo(t)
  const firstParent = await createParent(gh, { state: '开发中', title: '第一张' })
  const firstChild = await createChild(gh, firstParent, { title: '子票一' })
  const secondParent = await createParent(gh, { state: '开发中', title: '第二张' })
  const secondChild = await createChild(gh, secondParent, { title: '子票二' })

  const calls = []
  let release
  const running = new Promise((resolve) => {
    release = resolve
  })
  async function ignite(args) {
    calls.push(args)
    await running
    return { started: true }
  }

  await withTimeout(
    runOnce({
      gh,
      customers: customers(),
      notifier: fakeNotifier(),
      ignite,
      clock: () => NOW,
      config: { owner: OWNER, lockDir: await lockDir(t), maxActive: 5 },
    }),
  )

  assert.equal(calls.length, 1)
  const runningTicket = calls[0].ticket.number
  const otherChild = runningTicket === firstChild.number ? secondChild : firstChild
  assert.ok(labelsOf(fake, OWNER, REPO, runningTicket).includes('Sandcastle'))

  // 新实例（新锁目录、新内存状态），第一张还在后台跑：不重复点火，也不点同仓第二张。
  await withTimeout(
    runOnce({
      gh,
      customers: customers(),
      notifier: fakeNotifier(),
      ignite,
      clock: () => NOW,
      config: { owner: OWNER, lockDir: await lockDir(t), maxActive: 5 },
    }),
  )

  assert.equal(calls.length, 1, '重启后不重复点火')
  assert.ok(!labelsOf(fake, OWNER, REPO, otherChild.number).includes('Sandcastle'), '同一仓第二张仍等待')

  release()
  await new Promise((resolve) => setTimeout(resolve, 0))
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

test('runOnce：后台点火失败记 attempt，下一轮退避不重发', async (t) => {
  const { fake, gh } = await setupRepo(t)
  const parent = await createParent(gh, { state: '开发中' })
  const ticket = await createChild(gh, parent)
  let calls = 0
  const ignite = async () => {
    calls += 1
    throw new Error('runner 起不来')
  }
  const jobs = await loadStore(await jobFile(t))
  const config = {
    owner: OWNER,
    lockDir: await lockDir(t),
    maxActive: 5,
    jobs,
    jobPolicy: { maxAttempts: 3, backoffBaseMs: 60_000 },
  }

  await runOnce({ gh, customers: customers(), notifier: fakeNotifier(), ignite, clock: () => NOW, config })
  await Promise.allSettled([...(config.pendingIgnitions || [])])

  assert.equal(calls, 1)
  const row = findJob(jobs.rowsFor({ owner: OWNER, repo: REPO, parent: parent.number }), {
    action: 'ignite',
    ticket: ticket.number,
  })
  assert.equal(row.attempt, 1)
  assert.match(row.reason, /runner 起不来/)
  assert.ok(!labelsOf(fake, OWNER, REPO, ticket.number).includes('Sandcastle'), '失败后摘掉认领标签')

  await runOnce({ gh, customers: customers(), notifier: fakeNotifier(), ignite, clock: () => NOW, config })
  await Promise.allSettled([...(config.pendingIgnitions || [])])
  assert.equal(calls, 1, '退避期间不重复点火')
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

test('待验收驳回后第二轮点火修复子票，不重复建票', async (t) => {
  await assertRejectionIgnitesFixTicket(t, { small: false })
})

test('小需求待验收驳回后第二轮点火修复子票，不重复建票', async (t) => {
  await assertRejectionIgnitesFixTicket(t, { small: true })
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
  assert.equal(incident.key, `${OWNER}/${REPO}:#${parent.number}:出事:三圈没进展`)
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
  assert.equal(events[0].key, `${OWNER}/${REPO}:#${parent.number}:新单进队列`)
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

test('runLoop 收到停止信号才结束，每轮把 report 交给 onReport', async () => {
  const controller = new AbortController()
  const reports = []
  let runs = 0
  await runLoop({
    intervalMs: 1,
    signal: controller.signal,
    log: () => {},
    run: async () => {
      runs += 1
      if (runs === 2) controller.abort()
      return { round: runs }
    },
    onReport: async (report) => reports.push(report),
  })
  assert.deepEqual(reports, [{ round: 1 }, { round: 2 }])
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
  assert.equal(events[0].key, `${OWNER}/${REPO}:#${map.number}:重传地图已更新:2026-11-17`)

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
  assert.equal(events[0].key, `${OWNER}/${REPO}:#${updated.number}:重传地图已更新:2026-11-18`)
  assert.equal(quiet.number < updated.number, true)
})

test('runOnce：两个客户仓都有父工单 #1，各自的该跑 to-spec 都能发', async (t) => {
  const fake = await startFakeGithub({
    repos: [
      { owner: OWNER, name: 'shop-a' },
      { owner: OWNER, name: 'shop-b' },
    ],
  })
  t.after(() => fake.close())
  const gh = createGithub({ apiBase: fake.base, token: 'test' })
  await repoLabels(gh, OWNER, 'shop-a')
  await repoLabels(gh, OWNER, 'shop-b')

  for (const repo of ['shop-a', 'shop-b']) {
    const created = await gh.createIssue({
      owner: OWNER,
      repo,
      title: '要个预约取货',
      body: parentBody(),
      labels: ['状态:已提交'],
    })
    assert.equal(created.number, 1, '两个仓的父工单都是 #1')
    await gh.createComment({ owner: OWNER, repo, number: 1, body: '点头：补缺口\n\n## 最终答案' })
  }

  const notifier = fakeNotifier()
  await runOnce({
    gh,
    customers: customers([
      { id: 'c-0001', short_name: 'acme', status: 'active', repos: { demo: 'shop-a' } },
      { id: 'c-0002', short_name: 'other', status: 'active', repos: { demo: 'shop-b' } },
    ]),
    notifier,
    clock: () => NOW,
    config: { owner: OWNER, lockDir: await lockDir(t), maxActive: 5 },
  })

  const keys = [...notifier.delivered.keys()].filter((key) => key.includes('该跑 to-spec')).sort()
  assert.deepEqual(keys, [
    'acme/shop-a:#1:该跑 to-spec:0',
    'acme/shop-b:#1:该跑 to-spec:0',
  ])
  assert.equal(notifier.delivered.size, 2, '两条通知都送达，没有互相吞掉')
})

test('同一停滞连续 5 轮：needs-info key 稳定，轮次进 data，只送达一次', async () => {
  const delivered = new Map()
  const notifier = {
    async send(event) {
      if (!delivered.has(event.key)) delivered.set(event.key, event)
      return { code: 0, stdout: '{}' }
    },
  }
  const comments = [1, 2, 3].map((round) => ({
    body: progressLine({ path: '其余', tier: '开发中', step: '开工', round, stuck: false }),
  }))
  const seen = []

  for (let index = 0; index < 5; index += 1) {
    const actions = routeParent({
      parent: parent({ labels: labels('状态:排队中') }),
      comments,
      subIssues: [],
      spec: null,
      now: NOW,
      owner: OWNER,
      repo: REPO,
    })
    const incident = actions.find((action) => action.type === 'notify' && action.event === '出事')
    const needsInfo = actions.find(
      (action) => action.type === 'notify' && action.event === 'needs-info',
    )
    assert.ok(incident, '停滞要报一次出事')
    assert.ok(needsInfo, '停滞要报一次 needs-info')
    seen.push(needsInfo)
    await notifier.send(incident)
    await notifier.send(needsInfo)
  }

  assert.equal(new Set(seen.map((event) => event.key)).size, 1, '5 轮只有一个 needs-info key')
  assert.equal(seen[0].key, 'acme/acme-demo:#42:needs-info:排队中')
  assert.equal(seen[0].data.round, 3, '轮次放 data')
  assert.equal(delivered.size, 2, '出事和 needs-info 各送达一次')
  assert.ok(delivered.has('acme/acme-demo:#42:出事:三圈没进展'))
})

test('runOnce：重试到上限另发升级通知，key 与失败通知不同，attempt 进 data', async (t) => {
  const { gh } = await setupRepo(t)
  const parent = await createParent(gh, { state: '开发中' })
  const first = await createChild(gh, parent)
  await gh.closeIssue({ owner: OWNER, repo: REPO, number: first.number })
  const { root } = await makeRequirementRepo(t, [first.number])
  const finish = async () => ({ ok: false, reason: 'review_failed', findings: ['差一处'] })
  const jobsPath = await jobFile(t)
  const clock = new Date(NOW)
  const policy = { maxAttempts: 2, backoffBaseMs: 60_000 }
  const notifier = fakeNotifier()
  const run = async (store) =>
    runOnce({
      gh,
      customers: customers(),
      notifier,
      finish,
      clock: () => clock,
      config: {
        owner: OWNER,
        lockDir: await lockDir(t),
        maxActive: 5,
        repoRoot: root,
        jobs: store,
        jobPolicy: policy,
      },
    })

  await run(await loadStore(jobsPath))
  clock.setTime(NOW.getTime() + 61_000)
  await run(await loadStore(jobsPath))

  const failureKey = `acme/acme-demo:#${parent.number}:出事:作业失败:finish`
  const escalationKey = `acme/acme-demo:#${parent.number}:出事:作业失败:finish:升级`
  assert.ok(notifier.delivered.has(failureKey), '失败通知 key 稳定')
  assert.ok(notifier.delivered.has(escalationKey), '到上限另发升级')
  assert.equal(notifier.delivered.size, 2, '失败和升级各只送达一次')
  assert.equal(notifier.delivered.get(failureKey).data.attempt, 1)
  assert.equal(notifier.delivered.get(escalationKey).data.attempt, 2)
  assert.match(notifier.delivered.get(escalationKey).data.tried, /差一处/)
})
