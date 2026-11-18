import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { run as runIgniteCli } from '../bin/ignite.mjs'
import { createGithub } from '../lib/github.mjs'
import { ensureLabel } from '../lib/issues.mjs'
import { addRemote, commitAll, git, initBareRepo, initRepo, push } from '../lib/git.mjs'
import { buildPrompt, createGhOpenPr, createIgnite } from '../lib/ignition.mjs'
import { progressLine } from '../lib/progress.mjs'
import { createSandcastleRunner } from '../lib/sandcastle-runner.mjs'
import { runOnce, stallHits } from '../lib/scheduler.mjs'
import { startFakeGithub } from './fake-github.mjs'

const OWNER = 'acme'
const REPO = 'demo'
const ORDER = 'o-0001'
const REQ_BRANCH = `req/${ORDER}`

const TICKET_BODY = [
  '## 垂直切片',
  '',
  '顾客打开链接，看到今天的水果。',
  '',
  '## 验收条件',
  '',
  '- [ ] 打开链接，看到当天水果的名单。',
  '',
  '## 阻塞',
  '',
  'Blocked by: #12',
  '',
  '相关代码：`src/app.mjs`',
].join('\n')

function parentBody() {
  return [
    '## 客户原话',
    '',
    '> 「要个预约取货」',
    '',
    '## 需求全文',
    '',
    `- 客户简称：${OWNER}`,
    '- 需求名：yuyue-quhuo',
    '- 全文：https://github.com/acme/demo/tree/main/docs/requirements/yuyue-quhuo/',
    '',
    `<!-- factory:order=${ORDER} -->`,
  ].join('\n')
}

async function makeRepoFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'afk-ignition-'))
  t.after(() => rm(root, { recursive: true, force: true }))

  const bare = join(root, 'remote.git')
  await initBareRepo(bare)

  const seed = join(root, 'seed')
  await initRepo(seed)
  await writeFile(join(seed, 'AGENTS.md'), '# 仓库规则\n\nAGENTS-MARKER\n')
  await mkdir(join(seed, 'docs', 'agents'), { recursive: true })
  await writeFile(join(seed, 'docs', 'agents', 'feature-map.md'), '# 功能地图\n\nFEATURE-MAP-MARKER\n')
  await mkdir(join(seed, 'src'), { recursive: true })
  await writeFile(join(seed, 'src', 'app.mjs'), 'export const APP = "APP-SOURCE-MARKER"\n')
  await mkdir(join(seed, 'scripts'), { recursive: true })
  await writeFile(join(seed, 'scripts', 'check.sh'), 'echo CHECK-SCRIPT-MARKER\n')
  await commitAll(seed, 'FACTORY: 初始提交')
  await addRemote(seed, 'origin', bare)
  await push(seed, { branch: 'main', setUpstream: true })

  await git(seed, ['checkout', '-b', REQ_BRANCH])
  await writeFile(join(seed, 'req.txt'), '需求分支\n')
  await commitAll(seed, 'FACTORY: 需求分支')
  await push(seed, { branch: REQ_BRANCH })
  await git(seed, ['checkout', 'main'])

  return { root, bare, seed }
}

async function setupGithub(t, { ticketBody = TICKET_BODY, ticketLabels = ['状态:排队中'], blocked = false } = {}) {
  const fake = await startFakeGithub({ repos: [{ owner: OWNER, name: REPO }] })
  t.after(() => fake.close())
  const gh = createGithub({ apiBase: fake.base, token: 'test' })
  for (const name of ['状态:排队中', '状态:开发中', '状态:待验收', 'Sandcastle', 'ready-for-agent', '点火超时']) {
    await ensureLabel(gh, { owner: OWNER, repo: REPO, name })
  }
  const parent = await gh.createIssue({
    owner: OWNER,
    repo: REPO,
    title: '要个预约取货',
    body: parentBody(),
    labels: ['状态:排队中'],
  })
  const ticket = await gh.createIssue({
    owner: OWNER,
    repo: REPO,
    title: '看到今天水果',
    body: ticketBody,
    labels: ticketLabels,
  })
  await gh.addSubIssue({
    owner: OWNER,
    repo: REPO,
    number: parent.number,
    subIssueId: ticket.id,
  })
  const spec = await gh.createIssue({
    owner: OWNER,
    repo: REPO,
    title: 'spec yuyue-quhuo',
    body: '## Problem Statement\n\nSPEC-BODY-MARKER\n',
    labels: ['ready-for-agent'],
  })
  let blocker = null
  if (blocked) {
    blocker = await gh.createIssue({
      owner: OWNER,
      repo: REPO,
      title: '还没做完的票',
      body: '',
      labels: ['状态:排队中'],
    })
    await gh.addBlockedBy({
      owner: OWNER,
      repo: REPO,
      number: ticket.number,
      issueId: blocker.id,
    })
  }
  return { fake, gh, parent, ticket, spec, blocker }
}

function labelsOf(fake, number) {
  return fake.state.issues.get(`${OWNER}/${REPO}`).find((row) => row.number === number).labels
}

function commentsOf(fake, number) {
  return fake.state.issues.get(`${OWNER}/${REPO}`).find((row) => row.number === number).comments.map((row) => row.body)
}

function fakeRunner(handler = async (args) => {
  args.started()
  return { commits: [{ sha: 'abc123' }], branch: args.ticketBranch }
}) {
  const calls = []
  return {
    calls,
    async run(args) {
      calls.push(args)
      return handler(args)
    },
  }
}

