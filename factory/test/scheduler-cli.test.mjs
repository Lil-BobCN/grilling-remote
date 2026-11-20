import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { run, runSummary } from '../bin/scheduler.mjs'
import { addRemote, commitAll, git, initBareRepo, initRepo, push } from '../lib/git.mjs'
import { createGithub } from '../lib/github.mjs'
import { ensureLabel } from '../lib/issues.mjs'
import { STATE_LABELS, runOnce } from '../lib/scheduler.mjs'
import { startFakeGithub } from './fake-github.mjs'

const OWNER = 'acme'
const REPO = 'acme-demo'

function body() {
  return [
    '## 客户原话',
    '',
    '> 「要个预约取货」',
    '',
    '## 需求全文',
    '',
    '- 客户简称：acme',
    '- 需求名：yuyue-quhuo',
    '',
    '<!-- factory:order=o-0001 -->',
  ].join('\n')
}

test('--once 每张父工单打印一行 {repo,parent,decision,actions}', async (t) => {
  const fake = await startFakeGithub({ repos: [{ owner: OWNER, name: REPO }] })
  t.after(() => fake.close())
  const gh = createGithub({ apiBase: fake.base, token: 'test' })
  for (const [name, meta] of Object.entries(STATE_LABELS)) {
    await ensureLabel(gh, { owner: OWNER, repo: REPO, name, ...meta })
  }
  for (const name of ['Sandcastle', 'needs-info', '大小:小需求', 'ready-for-agent', 'wayfinder:map', 'wayfinder:grilling']) {
    await ensureLabel(gh, { owner: OWNER, repo: REPO, name })
  }
  const parent = await gh.createIssue({
    owner: OWNER,
    repo: REPO,
    title: '要个预约取货',
    body: body(),
    labels: ['状态:已提交'],
  })
  await gh.createComment({ owner: OWNER, repo: REPO, number: parent.number, body: '点头：补缺口' })

  const dir = await mkdtemp(join(tmpdir(), 'afk-scheduler-cli-'))
  const customersPath = join(dir, 'customers.json')
  await writeFile(
    customersPath,
    JSON.stringify([{ id: 'c-0001', short_name: 'acme', status: 'active', repos: { demo: REPO } }]),
  )

  const lines = []
  const notifier = {
    delivered: new Map(),
    async send(event) {
      if (!this.delivered.has(event.key)) this.delivered.set(event.key, event)
      return { code: 0, stdout: '{}' }
    },
  }

  await run(['--once', '--customers', customersPath, '--owner', OWNER], {
    gh,
    notifier,
    out: (line) => lines.push(JSON.parse(line)),
    clock: () => new Date('2026-11-17T10:00:00+08:00'),
    jobsFile: join(dir, 'jobs.json'),
  })

  assert.equal(lines.length, 1)
  assert.equal(lines[0].repo, 'acme/acme-demo')
  assert.equal(lines[0].parent, parent.number)
  assert.equal(lines[0].decision, 'advance')
  assert.ok(Array.isArray(lines[0].actions))
  assert.match(lines[0].reason, /点头：补缺口/)
  assert.ok(lines[0].executed, '输出带 executed')
  assert.ok(Array.isArray(lines[0].errors), '输出带 errors')

  const stored = fake.state.issues.get(`${OWNER}/${REPO}`).find((row) => row.number === parent.number)
  assert.deepEqual(stored.labels, ['状态:排队中'])
})

test('--once 缺 --owner 时报错，不偷偷扫账号', async () => {
  await assert.rejects(
    run(['--once', '--customers', '/tmp/nope.json'], { gh: {}, notifier: {} }),
    /缺 --owner/,
  )
})

test('runSummary 把每张父工单的 executed 和 report.errors 收成一行', () => {
  const summary = runSummary({
    now: '2026-11-17T10:00:00.000Z',
    repos: [
      {
        repo: REPO,
        parents: [
          { parent: 1, decision: 'develop', executed: { skipped: null, results: [{ type: 'ignite' }] } },
        ],
      },
    ],
    errors: [{ repo: REPO, parent: 1, message: '点火失败' }],
  })
  assert.equal(summary.ts, '2026-11-17T10:00:00.000Z')
  assert.equal(summary.executed.length, 1)
  assert.equal(summary.executed[0].parent, 1)
  assert.deepEqual(summary.executed[0].executed.results, [{ type: 'ignite' }])
  assert.equal(summary.errors.length, 1)
})

