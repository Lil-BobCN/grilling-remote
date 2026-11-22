import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { createGithub } from '../lib/github.mjs'
import { commitAll, git, initBareRepo, initRepo } from '../lib/git.mjs'
import { ensureLabel } from '../lib/issues.mjs'
import { createTicketPipeline } from '../lib/pipeline.mjs'
import { freshVerifiers, mergeTicket, parseTrail, readTrail } from '../lib/evidence.mjs'
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

  const bare = join(root, 'remote.git')
  await initBareRepo(bare)
  await git(repoDir, ['remote', 'add', 'origin', bare])
  await git(repoDir, ['push', 'origin', 'main', REQ_BRANCH, `ticket/${ticketNumber}`])
  return { root, repoDir }
}

/** 票分支加一个迁移文件，把 diff 抬成高风险：合并门禁要 2 个验证者。 */
async function addMigrationCommit(repoDir, ticketNumber) {
  await git(repoDir, ['checkout', `ticket/${ticketNumber}`])
  await mkdir(join(repoDir, 'db', 'migrations'), { recursive: true })
  await writeFile(join(repoDir, 'db', 'migrations', '001.sql'), 'CREATE TABLE fruit (id INTEGER);\n')
  await commitAll(repoDir, 'FACTORY: 加迁移')
  const head = await git(repoDir, ['rev-parse', 'HEAD'])
  await git(repoDir, ['checkout', REQ_BRANCH])
  return head
}

/** 票工作树释放后，trail 在票分支上，不在主仓工作树里。 */
async function branchTrail(repoDir, branch, ticketNumber) {
  const text = await git(repoDir, ['show', `${branch}:.audit/${ticketNumber}.tsv`]).catch(() => '')
  return parseTrail(text)
}

