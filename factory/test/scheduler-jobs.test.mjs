import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { encodeTicketsPayload } from '../../backend/lib/protocol.mjs'
import { createGithub } from '../lib/github.mjs'
import { ensureLabel } from '../lib/issues.mjs'
import { createJobStore, findJob } from '../lib/job.mjs'
import {
  createDecompose,
  createFixTicket,
  createGapProposal,
  createListMergedYesterday,
  createNeedsAnswer,
  parseGateRows,
  ticketFromBranch,
} from '../lib/scheduler-jobs.mjs'
import { newTicketEvent, runOnce, STATE_LABELS } from '../lib/scheduler.mjs'
import { startFakeGithub } from './fake-github.mjs'

const NOW = new Date('2026-11-17T10:00:00')
const HEADER = 'ts\tphase\tdecision\twhy\tevidence\tresult'
const AGENTS_DIR = fileURLToPath(new URL('../agents/', import.meta.url))

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

function proposalTickets() {
  return [
    {
      title: '顾客打开链接能看到当天水果和卖完的',
      verticalSlice: '顾客打开链接，看到今天的水果、价格和卖完的。',
      acceptance: ['打开链接，看到当天水果的名单。'],
      blockedBy: [],
    },
  ]
}

function proposalBody(tickets = proposalTickets()) {
  return `提案：拆票\n\n共 1 张票。\n\n${encodeTicketsPayload(tickets)}`
}

function commentsGh(comments, { children = [] } = {}) {
  const gh = {
    calls: 0,
    createdComments: [],
    children,
    async listComments() {
      gh.calls += 1
      return comments
    },
    async listSubIssues() {
      return gh.children
    },
    async createComment({ number, body }) {
      const row = { number, body }
      gh.createdComments.push(row)
      return { id: gh.createdComments.length, ...row }
    },
  }
  return gh
}

function okRunner(calls = []) {
  return {
    async run(options) {
      calls.push(options)
      return { ok: true, code: 0, stdout: '' }
    },
  }
}

