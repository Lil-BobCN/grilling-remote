import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { encodeTicketsPayload } from '../../backend/lib/protocol.mjs'
import { DECOMPOSE_TOOLS, GAP_TOOLS } from '../lib/agent-runner.mjs'
import { createDecompose, createGapProposal } from '../lib/scheduler-jobs.mjs'
import { routeParent } from '../lib/scheduler.mjs'

const NOW = new Date('2026-11-17T10:00:00+08:00')
const AGENTS_DIR = fileURLToPath(new URL('../agents/', import.meta.url))
const TOOLS_TEXT = 'Read,Write,Edit,Bash(node:*),Bash(gh:*)'

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

function route({
  stateLabel = '状态:已提交',
  small = false,
  comments = [],
  subIssues = [],
  spec = null,
  jobs = [],
  jobPolicy = {},
} = {}) {
  const names = [stateLabel]
  if (small) names.push('大小:小需求')
  return routeParent({
    parent: parent({ labels: labels(...names) }),
    comments,
    subIssues,
    spec,
    closedNumbers: [],
    now: NOW,
    jobs,
    jobPolicy,
    owner: 'acme',
    repo: 'demo',
  })
}

function types(actions) {
  return actions.map((action) => action.type)
}

test('已提交+驳回：补缺口 → 重跑补缺口提案', () => {
  const actions = route({ comments: [gate('驳回：补缺口 第 3 题推荐不对，按客户说的改')] })
  assert.deepEqual(types(actions), ['runGapProposal'])
})

test('小需求已提交+驳回：补缺口 → 也重跑补缺口提案', () => {
  const actions = route({ small: true, comments: [gate('驳回：补缺口 再问一遍')] })
  assert.deepEqual(types(actions), ['runGapProposal'])
})

test('排队中+有 spec+没有子票+驳回：拆票 → 重跑拆票', () => {
  const actions = route({
    stateLabel: '状态:排队中',
    comments: [gate('驳回：拆票 第二张票切得太宽，拆成两张')],
    spec: { number: 60, title: 'spec yuyue-quhuo' },
  })
  assert.deepEqual(types(actions), ['runDecompose'])
})

test('排队中+没有 spec+驳回：拆票 → 停，不重跑', () => {
  const actions = route({
    stateLabel: '状态:排队中',
    comments: [gate('驳回：拆票 再拆一次')],
  })
  assert.deepEqual(types(actions), [])
})

test('排队中+已有子票+驳回：拆票 → 停，不重跑', () => {
  const actions = route({
    stateLabel: '状态:排队中',
    comments: [gate('驳回：拆票 再拆一次')],
    spec: { number: 60, title: 'spec yuyue-quhuo' },
    subIssues: [sub()],
  })
  assert.deepEqual(types(actions), [])
})

test('小需求不走拆票：排队中+驳回：拆票 不重跑拆票', () => {
  const actions = route({
    small: true,
    stateLabel: '状态:排队中',
    comments: [gate('驳回：拆票 再拆一次')],
    spec: { number: 60, title: 'spec yuyue-quhuo' },
  })
  assert.equal(types(actions).includes('runDecompose'), false)
})

test('驳回后已经出了新提案：停，等运营商点头', () => {
  const gap = route({
    comments: [gate('驳回：补缺口 理由'), gate('提案：补缺口\n\n## 技术题')],
  })
  assert.deepEqual(types(gap), [])

  const decompose = route({
    stateLabel: '状态:排队中',
    comments: [gate('驳回：拆票 理由'), gate('提案：拆票')],
    spec: { number: 60, title: 'spec yuyue-quhuo' },
  })
  assert.deepEqual(types(decompose), [])
})

test('驳回重跑走现有作业退避：退避中不重发，过期再试', () => {
  const policy = { maxAttempts: 3, backoffBaseMs: 10 * 60 * 1000 }
  const jobs = [
    {
      owner: 'acme',
      repo: 'demo',
      parent: 42,
      ticket: null,
      action: 'gap-proposal',
      attempt: 1,
      lastBeat: NOW.toISOString(),
      stop: '',
    },
  ]
  const comments = [gate('驳回：补缺口 理由')]
  assert.deepEqual(route({ comments, jobs, jobPolicy: policy }), [])

  jobs[0].lastBeat = new Date(NOW.getTime() - 11 * 60 * 1000).toISOString()
  assert.deepEqual(types(route({ comments, jobs, jobPolicy: policy })), ['runGapProposal'])

  const decomposeJobs = [
    {
      owner: 'acme',
      repo: 'demo',
      parent: 42,
      ticket: null,
      action: 'decompose',
      attempt: 1,
      lastBeat: NOW.toISOString(),
      stop: '',
    },
  ]
  const waiting = route({
    stateLabel: '状态:排队中',
    comments: [gate('驳回：拆票 理由')],
    spec: { number: 60, title: 'spec yuyue-quhuo' },
    jobs: decomposeJobs,
    jobPolicy: policy,
  })
  assert.deepEqual(types(waiting), [])

  decomposeJobs[0].lastBeat = new Date(NOW.getTime() - 11 * 60 * 1000).toISOString()
  const due = route({
    stateLabel: '状态:排队中',
    comments: [gate('驳回：拆票 理由')],
    spec: { number: 60, title: 'spec yuyue-quhuo' },
    jobs: decomposeJobs,
    jobPolicy: policy,
  })
  assert.deepEqual(types(due), ['runDecompose'])
})

