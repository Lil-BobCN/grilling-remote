import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createGithub } from '../lib/github.mjs'
import {
  createTickets,
  frontier,
  parseParentAcceptance,
  parseTicketsPayload,
  renderPoint,
  renderProposal,
  validateTickets,
} from '../lib/tickets.mjs'
import { run } from '../bin/tickets.mjs'
import { startFakeGithub } from './fake-github.mjs'

const PARENT_BODY = `## 客户原话

> 「顾客想在线看水果，下单」

日期：2026-11-07

## 客户确认的结论

- 顾客打开链接看货。

## 验收条件

- [ ] 打开链接，看到当天水果的名单。
- [ ] 卖完的水果标出来，不能下单。
- [ ] 下单时选到店取，挑一个取货时间。
- [ ] 下单成功后看到订单号和取货地址。

## 不做清单

- 不做在线支付
`

test('parseParentAcceptance 读父工单验收条件，去掉复选框', () => {
  assert.deepEqual(parseParentAcceptance(PARENT_BODY), [
    '打开链接，看到当天水果的名单。',
    '卖完的水果标出来，不能下单。',
    '下单时选到店取，挑一个取货时间。',
    '下单成功后看到订单号和取货地址。',
  ])
})

function ticket(overrides = {}) {
  return {
    title: '顾客打开链接能看到当天水果和卖完的',
    verticalSlice: '顾客打开链接，看到今天的水果、价格和卖完的。',
    acceptance: ['打开链接，看到当天水果的名单。', '卖完的水果标出来，不能下单。'],
    blockedBy: [],
    ...overrides,
  }
}

test('validateTickets 接受来自父工单的验收条件', () => {
  const parentAcceptance = parseParentAcceptance(PARENT_BODY)
  assert.doesNotThrow(() => validateTickets({ tickets: [ticket()], parentAcceptance }))
})

test('validateTickets 拒绝父工单里没有的验收条件，并指出是哪条', () => {
  const parentAcceptance = parseParentAcceptance(PARENT_BODY)
  assert.throws(
    () =>
      validateTickets({
        tickets: [ticket({ acceptance: ['打开链接，看到当天水果的名单。', '顾客能在线支付。'] })],
        parentAcceptance,
      }),
    (error) =>
      error.code === 'acceptance_not_from_parent' &&
      error.message.includes('顾客能在线支付。') &&
      error.details.acceptance === '顾客能在线支付。',
  )
})

test('validateTickets 拒绝重复标题', () => {
  const parentAcceptance = parseParentAcceptance(PARENT_BODY)
  assert.throws(
    () => validateTickets({ tickets: [ticket(), ticket()], parentAcceptance }),
    (error) => error.code === 'duplicate_title' && error.message.includes(ticket().title),
  )
})

test('validateTickets 拒绝引用本批之外的阻塞票', () => {
  const parentAcceptance = parseParentAcceptance(PARENT_BODY)
  assert.throws(
    () =>
      validateTickets({
        tickets: [ticket(), ticket({ title: '顾客下单时能选到店取', blockedBy: [5] })],
        parentAcceptance,
      }),
    (error) => error.code === 'unknown_blocker' && error.message.includes('5'),
  )
  assert.throws(
    () =>
      validateTickets({
        tickets: [ticket(), ticket({ title: '顾客下单时能选到店取', blockedBy: ['不存在的票'] })],
        parentAcceptance,
      }),
    (error) => error.code === 'unknown_blocker' && error.message.includes('不存在的票'),
  )
})

test('validateTickets 拒绝空验收条件和缺失字段', () => {
  const parentAcceptance = parseParentAcceptance(PARENT_BODY)
  assert.throws(
    () => validateTickets({ tickets: [ticket({ acceptance: [] })], parentAcceptance }),
    (error) => error.code === 'acceptance_empty',
  )
  assert.throws(
    () => validateTickets({ tickets: [ticket({ verticalSlice: '  ' })], parentAcceptance }),
    (error) => error.code === 'missing_vertical_slice',
  )
  assert.throws(
    () => validateTickets({ tickets: [ticket({ blockedBy: undefined })], parentAcceptance }),
    (error) => error.code === 'blocked_by_not_array',
  )
})

