import assert from 'node:assert/strict'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createGithub } from '../lib/github.mjs'
import { ensureMapIssues, MapFormatError, parseMap, readDecisionTickets } from '../lib/map-issues.mjs'
import { startFakeGithub } from './fake-github.mjs'

const FIXTURE = fileURLToPath(
  new URL('../../docs/回传样例/工作区/.scratch/xianguopu/', import.meta.url),
)

async function copyFixture(t, prefix = 'gap-fixture-') {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  await cp(FIXTURE, dir, { recursive: true })
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

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

async function githubSetup(t) {
  const fake = await startFakeGithub({
    repos: [{ owner: 'acme', name: 'acme-shuiguo' }],
    issues: [{ owner: 'acme', repo: 'acme-shuiguo', title: '我想要一个卖水果的小程序', body: PARENT_BODY, labels: [] }],
  })
  t.after(() => fake.close())
  const gh = createGithub({ apiBase: fake.base, token: 'test' })
  const parent = await gh.getIssue({ owner: 'acme', repo: 'acme-shuiguo', number: 1 })
  return { fake, gh, parent }
}

function issuesOf(fake) {
  return fake.state.issues.get('acme/acme-shuiguo')
}


test('parseMap 读出六段原文', async () => {
  const { readFile } = await import('node:fs/promises')
  const text = await readFile(join(FIXTURE, 'map.md'), 'utf8')
  const map = parseMap(text)

  assert.equal(map.title, 'xianguopu 地图')
  assert.match(map.destination, /顾客在微信小程序里看到今天有什么水果/)
  assert.match(map.notes, /老板一个人看店/)
  assert.equal(map.next, '')
  assert.match(map.decisions, /01 顾客怎么看到今天有什么/)
  assert.equal(map.notYetSpecified, '')
  assert.match(map.outOfScope, /会员积分/)
})

test('parseMap 缺段报 MapFormatError', () => {
  assert.throws(() => parseMap('## Destination\n\n做点什么\n'), MapFormatError)
})

test('readDecisionTickets 按编号排序，拆出票头、问题、评论和结论', async () => {
  const tickets = await readDecisionTickets(join(FIXTURE, 'issues'))

  assert.deepEqual(
    tickets.map((ticket) => ticket.title),
    [
      '01 顾客怎么看到今天有什么',
      '02 下单要不要先付钱',
      '03 我在哪改价格和库存',
      '04 取货了怎么通知顾客',
      '05 小程序用哪家云',
    ],
  )
  assert.deepEqual(tickets.map((ticket) => ticket.type), ['grilling', 'grilling', 'prototype', 'task', 'research'])
  assert.equal(tickets[0].status, 'resolved')
  assert.equal(tickets[0].question, '顾客从哪看到今天的水果？')
  assert.deepEqual(tickets[0].comments, ['客户原话：「店里贴个二维码，扫一下就能看。」'])
  assert.match(tickets[0].conclusion, /店里贴二维码/)
  assert.doesNotMatch(tickets[2].body, /## 评论|## 结论|产出文件/)
  assert.equal(tickets[2].blockedBy, '')
})

test('readDecisionTickets 编号重复、Type 非法、缺 Question 都报 MapFormatError', async (t) => {
  const duplicate = await copyFixture(t)
  await writeFile(join(duplicate, 'issues', '01-重复的票.md'), '# 01 重复的票\n\nType: task\n\n## Question\n\n重复吗？\n')
  await assert.rejects(readDecisionTickets(join(duplicate, 'issues')), MapFormatError)

  const badType = await copyFixture(t)
  const file = join(badType, 'issues', '02-下单要不要先付钱.md')
  const { readFile } = await import('node:fs/promises')
  await writeFile(file, (await readFile(file, 'utf8')).replace('Type: grilling', 'Type: chat'))
  await assert.rejects(readDecisionTickets(join(badType, 'issues')), MapFormatError)

  const noQuestion = await copyFixture(t)
  const questionFile = join(noQuestion, 'issues', '03-我在哪改价格和库存.md')
  await writeFile(
    questionFile,
    (await readFile(questionFile, 'utf8')).replace('## Question', '## 问题'),
  )
  await assert.rejects(readDecisionTickets(join(noQuestion, 'issues')), MapFormatError)
})

test('建地图 issue：六段原文、Notes 第一行父工单链接、挂 wayfinder:map', async (t) => {
  const { fake, gh, parent } = await githubSetup(t)

  const result = await ensureMapIssues({
    gh,
    owner: 'acme',
    repo: 'acme-shuiguo',
    requirement: 'xianguopu',
    scratchDir: FIXTURE,
    parentIssueUrl: parent.html_url,
  })

  assert.equal(result.skipped, undefined)
  const mapIssue = await gh.getIssue({ owner: 'acme', repo: 'acme-shuiguo', number: result.mapIssue.number })
  assert.equal(mapIssue.title, 'xianguopu 地图')
  assert.match(mapIssue.body, /^## Destination/)
  const headings = [...mapIssue.body.matchAll(/^##\s+(.+)$/gm)].map((match) => match[1])
  assert.deepEqual(headings, [
    'Destination',
    'Notes',
    '接下来',
    'Decisions so far',
    'Not yet specified',
    'Out of scope',
  ])
  const notes = /^## Notes\n\n([\s\S]*?)\n\n## 接下来/m.exec(mapIssue.body)[1]
  assert.equal(notes.split('\n')[0], `- 父工单：${parent.html_url}`)
  assert.match(notes, /老板一个人看店/)
  assert.deepEqual(mapIssue.labels.map((row) => row.name), ['wayfinder:map'])
  assert.match(mapIssue.body, /<!-- factory:parent=https:\/\/github\.com\/acme\/acme-shuiguo\/issues\/1 -->\s*$/)

  const reloadedParent = await gh.getIssue({ owner: 'acme', repo: 'acme-shuiguo', number: parent.number })
  assert.match(reloadedParent.body, new RegExp(`- 地图：${mapIssue.html_url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
  assert.equal(issuesOf(fake).length, 7)
})

test('建决定票：标题保编号、正文去评论和结论、评论逐段、挂类型标签、挂到地图下', async (t) => {
  const { fake, gh, parent } = await githubSetup(t)

  const result = await ensureMapIssues({
    gh,
    owner: 'acme',
    repo: 'acme-shuiguo',
    requirement: 'xianguopu',
    scratchDir: FIXTURE,
    parentIssueUrl: parent.html_url,
  })

  const children = await gh.listSubIssues({
    owner: 'acme',
    repo: 'acme-shuiguo',
    number: result.mapIssue.number,
  })
  assert.deepEqual(children.map((row) => row.title), [
    '01 顾客怎么看到今天有什么',
    '02 下单要不要先付钱',
    '03 我在哪改价格和库存',
    '04 取货了怎么通知顾客',
    '05 小程序用哪家云',
  ])
  assert.deepEqual(children.map((row) => row.labels.map((label) => label.name).sort()), [
    ['wayfinder:grilling'],
    ['wayfinder:grilling'],
    ['wayfinder:prototype'],
    ['wayfinder:task'],
    ['wayfinder:research'],
  ])
  for (const child of children) {
    assert.match(child.body, /^Type: (grilling|research|prototype|task)$/m)
    assert.match(child.body, /^Status: resolved$/m)
    assert.match(child.body, /## Question/)
    assert.doesNotMatch(child.body, /## 评论|## 结论|产出文件/)
    assert.doesNotMatch(child.labels.map((label) => label.name).join(','), /状态:|ready-for-agent|Sandcastle/)
    const comments = await gh.listComments({ owner: 'acme', repo: 'acme-shuiguo', number: child.number })
    assert.equal(comments.length, 1)
    assert.match(comments[0].body, /^客户原话：/)
  }
  assert.equal(issuesOf(fake).length, 7)
})

test('重跑不建第二套，按编号更新正文和缺失的评论', async (t) => {
  const { fake, gh, parent } = await githubSetup(t)
  const scratch = await copyFixture(t)
  const args = {
    gh,
    owner: 'acme',
    repo: 'acme-shuiguo',
    requirement: 'xianguopu',
    scratchDir: scratch,
    parentIssueUrl: parent.html_url,
  }
  const first = await ensureMapIssues(args)

  const file = join(scratch, 'issues', '01-顾客怎么看到今天有什么.md')
  const { readFile } = await import('node:fs/promises')
  await writeFile(
    file,
    (await readFile(file, 'utf8')).replace('顾客从哪看到今天的水果？', '顾客第一次从哪看到今天的水果？'),
  )

  const second = await ensureMapIssues(args)
  assert.equal(second.mapIssue.number, first.mapIssue.number)
  assert.equal(issuesOf(fake).length, 7)
  const children = await gh.listSubIssues({ owner: 'acme', repo: 'acme-shuiguo', number: first.mapIssue.number })
  assert.equal(children.length, 5)

  const reloaded = children.find((row) => row.title.startsWith('01 '))
  assert.match(reloaded.body, /顾客第一次从哪看到今天的水果？/)
  const comments = await gh.listComments({ owner: 'acme', repo: 'acme-shuiguo', number: reloaded.number })
  assert.equal(comments.length, 1)

  const reloadedParent = await gh.getIssue({ owner: 'acme', repo: 'acme-shuiguo', number: parent.number })
  assert.equal((reloadedParent.body.match(/^- 地图：/gm) || []).length, 1)
})

test('格式不对时停下，不写任何 GitHub 状态', async (t) => {
  const { fake, gh, parent } = await githubSetup(t)
  const scratch = await copyFixture(t)
  const mapFile = join(scratch, 'map.md')
  const { readFile } = await import('node:fs/promises')
  await writeFile(
    mapFile,
    (await readFile(mapFile, 'utf8')).replace(
      '## 接下来\n\n## Decisions so far',
      '## 接下来\n\n- 07 没有这张票\n\n## Decisions so far',
    ),
  )

  await assert.rejects(
    ensureMapIssues({
      gh,
      owner: 'acme',
      repo: 'acme-shuiguo',
      requirement: 'xianguopu',
      scratchDir: scratch,
      parentIssueUrl: parent.html_url,
    }),
    MapFormatError,
  )
  assert.equal(issuesOf(fake).length, 1)
  assert.equal(fake.state.repos.get('acme/acme-shuiguo').labels.size, 5)
})

test('小需求只有需求草稿，返回 skipped 且不建图', async (t) => {
  const { fake, gh, parent } = await githubSetup(t)
  const scratch = await mkdtemp(join(tmpdir(), 'gap-small-'))
  t.after(() => rm(scratch, { recursive: true, force: true }))
  await writeFile(join(scratch, '需求草稿.md'), '# 需求草稿\n\nStatus: 已问完\n')

  const result = await ensureMapIssues({
    gh,
    owner: 'acme',
    repo: 'acme-shuiguo',
    requirement: 'xianguopu',
    scratchDir: scratch,
    parentIssueUrl: parent.html_url,
  })
  assert.deepEqual(result, { skipped: 'small' })
  assert.equal(issuesOf(fake).length, 1)
  assert.equal(fake.state.repos.get('acme/acme-shuiguo').labels.size, 5)
})

test('replace 换地图正文、按编号换票、作废旧票、保留运营者票', async (t) => {
  const { fake, gh, parent } = await githubSetup(t)
  const scratch = await copyFixture(t)
  const args = {
    gh,
    owner: 'acme',
    repo: 'acme-shuiguo',
    requirement: 'xianguopu',
    scratchDir: scratch,
    parentIssueUrl: parent.html_url,
  }
  const first = await ensureMapIssues(args)
  const operatorTicket = await gh.createIssue({
    owner: 'acme',
    repo: 'acme-shuiguo',
    title: '送货要不要设起送价',
    body: '## Question\n\n要不要设起送价？',
  })
  await gh.addSubIssue({
    owner: 'acme',
    repo: 'acme-shuiguo',
    number: first.mapIssue.number,
    subIssueId: operatorTicket.id,
  })

  const { readFile } = await import('node:fs/promises')
  const mapFile = join(scratch, 'map.md')
  await writeFile(
    mapFile,
    (await readFile(mapFile, 'utf8'))
      .replace(
        '顾客在微信小程序里看到今天有什么水果',
        '顾客在微信小程序里看到今天有什么水果和价格',
      )
      .replace('## 接下来\n\n## Decisions so far', '## 接下来\n\n- 06 送货范围怎么定\n\n## Decisions so far'),
  )
  await rm(join(scratch, 'issues', '05-小程序用哪家云.md'))
  const commentFile = join(scratch, 'issues', '01-顾客怎么看到今天有什么.md')
  await writeFile(
    commentFile,
    (await readFile(commentFile, 'utf8')).replace(
      '客户原话：「店里贴个二维码，扫一下就能看。」',
      '客户原话：「店里贴个二维码，扫一下就能看。」\n\n客户补充：「朋友也会看。」',
    ),
  )
  await writeFile(
    join(scratch, 'issues', '06-送货范围怎么定.md'),
    '# 06 送货范围怎么定\n\nType: grilling\nStatus: claimed\n\n## Question\n\n送货送到哪？\n\n## 评论\n\n客户原话：「超出镇上就不送了。」\n\n## 结论\n\n（做完才写）\n',
  )

  const result = await ensureMapIssues({ ...args, mode: 'replace' })
  const mapIssue = await gh.getIssue({ owner: 'acme', repo: 'acme-shuiguo', number: result.mapIssue.number })
  assert.match(mapIssue.body, /看到今天有什么水果和价格/)
  assert.equal((mapIssue.body.match(/^- 父工单：/gm) || []).length, 1)

  const children = await gh.listSubIssues({ owner: 'acme', repo: 'acme-shuiguo', number: mapIssue.number })
  assert.deepEqual(children.map((row) => row.title).sort(), [
    '01 顾客怎么看到今天有什么',
    '02 下单要不要先付钱',
    '03 我在哪改价格和库存',
    '04 取货了怎么通知顾客',
    '05 小程序用哪家云',
    '06 送货范围怎么定',
    '送货要不要设起送价',
  ])

  const ticket01 = children.find((row) => row.title.startsWith('01 '))
  const comments01 = await gh.listComments({ owner: 'acme', repo: 'acme-shuiguo', number: ticket01.number })
  assert.deepEqual(comments01.map((row) => row.body), [
    '客户原话：「店里贴个二维码，扫一下就能看。」',
    '客户补充：「朋友也会看。」',
    '店里贴二维码，顾客扫进小程序看当天清单。',
  ])

  const obsolete = issuesOf(fake).find((row) => row.title.startsWith('05 '))
  assert.equal(obsolete.state, 'closed')
  assert.ok(obsolete.comments.some((row) => row.body === '作废：重传'))

  const ticket06 = children.find((row) => row.title.startsWith('06 '))
  const comments06 = await gh.listComments({ owner: 'acme', repo: 'acme-shuiguo', number: ticket06.number })
  assert.equal(comments06.length, 1)
  assert.ok(!comments06.some((row) => row.body.includes('做完才写')))

  const operator = issuesOf(fake).find((row) => row.title === '送货要不要设起送价')
  assert.equal(operator.state, 'open')
  assert.ok(operator.comments.some((row) => row.body === '待复查：重传'))

  const mapComments = await gh.listComments({ owner: 'acme', repo: 'acme-shuiguo', number: mapIssue.number })
  const retransmit = mapComments.find((row) => row.body.startsWith('重传：'))
  assert.ok(retransmit)
  assert.match(retransmit.body, /送货要不要设起送价/)
  assert.doesNotMatch(retransmit.body, /01 顾客怎么看到今天有什么/)
})
