import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'
import { run as runGap } from '../bin/gap.mjs'
import { createGithub } from '../lib/github.mjs'
import { collectSnapshot } from '../lib/scheduler.mjs'
import { createDecompose } from '../lib/scheduler-jobs.mjs'
import { gateReady } from '../lib/gap.mjs'
import { parseMap, readDecisionTickets } from '../lib/map-issues.mjs'
import { parseParentAcceptance } from '../lib/tickets.mjs'
import { startFakeGithub } from './fake-github.mjs'
import {
  SIM_OWNER,
  SIM_REPO,
  SIM_REQUIREMENTS,
  buildParentBody,
  buildSpec,
  writeInboxPackage,
} from './sim/fixtures.mjs'
import {
  assertScratchRepo,
  closeMapDecisionTickets,
  createQueuedChild,
  createSimParent,
  ensureSimLabels,
  postSplitPoint,
  seedMapFromPackage,
  seedSpec,
  setSimState,
  writeSimCustomers,
  writeSimNotifierConfig,
} from './sim/seed.mjs'
import { createFakeActions, runSimRound } from './sim/round.mjs'

const SILENT = { log() {} }
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const execFileAsync = promisify(execFile)

async function tempDir(t, prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

async function startSim(t, { seed = true } = {}) {
  const fake = await startFakeGithub({ repos: [{ owner: SIM_OWNER, name: SIM_REPO }] })
  t.after(() => fake.close())
  const gh = createGithub({ apiBase: fake.base, token: 'test' })
  if (!seed) return { fake, gh }
  await ensureSimLabels({ gh, owner: SIM_OWNER, repo: SIM_REPO })
  return { fake, gh }
}

async function seedRequirement(t, gh, def, { proposal = false, point = false, closeDecisions = true } = {}) {
  const root = await tempDir(t, `afk-sim-${def.key}-`)
  const parent = await createSimParent({ gh, owner: SIM_OWNER, repo: SIM_REPO, def })
  const pkg = await writeInboxPackage({ root, def, owner: SIM_OWNER, repo: SIM_REPO, issueUrl: parent.html_url })
  const { mapIssue, tickets } = await seedMapFromPackage({
    gh,
    owner: SIM_OWNER,
    repo: SIM_REPO,
    def,
    scratchDir: pkg.scratchDir,
    parentIssueUrl: parent.html_url,
  })
  if (closeDecisions) {
    await closeMapDecisionTickets({ gh, owner: SIM_OWNER, repo: SIM_REPO, mapIssueNumber: mapIssue.number })
  }
  let proposalBody = ''
  if (proposal || point) {
    const result = await runGap(
      [
        'propose',
        '--scratch', pkg.scratchDir,
        '--owner', SIM_OWNER,
        '--repo', SIM_REPO,
        '--number', String(mapIssue.number),
      ],
      { gh, log: SILENT },
    )
    proposalBody = JSON.stringify(result.questions)
  }
  if (point) {
    await runGap(
      [
        'point',
        '--owner', SIM_OWNER,
        '--repo', SIM_REPO,
        '--number', String(parent.number),
        '--answers', JSON.stringify(['技术栈：Next.js + Postgres']),
      ],
      { gh, log: SILENT },
    )
  }
  return { root, parent: await gh.getIssue({ owner: SIM_OWNER, repo: SIM_REPO, number: parent.number }), pkg, mapIssue, tickets, proposalBody }
}

test('假回传件：meta.json 和 .scratch 文件按契约写出', async (t) => {
  const def = SIM_REQUIREMENTS[0]
  const root = await tempDir(t, 'afk-sim-package-')
  const pkg = await writeInboxPackage({
    root,
    def,
    owner: SIM_OWNER,
    repo: SIM_REPO,
    issueUrl: `https://github.com/${SIM_OWNER}/${SIM_REPO}/issues/7`,
  })

  const meta = JSON.parse(await readFile(pkg.metaPath, 'utf8'))
  assert.equal(meta.status, 'imported')
  assert.deepEqual(meta.imported, [
    {
      order_id: def.orderId,
      requirement: def.requirement,
      product: def.product,
      owner: SIM_OWNER,
      repo: SIM_REPO,
      issue_url: `https://github.com/${SIM_OWNER}/${SIM_REPO}/issues/7`,
      branch: `req/${def.orderId}`,
    },
  ])
  for (const name of ['map.md', 'pending.md', '验收场景.md', '决策记录.md']) {
    await stat(join(pkg.scratchDir, name))
  }
  await stat(join(pkg.scratchDir, 'issues', def.decisionFile))
})

test('假回传件：map.md 六段和决定票能被解析', async (t) => {
  const def = SIM_REQUIREMENTS[0]
  const root = await tempDir(t, 'afk-sim-parse-')
  const pkg = await writeInboxPackage({
    root,
    def,
    owner: SIM_OWNER,
    repo: SIM_REPO,
    issueUrl: `https://github.com/${SIM_OWNER}/${SIM_REPO}/issues/7`,
  })
  const map = parseMap(await readFile(join(pkg.scratchDir, 'map.md'), 'utf8'))
  assert.equal(map.notYetSpecified, '')
  assert.match(map.next, /^\s*-\s*1\s+/m)
  const tickets = await readDecisionTickets(join(pkg.scratchDir, 'issues'))
  assert.equal(tickets.length, 1)
  assert.equal(tickets[0].number, '01')
  assert.equal(tickets[0].type, 'grilling')
  assert.equal(tickets[0].status, 'open')
  assert.ok(tickets[0].question.length > 0)
})

test('父工单正文能拆出验收条件，并带 order 和需求名', () => {
  const def = SIM_REQUIREMENTS[1]
  const body = buildParentBody(def)
  assert.match(body, /<!-- factory:order=o-sim-0002 -->/)
  assert.match(body, /-\s*需求名：baoxiu-gongdan/m)
  assert.deepEqual(parseParentAcceptance(body), def.acceptance)
})

test('apply-map 在假仓建出地图和决定票，关票后 gateReady 通过', async (t) => {
  const def = SIM_REQUIREMENTS[0]
  const { gh } = await startSim(t)
  const { parent, mapIssue, tickets } = await seedRequirement(t, gh, def)

  assert.equal(tickets.length, 1)
  const freshParent = await gh.getIssue({ owner: SIM_OWNER, repo: SIM_REPO, number: parent.number })
  assert.match(freshParent.body, new RegExp(`- 地图：${mapIssue.html_url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))

  const blocked = await gateReady({
    gh,
    owner: SIM_OWNER,
    repo: SIM_REPO,
    mapIssueNumber: mapIssue.number,
    mapBody: mapIssue.body,
  })
  assert.equal(blocked.ready, true, JSON.stringify(blocked.blockers))
})

test('propose 写提案，point 在地图补完后写点头', async (t) => {
  const def = SIM_REQUIREMENTS[0]
  const { gh } = await startSim(t)
  const { parent, pkg, mapIssue } = await seedRequirement(t, gh, def, { proposal: true })

  let comments = await gh.listComments({ owner: SIM_OWNER, repo: SIM_REPO, number: parent.number })
  assert.equal(comments.at(-1).body.split('\n')[0], '提案：补缺口')
  assert.match(comments.at(-1).body, /## 技术题/)
  assert.match(comments.at(-1).body, new RegExp(def.pendingQuestion))

  const result = await runGap(
    [
      'point',
      '--owner', SIM_OWNER,
      '--repo', SIM_REPO,
      '--number', String(parent.number),
      '--answers', JSON.stringify({ answers: ['技术栈：Next.js + Postgres'], impacts: ['无'] }),
    ],
    { gh, log: SILENT },
  )
  assert.equal(result.posted, true)
  comments = await gh.listComments({ owner: SIM_OWNER, repo: SIM_REPO, number: parent.number })
  assert.equal(comments.at(-1).body.split('\n')[0], '点头：补缺口')
  assert.match(comments.at(-1).body, /## 最终答案/)

  const again = await gateReady({
    gh,
    owner: SIM_OWNER,
    repo: SIM_REPO,
    mapIssueNumber: mapIssue.number,
    mapBody: mapIssue.body,
  })
  assert.equal(again.ready, true)
  assert.ok(pkg.scratchDir)
})

test('拆票 brief 带父工单验收条件和假 spec', async (t) => {
  const def = SIM_REQUIREMENTS[1]
  const { gh } = await startSim(t)
  const { parent, mapIssue } = await seedRequirement(t, gh, def, { proposal: true, point: true })
  const spec = await seedSpec({ gh, owner: SIM_OWNER, repo: SIM_REPO, def })
  const snapshot = await collectSnapshot({ gh, owner: SIM_OWNER, repo: SIM_REPO })
  const row = snapshot.parents.find((item) => item.number === parent.number)
  assert.ok(row.spec, '父工单应匹配到假 spec')

  const briefs = []
  const fakeRunner = {
    async run(options) {
      briefs.push(options.brief)
      return { ok: true, code: 0, stdout: '', stderr: '' }
    },
  }
  const decompose = createDecompose({ runner: fakeRunner, gh, skip: false })
  const result = await decompose({ owner: SIM_OWNER, repo: SIM_REPO, parent: row, spec: row.spec })

  assert.equal(briefs.length, 1, '拆票 agent 被叫一次')
  assert.ok(result !== undefined)
  assert.match(briefs[0], /## 验收条件/)
  for (const item of def.acceptance) assert.ok(briefs[0].includes(item), item)
  assert.ok(briefs[0].includes(def.requirement), 'brief 带需求名')
  assert.ok(briefs[0].includes(spec.title), 'brief 带假 spec 标题')
  assert.ok(briefs[0].includes('提案：拆票'))
  assert.ok(mapIssue.number)
})

test('一轮调度：补缺口、拆票、点火三条决策，假 ignite 只记录', async (t) => {
  const [gapDef, splitDef, igniteDef] = SIM_REQUIREMENTS
  const { gh } = await startSim(t)

  const gapSeed = await seedRequirement(t, gh, gapDef)
  const splitSeed = await seedRequirement(t, gh, splitDef, { proposal: true, point: true })
  const igniteSeed = await seedRequirement(t, gh, igniteDef, { proposal: true, point: true })

  await setSimState({
    gh,
    owner: SIM_OWNER,
    repo: SIM_REPO,
    issue: splitSeed.parent,
    state: '排队中',
  })
  await setSimState({
    gh,
    owner: SIM_OWNER,
    repo: SIM_REPO,
    issue: igniteSeed.parent,
    state: '排队中',
  })
  await seedSpec({ gh, owner: SIM_OWNER, repo: SIM_REPO, def: gapDef })
  const splitSpec = await seedSpec({ gh, owner: SIM_OWNER, repo: SIM_REPO, def: splitDef })
  await seedSpec({ gh, owner: SIM_OWNER, repo: SIM_REPO, def: igniteDef })
  await postSplitPoint({ gh, owner: SIM_OWNER, repo: SIM_REPO, parent: igniteSeed.parent })
  const child = await createQueuedChild({
    gh,
    owner: SIM_OWNER,
    repo: SIM_REPO,
    def: igniteDef,
    parent: igniteSeed.parent,
  })

  const stateDir = await tempDir(t, 'afk-sim-round-')
  const customersPath = join(stateDir, 'customers.json')
  await writeSimCustomers(customersPath, { owner: SIM_OWNER, repo: SIM_REPO })
  const notifier = {
    events: [],
    async send(event) {
      this.events.push(event)
      return { code: 0, stdout: '{}' }
    },
  }
  const actions = createFakeActions()
  const { lines, report } = await runSimRound({
    gh,
    owner: SIM_OWNER,
    repo: SIM_REPO,
    customersPath,
    stateDir,
    notifier,
    actions,
    clock: () => new Date('2026-11-24T10:00:00+08:00'),
  })

  const byParent = new Map(lines.map((line) => [line.parent, line]))
  assert.equal(byParent.get(gapSeed.parent.number)?.decision, 'gap-proposal')
  assert.equal(byParent.get(splitSeed.parent.number)?.decision, 'decompose')
  assert.equal(byParent.get(igniteSeed.parent.number)?.decision, 'develop')
  assert.match(byParent.get(igniteSeed.parent.number)?.reason || '', new RegExp(`点火:#${child.number}`))

  assert.equal(actions.gapCalls.length, 1)
  assert.equal(actions.gapCalls[0].parent, gapSeed.parent.number)
  assert.equal(actions.decomposeCalls.length, 1)
  assert.equal(actions.decomposeCalls[0].parent, splitSeed.parent.number)
  assert.equal(actions.decomposeCalls[0].spec, splitSpec.number)
  assert.equal(actions.toSpecCalls.length, 0, '不跑 to-spec')
  assert.equal(actions.pipelineCalls.length, 1, '流水线只跑一次')
  assert.deepEqual(actions.igniteCalls, [
    {
      owner: SIM_OWNER,
      repo: SIM_REPO,
      parent: igniteSeed.parent.number,
      ticket: child.number,
      action: 'ignite',
    },
  ])

  const jobs = JSON.parse(await readFile(join(stateDir, 'jobs.json'), 'utf8'))
  const row = Object.values(jobs.jobs).find((item) => item.action === 'ignite')
  assert.equal(row.ticket, child.number)
  assert.equal(row.attempt, 0)
  assert.equal(row.stop, '')
  assert.deepEqual(report.errors, [])
  assert.ok(notifier.events.length >= 1)
  assert.equal(gapSeed.parent.number !== splitSeed.parent.number, true)
})

test('临时 notifier 和 customers 只指向模拟环境', async (t) => {
  const stateDir = await tempDir(t, 'afk-sim-config-')
  const customersPath = join(stateDir, 'customers.json')
  await writeSimCustomers(customersPath, { owner: SIM_OWNER, repo: SIM_REPO })
  const customers = JSON.parse(await readFile(customersPath, 'utf8'))
  assert.deepEqual(customers, [
    {
      id: 'sim-customer',
      short_name: '模拟客户',
      status: 'active',
      repos: { [SIM_REPO]: SIM_REPO },
    },
  ])

  const home = join(stateDir, 'notifier')
  const config = await writeSimNotifierConfig(home)
  assert.equal(config.channels.orca_bot.enabled, true)
  assert.equal(config.channels.orca_bot.bot, 'afk')
  assert.equal(config.channels.email.enabled, false)
  assert.equal(config.channels.push.enabled, false)
  const saved = JSON.parse(await readFile(join(home, 'config.json'), 'utf8'))
  assert.deepEqual(saved, config)
})

test('临时 notifier 给两张父工单各开 chat，不碰主 config', async (t) => {
  const stateDir = await tempDir(t, 'afk-sim-chat-')
  const home = join(stateDir, 'notifier')
  const orca = join(stateDir, 'fake-orca.mjs')
  const callsPath = join(stateDir, 'orca-calls.jsonl')
  await writeFile(
    orca,
    [
      '#!/usr/bin/env node',
      "import { appendFileSync } from 'node:fs'",
      'const args = process.argv.slice(2)',
      'if (process.env.ORCA_CALL_LOG) {',
      "  appendFileSync(process.env.ORCA_CALL_LOG, JSON.stringify(args) + '\\n')",
      '}',
      "if (args[0] === 'bot' && args[1] === 'chats') {",
      "  console.log(JSON.stringify({ ok: true, result: { chats: [] } }))",
      "} else if (args[0] === 'orchestration' && args[1] === 'send') {",
      "  console.log(JSON.stringify({ ok: true, result: { id: 'sim-message' } }))",
      '} else {',
      "  console.log(JSON.stringify({ ok: false, error: { message: 'unknown command' } }))",
      '  process.exit(1)',
      '}',
    ].join('\n'),
    'utf8',
  )
  await chmod(orca, 0o755)
  await writeSimNotifierConfig(home, { command: orca })

  const events = [
    {
      v: 1,
      key: 'sim-chat-gap-101',
      event: '补缺口提案',
      occurred_at: '2026-11-24T10:00:00+08:00',
      link: `https://github.com/${SIM_OWNER}/${SIM_REPO}/issues/101`,
      data: {
        customer: '模拟咖啡店',
        requirement: 'yuyue-kafei',
        question_count: 1,
        owner: SIM_OWNER,
        repo: SIM_REPO,
        ticket: 101,
        kind: 'gap',
        comment_url: `https://github.com/${SIM_OWNER}/${SIM_REPO}/issues/101#issuecomment-1001`,
      },
    },
    {
      v: 1,
      key: 'sim-chat-split-102',
      event: '拆票提案',
      occurred_at: '2026-11-24T10:01:00+08:00',
      link: `https://github.com/${SIM_OWNER}/${SIM_REPO}/issues/102`,
      data: {
        customer: '模拟五金店',
        requirement: 'baoxiu-gongdan',
        ticket_count: 3,
        owner: SIM_OWNER,
        repo: SIM_REPO,
        ticket: 102,
        kind: 'split',
        comment_url: `https://github.com/${SIM_OWNER}/${SIM_REPO}/issues/102#issuecomment-1002`,
      },
    },
  ]
  for (const event of events) {
    const eventPath = join(stateDir, `${event.key}.json`)
    await writeFile(eventPath, `${JSON.stringify(event)}\n`, 'utf8')
    const result = await execFileAsync(
      'python3',
      ['-m', 'notifier', 'send', '--event-file', eventPath],
      {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          NOTIFIER_HOME: home,
          ORCA_CALL_LOG: callsPath,
        },
      },
    )
    assert.match(String(result.stdout), /"ok": true/)
  }

  const rows = (await readFile(callsPath, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  const sends = rows.filter((args) => args[0] === 'orchestration' && args[1] === 'send')
  assert.equal(sends.length, 2)
  const subjects = sends.map((args) => args[args.indexOf('--subject') + 1]).sort()
  assert.deepEqual(subjects, [
    `拆票 ${SIM_OWNER}/${SIM_REPO}#102`,
    `补缺口 ${SIM_OWNER}/${SIM_REPO}#101`,
  ].sort())
  for (const args of sends) {
    assert.ok(args.includes('--chat'))
    assert.ok(args.includes('new'), '找不到 chat 时用 --chat new')
    const body = args[args.indexOf('--body') + 1]
    assert.match(body, /https:\/\/github\.com\/Lil-BobCN\/scratch-bot-sim\/issues\/10[12]/)
    assert.match(body, /提案评论：https:\/\/github\.com\//)
  }
})

test('清理守卫只认 scratch 仓', () => {
  assert.equal(assertScratchRepo(SIM_REPO), true)
  assert.throws(() => assertScratchRepo('some-customer-repo'), /scratch-bot-sim/)
  assert.equal(assertScratchRepo('some-customer-repo', { force: true }), true)
  assert.ok(buildSpec(SIM_REQUIREMENTS[0]).title.includes(SIM_REQUIREMENTS[0].requirement))
})