test('validateTickets 拒绝给子票加 ready-for-agent、Sandcastle、大小:小需求', () => {
  const parentAcceptance = parseParentAcceptance(PARENT_BODY)
  for (const forbidden of ['ready-for-agent', 'Sandcastle', '大小:小需求']) {
    assert.throws(
      () =>
        validateTickets({
          tickets: [ticket({ labels: [forbidden] })],
          parentAcceptance,
        }),
      (error) => error.code === 'forbidden_label' && error.message.includes(forbidden),
    )
  }
})

async function startShop(t, { issues = [] } = {}) {
  const fake = await startFakeGithub({
    repos: [{ owner: 'acme', name: 'acme-shop' }],
    issues: [{ title: '父工单', body: PARENT_BODY, labels: ['状态:排队中'], ...issues[0] }, ...issues.slice(1)],
  })
  t.after(() => fake.close())
  const gh = createGithub({ apiBase: fake.base, token: 'test' })
  return { fake, gh, store: fake.state.issues.get('acme/acme-shop') }
}

function threeTickets() {
  return [
    ticket(),
    ticket({
      title: '顾客下单时能选到店取',
      verticalSlice: '顾客下单时能选到店取，挑一个取货时间。',
      acceptance: ['下单时选到店取，挑一个取货时间。'],
      blockedBy: [0],
    }),
    ticket({
      title: '下单成功看到订单号和取货地址',
      verticalSlice: '顾客下单成功，看到订单号和取货地址。',
      acceptance: ['下单成功后看到订单号和取货地址。'],
      blockedBy: ['顾客下单时能选到店取'],
    }),
  ]
}

