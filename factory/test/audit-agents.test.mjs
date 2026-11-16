import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { runReviewAudit, runVerifyAudit, parseAuditVerdict } from '../lib/audit-agents.mjs'
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

function fakeRunner(stdout, { ok = true, stderr = '' } = {}) {
  const calls = []
  return {
    calls,
    async run(options) {
      calls.push(options)
      return { ok, code: ok ? 0 : 1, stdout, stderr }
    },
  }
}

function verdictLine(value) {
  return `AFK_VERDICT ${JSON.stringify(value)}`
}

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
