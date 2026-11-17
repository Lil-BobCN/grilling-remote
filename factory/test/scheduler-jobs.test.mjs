import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createDecompose,
  createFixTicket,
  createListMergedYesterday,
  createNeedsAnswer,
  parseGateRows,
  ticketFromBranch,
} from '../lib/scheduler-jobs.mjs'
import { newTicketEvent } from '../lib/scheduler.mjs'

const NOW = new Date('2026-11-17T10:00:00')
const HEADER = 'ts\tphase\tdecision\twhy\tevidence\tresult'

function trail(lines) {
  return [HEADER, ...lines].join('\n')
}

function labels(...names) {
  return names.map((name) => ({ name }))
}

test('parseGateRows：问的行返回，答行配给最早的问题，推荐从 decision 或 why 取', () => {
  const text = trail([
    '2026-11-16T09:00:00Z\tgate\t问：服务器放哪 推荐：香港\t\t\topen',
    '2026-11-16T09:05:00Z\tgate\t问：要不要备案\twhy 里写 推荐：不备案\t\topen',
    '2026-11-16T11:00:00Z\tgate\t答：服务器放哪\t\t\tanswered',
    '2026-11-16T11:05:00Z\tgate\t问：收不收个人信息\t\t\tparked',
  ])
  const rows = parseGateRows(text)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].question, '要不要备案')
  assert.equal(rows[0].recommended, '不备案')

  const missing = parseGateRows(
    trail(['2026-11-16T09:00:00Z\tgate\t问：用哪家云\t\t\topen']),
  )
  assert.equal(missing[0].recommended, '未写推荐')
})

test('ticketFromBranch 认 ticket/51 和 issue-51', () => {
  assert.equal(ticketFromBranch('ticket/51'), 51)
  assert.equal(ticketFromBranch('Lil-BobCN/issue-51'), 51)
  assert.equal(ticketFromBranch('main'), null)
})

test('createNeedsAnswer 读 open PR head 的 trail，answered 和 parked 不再返回', async () => {
  const tsv = trail([
    '2026-11-16T09:00:00Z\tgate\t问：服务器放哪 推荐：香港\t\t\topen',
    '2026-11-16T11:00:00Z\tgate\t答：服务器放哪\t\t\tanswered',
    '2026-11-16T09:10:00Z\tgate\t问：要不要备案\t\t\tparked',
  ])
  const calls = []
  const run = async (args) => {
    calls.push(args)
    if (args[0] === 'pr') {
      return JSON.stringify([
        { number: 7, headRefName: 'ticket/51', url: 'https://github.com/acme/demo/pull/7' },
        { number: 8, headRefName: 'main', url: 'https://github.com/acme/demo/pull/8' },
      ])
    }
    if (args[0] === 'api') return tsv
    throw new Error(`不认识的命令：${args.join(' ')}`)
  }

  const rows = await createNeedsAnswer({ run })({ owner: 'acme', repo: 'demo' })
  assert.deepEqual(rows, [])
  assert.ok(calls.some((args) => args[0] === 'api' && args.at(-1).includes('.audit/51.tsv')))
  assert.ok(!calls.some((args) => args[0] === 'api' && args.at(-1).includes('main')))
})

test('createNeedsAnswer 返回 key、问题、推荐和 PR 链接', async () => {
  const run = async (args) => {
    if (args[0] === 'pr') {
      return JSON.stringify([
        { number: 9, headRefName: 'issue-52', url: 'https://github.com/acme/demo/pull/9' },
      ])
    }
    return trail([
      '2026-11-16T09:00:00Z\tgate\t问：用哪家云 推荐：阿里云\t\t\topen',
      '2026-11-16T09:30:00Z\tgate\t问：要不要短信\t推荐：不要\t\topen',
    ])
  }
  const rows = await createNeedsAnswer({ run })({ owner: 'acme', repo: 'demo' })
  assert.equal(rows.length, 2)
  assert.equal(rows[0].question, '用哪家云')
  assert.equal(rows[0].recommended, '阿里云')
  assert.equal(rows[0].link, 'https://github.com/acme/demo/pull/9')
  assert.equal(rows[0].ticket, 52)
  assert.match(rows[0].key, /^9:/)
})

test('createListMergedYesterday 只取前一天 00:00–24:00，读标记，读不到用标题兜底', async () => {
  const inside = new Date(2026, 10, 16, 12, 0, 0).toISOString()
  const before = new Date(2026, 10, 15, 23, 59, 0).toISOString()
  const after = new Date(2026, 10, 17, 0, 0, 0).toISOString()
  const run = async () => {
    return JSON.stringify([
      {
        number: 11,
        title: '合并 #42 预约取货',
        mergedAt: inside,
        headRefName: 'ticket/51',
        body: '<!-- factory:customer=acme -->\n<!-- factory:requirement=yuyue -->',
      },
      { number: 12, title: '合并 #43 旧单', mergedAt: before, headRefName: 'ticket/52', body: '' },
      { number: 13, title: '合并 #44 新单', mergedAt: after, headRefName: 'ticket/53', body: '' },
      { number: 14, title: '合并 #45 没有标记', mergedAt: inside, headRefName: 'ticket/54', body: '' },
    ])
  }

  const items = await createListMergedYesterday({ run })({
    now: NOW,
    repos: [{ owner: 'acme', repo: 'demo' }],
  })
  assert.equal(items.length, 2)
  assert.deepEqual(
    items.map((item) => [item.customer, item.requirement, item.pr]),
    [
      ['acme', 'yuyue', 11],
      ['', '没有标记', 14],
    ],
  )
  assert.equal(items[0].url, 'https://github.com/acme/demo/pull/11')
  assert.equal(items[0].date, '2026-11-16')

  const empty = await createListMergedYesterday({ run: async () => '[]' })({
    now: NOW,
    repos: [{ owner: 'acme', repo: 'demo' }],
  })
  assert.deepEqual(empty, [])
})