/** 写一套指向当前 head 的完整证据：验证、测试、两轴评审都 pass。 */
async function seedCompleteTrail({ repoDir, ticketNumber, head, verifiers = ['v1'] }) {
  const rows = ['ts\tphase\tdecision\twhy\tevidence\tresult']
  verifiers.forEach((id, index) => {
    rows.push(
      `2026-11-17T02:00:0${index}.000Z\tverify\t${head}\t按验收条件验证 · verifier=${id}\t.audit/verify/after.png\tpass`,
    )
  })
  rows.push('2026-11-17T02:00:09.000Z\ttest\tnpm test\t验证 agent 跑的测试\tpass\tpass')
  rows.push(`2026-11-17T02:00:10.000Z\treview\t标准\thead ${head}\tAFK_VERDICT pass\tpass`)
  rows.push(`2026-11-17T02:00:11.000Z\treview\tspec\thead ${head}\tAFK_VERDICT pass\tpass`)
  await git(repoDir, ['checkout', `ticket/${ticketNumber}`])
  await mkdir(join(repoDir, '.audit'), { recursive: true })
  await writeFile(join(repoDir, '.audit', `${ticketNumber}.tsv`), `${rows.join('\n')}\n`)
  await commitAll(repoDir, `FACTORY: 测试证据 #${ticketNumber}`)
  await git(repoDir, ['checkout', REQ_BRANCH])
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

function parentSnapshot({ parent, ticket, labels = parent.labels || [] }) {
  return {
    number: parent.number,
    title: parent.title,
    body: parent.body,
    labels: labels.map((name) => ({ name })),
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

const REVERIFY_PROBLEM = 'src/features/orders/index.test.mjs 直接引用功能内部文件 pg，违反 lint 路径规则'

/** 按脚本返回评审和复验结论；fixer 调用时改一行代码，由 runFixerAudit 负责提交。 */
function scriptedRunner({ reviews = [], verifies = [] } = {}) {
  const calls = []
  let reviewIndex = 0
  let verifyIndex = 0
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
      if (args.name.startsWith('verify-')) {
        const ok = verifies[verifyIndex] !== 'fail'
        verifyIndex += 1
        return {
          ok: true,
          code: 0,
          stdout: `AFK_VERDICT ${JSON.stringify(
            ok
              ? {
                  ok: true,
                  evidence: ['.audit/verify/after.png'],
                  problems: [],
                  tests: [{ command: 'npm test', result: 'pass' }],
                }
              : { ok: false, problems: [REVERIFY_PROBLEM] },
          )}\n`,
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

/** 高风险票用：standard/spec 总过，interrogate 按脚本返回；fixer 每次改一行代码。 */
function interrogateRunner({ interrogate = [] } = {}) {
  const calls = []
  let index = 0
  let fixCount = 0
  return {
    calls,
    async run(args) {
      calls.push(args)
      if (args.name.startsWith('review-')) {
        if (args.name.endsWith('-interrogate')) {
          const ok = interrogate[index] !== 'fail'
          index += 1
          return {
            ok: true,
            code: 0,
            stdout: `AFK_VERDICT ${JSON.stringify({
              ok,
              evidence: ['https://github.com/acme/demo/pull/7#discussion_r1'],
              problems: ok
                ? []
                : ['到店取名额满时仍默认选中到店取，提交没有 slotId', '到店取名额 count 子查询没有锁，会超卖'],
            })}\n`,
            stderr: '',
          }
        }
        return {
          ok: true,
          code: 0,
          stdout: 'AFK_VERDICT {"ok":true,"evidence":["https://github.com/acme/demo/pull/7"],"problems":[]}\n',
          stderr: '',
        }
      }
      if (args.name.startsWith('fix-')) {
        fixCount += 1
        await writeFile(join(args.cwd, 'src', 'app.mjs'), `export const APP = ${10 + fixCount}\n`)
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

test('已有 fresh verify 但高风险缺第二个验证者：补人后合需求分支，不再返回 fresh-verify', async (t) => {
  const { fake, gh, parent, ticket } = await setupGithub(t)
  const { repoDir } = await makeRepoFixture(t, ticket.number)
  const head = await addMigrationCommit(repoDir, ticket.number)
  await seedCompleteTrail({ repoDir, ticketNumber: ticket.number, head })
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

  const run = result.runs[0]
  assert.notEqual(run.skipped, 'fresh-verify', JSON.stringify(run))
  assert.equal(run.ok, true, JSON.stringify(run))
  assert.ok(run.mergedSha)

  const verifyCalls = runner.calls.filter((call) => call.name.startsWith(`verify-${ticket.number}-`))
  assert.ok(
    verifyCalls.some((call) => call.name.endsWith('-v2')),
    `没有补第二个验证者：${verifyCalls.map((call) => call.name).join('、')}`,
  )

  const ticketHead = await git(repoDir, ['rev-parse', `ticket/${ticket.number}`])
  const fresh = await freshVerifiers({
    trail: await readTrail({ repoDir, ticket: ticket.number }),
    headSha: ticketHead,
    repoDir,
  })
  assert.deepEqual([...fresh].sort(), ['v1', 'v2'])
  assert.equal(issueOf(fake, ticket.number).state, 'closed')
})

test('合并失败后下一轮继续试合并，不会因 fresh verify 永久跳过', async (t) => {
  const { fake, gh, parent, ticket } = await setupGithub(t)
  const { repoDir } = await makeRepoFixture(t, ticket.number)
  const runner = fakeRunner()
  let merges = 0
  const merge = async (args) => {
    merges += 1
    if (merges === 1) return { ok: false, reason: 'merge_failed' }
    return mergeTicket(args)
  }
  const pipeline = createTicketPipeline({
    runner,
    previewFor: () => null,
    notifier: fakeNotifier(),
    log: () => {},
    merge,
  })
  const context = {
    gh,
    owner: OWNER,
    repo: REPO,
    parents: [parentSnapshot({ parent, ticket })],
    repoDir,
  }

  const first = await pipeline(context)
  assert.equal(first.runs[0].ok, false)
  assert.equal(first.runs[0].reason, 'merge_failed')
  assert.equal(issueOf(fake, ticket.number).state, 'open')

  const second = await pipeline(context)
  assert.notEqual(second.runs[0].skipped, 'fresh-verify', JSON.stringify(second.runs[0]))
  assert.equal(second.runs[0].ok, true, JSON.stringify(second.runs[0]))
  assert.ok(second.runs[0].mergedSha)
  assert.equal(merges, 2, '第二轮要再调一次合并')
  assert.equal(issueOf(fake, ticket.number).state, 'closed')
})

test('已有 fresh verify 但评审没齐：不再整段跳过，接着补评审', async (t) => {
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
  await commitAll(repoDir, `FACTORY: 测试证据 #${ticket.number}`)
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
  assert.notEqual(result.runs[0].skipped, 'fresh-verify')
  assert.equal(result.runs[0].ok, false)
  assert.equal(result.runs[0].reason, 'evidence_not_ready')
  assert.equal(runner.calls.filter((call) => call.name.startsWith('verify-')).length, 0, 'fresh verify 不重跑')
  assert.equal(runner.calls.filter((call) => call.name.startsWith('review-')).length, 1, '缺评审要补')
  assert.equal(
    (await branchTrail(repoDir, `ticket/${ticket.number}`, ticket.number)).filter(
      (row) => row.phase === 'verify',
    ).length,
    1,
    '不重复写 verify 行',
  )
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
  await commitAll(repoDir, `FACTORY: 测试证据 #${ticket.number}`)
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

test('fixer 第 1 轮后复验失败：复验问题交给第 2 轮 fixer，通过后能合并', async (t) => {
  const { fake, gh, parent, ticket } = await setupGithub(t)
  const { repoDir } = await makeRepoFixture(t, ticket.number)
  const runner = scriptedRunner({ reviews: ['fail', 'pass'], verifies: ['pass', 'fail', 'pass'] })
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

  const fixCalls = runner.calls.filter((call) => call.name.startsWith('fix-'))
  assert.equal(fixCalls.length, 2, '第 1 轮复验失败后要起第 2 轮 fixer')
  assert.match(fixCalls[1].brief, /lint 路径规则/, '第 2 轮 fixer 要收到复验问题')
  assert.doesNotMatch(fixCalls[1].brief, /连接池/, '第 2 轮只修复验问题，不重发上一轮评审问题')

  const verifyCalls = runner.calls.filter((call) => call.name.startsWith('verify-'))
  assert.equal(verifyCalls.length, 4, '初次验证、两次修后复验、合并后复验各一次')

  const rows = await readTrail({ repoDir, ticket: ticket.number })
  assert.ok(rows.some((row) => row.phase === 'verify' && row.result === 'fail'))
  assert.ok(rows.some((row) => row.phase === 'merge' && row.result === 'pass'))
  assert.equal(issueOf(fake, ticket.number).state, 'closed')

  const comments = await gh.listComments({ owner: OWNER, repo: REPO, number: parent.number })
  const progress = comments.filter((comment) => comment.body.startsWith('进度 v1｜'))
  const repair = progress.filter((comment) => comment.body.includes('细阶段：评审修复'))
  assert.equal(repair.length, 2, '两轮修复失败各写一条进度')
  assert.match(repair[1].body, /lint 路径规则/)
})

test('fixer 四轮复验都失败：发出事、不合并，fixer 不再多跑', async (t) => {
  const { fake, gh, parent, ticket } = await setupGithub(t)
  const { repoDir } = await makeRepoFixture(t, ticket.number)
  const runner = scriptedRunner({
    reviews: ['fail'],
    verifies: ['pass', 'fail', 'fail', 'fail', 'fail', 'fail'],
  })
  const notifier = fakeNotifier()
  const pipeline = createTicketPipeline({
    runner,
    previewFor: () => null,
    notifier,
    log: () => {},
  })
  const context = {
    gh,
    owner: OWNER,
    repo: REPO,
    parents: [parentSnapshot({ parent, ticket })],
    repoDir,
  }

  const first = await pipeline(context)

  assert.equal(first.runs[0].ok, false)
  assert.equal(first.runs[0].reason, 'evidence_not_ready')
  assert.match(first.runs[0].problems.join('；'), /lint 路径规则/)
  assert.equal(
    runner.calls.filter((call) => call.name.startsWith('fix-')).length,
    4,
    '复验失败最多修四轮，不无限重跑',
  )
  assert.ok(notifier.calls.some((event) => event.event === '出事'), '四轮都失败要发出事通知')
  assert.equal(issueOf(fake, ticket.number).state, 'open')
  assert.ok(
    !(await readTrail({ repoDir, ticket: ticket.number })).some(
      (row) => row.phase === 'merge' && row.result === 'pass',
    ),
    '复验没过不能合需求分支',
  )

  const second = await pipeline(context)

  assert.equal(second.runs[0].ok, false)
  assert.equal(
    runner.calls.filter((call) => call.name.startsWith('fix-')).length,
    4,
    '轮次用完以后不再起 fixer',
  )
})

test('fixer 四轮仍没过：发出事、不合并，下一圈不再修，进度行让停滞检测看得到', async (t) => {
  const { fake, gh, parent, ticket } = await setupGithub(t)
  const { repoDir } = await makeRepoFixture(t, ticket.number)
  const runner = scriptedRunner({ reviews: ['fail', 'fail', 'fail', 'fail', 'fail', 'fail'] })
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
    4,
    'fixer 默认最多跑四轮',
  )
  assert.equal(runner.calls.filter((call) => call.name.startsWith('review-')).length, 5)
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
  assert.equal(progress.length, 5)
  assert.deepEqual(
    progress.map((comment) => /轮次：(\d+)/.exec(comment.body)?.[1]),
    ['2', '3', '4', '5', '6'],
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
    4,
    '轮次用完以后不再起 fixer',
  )
})

test('maxFixRounds 由管线传入：配 1 轮就只修一轮，修不过发出事、不合并', async (t) => {
  const { fake, gh, parent, ticket } = await setupGithub(t)
  const { repoDir } = await makeRepoFixture(t, ticket.number)
  const runner = scriptedRunner({ reviews: ['fail', 'fail'] })
  const notifier = fakeNotifier()
  const pipeline = createTicketPipeline({
    runner,
    previewFor: () => null,
    notifier,
    log: () => {},
    maxFixRounds: 1,
  })

  const result = await pipeline({
    gh,
    owner: OWNER,
    repo: REPO,
    parents: [parentSnapshot({ parent, ticket })],
    repoDir,
  })

  assert.equal(result.runs[0].ok, false)
  assert.equal(result.runs[0].reason, 'evidence_not_ready')
  assert.equal(
    runner.calls.filter((call) => call.name.startsWith('fix-')).length,
    1,
    '管线要把 maxFixRounds 传给 ensureEvidenceBeforeMerge',
  )
  assert.ok(notifier.calls.some((event) => event.event === '出事'))
  assert.equal(issueOf(fake, ticket.number).state, 'open')
  assert.ok(
    !(await readTrail({ repoDir, ticket: ticket.number })).some(
      (row) => row.phase === 'merge' && row.result === 'pass',
    ),
  )
})

test('环境变量 AFK_MAX_FIX_ROUNDS 覆盖管线默认轮次', async (t) => {
  const saved = process.env.AFK_MAX_FIX_ROUNDS
  process.env.AFK_MAX_FIX_ROUNDS = '1'
  try {
    const { fake, gh, parent, ticket } = await setupGithub(t)
    const { repoDir } = await makeRepoFixture(t, ticket.number)
    const runner = scriptedRunner({ reviews: ['fail', 'fail'] })
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

    assert.equal(result.runs[0].ok, false)
    assert.equal(
      runner.calls.filter((call) => call.name.startsWith('fix-')).length,
      1,
      '环境变量要把默认轮次改成 1',
    )
    assert.ok(notifier.calls.some((event) => event.event === '出事'))
    assert.equal(issueOf(fake, ticket.number).state, 'open')
  } finally {
    if (saved === undefined) delete process.env.AFK_MAX_FIX_ROUNDS
    else process.env.AFK_MAX_FIX_ROUNDS = saved
  }
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
  const rows = await branchTrail(repoDir, `ticket/${ticket.number}`, ticket.number)
  const verifyRows = rows.filter((row) => row.phase === 'verify').length
  assert.equal(verifyRows, 1)

  const second = await pipeline({
    gh,
    owner: OWNER,
    repo: REPO,
    parents: [parentSnapshot({ parent, ticket })],
    repoDir,
  })
  assert.notEqual(second.runs[0].skipped, 'fresh-verify')
  assert.equal(second.runs[0].ok, false)
  assert.equal(second.runs[0].reason, 'evidence_not_ready')
  assert.equal(
    (await branchTrail(repoDir, `ticket/${ticket.number}`, ticket.number)).filter(
      (row) => row.phase === 'verify',
    ).length,
    verifyRows,
  )
})

/** 评审认证失败：验证正常，评审返回 403，fixer 不该被调用。 */
function authFailRunner() {
  const calls = []
  return {
    calls,
    async run(args) {
      calls.push(args)
      if (args.name.startsWith('review-')) {
        return {
          ok: false,
          code: 1,
          stdout: '',
          stderr: 'API Error: 403',
          authFailure: true,
          authMessage: 'API Error: 403',
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

test('评审认证失败：管线返回 auth_failed，父工单打 needs-info 写卡住进度，只发一次通知', async (t) => {
  const { fake, gh, parent, ticket } = await setupGithub(t)
  const { repoDir } = await makeRepoFixture(t, ticket.number)
  const runner = authFailRunner()
  const notifier = fakeNotifier()
  const pipeline = createTicketPipeline({
    runner,
    previewFor: () => null,
    notifier,
    log: () => {},
  })
  const context = {
    gh,
    owner: OWNER,
    repo: REPO,
    parents: [parentSnapshot({ parent, ticket })],
    repoDir,
  }

  const first = await pipeline(context)

  assert.equal(first.runs[0].ok, false)
  assert.equal(first.runs[0].reason, 'auth_failed')
  assert.ok(issueOf(fake, parent.number).labels.includes('needs-info'), '父工单要打 needs-info')
  const progress = commentsOf(fake, parent.number).filter((body) => body.startsWith('进度 v1｜'))
  assert.equal(progress.length, 1, '认证失败要写一条进度')
  assert.match(progress[0], /卡住：是/)
  assert.match(progress[0], /细阶段：评审/)
  assert.match(progress[0], /认证失败/)
  const incidents = notifier.calls.filter((event) => event.event === '出事')
  assert.equal(incidents.length, 1, '认证失败要发一次出事通知')
  assert.equal(incidents[0].data.reason, '认证失败')
  assert.equal(runner.calls.filter((call) => call.name.startsWith('fix-')).length, 0, '不调用 fixer')
  assert.equal(
    (await readTrail({ repoDir, ticket: ticket.number })).filter((row) => row.phase === 'review').length,
    0,
    '认证失败不能写成评审 fail 行',
  )
  assert.equal(issueOf(fake, ticket.number).state, 'open')

  // 下一轮调度会读到刚写的进度行，轮次随之变化；进度和通知都不能再写。
  const refreshedComments = (
    await gh.listComments({ owner: OWNER, repo: REPO, number: parent.number })
  ).map((comment) => ({ id: comment.id, body: comment.body, created_at: comment.created_at }))
  const second = await pipeline({
    ...context,
    parents: [{ ...parentSnapshot({ parent, ticket }), comments: refreshedComments }],
  })

  assert.equal(second.runs[0].ok, false)
  assert.equal(second.runs[0].reason, 'auth_failed')
  assert.equal(
    notifier.calls.filter((event) => event.event === '出事').length,
    1,
    '同一张父工单认证失败只通知一次',
  )
  assert.equal(
    commentsOf(fake, parent.number).filter((body) => body.includes('卡住：是')).length,
    1,
    '进度行不重复写',
  )
  assert.equal(runner.calls.filter((call) => call.name.startsWith('fix-')).length, 0)
})

test('父工单已有别的 needs-info 时，认证失败仍发一次通知', async (t) => {
  const { fake, gh, parent, ticket } = await setupGithub(t)
  await gh.addLabels({ owner: OWNER, repo: REPO, number: parent.number, labels: ['needs-info'] })
  const { repoDir } = await makeRepoFixture(t, ticket.number)
  const notifier = fakeNotifier()
  const pipeline = createTicketPipeline({
    runner: authFailRunner(),
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

  assert.equal(result.runs[0].reason, 'auth_failed')
  assert.equal(
    notifier.calls.filter((event) => event.event === '出事').length,
    1,
    '别的流程打的 needs-info 不能挡住认证失败通知',
  )
})

test('父工单带 needs-info：连续两轮不调 runner，摘掉标签后下一轮恢复', async (t) => {
  const { fake, gh, parent, ticket } = await setupGithub(t)
  await gh.addLabels({ owner: OWNER, repo: REPO, number: parent.number, labels: ['needs-info'] })
  const { repoDir } = await makeRepoFixture(t, ticket.number)
  const runner = fakeRunner()
  const pipeline = createTicketPipeline({
    runner,
    previewFor: () => null,
    notifier: fakeNotifier(),
    log: () => {},
  })
  const blocked = parentSnapshot({
    parent,
    ticket,
    labels: ['状态:开发中', 'needs-info'],
  })
  const context = { gh, owner: OWNER, repo: REPO, repoDir }

  for (const round of [1, 2]) {
    const result = await pipeline({ ...context, parents: [blocked] })
    assert.deepEqual(
      result.runs.map((run) => run.skipped),
      ['needs-info'],
      `第 ${round} 轮要跳过：${JSON.stringify(result.runs)}`,
    )
  }
  assert.equal(runner.calls.length, 0, '父工单带 needs-info 时两轮都不调 runner')
  assert.equal(issueOf(fake, ticket.number).state, 'open')

  await gh.removeLabel({ owner: OWNER, repo: REPO, number: parent.number, name: 'needs-info' })
  const resumed = await pipeline({ ...context, parents: [parentSnapshot({ parent, ticket })] })

  assert.equal(resumed.runs[0].ok, true, JSON.stringify(resumed.runs[0]))
  assert.ok(runner.calls.length > 0, '摘标签后下一轮重新调用 runner')
  assert.equal(issueOf(fake, ticket.number).state, 'closed')
})

test('高风险 interrogate 判不过：fixer 修完重新验证、standard/spec 和 interrogate 后合分支', async (t) => {
  const { fake, gh, parent, ticket } = await setupGithub(t)
  const { repoDir } = await makeRepoFixture(t, ticket.number)
  const head = await addMigrationCommit(repoDir, ticket.number)
  await seedCompleteTrail({ repoDir, ticketNumber: ticket.number, head, verifiers: ['v1', 'v2'] })
  const runner = interrogateRunner({ interrogate: ['fail', 'pass'] })
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

  const fixIndex = runner.calls.findIndex((call) => call.name.startsWith('fix-'))
  assert.ok(fixIndex >= 0, 'interrogate 没过没起 fixer')
  assert.equal(runner.calls[fixIndex].allowedTools, FIXER_TOOLS)

  const afterFix = runner.calls.slice(fixIndex + 1)
  const verifyNames = afterFix.filter((call) => call.name.startsWith('verify-')).map((call) => call.name)
  assert.ok(
    verifyNames.some((name) => name.endsWith('-v1')) && verifyNames.some((name) => name.endsWith('-v2')),
    `修完没重新跑两个验证者：${verifyNames.join('、')}`,
  )
  const reviewNames = afterFix.filter((call) => call.name.startsWith('review-')).map((call) => call.name)
  assert.deepEqual(
    reviewNames.slice(0, 2),
    [`review-${ticket.number}-all`, `review-${ticket.number}-interrogate`],
    `修完要先跑 standard/spec 再跑 interrogate：${reviewNames.join('、')}`,
  )
  assert.equal(
    runner.calls.filter((call) => call.name.endsWith('-interrogate')).length,
    2,
    'interrogate 一次不过，修完要再审一次',
  )

  const subjects = (await git(repoDir, ['log', '--format=%s', `ticket/${ticket.number}`]))
    .split(/\r?\n/)
    .filter(Boolean)
  assert.ok(
    subjects.some((line) => line.startsWith(`FACTORY: 评审修复 #${ticket.number}`)),
    `没有 FACTORY: 评审修复 提交：${subjects.join(' / ')}`,
  )

  const rows = await readTrail({ repoDir, ticket: ticket.number })
  assert.ok(rows.some((row) => row.phase === 'review' && row.decision === 'interrogate' && row.result === 'fail'))
  assert.ok(rows.some((row) => row.phase === 'review' && row.decision === 'interrogate' && row.result === 'pass'))
  assert.ok(rows.some((row) => row.phase === 'merge' && row.result === 'pass'))
  assert.equal(issueOf(fake, ticket.number).state, 'closed')

  const progress = commentsOf(fake, parent.number).filter((body) => body.startsWith('进度 v1｜'))
  const repair = progress.filter((body) => body.includes('细阶段：评审修复'))
  assert.equal(repair.length, 1, 'interrogate 失败那一轮要在父工单写一条进度')
  assert.match(repair[0], /轮次：2/)
})

test('interrogate 四轮仍没过：发出事、不合并；轮次用完不再重跑同一 head 的 interrogate', async (t) => {
  const { fake, gh, parent, ticket } = await setupGithub(t)
  const { repoDir } = await makeRepoFixture(t, ticket.number)
  const head = await addMigrationCommit(repoDir, ticket.number)
  await seedCompleteTrail({ repoDir, ticketNumber: ticket.number, head, verifiers: ['v1', 'v2'] })
  const runner = interrogateRunner({ interrogate: ['fail', 'fail', 'fail', 'fail', 'fail'] })
  const notifier = fakeNotifier()
  const pipeline = createTicketPipeline({
    runner,
    previewFor: () => null,
    notifier,
    log: () => {},
  })
  const context = {
    gh,
    owner: OWNER,
    repo: REPO,
    parents: [parentSnapshot({ parent, ticket })],
    repoDir,
  }

  const first = await pipeline(context)

  assert.equal(first.runs[0].ok, false)
  assert.equal(first.runs[0].reason, 'evidence_not_ready')
  assert.match(first.runs[0].problems.join('；'), /到店取名额/)
  assert.equal(
    runner.calls.filter((call) => call.name.startsWith('fix-')).length,
    4,
    'fixer 默认最多跑四轮',
  )
  assert.equal(
    runner.calls.filter((call) => call.name.endsWith('-interrogate')).length,
    5,
    '初始一次加四轮修复各一次',
  )
  assert.ok(notifier.calls.some((event) => event.event === '出事'), '修不过要发出事通知')
  assert.equal(issueOf(fake, ticket.number).state, 'open')
  assert.ok(
    !(await readTrail({ repoDir, ticket: ticket.number })).some(
      (row) => row.phase === 'merge' && row.result === 'pass',
    ),
    'interrogate 没过不能合需求分支',
  )

  const comments = await gh.listComments({ owner: OWNER, repo: REPO, number: parent.number })
  const progress = comments.filter((comment) => comment.body.startsWith('进度 v1｜'))
  assert.equal(progress.length, 5)
  assert.deepEqual(
    progress.map((comment) => /轮次：(\d+)/.exec(comment.body)?.[1]),
    ['2', '3', '4', '5', '6'],
  )
  assert.equal(stallHits({ comments }).some((hit) => hit.reason === '三圈没进展'), true)

  const before = runner.calls.length
  const second = await pipeline(context)

  assert.equal(second.runs[0].ok, false)
  assert.equal(second.runs[0].reason, 'evidence_not_ready')
  assert.match(second.runs[0].problems.join('；'), /修复轮次已用完/)
  assert.equal(runner.calls.length, before, '同一 head、轮次用完，不再跑 agent')
  assert.equal(runner.calls.filter((call) => call.name.startsWith('fix-')).length, 4)
  assert.equal(runner.calls.filter((call) => call.name.endsWith('-interrogate')).length, 5)
})

test('管线在票工作树里跑，不在主仓切票分支', async (t) => {
  const { fake, gh, parent, ticket } = await setupGithub(t)
  const { repoDir } = await makeRepoFixture(t, ticket.number)
  const seen = []
  const inner = fakeRunner()
  const runner = {
    calls: inner.calls,
    async run(args) {
      seen.push({
        cwd: args.cwd,
        branch: await git(args.cwd, ['branch', '--show-current']),
        main: await git(repoDir, ['branch', '--show-current']),
      })
      return inner.run(args)
    },
  }
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

  assert.equal(result.runs[0].ok, true, JSON.stringify(result.runs[0]))
  const worktreesDir = join(repoDir, '.sandcastle', 'worktrees')
  assert.ok(
    seen.some((call) => call.branch === `ticket/${ticket.number}`),
    '证据阶段要在票工作树里跑',
  )
  for (const call of seen) {
    assert.equal(call.main, REQ_BRANCH, '主仓在管线运行期间不能切走需求分支')
    if (call.branch === `ticket/${ticket.number}`) {
      assert.ok(
        call.cwd.startsWith(worktreesDir),
        `票分支上的 agent 要在票工作树里跑，实际 cwd=${call.cwd}`,
      )
    } else {
      // 合并后复验在主仓的需求分支上跑。
      assert.equal(call.branch, REQ_BRANCH)
      assert.equal(call.cwd, repoDir)
    }
  }
  assert.equal(issueOf(fake, ticket.number).state, 'closed')

  const left = await git(repoDir, ['worktree', 'list', '--porcelain'])
  assert.ok(!left.includes('.sandcastle/worktrees'), `管线跑完还有工作树残留：\n${left}`)
  assert.equal(await git(repoDir, ['branch', '--show-current']), REQ_BRANCH)
})

test('点火留下只有未跟踪文件的工作树：先归档再重建，不报 branch_conflict', async (t) => {
  const { fake, gh, parent, ticket } = await setupGithub(t)
  const { repoDir } = await makeRepoFixture(t, ticket.number)
  const worktree = join(repoDir, '.sandcastle', 'worktrees', `ticket-${ticket.number}`)
  await mkdir(dirname(worktree), { recursive: true })
  await git(repoDir, ['worktree', 'add', worktree, `ticket/${ticket.number}`])
  await mkdir(join(worktree, 'shots'), { recursive: true })
  await writeFile(join(worktree, 'shots', '首页.png'), 'LEFTOVER-SHOT')
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

  const run = result.runs[0]
  assert.notEqual(run.reason, 'branch_conflict', JSON.stringify(run))
  assert.equal(run.ok, true, JSON.stringify(run))
  assert.equal(issueOf(fake, ticket.number).state, 'closed')

  const archived = (
    await readdir(join(repoDir, '.audit', 'archive'), { recursive: true })
  ).filter((name) => name.endsWith('首页.png'))
  assert.equal(archived.length, 1, `归档目录里没有首页.png：${archived.join('、')}`)
  assert.match(archived[0], /ticket-\d+/)
  assert.equal(
    await readFile(join(repoDir, '.audit', 'archive', archived[0]), 'utf8'),
    'LEFTOVER-SHOT',
  )
  const left = await git(repoDir, ['worktree', 'list', '--porcelain'])
  assert.ok(!left.includes('.sandcastle/worktrees'), `管线跑完还有工作树残留：\n${left}`)
})

test('脏票工作树里被忽略的证据：先提交到票分支再归档，证据不丢', async (t) => {
  const { gh, parent, ticket } = await setupGithub(t)
  const { repoDir } = await makeRepoFixture(t, ticket.number)
  const worktree = join(repoDir, '.sandcastle', 'worktrees', `ticket-${ticket.number}`)
  await mkdir(dirname(worktree), { recursive: true })
  await git(repoDir, ['worktree', 'add', worktree, `ticket/${ticket.number}`])
  // 验证 agent 或人工加的忽略规则：证据不进普通 git status。
  await writeFile(
    join(repoDir, '.git', 'info', 'exclude'),
    `.audit/evidence/${ticket.number}/\n.audit/${ticket.number}.tsv\n`,
  )
  await mkdir(join(worktree, '.audit', 'evidence', String(ticket.number), 'v1'), {
    recursive: true,
  })
  await writeFile(
    join(worktree, '.audit', 'evidence', String(ticket.number), 'v1', 'after.png'),
    'PNG',
  )
  // 上一次修票留下未提交的已跟踪改动，prepareTicket 会拒绝复用工作树。
  await writeFile(join(worktree, 'src', 'app.mjs'), 'export const APP = 3\n')
  const pipeline = createTicketPipeline({
    runner: fakeRunner(),
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

  assert.equal(result.runs[0].reason, 'worktree_dirty', JSON.stringify(result.runs[0]))
  const committed = await git(repoDir, [
    'show',
    `ticket/${ticket.number}:.audit/evidence/${ticket.number}/v1/after.png`,
  ]).catch(() => '')
  assert.equal(committed, 'PNG', '被忽略的证据要先提交到票分支，不能被归档卷走')
})

test('未跟踪证据挡住切票分支：先归档再切，不返回 branch-busy', async (t) => {
  const { fake, gh, parent, ticket } = await setupGithub(t)
  const { repoDir } = await makeRepoFixture(t, ticket.number)
  // 上一张票验证留下的证据：需求分支里是未跟踪文件，票分支已经跟踪同一路径。
  await mkdir(join(repoDir, '.audit', 'verify'), { recursive: true })
  await writeFile(join(repoDir, '.audit', 'verify', 'after.png'), 'LEFTOVER-EVIDENCE')
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

  const run = result.runs[0]
  assert.notEqual(run.skipped, 'branch-busy', JSON.stringify(run))
  assert.equal(run.ok, true, JSON.stringify(run))
  assert.ok(run.mergedSha)
  assert.equal(issueOf(fake, ticket.number).state, 'closed')

  const archived = (await readdir(join(repoDir, '.audit', 'archive'), { recursive: true })).filter(
    (name) => name.endsWith('after.png'),
  )
  assert.equal(archived.length, 1, `归档目录里没有 after.png：${archived.join('、')}`)
  assert.equal(
    await readFile(join(repoDir, '.audit', 'archive', archived[0]), 'utf8'),
    'LEFTOVER-EVIDENCE',
    '归档不能改证据内容',
  )
})

test('归档处理不了时返回 branch_conflict，不再报 branch-busy', async (t) => {
  const { gh, parent, ticket } = await setupGithub(t)
  const { repoDir } = await makeRepoFixture(t, ticket.number)
  await mkdir(join(repoDir, '.audit', 'verify'), { recursive: true })
  await writeFile(join(repoDir, '.audit', 'verify', 'after.png'), 'LEFTOVER-EVIDENCE')
  await git(repoDir, ['config', 'core.hooksPath', '.git/nonexistent-hooks'])
  // 票分支被另一个工作树占着，repoWorkspace 建不了新工作树，归档也救不回来。
  const other = join(repoDir, '..', 'other-worktree')
  await git(repoDir, ['worktree', 'add', other, `ticket/${ticket.number}`])
  t.after(() => git(repoDir, ['worktree', 'remove', '--force', other]).catch(() => {}))
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
  assert.equal(result.runs[0].reason, 'branch_conflict')
  assert.notEqual(result.runs[0].skipped, 'branch-busy')
  assert.equal(runner.calls.length, 0, '切不过去就不跑验证和评审')
})