function fakeOpenPr(url = 'https://github.com/acme/demo/pull/7') {
  const calls = []
  return {
    calls,
    async openPr(args) {
      calls.push(args)
      return { url }
    },
  }
}

function fakePush(error = null) {
  const calls = []
  return {
    calls,
    async push(args) {
      calls.push(args)
      if (error) throw error
      return { branch: args.branch }
    },
  }
}

function fakeNotifier() {
  const calls = []
  return {
    calls,
    async send(event) {
      calls.push(event)
      return { code: 0 }
    },
  }
}

function ignitionConfig(fixture, gh, overrides = {}) {
  return {
    gh,
    owner: OWNER,
    repoRoot: join(fixture.root, 'repos'),
    lockDir: join(fixture.root, 'locks'),
    remoteUrlFor: () => fixture.bare,
    timeoutMs: 1000,
    log: () => {},
    ...overrides,
  }
}

test('不点带未关闭阻塞的票，也不贴 Sandcastle', async (t) => {
  const fixture = await makeRepoFixture(t)
  const { fake, gh, parent, ticket } = await setupGithub(t, { blocked: true })
  const runner = fakeRunner()
  const pr = fakeOpenPr()
  const ignite = createIgnite({
    config: ignitionConfig(fixture, gh),
    runner: runner.run,
    openPr: pr.openPr,
    notifier: fakeNotifier(),
  })

  const result = await ignite({ owner: OWNER, repo: REPO, parent, ticket })

  assert.equal(result.ok, false)
  assert.equal(result.skipped, 'blocked')
  assert.equal(runner.calls.length, 0)
  assert.equal(pr.calls.length, 0)
  assert.ok(!labelsOf(fake, ticket.number).includes('Sandcastle'))
})

test('同一仓已有 Sandcastle 票时跳过，不改状态', async (t) => {
  const fixture = await makeRepoFixture(t)
  const { fake, gh, parent, ticket } = await setupGithub(t)
  await gh.createIssue({
    owner: OWNER,
    repo: REPO,
    title: '正在跑的票',
    body: '',
    labels: ['状态:排队中', 'Sandcastle'],
  })
  const runner = fakeRunner()
  const ignite = createIgnite({
    config: ignitionConfig(fixture, gh),
    runner: runner.run,
    openPr: fakeOpenPr().openPr,
    notifier: fakeNotifier(),
  })

  const result = await ignite({ owner: OWNER, repo: REPO, parent, ticket })

  assert.equal(result.ok, false)
  assert.equal(result.skipped, 'busy')
  assert.equal(runner.calls.length, 0)
  assert.deepEqual(labelsOf(fake, ticket.number), ['状态:排队中'])
})

test('同仓锁被别的进程拿着时跳过', async (t) => {
  const fixture = await makeRepoFixture(t)
  const { fake, gh, parent, ticket } = await setupGithub(t)
  const lockDir = join(fixture.root, 'locks')
  await mkdir(lockDir, { recursive: true })
  await writeFile(join(lockDir, `${OWNER}__${REPO}.lock`), '1')
  const runner = fakeRunner()
  const ignite = createIgnite({
    config: ignitionConfig(fixture, gh, { lockDir }),
    runner: runner.run,
    openPr: fakeOpenPr().openPr,
    notifier: fakeNotifier(),
  })

  const result = await ignite({ owner: OWNER, repo: REPO, parent, ticket })

  assert.equal(result.skipped, 'busy')
  assert.equal(runner.calls.length, 0)
  assert.deepEqual(labelsOf(fake, ticket.number), ['状态:排队中'])
})

test('两分钟没回执：写点火超时评论、打标签、发通知，摘 Sandcastle，写出事和进度', async (t) => {
  const fixture = await makeRepoFixture(t)
  const { fake, gh, parent, ticket } = await setupGithub(t)
  const runner = fakeRunner(() => new Promise(() => {}))
  const notifier = fakeNotifier()
  const ignite = createIgnite({
    config: ignitionConfig(fixture, gh, { timeoutMs: 60 }),
    runner: runner.run,
    openPr: fakeOpenPr().openPr,
    notifier,
    clock: () => new Date('2026-11-17T10:00:00+08:00'),
  })

  const result = await ignite({ owner: OWNER, repo: REPO, parent, ticket })

  assert.equal(result.ok, false)
  assert.equal(result.timeout, true)
  assert.equal(runner.calls.length, 1)

  const timeout = notifier.calls.find((event) => event.event === '点火超时')
  assert.ok(timeout, '没有发点火超时通知')
  assert.deepEqual(timeout.data, { customer: OWNER, requirement: 'yuyue-quhuo' })
  assert.match(timeout.link, new RegExp(`/issues/${ticket.number}$`))

  const incident = notifier.calls.find((event) => event.event === '出事')
  assert.ok(incident, '没有发出事通知')
  assert.match(incident.data.reason, /点火失败/)
  assert.match(incident.data.reason, /两分钟没收到回执/)

  const comments = commentsOf(fake, ticket.number)
  assert.equal(comments.length, 1)
  assert.ok(comments[0].startsWith('点火超时'))
  assert.ok(!labelsOf(fake, ticket.number).includes('Sandcastle'))
  assert.ok(labelsOf(fake, ticket.number).includes('状态:开发中'))
  assert.ok(!labelsOf(fake, ticket.number).includes('状态:排队中'))
  assert.ok(!labelsOf(fake, ticket.number).includes('状态:待验收'))

  const progress = commentsOf(fake, parent.number).filter((body) => body.startsWith('进度 v1｜'))
  assert.equal(progress.length, 1)
  assert.match(progress[0], /细阶段：点火失败/)
})