test('renderProposal 一行一张票，提案阶段不建子票', async (t) => {
  const { fake } = await startShop(t)
  const body = renderProposal({
    seams: ['打开链接的页面', '下单接口'],
    tickets: threeTickets(),
  })

  const lines = body.split('\n')
  assert.equal(lines[0], '提案：拆票')
  assert.match(body, /## 接缝/)
  assert.match(body, /打开链接的页面/)
  assert.match(body, /## 票单/)
  assert.match(body, /共 3 张票/)

  const ticketLines = lines.filter((line) => /^- \d+\. /.test(line))
  assert.equal(ticketLines.length, 3)
  assert.match(ticketLines[0], /^- 1\. 顾客打开链接能看到当天水果和卖完的/)
  assert.match(ticketLines[0], /打开链接，看到当天水果的名单。/)
  assert.match(ticketLines[1], /^- 2\. 顾客下单时能选到店取/)
  assert.match(ticketLines[2], /^- 3\. 下单成功看到订单号和取货地址/)

  assert.equal(fake.state.issues.get('acme/acme-shop').length, 1, '提案阶段只有父工单')
})

test('renderProposal 末尾带隐藏票单 JSON，parseTicketsPayload 能读回', () => {
  const tickets = threeTickets()
  const body = renderProposal({ seams: ['打开链接的页面'], tickets })

  const lines = body.trimEnd().split('\n')
  assert.match(lines.at(-1), /^<!-- factory:tickets [A-Za-z0-9_-]+ -->$/)
  assert.deepEqual(parseTicketsPayload(body), tickets)
  assert.equal(parseTicketsPayload('提案：拆票\n\n没有票单'), null)
})

test('renderPoint 第一行是点头：拆票，写明建了几张', () => {
  const body = renderPoint({ count: 3 })
  assert.equal(body.split('\n')[0], '点头：拆票')
  assert.match(body, /3 张子票/)
})

function blockedNumbersFromBody(body) {
  const match = /^Blocked by:\s*(.+)$/m.exec(body || '')
  if (!match) return []
  return [...match[1].matchAll(/#(\d+)/g)].map((item) => Number(item[1]))
}

test('点头后建三张子票：只挂排队中、挂父工单、原生依赖、正文三段', async (t) => {
  const { fake, gh, store } = await startShop(t)
  const result = await createTickets({
    gh,
    owner: 'acme',
    repo: 'acme-shop',
    parent: 1,
    tickets: threeTickets(),
  })

  assert.deepEqual(result.tickets.map((row) => row.created), [true, true, true])
  assert.deepEqual(result.tickets.map((row) => row.number), [2, 3, 4])

  const parent = store[0]
  const children = store.slice(1)
  assert.equal(children.length, 3)
  assert.deepEqual(children.map((row) => row.title), [
    '顾客打开链接能看到当天水果和卖完的',
    '顾客下单时能选到店取',
    '下单成功看到订单号和取货地址',
  ])
  for (const child of children) assert.deepEqual(child.labels, ['状态:排队中'])
  assert.deepEqual(parent.labels, ['状态:排队中'])
  assert.deepEqual([...parent.subIssues].sort(), children.map((row) => row.id).sort())

  const [first, second, third] = children
  assert.equal(
    first.body,
    [
      '## 垂直切片',
      '',
      '顾客打开链接，看到今天的水果、价格和卖完的。',
      '',
      '## 验收条件',
      '',
      '- [ ] 打开链接，看到当天水果的名单。',
      '- [ ] 卖完的水果标出来，不能下单。',
    ].join('\n'),
  )
  assert.equal(
    second.body,
    [
      '## 垂直切片',
      '',
      '顾客下单时能选到店取，挑一个取货时间。',
      '',
      '## 验收条件',
      '',
      '- [ ] 下单时选到店取，挑一个取货时间。',
      '',
      '## 阻塞',
      '',
      `Blocked by: #${first.number}`,
    ].join('\n'),
  )
  assert.equal(
    third.body.split('\n').at(-1),
    `Blocked by: #${second.number}`,
  )

  assert.deepEqual(first.blockedBy, [])
  assert.deepEqual(second.blockedBy, [first.id])
  assert.deepEqual(third.blockedBy, [second.id])
  assert.deepEqual(blockedNumbersFromBody(second.body), [first.number])
  assert.deepEqual(blockedNumbersFromBody(third.body), [second.number])

  const labels = fake.state.repos.get('acme/acme-shop').labels
  assert.equal(labels.get('状态:排队中').color, 'fbca04')
})

test('验收条件不在父工单时拒绝建票，且一张也不建', async (t) => {
  const { fake, gh, store } = await startShop(t)
  const tickets = threeTickets()
  tickets[0].acceptance = ['打开链接，看到当天水果的名单。', '顾客能在线支付。']

  await assert.rejects(
    createTickets({ gh, owner: 'acme', repo: 'acme-shop', parent: 1, tickets }),
    (error) =>
      error.code === 'acceptance_not_from_parent' && error.message.includes('顾客能在线支付。'),
  )

  assert.equal(store.length, 1, '只有父工单')
  assert.equal(store[0].subIssues.length, 0)
  assert.equal(fake.state.repos.get('acme/acme-shop').labels.has('状态:排队中'), false)
})

test('重跑按标题复用子票，更新正文，阻塞边不重复', async (t) => {
  const { fake, gh, store } = await startShop(t)
  const tickets = threeTickets()
  const first = await createTickets({ gh, owner: 'acme', repo: 'acme-shop', parent: 1, tickets })
  const second = await createTickets({ gh, owner: 'acme', repo: 'acme-shop', parent: 1, tickets })

  assert.deepEqual(second.tickets.map((row) => row.created), [false, false, false])
  assert.deepEqual(
    second.tickets.map((row) => row.number),
    first.tickets.map((row) => row.number),
  )
  assert.equal(store.length, 4, '父工单加三张子票')
  assert.equal(store[0].subIssues.length, 3)
  assert.equal(store[2].blockedBy.length, 1)
  assert.equal(store[3].blockedBy.length, 1)

  const posts = fake.state.requests.filter(
    (row) => row.method === 'POST' && row.path.endsWith('/issues'),
  )
  assert.equal(posts.length, 3, '第二次不再建票')

  tickets[0].verticalSlice = '顾客打开链接，先看到价格。'
  const third = await createTickets({ gh, owner: 'acme', repo: 'acme-shop', parent: 1, tickets })
  assert.deepEqual(third.tickets.map((row) => row.created), [false, false, false])
  assert.match(store[1].body, /顾客打开链接，先看到价格。/)
})

test('frontier 只返回没有未关闭阻塞的票，正文和原生边一致', async (t) => {
  const { gh, store } = await startShop(t)
  await createTickets({ gh, owner: 'acme', repo: 'acme-shop', parent: 1, tickets: threeTickets() })

  const byId = new Map(store.map((row) => [row.id, row]))
  const rows = store.slice(1)
  for (const row of rows) {
    assert.deepEqual(
      blockedNumbersFromBody(row.body),
      row.blockedBy.map((id) => byId.get(id).number),
    )
  }

  const tasks = rows.map((row) => ({
    title: row.title,
    number: row.number,
    blockedBy: row.blockedBy.map((id) => byId.get(id).number),
  }))
  const titles = (closed) =>
    frontier({
      tickets: tasks.filter((row) => !closed.includes(row.number)),
      closedNumbers: closed,
    }).map((row) => row.title)

  assert.deepEqual(titles([]), ['顾客打开链接能看到当天水果和卖完的'])
  assert.deepEqual(titles([rows[0].number]), ['顾客下单时能选到店取'])
  assert.deepEqual(titles([rows[0].number, rows[1].number]), ['下单成功看到订单号和取货地址'])
})

test('CLI proposal、point、create 三个命令', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'afk-tickets-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const seamsFile = join(dir, 'seams.txt')
  await writeFile(seamsFile, '打开链接的页面\n下单接口\n', 'utf8')
  const ticketsFile = join(dir, 'tickets.json')
  await writeFile(ticketsFile, `${JSON.stringify(threeTickets(), null, 2)}\n`, 'utf8')

  const out = []
  await run(['proposal', '--seams', seamsFile, '--tickets', ticketsFile], {
    out: (text) => out.push(text),
  })
  const proposal = out.join('\n')
  assert.equal(proposal.split('\n')[0], '提案：拆票')
  assert.equal(proposal.split('\n').filter((line) => /^- \d+\. /.test(line)).length, 3)
  assert.match(proposal, /打开链接的页面/)

  const pointOut = []
  await run(['point', '--count', '3'], { out: (text) => pointOut.push(text) })
  assert.equal(pointOut.join('\n').split('\n')[0], '点头：拆票')
  assert.match(pointOut.join('\n'), /3 张子票/)

  const { gh, store } = await startShop(t)
  const created = await run(
    ['create', '--owner', 'acme', '--repo', 'acme-shop', '--parent', '1', '--tickets', ticketsFile],
    { gh, out: (text) => out.push(text) },
  )
  assert.equal(created.tickets.length, 3)
  assert.equal(store.length, 4)
})

test('CLI create --from-proposal 读提案票单，建票成功才写点头：拆票', async (t) => {
  const { gh, store } = await startShop(t)
  await gh.createComment({
    owner: 'acme',
    repo: 'acme-shop',
    number: 1,
    body: renderProposal({ seams: ['打开链接的页面'], tickets: threeTickets() }),
  })

  const created = await run(
    [
      'create',
      '--owner',
      'acme',
      '--repo',
      'acme-shop',
      '--parent',
      '1',
      '--from-proposal',
      '--point',
    ],
    { gh, out: () => {} },
  )

  assert.equal(created.tickets.length, 3)
  assert.equal(store.length, 4)
  const comments = store[0].comments.map((comment) => comment.body)
  assert.ok(comments.some((body) => body.startsWith('点头：拆票')))
  assert.ok(comments.some((body) => body.includes('建了 3 张子票')))

  // 重跑同一份提案：按标题复用，不建第二套，也不跳过点头。
  const again = await run(
    [
      'create',
      '--owner',
      'acme',
      '--repo',
      'acme-shop',
      '--parent',
      '1',
      '--from-proposal',
      '--point',
    ],
    { gh, out: () => {} },
  )
  assert.equal(again.tickets.length, 3)
  assert.equal(store.length, 4)
})

test('CLI create --from-proposal 建票失败时不写点头：拆票', async (t) => {
  const { gh, store } = await startShop(t)
  await gh.createComment({
    owner: 'acme',
    repo: 'acme-shop',
    number: 1,
    body: '提案：拆票\n\n没有机器可读的票单。',
  })

  await assert.rejects(
    run(
      [
        'create',
        '--owner',
        'acme',
        '--repo',
        'acme-shop',
        '--parent',
        '1',
        '--from-proposal',
        '--point',
      ],
      { gh, out: () => {} },
    ),
    /票单/,
  )

  assert.equal(store.length, 1)
  assert.ok(!store[0].comments.some((comment) => comment.body.startsWith('点头：拆票')))
})
