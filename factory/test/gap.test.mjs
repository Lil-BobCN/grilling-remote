import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  draftProposal,
  GateConflictError,
  GateNotReadyError,
  gateReady,
  postPoint,
  postProposal,
  renderPoint,
} from '../lib/gap.mjs'
import { createGithub } from '../lib/github.mjs'
import { ensureMapIssues, parseMap, readDecisionTickets } from '../lib/map-issues.mjs'
import { startFakeGithub } from './fake-github.mjs'

const FIXTURE = fileURLToPath(
  new URL('../../docs/回传样例/工作区/.scratch/xianguopu/', import.meta.url),
)

const PARENT_BODY = `## 客户原话

> 「顾客想在我的微信小程序里看今天有什么水果，下单，选到店取还是送货。」

日期：2026-11-08

## 客户确认的结论

- 店里贴二维码

## 验收条件

- [ ] 顾客扫码进小程序，看到当天水果的名单。

## 不做清单

- 无

## 需求全文

- 客户简称：acme
- 需求名：xianguopu
- 全文：https://github.com/acme/acme-shuiguo/tree/main/docs/requirements/xianguopu/
`

const PENDING = `# 技术题

## 1 小程序用哪家云

- 题目原文：做成小程序还是网页，放哪家云？
- 选项：微信云开发 / 自建服务器
- 推荐答案：微信云开发
- 标签：客户不懂

## 2 数据库放哪

- 题目原文：数据存在哪里？
- 推荐答案：用云开发自带的数据库
- 标签：客户不懂

## 3 后台能不能用手机浏览器

- 题目原文：后台用手机浏览器打开行不行？
- 推荐答案：行，先做手机网页
- 标签：待核实

## 4 微信通知怎么发

- 题目原文：取货通知怎么到顾客微信？
- 推荐答案：用小程序订阅消息
- 标签：客户不懂

## 5 要不要接在线支付

- 题目原文：这次要不要接微信支付？
- 推荐答案：不接，送货的微信转账
- 标签：你答
`

async function copyFixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'gap-gap-'))
  await cp(FIXTURE, dir, { recursive: true })
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

async function githubSetup(t) {
  const fake = await startFakeGithub({
    repos: [{ owner: 'acme', name: 'acme-shuiguo' }],
    issues: [{ owner: 'acme', repo: 'acme-shuiguo', title: '我想要一个卖水果的小程序', body: PARENT_BODY }],
  })
  t.after(() => fake.close())
  const gh = createGithub({ apiBase: fake.base, token: 'test' })
  const parent = await gh.getIssue({ owner: 'acme', repo: 'acme-shuiguo', number: 1 })
  const result = await ensureMapIssues({
    gh,
    owner: 'acme',
    repo: 'acme-shuiguo',
    requirement: 'xianguopu',
    scratchDir: FIXTURE,
    parentIssueUrl: parent.html_url,
  })
  return { fake, gh, parent, mapIssue: result.mapIssue }
}

test('gateReady：Not yet specified 非空或开放决定票未关时不放行', async (t) => {
  const { gh, mapIssue } = await githubSetup(t)
  let mapBody = (await gh.getIssue({ owner: 'acme', repo: 'acme-shuiguo', number: mapIssue.number })).body

  mapBody = mapBody.replace(
    '## Not yet specified\n\n## Out of scope',
    '## Not yet specified\n\n- 送货范围怎么定\n\n## Out of scope',
  )
  await gh.updateIssue({ owner: 'acme', repo: 'acme-shuiguo', number: mapIssue.number, body: mapBody })

  const withFog = await gateReady({
    gh,
    owner: 'acme',
    repo: 'acme-shuiguo',
    mapIssueNumber: mapIssue.number,
    mapBody,
  })
  assert.equal(withFog.ready, false)
  assert.ok(withFog.blockers.some((row) => row.kind === 'not-yet-specified'))

  const cleanBody = mapBody.replace('- 送货范围怎么定\n\n', '')
  const openTickets = await gateReady({
    gh,
    owner: 'acme',
    repo: 'acme-shuiguo',
    mapIssueNumber: mapIssue.number,
    mapBody: cleanBody,
  })
  assert.equal(openTickets.ready, false)
  assert.equal(openTickets.blockers.filter((row) => row.kind === 'open-ticket').length, 5)

  const children = await gh.listSubIssues({ owner: 'acme', repo: 'acme-shuiguo', number: mapIssue.number })
  for (const child of children) {
    await gh.closeIssue({ owner: 'acme', repo: 'acme-shuiguo', number: child.number })
  }
  const ready = await gateReady({
    gh,
    owner: 'acme',
    repo: 'acme-shuiguo',
    mapIssueNumber: mapIssue.number,
    mapBody: cleanBody,
  })
  assert.deepEqual(ready, { ready: true, blockers: [] })
})

