import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { runFixerAudit, runReviewAudit, runVerifyAudit, parseAuditVerdict } from '../lib/audit-agents.mjs'
import { NO_WRITE_TOOLS, REVIEW_TOOLS, VERIFY_TOOLS } from '../lib/agent-runner.mjs'
import { readTrail } from '../lib/evidence.mjs'
import { git } from '../lib/git.mjs'
import { run as runReview } from '../bin/review.mjs'
import { run as runVerify } from '../bin/verify.mjs'

const NOW = '2026-11-17T10:00:00+08:00'

async function makeRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'afk-audit-agents-'))
  await git(dir, ['init', '-b', 'main'])
  await git(dir, ['config', 'user.name', 'AFK Test'])
  await git(dir, ['config', 'user.email', 'test@afkfactory.space'])
  await mkdir(join(dir, '.audit', 'screenshots'), { recursive: true })
  await writeFile(join(dir, '.audit', 'screenshots', 'after.png'), 'png-bytes')
  await writeFile(join(dir, 'README.md'), 'base\n')
  await git(dir, ['add', '-A'])
  await git(dir, ['commit', '-m', 'base'])
  return dir
}

function fakeRunner(stdout, { ok = true, stderr = '', authFailure = false, authMessage = '' } = {}) {
  const calls = []
  return {
    calls,
    async run(options) {
      calls.push(options)
      return { ok, code: ok ? 0 : 1, stdout, stderr, ...(authFailure ? { authFailure: true, authMessage } : {}) }
    },
  }
}

function verdictLine(value) {
  return `AFK_VERDICT ${JSON.stringify(value)}`
}

