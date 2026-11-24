import assert from 'node:assert/strict'
import test from 'node:test'
import { run } from '../bin/map.mjs'
import { createGithub } from '../lib/github.mjs'
import { itemsOf, sectionText } from '../lib/map-clearing.mjs'
import { startFakeGithub } from './fake-github.mjs'

const OWNER = 'acme'
const REPO = 'acme-shuiguo'
const PARENT_BODY = `## 客户原话

> 「顾客想在我的微信小程序里看今天有什么水果。」

## 需求全文

- 客户简称：acme
- 需求名：xianguopu
`

function mapBody(parentUrl, { fog = [], next = '', decisions = '', notes = '', outOfScope = '- 会员积分' } = {}) {
  const sections = {
    Destination: '顾客在小程序里看今天有什么水果。',
    Notes: [`- 父工单：${parentUrl}`, notes].filter(Boolean).join('\n'),
    接下来: next,
    'Decisions so far': decisions,
    'Not yet specified': fog.map((item) => `- ${item}`).join('\n'),
    'Out of scope': outOfScope,
  }
  const text = Object.entries(sections)
    .map(([heading, content]) => (content ? `## ${heading}\n\n${content}` : `## ${heading}`))
    .join('\n\n')
  return `${text}\n\n<!-- factory:parent=${parentUrl} -->\n`
}

async function setup(
  t,
  { fog = ['送货范围怎么定', '起送价多少（你答）'], children = [], next = '', decisions = '', notes = '' } = {},
) {
  const fake = await startFakeGithub({ repos: [{ owner: OWNER, name: REPO }] })
  t.after(() => fake.close())
  const gh = createGithub({ apiBase: fake.base, token: 'test' })
  const parent = await gh.createIssue({ owner: OWNER, repo: REPO, title: '父工单', body: PARENT_BODY })
  const mapIssue = await gh.createIssue({
    owner: OWNER,
    repo: REPO,
    title: 'xianguopu 地图',
    body: mapBody(parent.html_url, { fog, next, decisions, notes }),
  })
  await gh.updateIssue({
    owner: OWNER,
    repo: REPO,
    number: parent.number,
    body: `${PARENT_BODY}\n- 地图：${mapIssue.html_url}\n`,
  })
  const seeded = []
  for (const child of children) {
    const issue = await gh.createIssue({
      owner: OWNER,
      repo: REPO,
      title: child.title,
      body: child.body || '',
    })
    await gh.addSubIssue({
      owner: OWNER,
      repo: REPO,
      number: mapIssue.number,
      subIssueId: issue.id,
    })
    if (child.state === 'closed') {
      await gh.closeIssue({ owner: OWNER, repo: REPO, number: issue.number })
    }
    seeded.push(issue)
  }
  return { fake, gh, parent, mapIssue, seeded, sink: { log() {} } }
}

function cli(command, parent, extra = []) {
  return [command, '--owner', OWNER, '--repo', REPO, '--parent', parent.html_url, ...extra]
}

function issuesOf(fake) {
  return fake.state.issues.get(`${OWNER}/${REPO}`)
}

async function mapBodyOf(gh, mapIssue) {
  return (await gh.getIssue({ owner: OWNER, repo: REPO, number: mapIssue.number })).body
}

function linesCount(text, needle) {
  return text.split('\n').filter((line) => line.trim() === needle).length
}

test('init 在 Notes 加清图协议标记，重复跑不加第二行', async (t) => {
  const { gh, parent, mapIssue, sink } = await setup(t)

  const first = await run(cli('init', parent), { gh, log: sink })
  assert.deepEqual(first, { map: mapIssue.html_url, added: true })
  let body = await mapBodyOf(gh, mapIssue)
  assert.equal(linesCount(body, '- 清图协议：v1'), 1)

  const second = await run(cli('init', parent), { gh, log: sink })
  assert.deepEqual(second, { map: mapIssue.html_url, added: false })
  body = await mapBodyOf(gh, mapIssue)
  assert.equal(linesCount(body, '- 清图协议：v1'), 1)
})