test('draftProposal：列出 pending 的题和推荐，也列地图上「你答」和 claimed 的票', async (t) => {
  const scratch = await copyFixture(t)
  await writeFile(join(scratch, 'pending.md'), PENDING)

  const mapFile = join(scratch, 'map.md')
  await writeFile(
    mapFile,
    (await readFile(mapFile, 'utf8')).replace(
      '## Not yet specified\n\n## Out of scope',
      '## Not yet specified\n\n- 送货范围怎么定，超区怎么办（你答）\n\n## Out of scope',
    ),
  )
  const claimedFile = join(scratch, 'issues', '02-下单要不要先付钱.md')
  await writeFile(
    claimedFile,
    (await readFile(claimedFile, 'utf8')).replace('Status: resolved', 'Status: claimed'),
  )

  const map = parseMap(await readFile(mapFile, 'utf8'))
  const tickets = await readDecisionTickets(join(scratch, 'issues'))
  const proposal = await draftProposal({ scratchDir: scratch, map, tickets, mapUrl: 'https://example.test/issues/2' })

  const firstLine = proposal.body.split('\n')[0]
  assert.equal(firstLine, '提案：补缺口')
  assert.match(proposal.body, /地图已还原：https:\/\/example\.test\/issues\/2/)
  for (const [question, recommended] of [
    ['做成小程序还是网页，放哪家云？', '微信云开发'],
    ['数据存在哪里？', '用云开发自带的数据库'],
    ['后台用手机浏览器打开行不行？', '行，先做手机网页'],
    ['取货通知怎么到顾客微信？', '用小程序订阅消息'],
    ['这次要不要接微信支付？', '不接，送货的微信转账'],
  ]) {
    assert.ok(proposal.body.includes(question), question)
    assert.ok(proposal.body.includes(recommended), recommended)
  }
  assert.match(proposal.body, /pending\.md 1 小程序用哪家云/)
  assert.match(proposal.body, /送货范围怎么定，超区怎么办/)
  assert.match(proposal.body, /map\.md Not yet specified/)
  assert.match(proposal.body, /顾客下单时先付钱，还是取货时付？/)
  assert.match(proposal.body, /票 02 下单要不要先付钱/)
  assert.equal(proposal.questions.length, 7)
  assert.match(proposal.body, /## 闸门检查/)
  for (const check of ['技术栈', '部署到哪', '第三方服务与账号', '数据怎么存', '每月花多少', '合规', '接缝', '词汇表', '查重']) {
    assert.ok(proposal.body.includes(check), check)
  }

  const withRecommendations = await draftProposal({
    scratchDir: scratch,
    map,
    tickets,
    mapUrl: 'https://example.test/issues/2',
    recommendations: { '送货范围怎么定，超区怎么办': '只送镇上，超区自取' },
  })
  assert.match(withRecommendations.body, /推荐：只送镇上，超区自取/)
})

test('renderPoint 两段格式，正文影响为空写「无」', () => {
  const body = renderPoint({ answers: ['技术栈：Next.js + Postgres', '- 部署：香港服务器'], impacts: [] })
  assert.equal(body.split('\n')[0], '点头：补缺口')
  const [answers, impacts] = body.split('## 正文影响')
  assert.match(answers, /## 最终答案\n\n- 技术栈：Next\.js \+ Postgres\n- 部署：香港服务器/)
  assert.equal(impacts.trim(), '无')

  const changed = renderPoint({
    answers: ['第 4 题：作废'],
    impacts: ['「要在线支付」（客户确认的结论）：第 4 题作废，正文未改，以本条评论为准。'],
  })
  assert.match(changed, /## 正文影响\n\n- 「要在线支付」/)
})

async function gateSetup(t, comments = []) {
  const fake = await startFakeGithub({
    repos: [{ owner: 'acme', name: 'acme-shuiguo' }],
    issues: [{ owner: 'acme', repo: 'acme-shuiguo', title: '父工单', body: PARENT_BODY }],
  })
  t.after(() => fake.close())
  const gh = createGithub({ apiBase: fake.base, token: 'test' })
  const parent = await gh.getIssue({ owner: 'acme', repo: 'acme-shuiguo', number: 1 })
  for (const body of comments) {
    await gh.createComment({ owner: 'acme', repo: 'acme-shuiguo', number: parent.number, body })
  }
  return { gh, parent }
}

const PROPOSAL = '提案：补缺口\n\n1. 题：用什么技术栈？\n   推荐：Next.js'

test('postPoint：父工单还没有提案时拒绝写点头', async (t) => {
  const { gh, parent } = await gateSetup(t)
  await assert.rejects(
    postPoint({
      gh,
      owner: 'acme',
      repo: 'acme-shuiguo',
      number: parent.number,
      mapIssueNumber: 2,
      parentIssueUrl: parent.html_url,
      answers: ['技术栈：Next.js'],
    }),
    (error) => error instanceof GateConflictError && error.kind === null,
  )
})

test('postPoint：最新关口是改口：时拒绝，等新的提案', async (t) => {
  const { gh, parent } = await gateSetup(t, [
    PROPOSAL,
    '改口：重传 2026-11-24T10:00:00.000Z，旧的提案和点头作废。',
  ])
  await assert.rejects(
    postPoint({
      gh,
      owner: 'acme',
      repo: 'acme-shuiguo',
      number: parent.number,
      mapIssueNumber: 2,
      parentIssueUrl: parent.html_url,
      answers: ['技术栈：Next.js'],
    }),
    (error) => error instanceof GateConflictError && error.kind === '改口：',
  )
})

test('postPoint：最新是同一条点头时幂等返回，不重写', async (t) => {
  const point = renderPoint({ answers: ['技术栈：Next.js + Postgres'] })
  const { gh, parent } = await gateSetup(t, [PROPOSAL, point])

  const posted = await postPoint({
    gh,
    owner: 'acme',
    repo: 'acme-shuiguo',
    number: parent.number,
    parentIssueUrl: parent.html_url,
    answers: ['技术栈：Next.js + Postgres'],
    impacts: [],
  })
  assert.equal(posted, false)
  const comments = await gh.listComments({ owner: 'acme', repo: 'acme-shuiguo', number: parent.number })
  assert.equal(comments.filter((row) => row.body.startsWith('点头：补缺口')).length, 1)
})

test('postPoint：最新是另一条点头时拒绝，答案要先改口', async (t) => {
  const { gh, parent } = await gateSetup(t, [
    PROPOSAL,
    renderPoint({ answers: ['技术栈：Next.js + Postgres'] }),
  ])
  await assert.rejects(
    postPoint({
      gh,
      owner: 'acme',
      repo: 'acme-shuiguo',
      number: parent.number,
      mapIssueNumber: 2,
      parentIssueUrl: parent.html_url,
      answers: ['技术栈：Vue + MySQL'],
    }),
    (error) => error instanceof GateConflictError && error.kind === '点头：补缺口',
  )
})

test('postPoint：缺父工单链接时拒绝，不用空串跳过归属校验', async (t) => {
  const { gh, parent } = await gateSetup(t, [PROPOSAL])
  await assert.rejects(
    postPoint({
      gh,
      owner: 'acme',
      repo: 'acme-shuiguo',
      number: parent.number,
      mapIssueNumber: 2,
      answers: ['技术栈：Next.js'],
    }),
    /父工单链接/,
  )
})

test('postPoint：已经过拆票时拒绝', async (t) => {
  const { gh, parent } = await gateSetup(t, [PROPOSAL, '提案：拆票\n\n1. 建票'])
  await assert.rejects(
    postPoint({
      gh,
      owner: 'acme',
      repo: 'acme-shuiguo',
      number: parent.number,
      mapIssueNumber: 2,
      parentIssueUrl: parent.html_url,
      answers: ['技术栈：Next.js'],
    }),
    (error) => error instanceof GateConflictError && error.kind === '提案：拆票',
  )
})

test('postPoint 未就绪时拒绝并只留一条提醒，补完后才写点头', async (t) => {
  const { gh, parent, mapIssue } = await githubSetup(t)
  await gh.createComment({
    owner: 'acme',
    repo: 'acme-shuiguo',
    number: parent.number,
    body: PROPOSAL,
  })
  const parentBefore = (await gh.getIssue({ owner: 'acme', repo: 'acme-shuiguo', number: parent.number })).body
  let mapBody = (await gh.getIssue({ owner: 'acme', repo: 'acme-shuiguo', number: mapIssue.number })).body
  mapBody = mapBody.replace(
    '## Not yet specified\n\n## Out of scope',
    '## Not yet specified\n\n- 送货范围怎么定\n\n## Out of scope',
  )
  await gh.updateIssue({ owner: 'acme', repo: 'acme-shuiguo', number: mapIssue.number, body: mapBody })

  const args = {
    gh,
    owner: 'acme',
    repo: 'acme-shuiguo',
    number: parent.number,
    mapIssueNumber: mapIssue.number,
    mapBody,
    parentIssueUrl: parent.html_url,
    answers: ['技术栈：Next.js + Postgres'],
    impacts: [],
  }
  await assert.rejects(postPoint(args), GateNotReadyError)
  await assert.rejects(postPoint(args), GateNotReadyError)
  let comments = await gh.listComments({ owner: 'acme', repo: 'acme-shuiguo', number: parent.number })
  assert.equal(comments.filter((row) => row.body.startsWith('提醒：补缺口')).length, 1)

  const cleanBody = mapBody.replace('- 送货范围怎么定\n\n', '')
  const children = await gh.listSubIssues({ owner: 'acme', repo: 'acme-shuiguo', number: mapIssue.number })
  for (const child of children) {
    await gh.closeIssue({ owner: 'acme', repo: 'acme-shuiguo', number: child.number })
  }
  await postPoint({ ...args, mapBody: cleanBody })
  comments = await gh.listComments({ owner: 'acme', repo: 'acme-shuiguo', number: parent.number })
  const point = comments.find((row) => row.body.startsWith('点头：补缺口'))
  assert.ok(point)
  assert.match(point.body, /## 最终答案/)
  assert.match(point.body, /## 正文影响/)
  const parentAfter = (await gh.getIssue({ owner: 'acme', repo: 'acme-shuiguo', number: parent.number })).body
  assert.equal(parentAfter, parentBefore)
})

test('postProposal 用 ensureCommentOnce，重跑不重复发', async (t) => {
  const { gh, parent } = await githubSetup(t)
  const body = '提案：补缺口\n\n1. 题：...\n   推荐：...'
  assert.equal(await postProposal({ gh, owner: 'acme', repo: 'acme-shuiguo', number: parent.number, body }), true)
  assert.equal(await postProposal({ gh, owner: 'acme', repo: 'acme-shuiguo', number: parent.number, body }), false)
  const comments = await gh.listComments({ owner: 'acme', repo: 'acme-shuiguo', number: parent.number })
  assert.equal(comments.length, 1)
})

test('gateReady：带清图协议时按 kinds 拦缺结论和缺 Decisions 行', async (t) => {
  const { gh, mapIssue } = await githubSetup(t)
  let mapBody = (await gh.getIssue({ owner: 'acme', repo: 'acme-shuiguo', number: mapIssue.number })).body
  mapBody = mapBody.replace('## Notes\n\n- 父工单', '## Notes\n\n- 清图协议：v1\n- 父工单')
  const children = await gh.listSubIssues({ owner: 'acme', repo: 'acme-shuiguo', number: mapIssue.number })
  for (const child of children) {
    await gh.closeIssue({ owner: 'acme', repo: 'acme-shuiguo', number: child.number })
  }

  let gate = await gateReady({
    gh,
    owner: 'acme',
    repo: 'acme-shuiguo',
    mapIssueNumber: mapIssue.number,
    mapBody,
  })
  assert.equal(gate.ready, false)
  assert.equal(gate.blockers.filter((row) => row.kind === 'missing-conclusion').length, 5)
  assert.equal(gate.blockers.some((row) => row.kind === 'decisions-missing'), false)

  const decisions = []
  for (const child of children) {
    const conclusion = `${child.title} 的结论`
    await gh.createComment({
      owner: 'acme',
      repo: 'acme-shuiguo',
      number: child.number,
      body: `结论：${conclusion}`,
    })
    decisions.push(`- ${child.title}：${conclusion}`)
  }
  gate = await gateReady({
    gh,
    owner: 'acme',
    repo: 'acme-shuiguo',
    mapIssueNumber: mapIssue.number,
    mapBody,
  })
  assert.equal(gate.blockers.filter((row) => row.kind === 'decisions-missing').length, 5)

  mapBody = mapBody.replace('## Decisions so far\n\n', `## Decisions so far\n\n${decisions.join('\n')}\n`)
  gate = await gateReady({
    gh,
    owner: 'acme',
    repo: 'acme-shuiguo',
    mapIssueNumber: mapIssue.number,
    mapBody,
  })
  assert.deepEqual(gate, { ready: true, blockers: [] })
})

async function protocolReadySetup(t) {
  const { gh, mapIssue } = await githubSetup(t)
  let body = (await gh.getIssue({ owner: 'acme', repo: 'acme-shuiguo', number: mapIssue.number })).body
  body = body.replace('## Notes\n\n- 父工单', '## Notes\n\n- 清图协议：v1\n- 父工单')
  const children = await gh.listSubIssues({ owner: 'acme', repo: 'acme-shuiguo', number: mapIssue.number })
  const decisions = []
  for (const child of children) {
    await gh.closeIssue({ owner: 'acme', repo: 'acme-shuiguo', number: child.number })
    const conclusion = `${child.title} 的结论`
    await gh.createComment({
      owner: 'acme',
      repo: 'acme-shuiguo',
      number: child.number,
      body: `结论：${conclusion}`,
    })
    decisions.push(`- ${child.title}：${conclusion}`)
  }
  body = body.replace('## Decisions so far\n\n', `## Decisions so far\n\n${decisions.join('\n')}\n`)
  return { gh, mapIssue, body }
}

test('gateReady：带清图协议时「接下来」和「未定」也要清', async (t) => {
  const { gh, mapIssue, body } = await protocolReadySetup(t)
  const args = { gh, owner: 'acme', repo: 'acme-shuiguo', mapIssueNumber: mapIssue.number }

  let gate = await gateReady({ ...args, mapBody: body })
  assert.deepEqual(gate, { ready: true, blockers: [] })

  const withNext = body.replace(
    '## 接下来\n\n## Decisions so far',
    '## 接下来\n\n- 第 06 张：送货范围怎么定\n\n## Decisions so far',
  )
  gate = await gateReady({ ...args, mapBody: withNext })
  assert.equal(gate.ready, false)
  assert.deepEqual(gate.blockers.map((row) => row.kind), ['next-not-empty'])

  gate = await gateReady({ ...args, mapBody: withNext.replace('- 第 06 张：送货范围怎么定', '- 无') })
  assert.deepEqual(gate, { ready: true, blockers: [] })

  const unsettled = body.replace('## Notes\n\n', '## Notes\n\n- 未定：起送价\n')
  gate = await gateReady({ ...args, mapBody: unsettled })
  assert.equal(gate.ready, false)
  assert.deepEqual(gate.blockers.map((row) => row.kind), ['unsettled-without-next'])

  const settled = body.replace('## Notes\n\n', '## Notes\n\n- 未定：起送价（运营者，下周定）\n')
  gate = await gateReady({ ...args, mapBody: settled })
  assert.deepEqual(gate, { ready: true, blockers: [] })
})

test('gateReady：带清图协议时 commentsByTicket 注入后不再读评论', async () => {
  const mapBody = [
    '## Destination',
    '',
    '卖水果',
    '',
    '## Notes',
    '',
    '- 清图协议：v1',
    '- 父工单：https://github.com/acme/acme-shuiguo/issues/1',
    '',
    '## 接下来',
    '',
    '## Decisions so far',
    '',
    '- 01 先做哪一版：先做取货',
    '',
    '## Not yet specified',
    '',
    '## Out of scope',
    '',
  ].join('\n')
  let readComments = false
  const gate = await gateReady({
    gh: {
      async listSubIssues() {
        return [{ number: 3, title: '01 先做哪一版', state: 'closed' }]
      },
      async listComments() {
        readComments = true
        return []
      },
    },
    owner: 'acme',
    repo: 'acme-shuiguo',
    mapIssueNumber: 2,
    mapBody,
    commentsByTicket: { 3: [{ body: '结论：先做取货' }] },
  })
  assert.equal(readComments, false)
  assert.deepEqual(gate, { ready: true, blockers: [] })
})
