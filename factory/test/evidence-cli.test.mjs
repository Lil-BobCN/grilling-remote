import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ensureEvidenceBeforeMerge } from '../bin/evidence.mjs'
import { appendTrail, readTrail } from '../lib/evidence.mjs'
import { git } from '../lib/git.mjs'

const NOW = '2026-11-17T10:00:00+08:00'

async function makeRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'afk-evidence-cli-'))
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

function verdict(ok = true, problems = []) {
  return `AFK_VERDICT ${JSON.stringify({
    ok,
    evidence: ['.audit/screenshots/after.png'],
    problems,
    tests: [{ command: 'npm test', result: ok ? 'pass' : 'fail' }],
  })}`
}

function fakeRunner(ok = true, problems = []) {
  const calls = []
  return {
    calls,
    async run(options) {
      calls.push(options)
      return { ok, code: ok ? 0 : 1, stdout: verdict(ok, problems), stderr: '' }
    },
  }
}

function fakePreview() {
  const calls = []
  return {
    calls,
    async start(args) {
      calls.push(['start', args])
      return {
        ok: true,
        address: 'acme-shop-pr51.afkfactory.space',
        url: 'https://acme-shop-pr51.afkfactory.space/',
        user: 'reviewer',
        password: 'secret',
      }
    },
    async stop(args) {
      calls.push(['stop', args])
      return { ok: true }
    },
  }
}

function fakeNotifier() {
  const sent = []
  return { sent, async send(event) { sent.push(event) } }
}

function ticket() {
  return {
    number: 51,
    title: '预约取货',
    customer: 'acme',
    requirement: 'yuyue',
    htmlUrl: 'https://github.com/acme/demo/issues/51',
  }
}

test('证据不齐：先起预览，跑验证和评审写 trail，预览留给合并阶段复用', async () => {
  const dir = await makeRepo()
  try {
    await appendTrail({
      repoDir: dir,
      ticket: 51,
      ts: NOW,
      phase: 'preview',
      decision: '有界面',
      result: 'required',
    })
    const runner = fakeRunner(true)
    const preview = fakePreview()
    const notifier = fakeNotifier()

    const result = await ensureEvidenceBeforeMerge({
      repoDir: dir,
      ticket: ticket(),
      ticketNumber: 51,
      branch: 'HEAD',
      runner,
      preview,
      notifier,
      now: NOW,
    })

    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(runner.calls.length, 2, '验证和评审各跑一次')
    assert.ok(runner.calls[0].brief.includes('预览：https://acme-shop-pr51'))
    assert.ok(runner.calls[0].brief.includes('reviewer'))
    assert.equal(preview.calls.filter(([kind]) => kind === 'start').length, 1)
    assert.equal(preview.calls.filter(([kind]) => kind === 'stop').length, 0, '预览留给合并阶段销毁')

    const rows = await readTrail({ repoDir: dir, ticket: 51 })
    assert.equal(rows.filter((row) => row.phase === 'verify' && row.result === 'pass').length, 1)
    assert.equal(rows.filter((row) => row.phase === 'test' && row.result === 'pass').length, 1)
    assert.deepEqual(
      rows.filter((row) => row.phase === 'review').map((row) => row.decision),
      ['标准', 'spec'],
    )
    assert.equal(notifier.sent.length, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('证据不齐且 agent 判不过：销毁预览，发出事，返回 evidence_not_ready', async () => {
  const dir = await makeRepo()
  try {
    await appendTrail({
      repoDir: dir,
      ticket: 51,
      ts: NOW,
      phase: 'preview',
      decision: '有界面',
      result: 'required',
    })
    const runner = fakeRunner(false, ['下单页 500'])
    const preview = fakePreview()
    const notifier = fakeNotifier()

    const result = await ensureEvidenceBeforeMerge({
      repoDir: dir,
      ticket: ticket(),
      ticketNumber: 51,
      branch: 'HEAD',
      runner,
      preview,
      notifier,
      now: NOW,
    })

    assert.equal(result.ok, false)
    assert.equal(result.reason, 'evidence_not_ready')
    assert.match(result.problems.join('；'), /下单页 500/)
    assert.equal(preview.calls.filter(([kind]) => kind === 'stop').length, 1)
    const incident = notifier.sent.find((event) => event.event === '出事')
    assert.ok(incident, '没有发出事通知')
    assert.equal(incident.data.reason, '验证评审修不过')
    assert.match(incident.data.tried, /下单页 500/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('没有预览行就不起预览；已有验证时只跑评审', async () => {
  const dir = await makeRepo()
  try {
    await appendTrail({
      repoDir: dir,
      ticket: 51,
      ts: NOW,
      phase: 'verify',
      decision: 'abc1234',
      why: '按验收条件验证',
      evidence: '.audit/screenshots/after.png',
      result: 'pass',
    })
    await appendTrail({
      repoDir: dir,
      ticket: 51,
      ts: NOW,
      phase: 'test',
      decision: 'npm test',
      evidence: 'pass',
      result: 'pass',
    })
    const runner = fakeRunner(true)
    const preview = fakePreview()

    const result = await ensureEvidenceBeforeMerge({
      repoDir: dir,
      ticket: ticket(),
      ticketNumber: 51,
      branch: 'HEAD',
      runner,
      preview,
      notifier: fakeNotifier(),
      now: NOW,
    })

    assert.equal(result.ok, true)
    assert.equal(preview.calls.length, 0)
    assert.equal(runner.calls.length, 1)
    assert.equal(runner.calls[0].name, 'review-51-all')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('证据已经齐了就不跑 agent', async () => {
  const dir = await makeRepo()
  try {
    for (const [phase, decision, result] of [
      ['verify', 'abc1234', 'pass'],
      ['test', 'npm test', 'pass'],
      ['review', '标准', 'pass'],
      ['review', 'spec', 'pass'],
    ]) {
      await appendTrail({
        repoDir: dir,
        ticket: 51,
        ts: NOW,
        phase,
        decision,
        evidence: '.audit/screenshots/after.png',
        result,
      })
    }
    const runner = fakeRunner(true)
    const result = await ensureEvidenceBeforeMerge({
      repoDir: dir,
      ticket: ticket(),
      ticketNumber: 51,
      branch: 'HEAD',
      runner,
      preview: fakePreview(),
      notifier: fakeNotifier(),
      now: NOW,
    })
    assert.equal(result.ok, true)
    assert.equal(runner.calls.length, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