test('提案：和改口：仍是等待信号，不触发重跑', () => {
  assert.deepEqual(types(route({ comments: [gate('提案：补缺口')] })), [])
  assert.deepEqual(types(route({ comments: [gate('改口：重传')] })), [])
})

test('待验收的驳回仍按现状建修复子票，不受重跑影响', () => {
  const actions = route({
    stateLabel: '状态:待验收',
    comments: [gate('驳回：客户说取货时间不能选。')],
  })
  assert.deepEqual(types(actions), ['setState', 'comment', 'createFixTicket'])
})

function captureRunner() {
  const calls = []
  return {
    calls,
    async run(options) {
      calls.push(options)
      return { ok: true, code: 0, stdout: '', stderr: '' }
    },
  }
}

function proposalBody() {
  const tickets = [
    {
      title: '顾客打开链接能看到当天水果和卖完的',
      verticalSlice: '顾客打开链接，看到今天的水果、价格和卖完的。',
      acceptance: ['打开链接，看到当天水果的名单。'],
      blockedBy: [],
    },
  ]
  return `提案：拆票\n\n共 1 张票。\n\n${encodeTicketsPayload(tickets)}`
}

function commentsGh(comments) {
  return {
    async listComments() {
      return comments
    },
    async listSubIssues() {
      return []
    },
  }
}

test('补缺口 brief 带最新一条驳回评论全文，工具白名单不变', async () => {
  const runner = captureRunner()
  const rejection = '驳回：补缺口 第 3 题推荐不对。\n客户说服务器要放香港，不要内地。'
  const parent = {
    number: 42,
    title: '要个预约取货',
    body: '',
    comments: [gate('提案：补缺口\n\n## 技术题'), gate(rejection)],
  }
  const gapProposal = createGapProposal({ runner, agentsDir: AGENTS_DIR, log: () => {} })

  const result = await gapProposal({ owner: 'acme', repo: 'demo', parent })

  assert.equal(result.ok, true)
  assert.equal(runner.calls.length, 1)
  assert.match(runner.calls[0].brief, /## 这次驳回的理由/)
  assert.equal(runner.calls[0].brief.includes(rejection), true)
  assert.equal(runner.calls[0].allowedTools, GAP_TOOLS)
})

test('补缺口 brief 没有驳回时不带驳回理由', async () => {
  const runner = captureRunner()
  const parent = {
    number: 42,
    title: '要个预约取货',
    body: '',
    comments: [gate('提案：补缺口\n\n## 技术题')],
  }
  const gapProposal = createGapProposal({ runner, agentsDir: AGENTS_DIR, log: () => {} })

  await gapProposal({ owner: 'acme', repo: 'demo', parent })

  assert.equal(runner.calls[0].brief.includes('## 这次驳回的理由'), false)
  assert.equal(runner.calls[0].brief.includes('客户说服务器要放香港'), false)
})

test('拆票 brief 带最新一条驳回评论全文，工具白名单不变', async () => {
  const runner = captureRunner()
  const rejection = '驳回：拆票 第二张票切得太宽。\n拆成两张，验收条件分开写。'
  const parent = {
    number: 42,
    title: '要个预约取货',
    body: '## 验收条件\n\n- [ ] 打开首页能看到入口。',
    comments: [gate('提案：拆票'), gate(rejection)],
  }
  const decompose = createDecompose({ runner, gh: commentsGh([{ body: proposalBody() }]) })

  const result = await decompose({ owner: 'acme', repo: 'demo', parent, spec: null })

  assert.equal(result.ok, true)
  assert.equal(runner.calls.length, 1)
  assert.match(runner.calls[0].brief, /## 这次驳回的理由/)
  assert.equal(runner.calls[0].brief.includes(rejection), true)
  assert.equal(runner.calls[0].allowedTools, DECOMPOSE_TOOLS)
})

test('拆票 brief 没有驳回时不带驳回理由', async () => {
  const runner = captureRunner()
  const parent = {
    number: 42,
    title: '要个预约取货',
    body: '',
    comments: [],
  }
  const decompose = createDecompose({ runner, gh: commentsGh([{ body: proposalBody() }]) })

  await decompose({ owner: 'acme', repo: 'demo', parent, spec: null })

  assert.equal(runner.calls[0].brief.includes('## 这次驳回的理由'), false)
  assert.equal(runner.calls[0].brief.includes('拆成两张'), false)
})

test('重跑用的两个工具白名单没变', () => {
  assert.equal(GAP_TOOLS, TOOLS_TEXT)
  assert.equal(DECOMPOSE_TOOLS, TOOLS_TEXT)
})