test('createDecompose 已有提案或点头时不重复跑，AFK_DECOMPOSE_SKIP 可关', async () => {
  const calls = []
  const runner = okRunner(calls)
  const proposal = proposalBody()
  const parent = {
    number: 42,
    title: '要个预约取货',
    body: '## 验收条件\n\n- [ ] 打开首页能看到入口。',
    comments: [{ body: proposal }],
  }
  const spec = { number: 60, title: 'spec yuyue', body: '用户故事' }
  const gh = commentsGh([{ body: proposal }])

  const decompose = createDecompose({ runner, gh })
  const skipped = await decompose({ owner: 'acme', repo: 'demo', parent, spec })
  assert.equal(skipped.skipped, 'already-proposed')
  assert.equal(calls.length, 0)

  const forced = createDecompose({ runner, skip: false, gh })
  const ran = await forced({ owner: 'acme', repo: 'demo', parent, spec })
  assert.equal(ran.ok, true)
  assert.equal(calls.length, 1)
  assert.match(calls[0].brief, /提案：拆票/)
  assert.match(calls[0].brief, /用户故事/)
  assert.match(calls[0].brief, /父工单：#42/)
  assert.match(calls[0].brief, /bin\/tickets\.mjs/)
  assert.match(calls[0].allowedTools, /Bash\(node:\*\)/)
})

test('createDecompose 的 brief 不含建票命令，写清提案阶段禁止建票', async () => {
  const calls = []
  const runner = okRunner(calls)
  const gh = commentsGh([{ body: proposalBody() }])
  const parent = { number: 42, title: '要个预约取货', body: '', comments: [] }

  const result = await createDecompose({ runner, gh })({
    owner: 'acme',
    repo: 'demo',
    parent,
    spec: null,
  })

  assert.equal(result.ok, true)
  const brief = calls[0].brief
  assert.ok(!brief.includes('--from-proposal'), 'brief 不应带建票参数')
  assert.ok(!brief.includes('tickets.mjs create'), 'brief 不应带建票命令')
  assert.match(brief, /不建任何子票/)
  assert.match(brief, /不要运行/)
})

test('createDecompose 发现 agent 在提案阶段建了子票时判失败，并在父工单写说明评论', async () => {
  const parent = { number: 42, title: '要个预约取货', body: '', comments: [] }
  const gh = commentsGh([{ body: proposalBody() }])
  let reads = 0
  gh.listSubIssues = async () => {
    reads += 1
    return reads === 1 ? [] : [{ number: 8 }, { number: 9 }]
  }
  const runner = {
    async run() {
      return { ok: true, code: 0, stdout: '' }
    },
  }

  const result = await createDecompose({ runner, gh })({
    owner: 'acme',
    repo: 'demo',
    parent,
    spec: null,
  })

  assert.equal(result.ok, false)
  assert.deepEqual(result.created, [8, 9])
  assert.match(result.reason, /#8/)
  assert.match(result.reason, /#9/)
  assert.match(result.reason, /提案阶段只出评论/)
  assert.match(result.reason, /只关闭不够/)
  assert.match(result.reason, /--remove-sub-issue 8,9/, 'reason 里给可复制的移除命令')
  assert.match(result.reason, /gh issue edit 42 --repo acme\/demo/, '命令带父工单号和仓库')
  assert.equal(gh.createdComments.length, 1)
  assert.equal(gh.createdComments[0].number, 42)
  assert.match(gh.createdComments[0].body, /#8/)
  assert.match(gh.createdComments[0].body, /只关闭不够/)
  assert.match(
    gh.createdComments[0].body,
    /gh issue edit 42 --repo acme\/demo --remove-sub-issue 8,9/,
    '评论里给可复制的移除命令',
  )
})

test('createDecompose 在 agent 失败但建了子票时仍按建子票判失败', async () => {
  const parent = { number: 42, title: '要个预约取货', body: '', comments: [] }
  const gh = commentsGh([{ body: proposalBody() }])
  let reads = 0
  gh.listSubIssues = async () => {
    reads += 1
    return reads === 1 ? [] : [{ number: 8 }]
  }
  const runner = {
    async run() {
      return { ok: false, code: 1, stderr: '配额用完' }
    },
  }

  const result = await createDecompose({ runner, gh })({
    owner: 'acme',
    repo: 'demo',
    parent,
    spec: null,
  })

  assert.equal(result.ok, false)
  assert.deepEqual(result.created, [8])
  assert.match(result.reason, /#8/)
  assert.equal(gh.createdComments.length, 1)
})

test('createDecompose 正常跑完子票数保持 0，跑 agent 前后各读一次子票', async () => {
  const parent = { number: 42, title: '要个预约取货', body: '', comments: [] }
  const gh = commentsGh([{ body: proposalBody() }])
  let reads = 0
  gh.listSubIssues = async () => {
    reads += 1
    return []
  }

  const result = await createDecompose({ runner: okRunner(), gh })({
    owner: 'acme',
    repo: 'demo',
    parent,
    spec: null,
  })

  assert.equal(result.ok, true)
  assert.equal(result.ticketCount, 1)
  assert.equal(reads, 2)
  assert.equal(gh.createdComments.length, 0)
})

test('createDecompose 成功后校验最新提案，票单能解析才 ok', async () => {
  const runner = okRunner()
  const gh = commentsGh([
    { body: '驳回：拆票 再拆一次' },
    { body: proposalBody() },
  ])
  const parent = { number: 42, title: '要个预约取货', body: '', comments: [] }

  const result = await createDecompose({ runner, gh })({
    owner: 'acme',
    repo: 'demo',
    parent,
    spec: null,
  })

  assert.equal(result.ok, true)
  assert.equal(result.ticketCount, 1)
  assert.equal(gh.calls, 1)
})

test('createDecompose 提案缺票单 marker 判失败，不写成功', async () => {
  const runner = okRunner()
  const gh = commentsGh([{ body: '提案：拆票\n\n- 顾客打开链接能看到当天水果和卖完的' }])
  const parent = { number: 42, title: '要个预约取货', body: '', comments: [] }

  const result = await createDecompose({ runner, gh })({
    owner: 'acme',
    repo: 'demo',
    parent,
    spec: null,
  })

  assert.equal(result.ok, false)
  assert.match(result.reason, /票单/)
})

test('createDecompose 票单 marker 解不开也判失败', async () => {
  const runner = okRunner()
  const gh = commentsGh([{ body: '提案：拆票\n\n<!-- factory:tickets 不是JSON -->' }])
  const parent = { number: 42, title: '要个预约取货', body: '', comments: [] }

  const result = await createDecompose({ runner, gh })({
    owner: 'acme',
    repo: 'demo',
    parent,
    spec: null,
  })

  assert.equal(result.ok, false)
  assert.match(result.reason, /票单/)
})

test('createDecompose 跑完最新关口不是提案：拆票也判失败', async () => {
  const runner = okRunner()
  const gh = commentsGh([{ body: proposalBody() }, { body: '驳回：拆票 理由' }])
  const parent = { number: 42, title: '要个预约取货', body: '', comments: [] }

  const result = await createDecompose({ runner, gh })({
    owner: 'acme',
    repo: 'demo',
    parent,
    spec: null,
  })

  assert.equal(result.ok, false)
  assert.match(result.reason, /提案：拆票/)
})

test('createDecompose 没接 GitHub 客户端时判失败，不假成功', async () => {
  const runner = okRunner()
  const parent = { number: 42, title: '要个预约取货', body: '', comments: [] }

  const result = await createDecompose({ runner, skip: false })({
    owner: 'acme',
    repo: 'demo',
    parent,
    spec: null,
  })

  assert.equal(result.ok, false)
  assert.match(result.reason, /GitHub/)
})

test('createDecompose 已有提案但父工单已有子票时判失败，不当作已提案跳过', async () => {
  const calls = []
  const runner = okRunner(calls)
  const parent = {
    number: 42,
    title: '要个预约取货',
    body: '',
    comments: [{ body: proposalBody() }],
  }
  const gh = commentsGh([], { children: [{ number: 8 }] })

  const result = await createDecompose({ runner, gh })({
    owner: 'acme',
    repo: 'demo',
    parent,
    spec: null,
  })

  assert.equal(result.ok, false)
  assert.equal(result.skipped, null)
  assert.match(result.reason, /#8/)
  assert.match(result.reason, /只关闭不够/, 'skip 分支也写清只关闭不清关联')
  assert.match(result.reason, /--remove-sub-issue 8/, 'skip 分支给可复制的移除命令')
  assert.match(result.reason, /gh issue edit 42 --repo acme\/demo/)
  assert.equal(calls.length, 0, '已有子票时不再跑 agent')
})

test('createDecompose 的 GitHub 客户端不支持 listSubIssues 时判失败，不假成功', async () => {
  const runner = okRunner()
  const gh = {
    async listComments() {
      return [{ body: proposalBody() }]
    },
  }
  const parent = { number: 42, title: '要个预约取货', body: '', comments: [] }

  const result = await createDecompose({ runner, gh })({
    owner: 'acme',
    repo: 'demo',
    parent,
    spec: null,
  })

  assert.equal(result.ok, false)
  assert.match(result.reason, /listSubIssues/)
})

test('createDecompose 写说明评论失败时仍判失败，不吞掉子票号', async () => {
  const parent = { number: 42, title: '要个预约取货', body: '', comments: [] }
  const gh = commentsGh([{ body: proposalBody() }])
  let reads = 0
  gh.listSubIssues = async () => {
    reads += 1
    return reads === 1 ? [] : [{ number: 8 }]
  }
  gh.createComment = async () => {
    throw new Error('评论写不进去')
  }

  const result = await createDecompose({ runner: okRunner(), gh })({
    owner: 'acme',
    repo: 'demo',
    parent,
    spec: null,
  })

  assert.equal(result.ok, false)
  assert.equal(result.created.includes(8), true)
  assert.match(result.reason, /#8/)
  assert.match(result.reason, /评论写不进去/)
})

test('createDecompose 已有点头：拆票时直接跳过，不再校验提案', async () => {
  const calls = []
  const runner = okRunner(calls)
  const parent = {
    number: 42,
    title: '要个预约取货',
    body: '',
    comments: [
      { body: '提案：拆票\n\n- 没有机器可读的票单。' },
      { body: '点头：拆票\n\n建了 1 张子票。' },
    ],
  }

  const result = await createDecompose({ runner, gh: commentsGh([]) })({
    owner: 'acme',
    repo: 'demo',
    parent,
    spec: null,
  })

  assert.equal(result.skipped, 'already-proposed')
  assert.equal(calls.length, 0)
})

test('createDecompose 已有坏提案时不跳过，重跑一次', async () => {
  const calls = []
  const runner = okRunner(calls)
  const parent = {
    number: 42,
    title: '要个预约取货',
    body: '',
    comments: [{ body: '提案：拆票\n\n- 没有机器可读的票单。' }],
  }
  const gh = commentsGh([{ body: proposalBody() }])

  const result = await createDecompose({ runner, gh })({
    owner: 'acme',
    repo: 'demo',
    parent,
    spec: null,
  })

  assert.equal(calls.length, 1, '坏提案要重跑一次 agent')
  assert.equal(result.ok, true)
})

test('createGapProposal 跑补缺口 agent：brief 带绝对路径和两条命令，stdout/stderr 进日志', async () => {
  const calls = []
  const logs = []
  const runner = {
    async run(options) {
      calls.push(options)
      return { ok: true, code: 0, stdout: 'MAP-OK', stderr: 'WARN-LINE' }
    },
  }
  const parent = { number: 42, title: '要个预约取货', body: '' }
  const gapProposal = createGapProposal({
    runner,
    agentsDir: AGENTS_DIR,
    log: (row) => logs.push(row),
  })

  const result = await gapProposal({ owner: 'acme', repo: 'demo', parent })

  assert.equal(result.ok, true)
  assert.equal(result.stdout, 'MAP-OK')
  assert.equal(result.stderr, 'WARN-LINE')
  assert.equal(calls.length, 1)
  assert.match(calls[0].brief, /父工单：#42/)
  assert.match(calls[0].brief, /apply-map/)
  assert.match(calls[0].brief, /propose/)
  assert.match(calls[0].brief, /factory\/bin\/gap\.mjs/)
  assert.equal(logs.length, 1)
  assert.equal(logs[0].stdout, 'MAP-OK')
  assert.equal(logs[0].stderr, 'WARN-LINE')
})

test('createGapProposal 失败返回 ok:false，并保留 stderr', async () => {
  const runner = {
    async run() {
      return { ok: false, code: 1, stdout: '', stderr: '地图缺 Not yet specified' }
    },
  }
  const gapProposal = createGapProposal({
    runner,
    agentsDir: AGENTS_DIR,
    log: () => {},
  })

  const result = await gapProposal({
    owner: 'acme',
    repo: 'demo',
    parent: { number: 42, title: '要个预约取货', body: '' },
  })

  assert.equal(result.ok, false)
  assert.equal(result.code, 1)
  assert.match(result.stderr, /Not yet specified/)
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
  assert.equal(event.key, 'acme/demo:#42:新单进队列')
  assert.equal(event.data.customer, 'acme')
  assert.equal(event.data.requirement, 'yuyue')

  assert.equal(newTicketEvent({ parent, comments: [{ body: 'hi' }] }), null)
  assert.equal(
    newTicketEvent({ parent: { ...parent, labels: labels('状态:排队中') }, comments: [] }),
    null,
  )
})

test('createGapProposal 失败接上调度器：写 needs-info stop，下一轮不再跑', async (t) => {
  const fake = await startFakeGithub({ repos: [{ owner: 'acme', name: 'acme-demo' }] })
  t.after(() => fake.close())
  const gh = createGithub({ apiBase: fake.base, token: 'test' })
  for (const [name, meta] of Object.entries(STATE_LABELS)) {
    await ensureLabel(gh, { owner: 'acme', repo: 'acme-demo', name, ...meta })
  }
  for (const name of ['needs-info', 'Sandcastle', '大小:小需求', 'ready-for-agent', 'wayfinder:map', 'wayfinder:grilling']) {
    await ensureLabel(gh, { owner: 'acme', repo: 'acme-demo', name })
  }
  const parent = await gh.createIssue({
    owner: 'acme',
    repo: 'acme-demo',
    title: '要个预约取货',
    body: '- 客户简称：acme\n- 需求名：yuyue-quhuo\n\n<!-- factory:order=o-0001 -->',
    labels: ['状态:已提交'],
  })
  let runs = 0
  const gapProposal = createGapProposal({
    runner: {
      async run() {
        runs += 1
        return { ok: false, code: 1, stdout: '', stderr: '403 没权限' }
      },
    },
    agentsDir: AGENTS_DIR,
    log: () => {},
  })
  const dir = await mkdtemp(join(tmpdir(), 'afk-jobs-integration-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const jobs = createJobStore({ filePath: join(dir, 'jobs.json') })
  await jobs.load()
  const options = {
    gh,
    customers: [{ id: 'c-0001', short_name: 'acme', status: 'active', repos: { demo: 'acme-demo' } }],
    notifier: { async send() { return { code: 0 } } },
    gapProposal,
    clock: () => NOW,
    config: { owner: 'acme', maxActive: 5, lockDir: dir, jobs },
  }

  await runOnce(options)
  const row = findJob(jobs.rowsFor({ owner: 'acme', repo: 'acme-demo', parent: parent.number }), {
    action: 'needs-info',
  })
  assert.equal(row.stop, 'needs-info')
  assert.match(row.reason, /403 没权限/)

  await runOnce(options)
  assert.equal(runs, 1, '停了线就不重跑补缺口')
})