test('点火成功：贴 Sandcastle、写 prompt、跑 runner、开 PR、写评论', async (t) => {
  const fixture = await makeRepoFixture(t)
  const { fake, gh, parent, ticket } = await setupGithub(t)
  const runner = fakeRunner(async (args) => {
    args.started()
    return {
      commits: [{ sha: 'abc123' }, { sha: 'def456' }],
      branch: args.ticketBranch,
    }
  })
  const pr = fakeOpenPr('https://github.com/acme/demo/pull/7')
  const notifier = fakeNotifier()
  const ignite = createIgnite({
    config: ignitionConfig(fixture, gh),
    runner: runner.run,
    openPr: pr.openPr,
    push: fakePush().push,
    notifier,
  })

  const result = await ignite({ owner: OWNER, repo: REPO, parent, ticket })

  assert.equal(result.ok, true)
  assert.equal(result.branch, `ticket/${ticket.number}`)
  assert.deepEqual(result.commits, ['abc123', 'def456'])
  assert.equal(result.prUrl, 'https://github.com/acme/demo/pull/7')

  assert.equal(runner.calls.length, 1)
  const call = runner.calls[0]
  assert.equal(call.repoDir, join(fixture.root, 'repos', REPO))
  assert.equal(call.branch, REQ_BRANCH)
  assert.equal(call.ticketBranch, `ticket/${ticket.number}`)
  assert.equal(call.timeoutMs, 1000)
  assert.equal(call.worktree, join(call.repoDir, '.sandcastle', 'worktrees', `ticket-${ticket.number}`))

  const promptFile = call.prompt
  assert.equal(promptFile, join(call.repoDir, '.sandcastle', `prompt-${ticket.number}.md`))
  const prompt = await readFile(promptFile, 'utf8')
  assert.equal(prompt.split('\n')[0], '/tdd')
  assert.match(prompt, /SPEC-BODY-MARKER/)
  assert.match(prompt, /## 垂直切片/)
  assert.match(prompt, /## 验收条件/)
  assert.match(prompt, /AGENTS-MARKER/)
  assert.match(prompt, /FEATURE-MAP-MARKER/)
  assert.match(prompt, /APP-SOURCE-MARKER/)

  assert.equal(pr.calls.length, 1)
  assert.equal(pr.calls[0].base, REQ_BRANCH)
  assert.equal(pr.calls[0].head, `ticket/${ticket.number}`)
  assert.match(pr.calls[0].body, /## 摘要/)
  assert.match(pr.calls[0].body, /## 证据/)
  assert.match(pr.calls[0].body, /## 合并危险/)
  assert.match(pr.calls[0].body, /待验证队和评审判定/)
  assert.match(pr.calls[0].body, /## 影响范围/)

  assert.ok(labelsOf(fake, ticket.number).includes('Sandcastle'))
  assert.ok(labelsOf(fake, ticket.number).includes('状态:开发中'))
  assert.ok(!labelsOf(fake, ticket.number).includes('状态:排队中'))
  const comments = commentsOf(fake, ticket.number)
  assert.equal(comments.length, 1)
  assert.match(comments[0], new RegExp(`ticket/${ticket.number}`))
  assert.match(comments[0], /2 个提交/)
  assert.match(comments[0], /pull\/7/)
  assert.equal(notifier.calls.length, 0)
})

test('点火成功先 push 票分支，PR head 用 push 的分支', async (t) => {
  const fixture = await makeRepoFixture(t)
  const { fake, gh, parent, ticket } = await setupGithub(t)
  const branch = `ticket/${ticket.number}-fix`
  const logs = []
  const runner = fakeRunner(async () => {
    return { commits: [{ sha: 'abc123' }, { sha: 'def456' }], branch }
  })
  const push = fakePush()
  const pr = fakeOpenPr()
  const ignite = createIgnite({
    config: ignitionConfig(fixture, gh, { log: (row) => logs.push(row) }),
    runner: runner.run,
    openPr: pr.openPr,
    push: push.push,
    notifier: fakeNotifier(),
  })

  const result = await ignite({ owner: OWNER, repo: REPO, parent, ticket })

  assert.equal(result.ok, true)
  assert.equal(result.branch, branch)
  assert.equal(push.calls.length, 1)
  assert.equal(push.calls[0].branch, branch)
  assert.equal(push.calls[0].repoDir, join(fixture.root, 'repos', REPO))
  assert.equal(pr.calls.length, 1)
  assert.equal(pr.calls[0].head, branch)
  assert.match(commentsOf(fake, ticket.number)[0], new RegExp(branch))

  const done = logs.find((row) => row.msg === '点火完成')
  assert.equal(done.commits, 2)
  assert.deepEqual(done.afkResult, { commits: [{ sha: 'abc123' }, { sha: 'def456' }], branch })
})

test('本地需求分支有未推提交时先推送，点火不重置掉', async (t) => {
  const fixture = await makeRepoFixture(t)
  const { gh, parent, ticket } = await setupGithub(t)
  const repoDir = join(fixture.root, 'repos', REPO)
  await mkdir(join(fixture.root, 'repos'), { recursive: true })
  await git(fixture.root, ['clone', fixture.bare, repoDir])
  await git(repoDir, ['checkout', REQ_BRANCH])
  await writeFile(join(repoDir, 'merged.txt'), '上一张票的合并\n')
  await commitAll(repoDir, 'FACTORY: 合并 #10')
  const localHead = await git(repoDir, ['rev-parse', 'HEAD'])
  await git(repoDir, ['branch', `ticket/${ticket.number}`, localHead])
  assert.notEqual(await git(fixture.bare, ['rev-parse', REQ_BRANCH]), localHead)

  const runner = fakeRunner()
  const ignite = createIgnite({
    config: ignitionConfig(fixture, gh),
    runner: runner.run,
    openPr: fakeOpenPr().openPr,
    notifier: fakeNotifier(),
  })

  const result = await ignite({ owner: OWNER, repo: REPO, parent, ticket })

  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(
    await git(fixture.bare, ['rev-parse', REQ_BRANCH]),
    localHead,
    '未推提交要先推到 origin',
  )
  assert.equal(
    await git(repoDir, ['rev-parse', REQ_BRANCH]),
    localHead,
    '点火不能重置本地需求分支',
  )
  assert.equal(runner.calls.length, 1)
})

test('本地需求分支未推提交且推送失败时，点火报错且不重置', async (t) => {
  const fixture = await makeRepoFixture(t)
  const { gh, parent, ticket } = await setupGithub(t)
  const repoDir = join(fixture.root, 'repos', REPO)
  await mkdir(join(fixture.root, 'repos'), { recursive: true })
  await git(fixture.root, ['clone', fixture.bare, repoDir])
  await git(repoDir, ['checkout', REQ_BRANCH])
  await writeFile(join(repoDir, 'merged.txt'), '上一张票的合并\n')
  await commitAll(repoDir, 'FACTORY: 合并 #10')
  const localHead = await git(repoDir, ['rev-parse', 'HEAD'])

  const runner = fakeRunner()
  const ignite = createIgnite({
    config: ignitionConfig(fixture, gh),
    runner: runner.run,
    openPr: fakeOpenPr().openPr,
    push: async () => {
      throw new Error('deny')
    },
    notifier: fakeNotifier(),
  })

  const result = await ignite({ owner: OWNER, repo: REPO, parent, ticket })

  assert.equal(result.ok, false)
  assert.match(String(result.error), /没推到 origin/)
  assert.match(String(result.error), /deny/)
  assert.equal(await git(repoDir, ['rev-parse', REQ_BRANCH]), localHead, '不能静默重置')
  assert.equal(runner.calls.length, 0)
})

test('gh pr create 退出码 1 但 stdout 有 PR 地址：点火算完成，不重复开 PR', async (t) => {
  const fixture = await makeRepoFixture(t)
  const { fake, gh, parent, ticket } = await setupGithub(t)
  const runner = fakeRunner()
  const calls = []
  const openPr = createGhOpenPr({
    exec: async (command, args) => {
      calls.push({ command, args })
      return { code: 1, stdout: 'https://github.com/acme/demo/pull/15\n', stderr: '' }
    },
  })
  const ignite = createIgnite({
    config: ignitionConfig(fixture, gh),
    runner: runner.run,
    openPr,
    push: fakePush().push,
    notifier: fakeNotifier(),
  })

  const result = await ignite({ owner: OWNER, repo: REPO, parent, ticket })

  assert.equal(result.ok, true)
  assert.equal(result.prUrl, 'https://github.com/acme/demo/pull/15')
  assert.equal(calls.length, 1)
  const comments = commentsOf(fake, ticket.number)
  assert.match(comments[0], /点火完成/)
  assert.match(comments[0], /pull\/15/)
})

test('注入的 openPr 返回非零退出码但 stderr 有 PR 地址：点火算完成', async (t) => {
  const fixture = await makeRepoFixture(t)
  const { fake, gh, parent, ticket } = await setupGithub(t)
  const runner = fakeRunner()
  const calls = []
  const ignite = createIgnite({
    config: ignitionConfig(fixture, gh),
    runner: runner.run,
    openPr: async (args) => {
      calls.push(args)
      return { code: 1, stdout: '', stderr: 'https://github.com/acme/demo/pull/16\n' }
    },
    push: fakePush().push,
    notifier: fakeNotifier(),
  })

  const result = await ignite({ owner: OWNER, repo: REPO, parent, ticket })

  assert.equal(result.ok, true)
  assert.equal(result.prUrl, 'https://github.com/acme/demo/pull/16')
  assert.equal(calls.length, 1)
  assert.match(commentsOf(fake, ticket.number)[0], /点火完成/)
})

test('注入的 openPr 返回非零退出码且没有 PR 地址：点火失败', async (t) => {
  const fixture = await makeRepoFixture(t)
  const { fake, gh, parent, ticket } = await setupGithub(t)
  const runner = fakeRunner()
  const ignite = createIgnite({
    config: ignitionConfig(fixture, gh),
    runner: runner.run,
    openPr: async () => ({ code: 1, stdout: '', stderr: 'network down' }),
    push: fakePush().push,
    notifier: fakeNotifier(),
  })

  const result = await ignite({ owner: OWNER, repo: REPO, parent, ticket })

  assert.equal(result.ok, false)
  assert.match(result.error, /没拿到链接/)
  assert.match(commentsOf(fake, ticket.number)[0], /点火失败/)
})

test('没有提交时不 push、不开 PR，写「没有产生提交」，摘标签发通知写进度', async (t) => {
  const fixture = await makeRepoFixture(t)
  const { fake, gh, parent, ticket } = await setupGithub(t)
  const runner = fakeRunner(async () => ({ commits: [], branch: `ticket/${ticket.number}` }))
  const push = fakePush()
  const pr = fakeOpenPr()
  const notifier = fakeNotifier()
  const ignite = createIgnite({
    config: ignitionConfig(fixture, gh),
    runner: runner.run,
    openPr: pr.openPr,
    push: push.push,
    notifier,
  })

  const result = await ignite({ owner: OWNER, repo: REPO, parent, ticket })

  assert.equal(result.ok, false)
  assert.equal(result.error, 'no-commits')
  assert.equal(push.calls.length, 0)
  assert.equal(pr.calls.length, 0)
  assert.match(commentsOf(fake, ticket.number)[0], /没有产生提交/)
  assert.ok(!labelsOf(fake, ticket.number).includes('Sandcastle'))

  const incident = notifier.calls.find((event) => event.event === '出事')
  assert.ok(incident, '没有发出事通知')
  assert.match(incident.data.reason, /点火失败/)
  assert.match(incident.data.reason, /没有产生提交/)

  const progress = commentsOf(fake, parent.number).filter((body) => body.startsWith('进度 v1｜'))
  assert.equal(progress.length, 1)
  assert.match(progress[0], /细阶段：点火失败/)
  assert.match(progress[0], /没有产生提交/)
})

test('push 失败：写评论带分支和提交数，不开 PR', async (t) => {
  const fixture = await makeRepoFixture(t)
  const { fake, gh, parent, ticket } = await setupGithub(t)
  const branch = `ticket/${ticket.number}`
  const logs = []
  const runner = fakeRunner(async () => ({
    commits: [{ sha: 'abc123' }, { sha: 'def456' }],
    branch,
  }))
  const push = fakePush(new Error('远端拒绝'))
  const pr = fakeOpenPr()
  const ignite = createIgnite({
    config: ignitionConfig(fixture, gh, { log: (row) => logs.push(row) }),
    runner: runner.run,
    openPr: pr.openPr,
    push: push.push,
    notifier: fakeNotifier(),
  })

  const result = await ignite({ owner: OWNER, repo: REPO, parent, ticket })

  assert.equal(result.ok, false)
  assert.match(result.error, /远端拒绝/)
  assert.equal(pr.calls.length, 0)
  const comment = commentsOf(fake, ticket.number)[0]
  assert.ok(comment.startsWith('点火失败'))
  assert.match(comment, new RegExp(branch.replace('/', '\\/')))
  assert.match(comment, /2 个提交/)
  const failure = logs.find((row) => row.msg === '点火失败')
  assert.equal(failure.branch, branch)
  assert.equal(failure.commits, 2)
})

test('runner 抛错：摘 Sandcastle、发出事、父工单写进度，不开 PR，不写待验收', async (t) => {
  const fixture = await makeRepoFixture(t)
  const { fake, gh, parent, ticket } = await setupGithub(t)
  await gh.createComment({
    owner: OWNER,
    repo: REPO,
    number: parent.number,
    body: progressLine({ path: '其余', tier: '开发中', step: '开工', round: 1, stuck: false }),
  })
  const logs = []
  const runner = fakeRunner(async () => {
    throw new Error('容器起不来')
  })
  const pr = fakeOpenPr()
  const notifier = fakeNotifier()
  const ignite = createIgnite({
    config: ignitionConfig(fixture, gh, { log: (row) => logs.push(row) }),
    runner: runner.run,
    openPr: pr.openPr,
    notifier,
  })

  const result = await ignite({ owner: OWNER, repo: REPO, parent, ticket })

  assert.equal(result.ok, false)
  assert.match(result.error, /容器起不来/)
  assert.equal(pr.calls.length, 0)
  const comments = commentsOf(fake, ticket.number)
  assert.equal(comments.length, 1)
  assert.ok(comments[0].startsWith('点火失败'))
  assert.match(comments[0], /容器起不来/)
  assert.equal(logs.length, 1)
  assert.equal(logs[0].level, 'error')
  assert.equal(logs[0].msg, '点火失败')
  assert.ok(!labelsOf(fake, ticket.number).includes('状态:待验收'))
  assert.ok(!labelsOf(fake, ticket.number).includes('Sandcastle'))
  assert.ok(labelsOf(fake, ticket.number).includes('状态:开发中'))

  const incident = notifier.calls.find((event) => event.event === '出事')
  assert.ok(incident, '没有发出事通知')
  assert.match(incident.data.reason, /点火失败/)
  assert.match(incident.data.reason, /容器起不来/)

  const progress = commentsOf(fake, parent.number).filter((body) => body.startsWith('进度 v1｜'))
  const failureLine = progress.at(-1)
  assert.equal(progress.length, 2)
  assert.match(failureLine, /细阶段：点火失败/)
  assert.match(failureLine, /轮次：2/)
  assert.match(failureLine, /容器起不来/)
})

test('连续三次点火失败：父工单三圈进度，stallHits 读到三圈没进展', async (t) => {
  const fixture = await makeRepoFixture(t)
  const { gh, parent, ticket } = await setupGithub(t)
  const runner = fakeRunner(async () => {
    throw new Error('容器起不来')
  })
  const ignite = createIgnite({
    config: ignitionConfig(fixture, gh),
    runner: runner.run,
    openPr: fakeOpenPr().openPr,
    notifier: fakeNotifier(),
  })

  for (let index = 0; index < 3; index += 1) {
    await ignite({ owner: OWNER, repo: REPO, parent, ticket })
  }

  const comments = await gh.listComments({ owner: OWNER, repo: REPO, number: parent.number })
  const progress = comments.map((comment) => comment.body).filter((body) => body.startsWith('进度 v1｜'))
  assert.equal(progress.length, 3)
  assert.match(progress[0], /细阶段：点火失败/)
  assert.match(progress[1], /细阶段：点火失败/)
  assert.match(progress[2], /细阶段：点火失败/)

  const hits = stallHits({ comments })
  assert.ok(
    hits.some((hit) => hit.reason === '三圈没进展'),
    `没有读到三圈没进展：${JSON.stringify(hits)}`,
  )
})

test('票里没点文件时，相关代码放 git ls-files 前 100 行', async (t) => {
  const fixture = await makeRepoFixture(t)
  const ticketBody = [
    '## 垂直切片',
    '',
    '顾客打开链接，看到今天的水果。',
    '',
    '## 验收条件',
    '',
    '- [ ] 打开链接，看到当天水果的名单。',
  ].join('\n')
  const { fake, gh, parent, ticket } = await setupGithub(t, { ticketBody })
  const runner = fakeRunner(async (args) => {
    args.started()
    return { commits: [{ sha: 'abc123' }], branch: args.ticketBranch }
  })
  const ignite = createIgnite({
    config: ignitionConfig(fixture, gh),
    runner: runner.run,
    openPr: fakeOpenPr().openPr,
    push: fakePush().push,
    notifier: fakeNotifier(),
  })

  await ignite({ owner: OWNER, repo: REPO, parent, ticket })

  const prompt = await readFile(runner.calls[0].prompt, 'utf8')
  assert.match(prompt, /git ls-files（前 100 行）/)
  assert.match(prompt, /src\/app\.mjs/)
  assert.match(prompt, /scripts\/check\.sh/)
})

test('重启后同一票已有 Sandcastle，不重复点火', async (t) => {
  const fixture = await makeRepoFixture(t)
  const { fake, gh, parent } = await setupGithub(t, { ticketLabels: ['状态:排队中'] })
  await gh.createComment({
    owner: OWNER,
    repo: REPO,
    number: parent.number,
    body: '点头：拆票',
  })
  const runner = fakeRunner(async (args) => {
    args.started()
    return { commits: [{ sha: 'abc123' }], branch: args.ticketBranch }
  })
  const pr = fakeOpenPr()
  const customers = [{ id: 'c-0001', short_name: OWNER, status: 'active', repos: { demo: REPO } }]
  const clock = () => new Date('2026-11-17T10:00:00+08:00')
  const firstConfig = {
    ...ignitionConfig(fixture, gh),
    lockDir: join(fixture.root, 'scheduler-locks-1'),
    maxActive: 5,
  }
  const first = createIgnite({
    config: firstConfig,
    runner: runner.run,
    openPr: pr.openPr,
    push: fakePush().push,
    notifier: fakeNotifier(),
  })

  await runOnce({ gh, customers, notifier: fakeNotifier(), ignite: first, clock, config: firstConfig })
  // 点火在后台跑：等这次跑完再断言，轮次本身不等它。
  await Promise.allSettled([...(firstConfig.pendingIgnitions || [])])

  assert.equal(runner.calls.length, 1)
  assert.ok(labelsOf(fake, parent.number).includes('状态:开发中'))

  // 重启：新的锁目录、新的通知去重集合，状态仍从工单读。
  const restartedConfig = {
    ...ignitionConfig(fixture, gh),
    lockDir: join(fixture.root, 'scheduler-locks-2'),
    maxActive: 5,
  }
  const restarted = createIgnite({
    config: restartedConfig,
    runner: runner.run,
    openPr: pr.openPr,
    push: fakePush().push,
    notifier: fakeNotifier(),
  })
  await runOnce({
    gh,
    customers,
    notifier: fakeNotifier(),
    ignite: restarted,
    clock,
    config: restartedConfig,
  })

  assert.equal(runner.calls.length, 1, '重启后不重复点火')
  assert.equal(
    commentsOf(fake, parent.number).filter((body) => body.startsWith('进度 v1｜')).length,
    1,
  )
})

async function runnerFixture(t, { image = 'sandcastle:from-env' } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'afk-runner-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const repoDir = join(root, REPO)
  await mkdir(join(repoDir, '.sandcastle'), { recursive: true })
  const envLines = ['GH_TOKEN=repo-scoped-token']
  if (image) envLines.unshift(`SANDCASTLE_IMAGE=${image}`)
  await writeFile(join(repoDir, '.sandcastle', '.env'), `${envLines.join('\n')}\n`)
  const prompt = join(repoDir, '.sandcastle', 'prompt-5.md')
  await writeFile(prompt, '/tdd\n\n# 这张票\n')
  return { root, repoDir, prompt, home: join(root, 'sandcastle-home') }
}

function fakeExec() {
  const calls = []
  return {
    calls,
    async exec(command, args, options = {}) {
      calls.push({ command, args, options })
      if (command === 'npm') return { code: 0, stdout: 'added 12 packages', stderr: '' }
      if (command.endsWith('/tsx')) {
        options.onStart?.()
        return {
          code: 0,
          stdout: 'Sandcastle 日志\nAFK_RESULT:{"commits":[{"sha":"abc123"}],"branch":"ticket/5"}\n',
          stderr: '',
        }
      }
      return { code: 0, stdout: '', stderr: '' }
    },
  }
}

async function seedInstalledSandcastle(home) {
  const dir = join(home, 'node_modules', '@ai-hero', 'sandcastle')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'package.json'), '{"name":"@ai-hero/sandcastle"}')
  await mkdir(join(home, 'node_modules', '.bin'), { recursive: true })
  await writeFile(join(home, 'node_modules', '.bin', 'tsx'), '')
}

test('prepare 慢过两分钟不算超时，run 立即回执就点火成功', async (t) => {
  const fixture = await makeRepoFixture(t)
  const { fake, gh, parent, ticket } = await setupGithub(t)
  const calls = []
  const runner = {
    async prepare(args) {
      calls.push({ phase: 'prepare', args })
      await new Promise((resolve) => setTimeout(resolve, 150))
      return { imageName: 'sandcastle:demo', scriptPath: join(fixture.root, 'run.mts') }
    },
    async run(args) {
      calls.push({ phase: 'run', args })
      args.started()
      return { commits: [{ sha: 'abc123' }], branch: args.ticketBranch }
    },
  }
  const notifier = fakeNotifier()
  const pr = fakeOpenPr()
  const ignite = createIgnite({
    config: ignitionConfig(fixture, gh, { timeoutMs: 30 }),
    runner,
    openPr: pr.openPr,
    push: fakePush().push,
    notifier,
  })

  const result = await ignite({ owner: OWNER, repo: REPO, parent, ticket })

  assert.equal(result.ok, true)
  assert.equal(calls[0].phase, 'prepare')
  assert.equal(calls[1].phase, 'run')
  assert.equal(calls[1].args.prepared.imageName, 'sandcastle:demo')
  assert.equal(notifier.calls.length, 0)
  assert.ok(!commentsOf(fake, ticket.number).some((body) => body.startsWith('点火超时')))
  assert.ok(!labelsOf(fake, ticket.number).includes('点火超时'))
  assert.equal(pr.calls.length, 1)
})

test('sandcastle runner：首次装依赖、镜像取 .env、脚本不带宿主 token', async (t) => {
  const fixture = await runnerFixture(t)
  const hook = fakeExec()
  const builds = []
  const runner = createSandcastleRunner({
    home: fixture.home,
    env: {
      PATH: '/usr/local/bin:/usr/bin',
      HOME: '/Users/example',
      GH_TOKEN: 'host-secret',
      ANTHROPIC_AUTH_TOKEN: 'host-model-secret',
    },
    exec: hook.exec,
    buildImage: async ({ image }) => {
      builds.push(image)
    },
  })
  let started = 0
  const prepared = await runner.prepare({
    repoDir: fixture.repoDir,
    worktree: join(fixture.repoDir, '.sandcastle', 'worktrees', 'ticket-5'),
    branch: REQ_BRANCH,
    ticketBranch: 'ticket/5',
    prompt: fixture.prompt,
    envFile: join(fixture.repoDir, '.sandcastle', '.env'),
    timeoutMs: 120000,
  })

  assert.equal(started, 0, 'prepare 不碰回执')
  assert.equal(prepared.imageName, 'sandcastle:from-env')
  const scriptPath = join(fixture.home, 'run-5.mts')
  assert.equal(prepared.scriptPath, scriptPath)
  assert.deepEqual(builds, ['sandcastle:from-env'])

  const install = hook.calls[0]
  assert.equal(install.command, 'npm')
  assert.deepEqual(install.args, ['install', '@ai-hero/sandcastle@0.12.0', 'tsx'])
  assert.equal(install.options.cwd, fixture.home)

  const result = await runner.run({
    repoDir: fixture.repoDir,
    ticketBranch: 'ticket/5',
    started: () => {
      started += 1
    },
    prepared,
  })

  assert.deepEqual(result, { commits: [{ sha: 'abc123' }], branch: 'ticket/5' })
  assert.equal(started, 1)

  const script = await readFile(scriptPath, 'utf8')
  assert.match(script, /branchStrategy.*type.*branch.*ticket\/5/)
  assert.match(script, /promptFile: "/)
  assert.match(script, /imageName: "sandcastle:from-env"/)
  assert.match(script, /GH_TOKEN.*只限当前客户仓/)
  assert.ok(!script.includes('host-secret'))
  assert.ok(!script.includes('host-model-secret'))
  assert.ok(!script.includes('repo-scoped-token'))
  assert.ok(!/process\.env/.test(script))

  const run = hook.calls.find((call) => call.command.endsWith('/tsx'))
  assert.equal(run.args[0], scriptPath)
  assert.equal(run.options.cwd, fixture.repoDir)
  assert.equal(run.options.env.NODE_PATH, join(fixture.home, 'node_modules'))
  assert.equal(run.options.env.GH_TOKEN, undefined)
  assert.equal(run.options.env.ANTHROPIC_AUTH_TOKEN, undefined)
  assert.equal(run.options.env.HOME, '/Users/example')
})

test('sandcastle runner：依赖已装就不重装，镜像没配时用 sandcastle:<repo>', async (t) => {
  const fixture = await runnerFixture(t, { image: '' })
  await seedInstalledSandcastle(fixture.home)
  const hook = fakeExec()
  const builds = []
  const runner = createSandcastleRunner({
    home: fixture.home,
    env: { PATH: '/usr/bin', HOME: '/Users/example' },
    exec: hook.exec,
    buildImage: async ({ image }) => {
      builds.push(image)
    },
  })

  const prepared = await runner.prepare({
    repoDir: fixture.repoDir,
    worktree: join(fixture.repoDir, '.sandcastle', 'worktrees', 'ticket-5'),
    branch: REQ_BRANCH,
    ticketBranch: 'ticket/5',
    prompt: fixture.prompt,
    envFile: join(fixture.repoDir, '.sandcastle', '.env'),
    timeoutMs: 120000,
  })

  assert.equal(prepared.imageName, `sandcastle:${REPO}`)
  assert.ok(!hook.calls.some((call) => call.command === 'npm'))
  assert.deepEqual(builds, [`sandcastle:${REPO}`])
})

test('ignite CLI --dry-run 只打印 prompt 和命令，不贴标签', async (t) => {
  const fixture = await makeRepoFixture(t)
  const { fake, gh, parent, ticket } = await setupGithub(t)
  const lines = []

  const result = await runIgniteCli(
    [
      '--owner',
      OWNER,
      '--repo',
      REPO,
      '--parent',
      String(parent.number),
      '--ticket',
      String(ticket.number),
      '--dry-run',
    ],
    {
      gh,
      config: { repoRoot: join(fixture.root, 'repos') },
      out: (line) => lines.push(line),
    },
  )

  assert.equal(result.dryRun, true)
  const text = lines.join('\n')
  assert.match(text, /^\/tdd$/m)
  assert.match(text, /SPEC-BODY-MARKER/)
  assert.match(text, /# 分支：req\/o-0001 → ticket\/\d+/)
  assert.match(text, /gh pr create --base req\/o-0001/)
  assert.deepEqual(labelsOf(fake, ticket.number), ['状态:排队中'])
})

test('createGhOpenPr：退出码非零但从 stdout 找到 PR 地址时返回地址', async () => {
  const calls = []
  const openPr = createGhOpenPr({
    exec: async (command, args) => {
      calls.push({ command, args })
      return { code: 1, stdout: 'https://github.com/o/r/pull/15\n', stderr: 'warning' }
    },
  })

  const created = await openPr({
    repoDir: '/tmp/x',
    base: 'req/o-0001',
    head: 'ticket/15',
    title: '票 15',
    body: 'body',
  })

  assert.deepEqual(created, { url: 'https://github.com/o/r/pull/15' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].command, 'gh')
  assert.deepEqual(calls[0].args.slice(0, 2), ['pr', 'create'])
})

test('createGhOpenPr：退出码非零但地址只在 stderr 里也认', async () => {
  const openPr = createGhOpenPr({
    exec: async () => ({ code: 1, stdout: '', stderr: '提示\nhttps://github.com/o/r/pull/21\n' }),
  })

  const created = await openPr({
    repoDir: '/tmp/x',
    base: 'req/o-0001',
    head: 'ticket/21',
    title: '票 21',
    body: 'body',
  })

  assert.deepEqual(created, { url: 'https://github.com/o/r/pull/21' })
})

test('createGhOpenPr：退出码非零且没有 PR 地址时抛错', async () => {
  const openPr = createGhOpenPr({
    exec: async () => ({ code: 1, stdout: '出错了', stderr: 'network down' }),
  })

  await assert.rejects(
    openPr({ repoDir: '/tmp/x', base: 'req/o-0001', head: 'ticket/21', title: '票 21', body: 'body' }),
    /gh pr create 失败（退出码 1）/,
  )
})

test('buildPrompt：第一行 /tdd，分节放 spec、票三段、AGENTS、feature map 和相关代码', () => {
  const prompt = buildPrompt({
    spec: { title: 'spec yuyue-quhuo', body: 'SPEC-BODY-MARKER' },
    ticket: { number: 51, title: '看到今天水果', body: TICKET_BODY },
    agentsMd: 'AGENTS-MARKER',
    featureMap: 'FEATURE-MAP-MARKER',
    relevantCode: [{ path: 'src/app.mjs', text: 'APP-SOURCE-MARKER', truncated: false }],
  })

  const lines = prompt.split('\n')
  assert.equal(lines[0], '/tdd')
  assert.equal(lines[1], '')
  assert.match(prompt, /SPEC-BODY-MARKER/)
  assert.match(prompt, /## 垂直切片/)
  assert.match(prompt, /## 验收条件/)
  assert.match(prompt, /^# 做法$/m)
  assert.match(prompt, /FACTORY:/)
  assert.match(prompt, /全量测试最后跑一次/)
  assert.match(prompt, /AGENTS-MARKER/)
  assert.match(prompt, /FEATURE-MAP-MARKER/)
  assert.match(prompt, /## src\/app\.mjs/)
  assert.match(prompt, /APP-SOURCE-MARKER/)
})
