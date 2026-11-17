import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createGithub } from '../lib/github.mjs'
import { commitAll, git, initRepo } from '../lib/git.mjs'
import { ensureLabel } from '../lib/issues.mjs'
import { createTicketPipeline } from '../lib/pipeline.mjs'
import { readTrail } from '../lib/evidence.mjs'
import { FIXER_TOOLS } from '../lib/agent-runner.mjs'
import { stallHits } from '../lib/scheduler.mjs'
import { startFakeGithub } from './fake-github.mjs'

const OWNER = 'acme'
const REPO = 'demo'
const ORDER = 'o-0001'
const REQ_BRANCH = `req/${ORDER}`

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
    '',
    `<!-- factory:order=${ORDER} -->`,
  ].join('\n')
}

async function makeRepoFixture(t, ticketNumber) {
  const root = await mkdtemp(join(tmpdir(), 'afk-pipeline-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const repoDir = join(root, REPO)
  await initRepo(repoDir)
  await mkdir(join(repoDir, 'src'), { recursive: true })
  await writeFile(join(repoDir, 'src', 'app.mjs'), 'export const APP = 1\n')
  await commitAll(repoDir, 'FACTORY: 初始提交')

  await git(repoDir, ['checkout', '-b', REQ_BRANCH])
  await writeFile(join(repoDir, 'req.txt'), '需求分支\n')
  await commitAll(repoDir, 'FACTORY: 需求分支')

  await git(repoDir, ['checkout', '-b', `ticket/${ticketNumber}`, REQ_BRANCH])
  await mkdir(join(repoDir, '.audit', 'verify'), { recursive: true })
  await writeFile(join(repoDir, '.audit', 'verify', 'after.png'), 'PNG')
  await writeFile(join(repoDir, 'src', 'app.mjs'), 'export const APP = 2\n')
  await commitAll(repoDir, 'FACTORY: 票实现')
  await git(repoDir, ['checkout', REQ_BRANCH])
  return { root, repoDir }
}

async function setupGithub(t) {
  const fake = await startFakeGithub({ repos: [{ owner: OWNER, name: REPO }] })
  t.after(() => fake.close())
  const gh = createGithub({ apiBase: fake.base, token: 'test' })
  for (const name of ['状态:排队中', '状态:开发中', '状态:待验收', 'Sandcastle', 'needs-info']) {
    await ensureLabel(gh, { owner: OWNER, repo: REPO, name })
  }
  const parent = await gh.createIssue({
    owner: OWNER,
    repo: REPO,
    title: '要个预约取货',
    body: parentBody(),
    labels: ['状态:开发中'],
  })
  const ticket = await gh.createIssue({
    owner: OWNER,
    repo: REPO,
    title: '看到今天水果',
    body: '## 验收条件\n\n- [ ] 打开链接看到水果。\n',
    labels: ['状态:排队中', 'Sandcastle'],
  })
  await gh.addSubIssue({ owner: OWNER, repo: REPO, number: parent.number, subIssueId: ticket.id })
  await gh.createComment({
    owner: OWNER,
    repo: REPO,
    number: ticket.number,
    body: `点火完成：分支 \`ticket/${ticket.number}\`，1 个提交，PR https://github.com/acme/demo/pull/7`,
  })
  return { fake, gh, parent, ticket }
}

function parentSnapshot({ parent, ticket }) {
  return {
    number: parent.number,
    title: parent.title,
    body: parent.body,
    comments: [],
    subIssues: [
      {
        number: ticket.number,
        id: ticket.id,
        title: ticket.title,
        body: ticket.body,
        state: 'open',
        labels: [{ name: '状态:排队中' }, { name: 'Sandcastle' }],
        html_url: ticket.html_url,
        blockedBy: [],
      },
    ],
  }
}

function fakeRunner({ reviewFail = false } = {}) {
  const calls = []
  return {
    calls,
    async run(args) {
      calls.push(args)
      if (args.name.startsWith('review-')) {
        return {
          ok: true,
          code: 0,
          stdout: reviewFail
            ? 'AFK_VERDICT {"ok":false,"problems":["连接池缺 error 监听"]}\n'
            : 'AFK_VERDICT {"ok":true,"evidence":["https://github.com/acme/demo/pull/7"],"problems":[]}\n',
          stderr: '',
        }
      }
      return {
        ok: true,
        code: 0,
        stdout:
          'AFK_VERDICT {"ok":true,"evidence":[".audit/verify/after.png"],"problems":[],"tests":[{"command":"npm test","result":"pass"}]}\n',
        stderr: '',
      }
    },
  }
}

function fakeNotifier() {
  return {
    calls: [],
    async send(event) {
      this.calls.push(event)
      return { code: 0 }
    },
  }
}

/** 按脚本返回评审结论；fixer 调用时改一行代码，由 runFixerAudit 负责提交。 */
function scriptedRunner({ reviews = [] } = {}) {
  const calls = []
  let reviewIndex = 0
  let fixCount = 0
  return {
    calls,
    async run(args) {
      calls.push(args)
      if (args.name.startsWith('review-')) {
        const ok = reviews[reviewIndex] !== 'fail'
        reviewIndex += 1
        return {
          ok: true,
          code: 0,
          stdout: `AFK_VERDICT ${JSON.stringify({
            ok,
            evidence: ['https://github.com/acme/demo/pull/7'],
            problems: ok ? [] : ['连接池缺 error 监听'],
          })}\n`,
          stderr: '',
        }
      }
      if (args.name.startsWith('fix-')) {
        fixCount += 1
        await writeFile(join(args.cwd, 'src', 'app.mjs'), `export const APP = ${2 + fixCount}\n`)
        return { ok: true, code: 0, stdout: 'AFK_FIX: done\n', stderr: '' }
      }
      return {
        ok: true,
        code: 0,
        stdout:
          'AFK_VERDICT {"ok":true,"evidence":[".audit/verify/after.png"],"problems":[],"tests":[{"command":"npm test","result":"pass"}]}\n',
        stderr: '',
      }
    },
  }
}

function issueOf(fake, number) {
  return fake.state.issues.get(`${OWNER}/${REPO}`).find((row) => row.number === number)
}

function commentsOf(fake, number) {
  return issueOf(fake, number).comments.map((row) => row.body)
}

test('D3/D4/D5：点火完成后自动补验证评审并合需求分支，第二次不重复', async (t) => {
  const { fake, gh, parent, ticket } = await setupGithub(t)
  const { repoDir } = await makeRepoFixture(t, ticket.number)
  const runner = fakeRunner()
  const pipeline = createTicketPipeline({
    runner,
    previewFor: () => null,
    notifier: fakeNotifier(),
    log: () => {},
  })

  const first = await pipeline({
    gh,
    owner: OWNER,
    repo: REPO,
    parents: [parentSnapshot({ parent, ticket })],
    repoDir,
  })

  assert.equal(first.runs.length, 1)
  assert.equal(first.runs[0].ok, true, JSON.stringify(first.runs[0]))
  assert.ok(first.runs[0].mergedSha)

  const closed = issueOf(fake, ticket.number)
  assert.equal(closed.state, 'closed')
  assert.ok(closed.labels.includes('状态:待验收'))
  assert.ok(!closed.labels.includes('Sandcastle'))
  assert.ok(commentsOf(fake, ticket.number).some((body) => body.startsWith('四样证据齐')))

  const rows = await readTrail({ repoDir, ticket: ticket.number })
  assert.ok(rows.some((row) => row.phase === 'merge' && row.result === 'pass'))
  assert.ok(rows.some((row) => row.phase === 'verify' && row.result === 'pass'))
  assert.ok(rows.some((row) => row.phase === 'review' && row.result === 'pass' && row.decision.includes('标准')))
  const before = rows.length

  const second = await pipeline({
    gh,
    owner: OWNER,
    repo: REPO,
    parents: [parentSnapshot({ parent, ticket })],
    repoDir,
  })
  assert.equal(second.runs.length, 0, '最新评论已不是点火完成，不重跑')
  assert.equal((await readTrail({ repoDir, ticket: ticket.number })).length, before, '同一 head 不重复写 trail')
})

test('没有 fresh verify 才触发；已有 fresh verify 不跑', async (t) => {
  const { gh, parent, ticket } = await setupGithub(t)
  const { repoDir } = await makeRepoFixture(t, ticket.number)
  await git(repoDir, ['checkout', `ticket/${ticket.number}`])
  const head = await git(repoDir, ['rev-parse', 'HEAD'])
  await mkdir(join(repoDir, '.audit'), { recursive: true })
  await writeFile(
    join(repoDir, '.audit', `${ticket.number}.tsv`),
    [
      'ts\tphase\tdecision\twhy\tevidence\tresult',
      `2026-11-17T02:00:00.000Z\tverify\t${head}\t按验收条件验证\t.audit/verify/after.png\tpass`,
    ].join('\n') + '\n',
  )
  await git(repoDir, ['checkout', REQ_BRANCH])
  const runner = fakeRunner()
  const pipeline = createTicketPipeline({
    runner,
    previewFor: () => null,
    notifier: fakeNotifier(),
    log: () => {},
  })

  const result = await pipeline({
    gh,
    owner: OWNER,
    repo: REPO,
    parents: [parentSnapshot({ parent, ticket })],
    repoDir,
  })

  assert.equal(result.runs.length, 1)
  assert.equal(result.runs[0].skipped, 'fresh-verify')
  assert.equal(runner.calls.length, 0)
})

test('有界面的票没有预览注入：判 preview_required，不跑验证、不合并', async (t) => {
  const { fake, gh, parent, ticket } = await setupGithub(t)
  const { repoDir } = await makeRepoFixture(t, ticket.number)
  await git(repoDir, ['checkout', `ticket/${ticket.number}`])
  await mkdir(join(repoDir, '.audit'), { recursive: true })
  await writeFile(
    join(repoDir, '.audit', `${ticket.number}.tsv`),
    'ts\tphase\tdecision\twhy\tevidence\tresult\n2026-11-17T02:00:00.000Z\tpreview\t有界面\t验收条件要看页面\t\trequired\n',
  )
  await git(repoDir, ['checkout', REQ_BRANCH])
  const runner = fakeRunner()
  const pipeline = createTicketPipeline({
    runner,
    previewFor: () => null,
    notifier: fakeNotifier(),
    log: () => {},
  })

  const result = await pipeline({
    gh,
    owner: OWNER,
    repo: REPO,
    parents: [parentSnapshot({ parent, ticket })],
    repoDir,
  })

  assert.equal(result.runs[0].ok, false)
  assert.equal(result.runs[0].reason, 'preview_required')
  assert.equal(runner.calls.length, 0)
  assert.equal(issueOf(fake, ticket.number).state, 'open')
})

test('评审第一次没过：fixer 用 FIXER_TOOLS 改完提交，复评过再合需求分支', async (t) => {
  const { fake, gh, parent, ticket } = await setupGithub(t)
  const { repoDir } = await makeRepoFixture(t, ticket.number)
  const runner = scriptedRunner({ reviews: ['fail', 'pass'] })
  const notifier = fakeNotifier()
  const pipeline = createTicketPipeline({
    runner,
    previewFor: () => null,
    notifier,
    log: () => {},
  })

  const result = await pipeline({
    gh,
    owner: OWNER,
    repo: REPO,
    parents: [parentSnapshot({ parent, ticket })],
    repoDir,
  })

  assert.equal(result.runs[0].ok, true, JSON.stringify(result.runs[0]))
  assert.ok(result.runs[0].mergedSha)

  const reviewCalls = runner.calls.filter((call) => call.name.startsWith('review-'))
  assert.equal(reviewCalls.length, 2, '评审失败后要复评一次')
  const fixCall = runner.calls.find((call) => call.name.startsWith('fix-'))
  assert.ok(fixCall, '评审没过没起 fixer')
  assert.equal(fixCall.allowedTools, FIXER_TOOLS)

  const subjects = (await git(repoDir, ['log', '--format=%s', `ticket/${ticket.number}`]))
    .split(/\r?\n/)
    .filter(Boolean)
  assert.ok(
    subjects.some((line) => line.startsWith(`FACTORY: 评审修复 #${ticket.number}`)),
    `没有 FACTORY: 评审修复 提交：${subjects.join(' / ')}`,
  )

  const rows = await readTrail({ repoDir, ticket: ticket.number })
  assert.ok(rows.some((row) => row.phase === 'review' && row.result === 'fail'))
  assert.ok(rows.some((row) => row.phase === 'review' && row.result === 'pass'))
  assert.ok(rows.some((row) => row.phase === 'merge' && row.result === 'pass'))

  const progress = commentsOf(fake, parent.number).filter((body) => body.startsWith('进度 v1｜'))
  const reviewProgress = progress.filter((body) => body.includes('细阶段：评审修复'))
  assert.equal(reviewProgress.length, 1, '评审失败那一轮要在父工单写一条进度')
  assert.match(reviewProgress[0], /轮次：2/)
  assert.ok(progress.some((body) => body.includes('细阶段：合分支')), '合并成功后写合分支进度')
  assert.equal(issueOf(fake, ticket.number).state, 'closed')
})

test('fixer 两轮仍没过：发出事、不合并，第三圈不再修，进度行让停滞检测看得到', async (t) => {
  const { fake, gh, parent, ticket } = await setupGithub(t)
  const { repoDir } = await makeRepoFixture(t, ticket.number)
  const runner = scriptedRunner({ reviews: ['fail', 'fail', 'fail', 'fail'] })
  const notifier = fakeNotifier()
  const pipeline = createTicketPipeline({
    runner,
    previewFor: () => null,
    notifier,
    log: () => {},
  })

  const first = await pipeline({
    gh,
    owner: OWNER,
    repo: REPO,
    parents: [parentSnapshot({ parent, ticket })],
    repoDir,
  })

  assert.equal(first.runs[0].ok, false)
  assert.equal(first.runs[0].reason, 'evidence_not_ready')
  assert.match(first.runs[0].problems.join('；'), /连接池/)
  assert.equal(
    runner.calls.filter((call) => call.name.startsWith('fix-')).length,
    2,
    'fixer 最多跑两轮',
  )
  assert.equal(runner.calls.filter((call) => call.name.startsWith('review-')).length, 3)
  assert.ok(notifier.calls.some((event) => event.event === '出事'), '修不过要发出事通知')
  assert.equal(issueOf(fake, ticket.number).state, 'open')
  assert.ok(
    !(await readTrail({ repoDir, ticket: ticket.number })).some(
      (row) => row.phase === 'merge' && row.result === 'pass',
    ),
    '没过评审不能合需求分支',
  )

  const comments = await gh.listComments({ owner: OWNER, repo: REPO, number: parent.number })
  const progress = comments.filter((comment) => comment.body.startsWith('进度 v1｜'))
  assert.equal(progress.length, 3)
  assert.deepEqual(
    progress.map((comment) => /轮次：(\d+)/.exec(comment.body)?.[1]),
    ['2', '3', '4'],
  )
  assert.equal(stallHits({ comments }).some((hit) => hit.reason === '三圈没进展'), true)

  const second = await pipeline({
    gh,
    owner: OWNER,
    repo: REPO,
    parents: [parentSnapshot({ parent, ticket })],
    repoDir,
  })
  assert.equal(second.runs[0].ok, false)
  assert.equal(
    runner.calls.filter((call) => call.name.startsWith('fix-')).length,
    2,
    '轮次用完以后不再起 fixer',
  )
})

test('评审失败：返回 evidence_not_ready，不合并，不写重复 verify 行', async (t) => {
  const { fake, gh, parent, ticket } = await setupGithub(t)
  const { repoDir } = await makeRepoFixture(t, ticket.number)
  const runner = fakeRunner({ reviewFail: true })
  const pipeline = createTicketPipeline({
    runner,
    previewFor: () => null,
    notifier: fakeNotifier(),
    log: () => {},
  })

  const first = await pipeline({
    gh,
    owner: OWNER,
    repo: REPO,
    parents: [parentSnapshot({ parent, ticket })],
    repoDir,
  })

  assert.equal(first.runs[0].ok, false)
  assert.equal(first.runs[0].reason, 'evidence_not_ready')
  assert.match(first.runs[0].problems.join('；'), /连接池/)
  assert.equal(issueOf(fake, ticket.number).state, 'open')
  const rows = await readTrail({ repoDir, ticket: ticket.number })
  const verifyRows = rows.filter((row) => row.phase === 'verify').length
  assert.equal(verifyRows, 1)

  const second = await pipeline({
    gh,
    owner: OWNER,
    repo: REPO,
    parents: [parentSnapshot({ parent, ticket })],
    repoDir,
  })
  assert.equal(second.runs[0].skipped, 'fresh-verify')
  assert.equal((await readTrail({ repoDir, ticket: ticket.number })).filter((row) => row.phase === 'verify').length, verifyRows)
})