test('createDecompose 已有提案或点头时不重复跑，AFK_DECOMPOSE_SKIP 可关', async () => {
  const calls = []
  const runner = {
    async run(options) {
      calls.push(options)
      return { ok: true, code: 0, stdout: '' }
    },
  }
  const parent = {
    number: 42,
    title: '要个预约取货',
    body: '## 验收条件\n\n- [ ] 打开首页能看到入口。',
    comments: [{ body: '提案：拆票\n\n- 主页' }],
  }
  const spec = { number: 60, title: 'spec yuyue', body: '用户故事' }

  const decompose = createDecompose({ runner })
  const skipped = await decompose({ owner: 'acme', repo: 'demo', parent, spec })
  assert.equal(skipped.skipped, 'already-proposed')
  assert.equal(calls.length, 0)

  const forced = createDecompose({ runner, skip: false })
  const ran = await forced({ owner: 'acme', repo: 'demo', parent, spec })
  assert.equal(ran.ok, true)
  assert.equal(calls.length, 1)
  assert.match(calls[0].brief, /提案：拆票/)
  assert.match(calls[0].brief, /用户故事/)
  assert.match(calls[0].brief, /父工单：#42/)
})

test('createFixTicket 建修复子票：标题取第一句，只挂排队中，挂成 sub-issue，不写阻塞', async () => {
  const calls = { created: [], subIssues: [] }
  const gh = {
    async listLabels() {
      return []
    },
    async createLabel(args) {
      calls.label = args
    },
    async listSubIssues() {
      return []
    },
    async createIssue(args) {
      calls.created.push(args)
      return { id: 700, number: 91, ...args }
    },
    async addSubIssue(args) {
      calls.subIssues.push(args)
    },
  }
  const parent = {
    number: 42,
    body: [
      '## 验收条件',
      '',
      '- [ ] 打开首页能看到预约入口。',
      '- [ ] 填手机号能下单。',
    ].join('\n'),
  }

  const result = await createFixTicket({ gh })({
    owner: 'acme',
    repo: 'demo',
    parent,
    rejection: { body: '驳回：确认页看不到订好了。客户说再核对一次。' },
  })
  assert.equal(result.created, true)
  assert.equal(result.number, 91)
  assert.equal(calls.created[0].title, '确认页看不到订好了')
  assert.deepEqual(calls.created[0].labels, ['状态:排队中'])
  assert.match(calls.created[0].body, /## 垂直切片\n\n按驳回修好/)
  assert.match(calls.created[0].body, /## 验收条件\n\n- \[ \] 打开首页能看到预约入口。/)
  assert.ok(!calls.created[0].body.includes('## 阻塞'))
  assert.deepEqual(calls.subIssues, [{ owner: 'acme', repo: 'demo', number: 42, subIssueId: 700 }])
})

test('createFixTicket 验收条件抄驳回点名的条目；同名子票不重复建', async () => {
  const calls = { created: [] }
  const children = [{ title: '填手机号能下单', number: 5 }]
  const gh = {
    async listLabels() {
      return []
    },
    async createLabel() {},
    async listSubIssues() {
      return children
    },
    async createIssue(args) {
      calls.created.push(args)
      return { id: 701, number: 92, ...args }
    },
    async addSubIssue() {},
  }
  const parent = {
    number: 43,
    body: '## 验收条件\n\n- [ ] 打开首页能看到预约入口。\n- [ ] 填手机号能下单。',
  }

  const again = await createFixTicket({ gh })({
    owner: 'acme',
    repo: 'demo',
    parent,
    rejection: { body: '驳回：填手机号能下单' },
  })
  assert.deepEqual(again, { created: false, number: 5, title: '填手机号能下单' })
  assert.equal(calls.created.length, 0)

  children.length = 0
  await createFixTicket({ gh })({
    owner: 'acme',
    repo: 'demo',
    parent,
    rejection: { body: '驳回：填手机号能下单' },
  })
  assert.equal(calls.created.length, 1)
  assert.match(calls.created[0].body, /- \[ \] 填手机号能下单。/)
  assert.ok(!calls.created[0].body.includes('打开首页能看到预约入口'))
})

test('newTicketEvent 只在已提交且没有评论时推一次', () => {
  const parent = {
    number: 42,
    body: '- 客户简称：acme\n- 需求名：yuyue',
    labels: labels('状态:已提交'),
  }
  const event = newTicketEvent({ parent, comments: [], owner: 'acme', repo: 'demo' })
  assert.equal(event.event, '新单进队列')
  assert.equal(event.key, '#42:新单进队列')
  assert.equal(event.data.customer, 'acme')
  assert.equal(event.data.requirement, 'yuyue')

  assert.equal(newTicketEvent({ parent, comments: [{ body: 'hi' }] }), null)
  assert.equal(
    newTicketEvent({ parent: { ...parent, labels: labels('状态:排队中') }, comments: [] }),
    null,
  )
})