test('审计行按写入时刻取时间，不共用进入时间', async () => {
  const dir = await makeRepo()
  try {
    const times = [
      new Date('2026-11-17T10:00:00Z'),
      new Date('2026-11-17T10:05:00Z'),
    ]
    let index = 0
    const clock = () => times[Math.min(index++, times.length - 1)]
    const runner = fakeRunner(
      verdictLine({
        ok: true,
        evidence: ['.audit/screenshots/after.png'],
        problems: [],
        tests: [{ command: 'npm test', result: 'pass' }],
      }),
    )
    await runVerifyAudit({ repoDir: dir, ticket: 71, branch: 'HEAD', runner, clock })
    const rows = await readTrail({ repoDir: dir, ticket: 71 })
    const verify = rows.find((row) => row.phase === 'verify')
    const testRow = rows.find((row) => row.phase === 'test')
    assert.equal(verify.ts, times[0].toISOString())
    assert.equal(testRow.ts, times[1].toISOString())
    assert.ok(Date.parse(testRow.ts) > Date.parse(verify.ts), '两行时间递增')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('验证通过：写 verify 行和 test 行，decision 是 head', async () => {
  const dir = await makeRepo()
  try {
    const head = await git(dir, ['rev-parse', 'HEAD'])
    const runner = fakeRunner(
      verdictLine({
        ok: true,
        evidence: ['.audit/screenshots/after.png'],
        problems: [],
        tests: [{ command: 'npm test', result: 'pass' }],
      }),
    )
    const result = await runVerifyAudit({
      repoDir: dir,
      ticket: 51,
      branch: 'HEAD',
      before: 'abc1234',
      runner,
      now: NOW,
    })
    assert.equal(result.ok, true)
    assert.equal(result.headSha, head)
    assert.match(runner.calls[0].brief, /AFK_VERDICT/)
    assert.equal(runner.calls[0].tools, NO_WRITE_TOOLS)
    assert.equal(runner.calls[0].allowedTools, VERIFY_TOOLS)
    assert.ok(!runner.calls[0].allowedTools.includes('Write'))
    assert.ok(!runner.calls[0].allowedTools.includes('Edit'))

    const rows = await readTrail({ repoDir: dir, ticket: 51 })
    const verify = rows.find((row) => row.phase === 'verify')
    assert.equal(verify.decision, head)
    assert.equal(verify.why, '改前 abc1234')
    assert.equal(verify.evidence, '.audit/screenshots/after.png')
    assert.equal(verify.result, 'pass')
    const testRow = rows.find((row) => row.phase === 'test')
    assert.equal(testRow.decision, 'npm test')
    assert.equal(testRow.evidence, 'pass')
    assert.equal(testRow.result, 'pass')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('截图不存在判 fail，并写清哪个路径', async () => {
  const dir = await makeRepo()
  try {
    const runner = fakeRunner(
      verdictLine({ ok: true, evidence: ['.audit/screenshots/missing.png'], problems: [] }),
    )
    const result = await runVerifyAudit({ repoDir: dir, ticket: 52, branch: 'HEAD', runner, now: NOW })
    assert.equal(result.ok, false)
    assert.match(result.problems.join('；'), /missing\.png/)
    const rows = await readTrail({ repoDir: dir, ticket: 52 })
    assert.equal(rows.find((row) => row.phase === 'verify').result, 'fail')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('验证 agent 判不过时 problems 写进返回值和 trail', async () => {
  const dir = await makeRepo()
  try {
    const runner = fakeRunner(
      verdictLine({
        ok: false,
        evidence: ['.audit/screenshots/after.png'],
        problems: ['下单页 500'],
        tests: [{ command: 'npm test', result: 'fail' }],
      }),
    )
    const result = await runVerifyAudit({ repoDir: dir, ticket: 53, branch: 'HEAD', runner, now: NOW })
    assert.equal(result.ok, false)
    assert.deepEqual(result.problems, ['下单页 500'])
    const rows = await readTrail({ repoDir: dir, ticket: 53 })
    assert.equal(rows.find((row) => row.phase === 'verify').result, 'fail')
    assert.equal(rows.find((row) => row.phase === 'test').result, 'fail')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('评审默认写标准和 spec 两行，模式可以只写一轴', async () => {
  const dir = await makeRepo()
  try {
    const head = await git(dir, ['rev-parse', 'HEAD'])
    const runner = fakeRunner(
      verdictLine({ ok: true, evidence: ['https://github.com/acme/demo/pull/7#discussion_r1'] }),
    )
    const all = await runReviewAudit({ repoDir: dir, ticket: 54, branch: 'HEAD', runner, now: NOW })
    assert.equal(all.ok, true)
    assert.equal(runner.calls.at(-1).tools, NO_WRITE_TOOLS)
    assert.equal(runner.calls.at(-1).allowedTools, REVIEW_TOOLS)
    assert.ok(!runner.calls.at(-1).allowedTools.includes('Write'))
    let rows = await readTrail({ repoDir: dir, ticket: 54 }).then((list) =>
      list.filter((row) => row.phase === 'review'),
    )
    assert.deepEqual(rows.map((row) => row.decision), ['标准', 'spec'])
    for (const row of rows) {
      assert.equal(row.why, `head ${head}`)
      assert.equal(row.evidence, 'https://github.com/acme/demo/pull/7#discussion_r1')
      assert.equal(row.result, 'pass')
    }

    await runReviewAudit({
      repoDir: dir,
      ticket: 55,
      branch: 'HEAD',
      mode: 'spec',
      runner,
      now: NOW,
    })
    rows = await readTrail({ repoDir: dir, ticket: 55 })
    assert.deepEqual(rows.map((row) => row.decision), ['spec'])

    await runReviewAudit({
      repoDir: dir,
      ticket: 56,
      branch: 'HEAD',
      mode: 'interrogate',
      runner,
      now: NOW,
    })
    rows = await readTrail({ repoDir: dir, ticket: 56 })
    assert.deepEqual(rows.map((row) => row.decision), ['interrogate'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('评审判不过时两行都写 fail', async () => {
  const dir = await makeRepo()
  try {
    const runner = fakeRunner(verdictLine({ ok: false, problems: ['漏了错误处理'] }))
    const result = await runReviewAudit({ repoDir: dir, ticket: 57, branch: 'HEAD', runner, now: NOW })
    assert.equal(result.ok, false)
    const rows = await readTrail({ repoDir: dir, ticket: 57 })
    assert.deepEqual(rows.map((row) => row.result), ['fail', 'fail'])
    assert.match(rows[0].evidence, /漏了错误处理/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('验证 agent 认证失败：返回 authFailure，不写普通 fail 行', async () => {
  const dir = await makeRepo()
  try {
    const runner = fakeRunner('', {
      ok: false,
      stderr: 'API Error: 403',
      authFailure: true,
      authMessage: 'API Error: 403',
    })
    const result = await runVerifyAudit({ repoDir: dir, ticket: 62, branch: 'HEAD', runner, now: NOW })
    assert.equal(result.ok, false)
    assert.equal(result.authFailure, true)
    assert.equal(result.authMessage, 'API Error: 403')
    assert.match(result.problems.join('；'), /认证失败/)
    assert.match(result.problems.join('；'), /403/)
    assert.deepEqual(result.rows, [])
    assert.deepEqual(await readTrail({ repoDir: dir, ticket: 62 }), [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('评审 agent 认证失败：返回 authFailure，不写成评审 fail 行', async () => {
  const dir = await makeRepo()
  try {
    const runner = fakeRunner('', {
      ok: false,
      stderr: 'API Error: 401',
      authFailure: true,
      authMessage: 'API Error: 401',
    })
    const result = await runReviewAudit({ repoDir: dir, ticket: 63, branch: 'HEAD', runner, now: NOW })
    assert.equal(result.ok, false)
    assert.equal(result.authFailure, true)
    assert.match(result.problems.join('；'), /认证失败/)
    assert.deepEqual(result.rows, [])
    assert.deepEqual(await readTrail({ repoDir: dir, ticket: 63 }), [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('兼容旧的 AFK_VERDICT: pass 写法', () => {
  assert.equal(parseAuditVerdict('AFK_VERDICT: pass').ok, true)
  const failed = parseAuditVerdict('AFK_VERDICT: fail 首页白屏')
  assert.equal(failed.ok, false)
  assert.deepEqual(failed.problems, ['首页白屏'])
})

test('verify CLI 注入假 runner，输出 ok 并按结果写 trail', async () => {
  const dir = await makeRepo()
  try {
    const runner = fakeRunner(
      verdictLine({
        ok: true,
        evidence: ['.audit/screenshots/after.png'],
        tests: [{ command: 'npm test', result: 'pass' }],
      }),
    )
    const { output, exitCode } = await runVerify(
      ['--repo-dir', dir, '--ticket', '58', '--branch', 'HEAD'],
      { runner, now: NOW },
    )
    assert.equal(exitCode, 0)
    assert.equal(output.ok, true)
    const rows = await readTrail({ repoDir: dir, ticket: 58 })
    assert.equal(rows.length, 2)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('review CLI 注入假 runner，--mode spec 只写 spec 行', async () => {
  const dir = await makeRepo()
  try {
    const runner = fakeRunner(verdictLine({ ok: true }))
    const { output, exitCode } = await runReview(
      ['--repo-dir', dir, '--ticket', '59', '--branch', 'HEAD', '--mode', 'spec'],
      { runner, now: NOW },
    )
    assert.equal(exitCode, 0)
    assert.equal(output.ok, true)
    const rows = await readTrail({ repoDir: dir, ticket: 59 })
    assert.deepEqual(rows.map((row) => row.decision), ['spec'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('验证证据按票和验证者分目录，跨票同名不覆盖', async () => {
  const dir = await makeRepo()
  const shared = '.audit/screenshots/order-delivery.png'
  const calls = []
  const writer = (content) => ({
    async run(options) {
      calls.push(options)
      await mkdir(join(dir, '.audit', 'screenshots'), { recursive: true })
      await writeFile(join(dir, shared), content)
      return {
        ok: true,
        code: 0,
        stdout: verdictLine({ ok: true, evidence: [shared], problems: [] }),
        stderr: '',
      }
    },
  })
  try {
    const first = await runVerifyAudit({
      repoDir: dir,
      ticket: 70,
      branch: 'HEAD',
      verifierId: 'v1',
      runner: writer('票 70 v1'),
      now: NOW,
    })
    assert.equal(first.ok, true, JSON.stringify(first.problems))
    assert.equal(first.evidence[0], '.audit/evidence/70/v1/screenshots/order-delivery.png')

    const other = await runVerifyAudit({
      repoDir: dir,
      ticket: 70,
      branch: 'HEAD',
      verifierId: 'v2',
      runner: writer('票 70 v2'),
      now: NOW,
    })
    assert.equal(other.evidence[0], '.audit/evidence/70/v2/screenshots/order-delivery.png')

    const next = await runVerifyAudit({
      repoDir: dir,
      ticket: 71,
      branch: 'HEAD',
      verifierId: 'v1',
      runner: writer('票 71 v1'),
      now: NOW,
    })
    assert.equal(next.evidence[0], '.audit/evidence/71/v1/screenshots/order-delivery.png')

    assert.match(calls.at(-1).brief, /\.audit\/evidence\/71\/v1/)
    assert.equal(
      await readFile(join(dir, first.evidence[0]), 'utf8'),
      '票 70 v1',
      '后一张票不能覆盖前一张票的证据',
    )
    assert.equal(
      await readFile(join(dir, other.evidence[0]), 'utf8'),
      '票 70 v2',
      '另一个验证者不能覆盖同名证据',
    )
    const rows = await readTrail({ repoDir: dir, ticket: 70 })
    assert.equal(
      rows.find((row) => row.phase === 'verify' && row.why.includes('verifier=v2')).evidence,
      other.evidence[0],
      'trail 要写挪动后的路径',
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

function writingRunner(write) {
  return {
    calls: [],
    async run(options) {
      this.calls.push(options)
      await write(options)
      return { ok: true, code: 0, stdout: 'AFK_FIX: done\n', stderr: '' }
    },
  }
}

test('fixer 提交只含源码，不带 .sandcastle 和 .factory-tmp 临时文件', async () => {
  const dir = await makeRepo()
  try {
    const runner = writingRunner(async ({ cwd }) => {
      await mkdir(join(cwd, 'src'), { recursive: true })
      await writeFile(join(cwd, 'src', 'app.mjs'), 'export const APP = 2\n')
      await mkdir(join(cwd, '.sandcastle'), { recursive: true })
      await writeFile(join(cwd, '.sandcastle', 'prompt-x.md'), '临时提示词\n')
      await mkdir(join(cwd, '.factory-tmp'), { recursive: true })
      await writeFile(join(cwd, '.factory-tmp', 'x'), '临时文件\n')
    })
    const result = await runFixerAudit({ repoDir: dir, ticket: 60, branch: 'HEAD', round: 1, runner })
    assert.equal(result.ok, true, result.problems.join('；'))
    assert.equal(result.changed, true)
    assert.equal(await git(dir, ['log', '-1', '--format=%s']), 'FACTORY: 评审修复 #60 第1轮')
    const files = (await git(dir, ['show', '--name-only', '--format=', 'HEAD']))
      .split(/\r?\n/)
      .filter(Boolean)
    assert.deepEqual(files, ['src/app.mjs'])
    assert.equal(await readFile(join(dir, '.sandcastle', 'prompt-x.md'), 'utf8'), '临时提示词\n')
    assert.equal(await readFile(join(dir, '.factory-tmp', 'x'), 'utf8'), '临时文件\n')
    const status = await git(dir, ['status', '--porcelain'])
    assert.match(status, /\?\? \.factory-tmp\//)
    assert.match(status, /\?\? \.sandcastle\//)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('工作区只有临时文件时 fixer 不提交', async () => {
  const dir = await makeRepo()
  try {
    const runner = writingRunner(async ({ cwd }) => {
      await mkdir(join(cwd, '.sandcastle'), { recursive: true })
      await writeFile(join(cwd, '.sandcastle', 'prompt-x.md'), '临时提示词\n')
      await mkdir(join(cwd, '.factory-tmp'), { recursive: true })
      await writeFile(join(cwd, '.factory-tmp', 'x'), '临时文件\n')
    })
    const head = await git(dir, ['rev-parse', 'HEAD'])
    const result = await runFixerAudit({ repoDir: dir, ticket: 61, branch: 'HEAD', round: 1, runner })
    assert.equal(result.changed, false)
    assert.equal(result.headSha, head)
    assert.equal(result.ok, false)
    assert.match(result.problems.join('；'), /没改出提交/)
    assert.equal(await git(dir, ['rev-parse', 'HEAD']), head)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
