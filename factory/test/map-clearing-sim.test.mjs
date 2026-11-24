import assert from 'node:assert/strict'
import test from 'node:test'
import { run as runMap } from '../bin/map.mjs'
import { gateReady, postPoint } from '../lib/gap.mjs'
import { createGithub } from '../lib/github.mjs'
import { parseMap } from '../lib/map-issues.mjs'
import { startFakeGithub } from './fake-github.mjs'

const OWNER = 'acme'
const REPO = 'acme-shuiguo'
const PARENT_BODY = `## 客户原话

> 「顾客想在我的微信小程序里看今天有什么水果。」

## 需求全文

- 客户简称：acme
- 需求名：xianguopu
`

function mapBody(parentUrl, { fog = [], next = '', decisions = '', notes = '' } = {}) {
  const sections = {
    Destination: '顾客在小程序里看今天有什么水果。',
    Notes: [`- 父工单：${parentUrl}`, notes].filter(Boolean).join('\n'),
    接下来: next,
    'Decisions so far': decisions,
    'Not yet specified': fog.map((item) => `- ${item}`).join('\n'),
    'Out of scope': '- 会员积分',
  }
  const text = Object.entries(sections)
    .map(([heading, content]) => (content ? `## ${heading}\n\n${content}` : `## ${heading}`))
    .join('\n\n')
  return `${text}\n\n<!-- factory:parent=${parentUrl} -->\n`
}

function cli(command, parent, extra = []) {
  return [command, '--owner', OWNER, '--repo', REPO, '--parent', parent.html_url, ...extra]
}

test('清图协议端到端：init → ticket → defer → conclude → check → 点头', async (t) => {
  const fake = await startFakeGithub({ repos: [{ owner: OWNER, name: REPO }] })
  t.after(() => fake.close())
  const gh = createGithub({ apiBase: fake.base, token: 'test' })
  const logs = []
  const sink = { log: (line) => logs.push(line) }

  const parent = await gh.createIssue({ owner: OWNER, repo: REPO, title: '父工单', body: PARENT_BODY })
  const oldTicket = await gh.createIssue({
    owner: OWNER,
    repo: REPO,
    title: '01 现有决定票',
    body: '## Question\n\n现有票要确认什么？',
  })
  const mapIssue = await gh.createIssue({
    owner: OWNER,
    repo: REPO,
    title: 'xianguopu 地图',
    body: mapBody(parent.html_url, {
      fog: ['送货范围怎么定', '起送价多少（你答）'],
      next: '- 第 01 张：现有决定票',
    }),
  })
  await gh.addSubIssue({
    owner: OWNER,
    repo: REPO,
    number: mapIssue.number,
    subIssueId: oldTicket.id,
  })
  await gh.updateIssue({
    owner: OWNER,
    repo: REPO,
    number: parent.number,
    body: `${PARENT_BODY}\n- 地图：${mapIssue.html_url}\n`,
  })
  await gh.createComment({
    owner: OWNER,
    repo: REPO,
    number: parent.number,
    body: '提案：补缺口\n\n1. 题：用什么技术栈？\n   推荐：Next.js',
  })

  const initialized = await runMap(cli('init', parent), { gh, log: sink })
  assert.deepEqual(initialized, { map: mapIssue.html_url, added: true })

  const created = await runMap(
    cli('ticket', parent, [
      '--title', '送货范围怎么定',
      '--type', 'grilling',
      '--question', '送货送到哪？',
      '--from-item', '送货范围怎么定',
    ]),
    { gh, log: sink },
  )
  assert.equal(created.created, true)
  assert.equal(created.ticket.title, '02 送货范围怎么定')

  const deferred = await runMap(
    cli('defer', parent, [
      '--item', '起送价多少（你答）',
      '--to', 'notes',
      '--who', '运营者',
      '--next', '下周和客户定',
    ]),
    { gh, log: sink },
  )
  assert.equal(deferred.changed, true)

  const oldConclusion = await runMap(
    cli('conclude', parent, ['--ticket', '01', '--conclusion', '维持现有做法']),
    { gh, log: sink },
  )
  assert.equal(oldConclusion.closed, true)
  assert.equal(oldConclusion.commented, true)

  const newConclusion = await runMap(
    cli('conclude', parent, ['--ticket', '02', '--conclusion', '只送镇上，超区自取']),
    { gh, log: sink },
  )
  assert.equal(newConclusion.closed, true)
  assert.equal(newConclusion.commented, true)
  assert.equal(newConclusion.decisionsAdded, true)

  const checked = await runMap(cli('check', parent), { gh, log: sink })
  assert.deepEqual(checked, { ready: true, blockers: [] })

  const finalMap = await gh.getIssue({ owner: OWNER, repo: REPO, number: mapIssue.number })
  const gate = await gateReady({
    gh,
    owner: OWNER,
    repo: REPO,
    mapIssueNumber: mapIssue.number,
    mapBody: finalMap.body,
  })
  assert.deepEqual(gate, { ready: true, blockers: [] })

  const pointed = await postPoint({
    gh,
    owner: OWNER,
    repo: REPO,
    number: parent.number,
    mapIssueNumber: mapIssue.number,
    parentIssueUrl: parent.html_url,
    answers: ['技术栈：Next.js + Postgres', '取货通知：小程序订阅消息'],
    impacts: [],
  })
  assert.equal(pointed, true)
  const parentComments = await gh.listComments({ owner: OWNER, repo: REPO, number: parent.number })
  const point = parentComments.find((row) => row.body.startsWith('点头：补缺口'))
  assert.ok(point)
  assert.match(point.body, /## 最终答案\n\n- 技术栈：Next\.js \+ Postgres/)

  const parsed = parseMap(finalMap.body)
  const headings = [...finalMap.body.matchAll(/^##\s+(.+)$/gm)].map((match) => match[1])
  assert.deepEqual(headings, [
    'Destination',
    'Notes',
    '接下来',
    'Decisions so far',
    'Not yet specified',
    'Out of scope',
  ])
  assert.equal(parsed.notYetSpecified, '')
  assert.equal(parsed.next, '')
  assert.match(parsed.notes, /^- 清图协议：v1$/m)
  assert.match(parsed.notes, /^- 未定：起送价多少（你答）（运营者，下周和客户定）$/m)
  assert.match(parsed.decisions, /^- 01 现有决定票：维持现有做法$/m)
  assert.match(parsed.decisions, /^- 02 送货范围怎么定：只送镇上，超区自取$/m)
  assert.equal(logs.length, 6, 'init、ticket、defer、两次 conclude、check 各一行 JSON')

  t.diagnostic(`map.mjs 输出：\n${logs.join('\n')}`)
})