test('ticket 建决定票、清雾、加接下来；重复跑不建第二张票', async (t) => {
  const { fake, gh, parent, mapIssue, sink } = await setup(t)
  const args = cli('ticket', parent, [
    '--title', '送货范围怎么定',
    '--type', 'grilling',
    '--question', '送货送到哪？',
    '--from-item', '送货范围怎么定',
  ])

  const created = await run(args, { gh, log: sink })
  assert.deepEqual(Object.keys(created).sort(), ['created', 'map', 'removedItem', 'ticket'])
  assert.equal(created.map, mapIssue.html_url)
  assert.equal(created.created, true)
  assert.equal(created.removedItem, '送货范围怎么定')
  assert.equal(created.ticket.title, '01 送货范围怎么定')

  const ticket = await gh.getIssue({ owner: OWNER, repo: REPO, number: created.ticket.number })
  assert.equal(ticket.html_url, created.ticket.url)
  assert.deepEqual(ticket.labels.map((row) => row.name), ['wayfinder:grilling'])
  assert.match(ticket.body, /^## Question\n\n送货送到哪？\n\n## 评论\n\n## 结论$/)
  assert.doesNotMatch(ticket.body, /状态:|ready-for-agent/)

  const children = await gh.listSubIssues({ owner: OWNER, repo: REPO, number: mapIssue.number })
  assert.deepEqual(children.map((row) => row.number), [ticket.number])

  let body = await mapBodyOf(gh, mapIssue)
  assert.doesNotMatch(sectionText(body, 'Not yet specified'), /送货范围怎么定/)
  assert.equal(linesCount(body, '- 第 01 张：送货范围怎么定'), 1)

  const again = await run(args, { gh, log: sink })
  assert.equal(again.created, false)
  assert.equal(again.removedItem, null)
  assert.equal(again.ticket.number, created.ticket.number)
  assert.equal(issuesOf(fake).length, 3, '父工单、地图、决定票各一张')
  body = await mapBodyOf(gh, mapIssue)
  assert.equal(linesCount(body, '- 第 01 张：送货范围怎么定'), 1)
})

test('ticket 找不到雾项又没建过票时报中文错，不改地图', async (t) => {
  const { gh, parent, mapIssue, sink } = await setup(t)
  const before = await mapBodyOf(gh, mapIssue)
  await assert.rejects(
    run(
      cli('ticket', parent, [
        '--title', '没这一项',
        '--type', 'grilling',
        '--question', '问？',
        '--from-item', '没这一项',
      ]),
      { gh, log: sink },
    ),
    /Not yet specified 里找不到这一项/,
  )
  assert.equal(await mapBodyOf(gh, mapIssue), before)
})

test('ticket 的 --type 只收四种，别的报中文错', async (t) => {
  const { gh, parent, sink } = await setup(t)
  await assert.rejects(
    run(
      cli('ticket', parent, [
        '--title', '随便',
        '--type', 'chat',
        '--question', '问？',
        '--from-item', '送货范围怎么定',
      ]),
      { gh, log: sink },
    ),
    /--type 要填 grilling、research、prototype、task 之一/,
  )
})

test('conclude 写结论评论、关票、删接下来、加 Decisions so far；重复跑幂等', async (t) => {
  const { gh, parent, mapIssue, sink } = await setup(t, { fog: ['送货范围怎么定'] })
  const created = await run(
    cli('ticket', parent, [
      '--title', '送货范围怎么定',
      '--type', 'grilling',
      '--question', '送货送到哪？',
      '--from-item', '送货范围怎么定',
    ]),
    { gh, log: sink },
  )

  const concluded = await run(
    cli('conclude', parent, ['--ticket', '01', '--conclusion', '只送镇上，超区自取']),
    { gh, log: sink },
  )
  assert.equal(concluded.map, mapIssue.html_url)
  assert.equal(concluded.ticket.number, created.ticket.number)
  assert.equal(concluded.ticket.title, '01 送货范围怎么定')
  assert.equal(concluded.commented, true)
  assert.equal(concluded.closed, true)
  assert.equal(concluded.decisionsAdded, true)

  const ticket = await gh.getIssue({ owner: OWNER, repo: REPO, number: created.ticket.number })
  assert.equal(ticket.state, 'closed')
  const comments = await gh.listComments({ owner: OWNER, repo: REPO, number: ticket.number })
  assert.deepEqual(comments.map((row) => row.body), ['结论：只送镇上，超区自取'])

  let body = await mapBodyOf(gh, mapIssue)
  assert.equal(linesCount(body, '- 第 01 张：送货范围怎么定'), 0)
  assert.equal(linesCount(body, '- 01 送货范围怎么定：只送镇上，超区自取'), 1)

  const again = await run(
    cli('conclude', parent, ['--ticket', '01 送货', '--conclusion', '只送镇上，超区自取']),
    { gh, log: sink },
  )
  assert.equal(again.commented, false)
  assert.equal(again.closed, false)
  assert.equal(again.decisionsAdded, false)
  body = await mapBodyOf(gh, mapIssue)
  assert.equal(linesCount(body, '- 01 送货范围怎么定：只送镇上，超区自取'), 1)
  const rewrote = await gh.listComments({ owner: OWNER, repo: REPO, number: ticket.number })
  assert.equal(rewrote.length, 1)
})

test('conclude 找不到票时报中文错', async (t) => {
  const { gh, parent, sink } = await setup(t)
  await assert.rejects(
    run(cli('conclude', parent, ['--ticket', '09', '--conclusion', '没有这张票']), { gh, log: sink }),
    /地图下找不到票：09/,
  )
})

test('defer 记到 Out of scope 和 Notes，重复跑不重复加行', async (t) => {
  const { gh, parent, mapIssue, sink } = await setup(t)

  const toScope = await run(
    cli('defer', parent, [
      '--item', '送货范围怎么定',
      '--to', 'out-of-scope',
      '--reason', '只做镇上，超区以后再说',
    ]),
    { gh, log: sink },
  )
  assert.deepEqual(toScope, {
    map: mapIssue.html_url,
    item: '送货范围怎么定',
    to: 'out-of-scope',
    changed: true,
  })
  let body = await mapBodyOf(gh, mapIssue)
  assert.equal(linesCount(body, '- 送货范围怎么定（本版不做：只做镇上，超区以后再说）'), 1)
  assert.doesNotMatch(body, /Not yet specified\n\n送货范围怎么定/)

  const again = await run(
    cli('defer', parent, [
      '--item', '送货范围怎么定',
      '--to', 'out-of-scope',
      '--reason', '只做镇上，超区以后再说',
    ]),
    { gh, log: sink },
  )
  assert.equal(again.changed, false)
  body = await mapBodyOf(gh, mapIssue)
  assert.equal(linesCount(body, '- 送货范围怎么定（本版不做：只做镇上，超区以后再说）'), 1)

  const toNotes = await run(
    cli('defer', parent, [
      '--item', '起送价多少（你答）',
      '--to', 'notes',
      '--who', '运营者',
      '--next', '下周和客户定',
    ]),
    { gh, log: sink },
  )
  assert.equal(toNotes.changed, true)
  body = await mapBodyOf(gh, mapIssue)
  assert.equal(linesCount(body, '- 未定：起送价多少（你答）（运营者，下周和客户定）'), 1)

  const notesAgain = await run(
    cli('defer', parent, [
      '--item', '起送价多少（你答）',
      '--to', 'notes',
      '--who', '运营者',
      '--next', '下周和客户定',
    ]),
    { gh, log: sink },
  )
  assert.equal(notesAgain.changed, false)
  body = await mapBodyOf(gh, mapIssue)
  assert.equal(linesCount(body, '- 未定：起送价多少（你答）（运营者，下周和客户定）'), 1)
})

test('defer 缺理由或缺谁回话时报错，地图不动', async (t) => {
  const { gh, parent, mapIssue, sink } = await setup(t)
  const before = await mapBodyOf(gh, mapIssue)
  await assert.rejects(
    run(cli('defer', parent, ['--item', '送货范围怎么定', '--to', 'out-of-scope']), { gh, log: sink }),
    /--to out-of-scope 要带 --reason/,
  )
  await assert.rejects(
    run(cli('defer', parent, ['--item', '送货范围怎么定', '--to', 'notes', '--who', '运营者']), {
      gh,
      log: sink,
    }),
    /--to notes 要带 --who 和 --next/,
  )
  assert.equal(await mapBodyOf(gh, mapIssue), before)
})

test('check 按 kinds 报 blockers，清完才 ready', async (t) => {
  const { gh, parent, sink } = await setup(t, { fog: ['送货范围怎么定'] })
  await run(cli('init', parent), { gh, log: sink })
  await run(
    cli('ticket', parent, [
      '--title', '送货范围怎么定',
      '--type', 'grilling',
      '--question', '送货送到哪？',
      '--from-item', '送货范围怎么定',
    ]),
    { gh, log: sink },
  )

  const blocked = await run(cli('check', parent), { gh, log: sink })
  assert.equal(blocked.ready, false)
  const kinds = new Set(blocked.blockers.map((row) => row.kind))
  assert.equal(kinds.has('open-ticket'), true)
  assert.equal(kinds.has('next-not-empty'), true)

  await run(cli('conclude', parent, ['--ticket', '01', '--conclusion', '只送镇上']), { gh, log: sink })
  const ready = await run(cli('check', parent), { gh, log: sink })
  assert.deepEqual(ready, { ready: true, blockers: [] })
})

test('check 对关闭但没结论的票报 missing-conclusion，补上结论后通过', async (t) => {
  const { gh, parent, mapIssue, sink } = await setup(t, {
    fog: [],
    children: [{ title: '05 手动关的票', body: '## Question\n\n手动关的。', state: 'closed' }],
  })
  await run(cli('init', parent), { gh, log: sink })

  const blocked = await run(cli('check', parent), { gh, log: sink })
  assert.equal(blocked.ready, false)
  assert.deepEqual(blocked.blockers.map((row) => row.kind), ['missing-conclusion'])

  const child = (await gh.listSubIssues({ owner: OWNER, repo: REPO, number: mapIssue.number }))[0]
  await gh.createComment({ owner: OWNER, repo: REPO, number: child.number, body: '结论：手动结论' })
  const body = await mapBodyOf(gh, mapIssue)
  await gh.updateIssue({
    owner: OWNER,
    repo: REPO,
    number: mapIssue.number,
    body: body.replace('## Decisions so far\n', '## Decisions so far\n\n- 05 手动关的票：手动结论\n'),
  })

  const ready = await run(cli('check', parent), { gh, log: sink })
  assert.deepEqual(ready, { ready: true, blockers: [] })
})

test('list 输出雾、接下来、开闭票、Decisions、未定和协议状态', async (t) => {
  const { gh, parent, mapIssue, sink } = await setup(t, { fog: ['送货范围怎么定', '起送价多少（你答）'] })
  await run(cli('init', parent), { gh, log: sink })
  await run(
    cli('ticket', parent, [
      '--title', '送货范围怎么定',
      '--type', 'grilling',
      '--question', '送货送到哪？',
      '--from-item', '送货范围怎么定',
    ]),
    { gh, log: sink },
  )
  await run(
    cli('defer', parent, ['--item', '起送价多少（你答）', '--to', 'notes', '--who', '运营者', '--next', '下周定']),
    { gh, log: sink },
  )

  const listed = await run(cli('list', parent), { gh, log: sink })
  assert.equal(listed.map, mapIssue.html_url)
  assert.equal(listed.protocol, true)
  assert.deepEqual(listed.fog, [])
  assert.deepEqual(listed.next, ['第 01 张：送货范围怎么定'])
  assert.deepEqual(listed.openTickets.map((row) => row.title), ['01 送货范围怎么定'])
  assert.deepEqual(listed.closedTickets, [])
  assert.deepEqual(listed.decisions, [])
  assert.deepEqual(listed.deferred, ['未定：起送价多少（你答）（运营者，下周定）'])
})

test('父工单没有地图链接、地图不属于父工单时报中文错', async (t) => {
  const { gh, parent, mapIssue, sink } = await setup(t)
  await gh.updateIssue({ owner: OWNER, repo: REPO, number: parent.number, body: PARENT_BODY })
  await assert.rejects(run(cli('init', parent), { gh, log: sink }), /找不到「- 地图：<链接>」/)

  const stray = await gh.createIssue({
    owner: OWNER,
    repo: REPO,
    title: '别人的地图',
    body: mapBody('https://github.com/acme/acme-shuiguo/issues/999'),
  })
  await gh.updateIssue({
    owner: OWNER,
    repo: REPO,
    number: parent.number,
    body: `${PARENT_BODY}\n- 地图：${stray.html_url}\n`,
  })
  await assert.rejects(run(cli('init', parent), { gh, log: sink }), /不属于父工单/)
  const strayBody = (await gh.getIssue({ owner: OWNER, repo: REPO, number: stray.number })).body
  assert.doesNotMatch(strayBody, /清图协议/)
  assert.ok(mapIssue.number)
})

test('ticket 编号接着现有决定票的最大编号往下排', async (t) => {
  const { gh, parent, mapIssue, sink } = await setup(t, {
    fog: ['送货范围怎么定'],
    children: [{ title: '02 已有票', body: '## Question\n\n已经谈过的票。' }],
  })
  const created = await run(
    cli('ticket', parent, [
      '--title', '送货范围怎么定',
      '--type', 'research',
      '--question', '送货送到哪？',
      '--from-item', '送货范围怎么定',
    ]),
    { gh, log: sink },
  )
  assert.equal(created.ticket.title, '03 送货范围怎么定')
  const ticket = await gh.getIssue({ owner: OWNER, repo: REPO, number: created.ticket.number })
  assert.deepEqual(ticket.labels.map((row) => row.name), ['wayfinder:research'])
  const body = await mapBodyOf(gh, mapIssue)
  assert.equal(linesCount(body, '- 第 03 张：送货范围怎么定'), 1)
})

test('conclude 写 Decisions so far 时同一张票只留一行，新的替换旧的', async (t) => {
  const { gh, parent, mapIssue, sink } = await setup(t, {
    fog: ['送货范围怎么定'],
    decisions: '- 01 送货范围怎么定：旧结论',
  })
  await run(
    cli('ticket', parent, [
      '--title', '送货范围怎么定',
      '--type', 'grilling',
      '--question', '送货送到哪？',
      '--from-item', '送货范围怎么定',
    ]),
    { gh, log: sink },
  )
  await run(cli('conclude', parent, ['--ticket', '01', '--conclusion', '只送镇上']), { gh, log: sink })
  await run(cli('conclude', parent, ['--ticket', '01', '--conclusion', '只送镇上']), { gh, log: sink })

  const body = await mapBodyOf(gh, mapIssue)
  const decisions = itemsOf(sectionText(body, 'Decisions so far')).filter((line) =>
    line.startsWith('01 送货范围怎么定：'),
  )
  assert.deepEqual(decisions, ['01 送货范围怎么定：只送镇上'])
})

test('ticket 写接下来时同一 NN 不重复，已有行被替换', async (t) => {
  const { gh, parent, mapIssue, sink } = await setup(t, {
    fog: ['送货范围怎么定'],
    next: '- 第 01 张：旧标题',
  })
  const created = await run(
    cli('ticket', parent, [
      '--title', '送货范围怎么定',
      '--type', 'grilling',
      '--question', '送货送到哪？',
      '--from-item', '送货范围怎么定',
    ]),
    { gh, log: sink },
  )
  assert.equal(created.ticket.title, '01 送货范围怎么定')
  const body = await mapBodyOf(gh, mapIssue)
  assert.deepEqual(itemsOf(sectionText(body, '接下来')), ['第 01 张：送货范围怎么定'])
})

test('check 对没有协议标记的老地图只看雾和开放票', async (t) => {
  const { gh, parent, mapIssue, sink } = await setup(t, {
    fog: ['送货范围怎么定'],
    children: [{ title: '01 已有票', body: '## Question\n\n已经谈过。' }],
  })

  const blocked = await run(cli('check', parent), { gh, log: sink })
  assert.equal(blocked.ready, false)
  assert.deepEqual([...new Set(blocked.blockers.map((row) => row.kind))].sort(), [
    'not-yet-specified',
    'open-ticket',
  ])

  await run(
    cli('defer', parent, ['--item', '送货范围怎么定', '--to', 'notes', '--who', '运营者', '--next', '下周定']),
    { gh, log: sink },
  )
  const children = await gh.listSubIssues({ owner: OWNER, repo: REPO, number: mapIssue.number })
  await gh.closeIssue({ owner: OWNER, repo: REPO, number: children[0].number })

  const ready = await run(cli('check', parent), { gh, log: sink })
  assert.deepEqual(ready, { ready: true, blockers: [] })
})

test('conclude 第二次给不同结论时报错，不写第二条评论，Decisions 保持旧结论', async (t) => {
  const { gh, parent, mapIssue, sink } = await setup(t, { fog: ['送货范围怎么定'] })
  const created = await run(
    cli('ticket', parent, [
      '--title', '送货范围怎么定',
      '--type', 'grilling',
      '--question', '送货送到哪？',
      '--from-item', '送货范围怎么定',
    ]),
    { gh, log: sink },
  )
  await run(cli('conclude', parent, ['--ticket', '01', '--conclusion', '只送镇上']), { gh, log: sink })
  const bodyBefore = await mapBodyOf(gh, mapIssue)

  await assert.rejects(
    run(cli('conclude', parent, ['--ticket', '01', '--conclusion', '只送镇上和邻镇']), { gh, log: sink }),
    /这张票已有结论，改结论走改口\/重传/,
  )

  const comments = await gh.listComments({ owner: OWNER, repo: REPO, number: created.ticket.number })
  assert.deepEqual(comments.map((row) => row.body), ['结论：只送镇上'])
  const bodyAfter = await mapBodyOf(gh, mapIssue)
  assert.equal(bodyAfter, bodyBefore)
  assert.equal(linesCount(bodyAfter, '- 01 送货范围怎么定：只送镇上'), 1)
})