async function repoFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'afk-scheduler-cli-repo-'))
  t.after(() => rm(root, { recursive: true, force: true }))

  const bare = join(root, 'remote.git')
  await initBareRepo(bare)

  const seed = join(root, 'seed')
  await initRepo(seed)
  await writeFile(join(seed, 'AGENTS.md'), '# 规则\n\nAGENTS-CLI\n')
  await mkdir(join(seed, 'docs', 'agents'), { recursive: true })
  await writeFile(join(seed, 'docs', 'agents', 'feature-map.md'), '# 地图\n')
  await mkdir(join(seed, 'src'), { recursive: true })
  await writeFile(join(seed, 'src', 'app.mjs'), 'export const APP = 1\n')
  await commitAll(seed, 'FACTORY: 初始提交')
  await addRemote(seed, 'origin', bare)
  await push(seed, { branch: 'main', setUpstream: true })

  await git(seed, ['checkout', '-b', 'req/o-0001'])
  await writeFile(join(seed, 'req.txt'), '需求分支\n')
  await commitAll(seed, 'FACTORY: 需求分支')
  await push(seed, { branch: 'req/o-0001' })

  return { root, bare }
}

async function ignitionScenario(t) {
  const fake = await startFakeGithub({ repos: [{ owner: OWNER, name: REPO }] })
  t.after(() => fake.close())
  const gh = createGithub({ apiBase: fake.base, token: 'test' })
  for (const [name, meta] of Object.entries(STATE_LABELS)) {
    await ensureLabel(gh, { owner: OWNER, repo: REPO, name, ...meta })
  }
  for (const name of ['Sandcastle', 'needs-info', '大小:小需求', 'ready-for-agent', 'wayfinder:map', 'wayfinder:grilling']) {
    await ensureLabel(gh, { owner: OWNER, repo: REPO, name })
  }

  const parent = await gh.createIssue({
    owner: OWNER,
    repo: REPO,
    title: '要个预约取货',
    body: body(),
    labels: ['状态:排队中'],
  })
  await gh.createIssue({
    owner: OWNER,
    repo: REPO,
    title: 'spec yuyue-quhuo',
    body: '## Problem Statement\n\n预约取货。',
    labels: ['ready-for-agent'],
  })
  const child = await gh.createIssue({
    owner: OWNER,
    repo: REPO,
    title: '看到今天水果',
    body: '## 垂直切片\n\n顾客看到水果。\n\n## 验收条件\n\n- [ ] 看到名单。\n',
    labels: ['状态:排队中'],
  })
  await gh.addSubIssue({ owner: OWNER, repo: REPO, number: parent.number, subIssueId: child.id })
  await gh.createComment({ owner: OWNER, repo: REPO, number: parent.number, body: '点头：拆票' })

  const dir = await mkdtemp(join(tmpdir(), 'afk-scheduler-cli-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const customersPath = join(dir, 'customers.json')
  await writeFile(
    customersPath,
    JSON.stringify([{ id: 'c-0001', short_name: 'acme', status: 'active', repos: { demo: REPO } }]),
  )

  return { fake, gh, parent, child, customersPath, jobsFile: join(dir, 'jobs.json') }
}

function issueRow(fake, number) {
  return fake.state.issues.get(`${OWNER}/${REPO}`).find((row) => row.number === number)
}

function quietNotifier() {
  return {
    delivered: new Map(),
    async send(event) {
      if (!this.delivered.has(event.key)) this.delivered.set(event.key, event)
      return { code: 0, stdout: '{}' }
    },
  }
}

test('默认注入 ignite：--once 自己点火，贴 Sandcastle，父工单转开发中', async (t) => {
  const { fake, gh, parent, child, customersPath, jobsFile } = await ignitionScenario(t)
  const { root, bare } = await repoFixture(t)
  const runnerCalls = []
  async function runner(args) {
    runnerCalls.push(args)
    args.started()
    return { commits: [{ sha: 'abc123' }], branch: args.ticketBranch }
  }
  const prCalls = []
  async function openPr(args) {
    prCalls.push(args)
    return { url: 'https://github.com/acme/acme-demo/pull/9' }
  }
  const pushCalls = []
  async function push(args) {
    pushCalls.push(args)
    return { branch: args.branch }
  }
  const lines = []

  await run(['--once', '--customers', customersPath, '--owner', OWNER], {
    gh,
    notifier: quietNotifier(),
    runner,
    openPr,
    push,
    out: (line) => lines.push(JSON.parse(line)),
    clock: () => new Date('2026-11-17T10:00:00+08:00'),
    repoRoot: join(root, 'repos'),
    lockDir: join(root, 'locks'),
    jobsFile,
    config: { remoteUrlFor: () => bare, log: () => {} },
  })

  assert.equal(lines.length, 1)
  assert.equal(lines[0].parent, parent.number)
  assert.equal(lines[0].decision, 'develop')
  assert.equal(runnerCalls.length, 1)
  assert.equal(pushCalls.length, 1)
  assert.equal(pushCalls[0].branch, `ticket/${child.number}`)
  assert.equal(prCalls.length, 1)
  assert.equal(prCalls[0].base, 'req/o-0001')
  assert.equal(prCalls[0].head, `ticket/${child.number}`)

  assert.ok(issueRow(fake, child.number).labels.includes('Sandcastle'))
  assert.ok(issueRow(fake, child.number).labels.includes('状态:开发中'))
  assert.ok(issueRow(fake, parent.number).labels.includes('状态:开发中'))
})

test('--dry-run 只读：打印 develop，不点火、不改标签', async (t) => {
  const { fake, gh, parent, child, customersPath } = await ignitionScenario(t)
  let fired = 0
  const lines = []

  await run(['--dry-run', '--customers', customersPath, '--owner', OWNER], {
    gh,
    notifier: quietNotifier(),
    runner: async () => {
      fired += 1
      throw new Error('dry-run 不该点火')
    },
    openPr: async () => {
      fired += 1
      throw new Error('dry-run 不该开 PR')
    },
    out: (line) => lines.push(JSON.parse(line)),
    clock: () => new Date('2026-11-17T10:00:00+08:00'),
    config: { log: () => {} },
  })

  assert.equal(fired, 0)
  assert.equal(lines.length, 1)
  assert.equal(lines[0].parent, parent.number)
  assert.equal(lines[0].decision, 'develop')
  assert.deepEqual(issueRow(fake, child.number).labels, ['状态:排队中'])
  assert.deepEqual(issueRow(fake, parent.number).labels, ['状态:排队中'])
})

test('运行中改 customers.json：下一轮按新表扫到新客户仓', async (t) => {
  const fake = await startFakeGithub({
    repos: [
      { owner: OWNER, name: REPO },
      { owner: OWNER, name: 'acme-second' },
    ],
  })
  t.after(() => fake.close())
  const gh = createGithub({ apiBase: fake.base, token: 'test' })
  const dir = await mkdtemp(join(tmpdir(), 'afk-scheduler-reread-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const customersPath = join(dir, 'customers.json')
  const repoOne = { id: 'c-0001', short_name: 'acme', status: 'active', repos: { demo: REPO } }
  const repoTwo = { id: 'c-0002', short_name: 'second', status: 'active', repos: { demo: 'acme-second' } }
  await writeFile(customersPath, JSON.stringify([repoOne]))

  const seen = []
  const controller = new AbortController()
  const runOnceImpl = async (options) => {
    const report = await runOnce(options)
    seen.push(report.repos.map((row) => row.fullName))
    if (seen.length === 1) {
      await writeFile(customersPath, JSON.stringify([repoOne, repoTwo]))
      const later = new Date(Date.now() + 5000)
      await utimes(customersPath, later, later)
    } else {
      controller.abort()
    }
    return report
  }

  await run(['--loop', '--customers', customersPath, '--owner', OWNER], {
    gh,
    notifier: quietNotifier(),
    out: () => {},
    runOnceImpl,
    signal: controller.signal,
    jobsFile: join(dir, 'jobs.json'),
    intervalMs: 5,
    ghRun: async () => ({ code: 0, stdout: '[]' }),
    config: { log: () => {}, previewSweep: async () => ({}) },
  })

  assert.equal(seen.length, 2, '至少跑两轮')
  assert.deepEqual(seen[0], [`${OWNER}/${REPO}`])
  assert.deepEqual(seen[1].sort(), [`${OWNER}/${REPO}`, `${OWNER}/acme-second`].sort())
})

test('运行中 customers.json 形状变坏：当轮报 ConfigError，不静默用旧表', async (t) => {
  const fake = await startFakeGithub({ repos: [{ owner: OWNER, name: REPO }] })
  t.after(() => fake.close())
  const gh = createGithub({ apiBase: fake.base, token: 'test' })
  const dir = await mkdtemp(join(tmpdir(), 'afk-scheduler-reread-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const customersPath = join(dir, 'customers.json')
  await writeFile(
    customersPath,
    JSON.stringify([{ id: 'c-0001', short_name: 'acme', status: 'active', repos: { demo: REPO } }]),
  )

  const failures = []
  const controller = new AbortController()
  let rounds = 0
  const runOnceImpl = async (options) => {
    rounds += 1
    if (rounds === 1) {
      const report = await runOnce(options)
      await writeFile(customersPath, JSON.stringify([{ id: 'c-0001', short_name: 'acme', status: '坏' }]))
      const later = new Date(Date.now() + 5000)
      await utimes(customersPath, later, later)
      return report
    }
    try {
      return await runOnce(options)
    } catch (error) {
      failures.push(error)
      controller.abort()
      throw error
    }
  }

  await run(['--loop', '--customers', customersPath, '--owner', OWNER], {
    gh,
    notifier: quietNotifier(),
    out: () => {},
    runOnceImpl,
    signal: controller.signal,
    jobsFile: join(dir, 'jobs.json'),
    intervalMs: 5,
    ghRun: async () => ({ code: 0, stdout: '[]' }),
    config: { log: () => {}, previewSweep: async () => ({}) },
  })

  assert.equal(rounds, 2)
  assert.equal(failures.length, 1)
  assert.match(failures[0].message, /status 必须是 active 或 disabled/)
})
