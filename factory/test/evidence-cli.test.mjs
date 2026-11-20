import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ensureEvidenceBeforeMerge, runMerge } from '../bin/evidence.mjs'
import { appendTrail, freshVerifiers, readTrail } from '../lib/evidence.mjs'
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

async function commitAll(dir, message) {
  await git(dir, ['add', '-A'])
  await git(dir, ['commit', '-m', message])
  return git(dir, ['rev-parse', 'HEAD'])
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

test('--dry-run 报告 risk/plan/fresh/preview，和真合并用同一套判定', async () => {
  const dir = await makeRepo()
  try {
    await git(dir, ['checkout', '-b', 'req/51'])
    await writeFile(join(dir, 'req.txt'), 'req\n')
    const reqSha = await commitAll(dir, 'req work')

    await git(dir, ['checkout', '-b', 'ticket/51', 'main'])
    await mkdir(join(dir, 'db', 'migrations'), { recursive: true })
    await writeFile(join(dir, 'db', 'migrations', '001_init.sql'), 'create table t;\n')
    const codeSha = await commitAll(dir, 'ticket work')

    for (const item of [
      {
        phase: 'verify',
        decision: codeSha,
        why: `验证 head ${codeSha}`,
        evidence: `.audit/screenshots/after.png sha=${codeSha}`,
      },
      { phase: 'test', decision: 'npm test', why: `测试 head ${codeSha}`, evidence: 'pass' },
      { phase: 'review', decision: '标准', why: `head ${codeSha}`, evidence: 'AFK_VERDICT pass' },
      { phase: 'review', decision: 'spec', why: `head ${codeSha}`, evidence: 'AFK_VERDICT pass' },
    ]) {
      await appendTrail({ repoDir: dir, ticket: 51, ts: NOW, result: 'pass', ...item })
    }

    const blocked = await runMerge({
      'repo-dir': dir,
      ticket: '51',
      'ticket-branch': 'ticket/51',
      'req-branch': 'req/51',
      dryRun: true,
    })
    assert.equal(blocked.output.dryRun, true)
    assert.equal(blocked.output.ok, false, JSON.stringify(blocked.output))
    assert.equal(blocked.output.risk, 'high')
    assert.deepEqual(blocked.output.plan, {
      run: true,
      verifiers: 2,
      mode: 'full',
      reviewMode: 'interrogate',
    })
    assert.equal(blocked.output.fresh.length, 1)
    assert.deepEqual(blocked.output.preview, { required: false })
    assert.ok(blocked.output.missing.some((text) => text.includes('高风险验证队')))
    assert.equal(blocked.exitCode, 1)
    assert.equal(await git(dir, ['rev-parse', 'req/51']), reqSha, 'dry-run 不该动需求分支')

    await appendTrail({
      repoDir: dir,
      ticket: 51,
      ts: NOW,
      phase: 'verify',
      decision: codeSha,
      why: `验证 head ${codeSha} · verifier=v2`,
      evidence: `.audit/screenshots/after.png sha=${codeSha}`,
      result: 'pass',
    })
    const ready = await runMerge({
      'repo-dir': dir,
      ticket: '51',
      'ticket-branch': 'ticket/51',
      'req-branch': 'req/51',
      dryRun: true,
    })
    assert.equal(ready.output.ok, true, JSON.stringify(ready.output))
    assert.equal(ready.output.fresh.length, 2)
    assert.deepEqual(ready.output.missing, [])
    assert.equal(ready.exitCode, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

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

test('评审 agent 认证失败：返回 auth_failed，不调用 fixer，不发出事通知', async () => {
  const dir = await makeRepo()
  try {
    const calls = []
    const runner = {
      async run(options) {
        calls.push(options)
        if (options.name.startsWith('review-')) {
          return {
            ok: false,
            code: 1,
            stdout: '',
            stderr: 'API Error: 403',
            authFailure: true,
            authMessage: 'API Error: 403',
          }
        }
        return { ok: true, code: 0, stdout: verdict(true), stderr: '' }
      },
    }
    const fixerCalls = []
    const notifier = fakeNotifier()

    const result = await ensureEvidenceBeforeMerge({
      repoDir: dir,
      ticket: ticket(),
      ticketNumber: 51,
      branch: 'HEAD',
      runner,
      preview: fakePreview(),
      notifier,
      now: NOW,
      fixer: async (args) => {
        fixerCalls.push(args)
        return { ok: true }
      },
    })

    assert.equal(result.ok, false)
    assert.equal(result.reason, 'auth_failed')
    assert.equal(result.stage, 'review')
    assert.match(result.problems.join('；'), /认证失败/)
    assert.match(result.problems.join('；'), /403/)
    assert.equal(fixerCalls.length, 0, '认证失败不能交给 fixer')
    assert.equal(calls.filter((call) => call.name.startsWith('fix-')).length, 0)
    assert.equal(calls.filter((call) => call.name.startsWith('review-')).length, 1)

    const rows = await readTrail({ repoDir: dir, ticket: 51 })
    assert.equal(rows.filter((row) => row.phase === 'review').length, 0, '认证失败不能写成评审 fail 行')
    assert.equal(notifier.sent.length, 0, '通知由管线发，这里不重复发')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('验证 agent 认证失败：不再跑评审，返回 auth_failed', async () => {
  const dir = await makeRepo()
  try {
    const calls = []
    const runner = {
      async run(options) {
        calls.push(options)
        return {
          ok: false,
          code: 1,
          stdout: '',
          stderr: 'API Error: 402',
          authFailure: true,
          authMessage: 'API Error: 402',
        }
      },
    }
    const fixerCalls = []

    const result = await ensureEvidenceBeforeMerge({
      repoDir: dir,
      ticket: ticket(),
      ticketNumber: 51,
      branch: 'HEAD',
      runner,
      preview: fakePreview(),
      notifier: fakeNotifier(),
      now: NOW,
      fixer: async (args) => {
        fixerCalls.push(args)
        return { ok: true }
      },
    })

    assert.equal(result.ok, false)
    assert.equal(result.reason, 'auth_failed')
    assert.equal(result.stage, 'verify')
    assert.equal(calls.length, 1, '验证认证失败后同一轮不再跑评审')
    assert.equal(calls[0].name.startsWith('verify-'), true)
    assert.equal(fixerCalls.length, 0)
    assert.deepEqual(await readTrail({ repoDir: dir, ticket: 51 }), [])
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

test('只有一条 review 行时跑一次评审补齐两条轴，不提前放行', async () => {
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
    await appendTrail({
      repoDir: dir,
      ticket: 51,
      ts: NOW,
      phase: 'review',
      decision: '标准',
      why: 'head abc1234',
      evidence: 'AFK_VERDICT pass',
      result: 'pass',
    })
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
    assert.equal(runner.calls.length, 1, '只补评审，不再跑验证')
    assert.equal(runner.calls[0].name, 'review-51-all')
    const rows = await readTrail({ repoDir: dir, ticket: 51 })
    const reviews = rows.filter((row) => row.phase === 'review' && row.result === 'pass')
    assert.equal(reviews.filter((row) => row.decision === '标准').length, 2)
    assert.equal(reviews.filter((row) => row.decision === 'spec').length, 1)
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

async function highRiskRepo() {
  const dir = await makeRepo()
  await git(dir, ['checkout', '-b', 'ticket/51'])
  await mkdir(join(dir, 'db', 'migrations'), { recursive: true })
  await writeFile(join(dir, 'db', 'migrations', '001_init.sql'), 'create table t;\n')
  await git(dir, ['add', '-A'])
  await git(dir, ['commit', '-m', 'ticket work'])
  const headSha = await git(dir, ['rev-parse', 'HEAD'])
  return { dir, headSha }
}

async function appendReadyExceptVerifiers({ dir, headSha, verifyRows }) {
  for (const item of verifyRows) {
    await appendTrail({
      repoDir: dir,
      ticket: 51,
      ts: NOW,
      phase: 'verify',
      decision: headSha,
      why: item.why,
      evidence: '.audit/screenshots/after.png',
      result: 'pass',
    })
  }
  await appendTrail({
    repoDir: dir,
    ticket: 51,
    ts: NOW,
    phase: 'test',
    decision: 'npm test',
    why: `测试 head ${headSha}`,
    evidence: 'pass',
    result: 'pass',
  })
  for (const decision of ['标准', 'spec']) {
    await appendTrail({
      repoDir: dir,
      ticket: 51,
      ts: NOW,
      phase: 'review',
      decision,
      why: `head ${headSha}`,
      evidence: 'AFK_VERDICT pass',
      result: 'pass',
    })
  }
}

test('高风险票只有一个验证者时自动补第二个，再补 interrogate', async () => {
  const { dir, headSha } = await highRiskRepo()
  try {
    await appendReadyExceptVerifiers({
      dir,
      headSha,
      verifyRows: [{ why: `验证 head ${headSha}` }],
    })
    const runner = fakeRunner(true)
    const result = await ensureEvidenceBeforeMerge({
      repoDir: dir,
      ticket: ticket(),
      ticketNumber: 51,
      branch: 'ticket/51',
      baseBranch: 'main',
      runner,
      preview: fakePreview(),
      notifier: fakeNotifier(),
      now: NOW,
    })

    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(runner.calls.length, 2, '补第二个验证者，再补 interrogate')
    const verifyCalls = runner.calls.filter((call) => call.name.startsWith('verify-51-'))
    assert.equal(verifyCalls.length, 1, '补一个验证者就够')
    assert.deepEqual(
      runner.calls.filter((call) => call.name.startsWith('review-')).map((call) => call.name),
      ['review-51-interrogate'],
      'standard/spec 已齐，不重跑',
    )
    const rows = await readTrail({ repoDir: dir, ticket: 51 })
    const verifyRows = rows.filter((row) => row.phase === 'verify' && row.result === 'pass')
    assert.equal(verifyRows.length, 2)
    assert.ok(verifyRows.some((row) => row.why.includes('verifier=v1')))
    const ids = await freshVerifiers({ trail: rows, repoDir: dir })
    assert.equal(ids.length, 2, JSON.stringify(ids))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('同一验证者 id 写两行只算一个，仍补一个不同 id 的验证者', async () => {
  const { dir, headSha } = await highRiskRepo()
  try {
    await appendReadyExceptVerifiers({
      dir,
      headSha,
      verifyRows: [
        { why: `验证 head ${headSha} · verifier=v1` },
        { why: `复验 head ${headSha} · verifier=v1` },
      ],
    })
    const runner = fakeRunner(true)
    const result = await ensureEvidenceBeforeMerge({
      repoDir: dir,
      ticket: ticket(),
      ticketNumber: 51,
      branch: 'ticket/51',
      baseBranch: 'main',
      runner,
      preview: fakePreview(),
      notifier: fakeNotifier(),
      now: NOW,
    })

    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(runner.calls.length, 2, '两行同 id 只算一个验证者，另加一次 interrogate')
    const verifyCalls = runner.calls.filter((call) => call.name.startsWith('verify-51-'))
    assert.equal(verifyCalls.length, 1)
    assert.ok(verifyCalls[0].name.endsWith('-v2'))
    const rows = await readTrail({ repoDir: dir, ticket: 51 })
    const ids = await freshVerifiers({ trail: rows, repoDir: dir })
    assert.deepEqual(ids, ['v1', 'v2'])
    assert.equal(rows.filter((row) => row.phase === 'verify' && row.result === 'pass').length, 3)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('初次验证判不过：同一轮叫 fixer，复验通过后不再被旧问题挡住', async () => {
  const dir = await makeRepo()
  try {
    let verifyCalls = 0
    const runner = {
      async run(options) {
        if (options.name.startsWith('verify-')) {
          verifyCalls += 1
          const ok = verifyCalls > 1
          return {
            ok: true,
            code: 0,
            stderr: '',
            stdout: `AFK_VERDICT ${JSON.stringify(
              ok
                ? {
                    ok: true,
                    evidence: ['.audit/screenshots/after.png'],
                    problems: [],
                    tests: [{ command: 'npm test', result: 'pass' }],
                  }
                : { ok: false, evidence: [], problems: ['首页白屏'], tests: [] },
            )}`,
          }
        }
        return {
          ok: true,
          code: 0,
          stderr: '',
          stdout:
            'AFK_VERDICT {"ok":true,"evidence":["https://github.com/acme/demo/pull/7"],"problems":[]}',
        }
      },
    }
    const fixerCalls = []
    const fixer = async ({ repoDir, findings }) => {
      fixerCalls.push(findings)
      await writeFile(join(repoDir, 'fixed.txt'), 'fixed\n')
      await git(repoDir, ['add', '-A'])
      await git(repoDir, ['commit', '-m', 'FACTORY: 评审修复 #51 第1轮'])
      return { ok: true, changed: true }
    }
    const cleanCheck = async ({ ref }) => ({
      ok: true,
      headSha: ref,
      reason: '',
      missing: [],
      logPath: '',
      skipped: true,
    })

    const result = await ensureEvidenceBeforeMerge({
      repoDir: dir,
      ticket: ticket(),
      ticketNumber: 51,
      branch: 'HEAD',
      runner,
      preview: fakePreview(),
      notifier: fakeNotifier(),
      now: NOW,
      fixer,
      cleanCheck,
    })

    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(fixerCalls.length, 1, '初次验证失败要叫一次 fixer')
    assert.match(fixerCalls[0].join('；'), /首页白屏/)
    assert.equal(verifyCalls, 2, '修复后在新 head 复验一次')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('fixer 提交后干净检查在新 head 重跑，旧 head 的 pass 不算', async () => {
  const dir = await makeRepo()
  try {
    const oldHead = await git(dir, ['rev-parse', 'HEAD'])
    const cleanHeads = []
    let newHeadRuns = 0
    const cleanCheck = async ({ ref }) => {
      cleanHeads.push(ref)
      if (ref === oldHead) {
        return { ok: true, headSha: ref, reason: '', missing: [], logPath: '' }
      }
      newHeadRuns += 1
      const ok = newHeadRuns > 1
      return {
        ok,
        headSha: ref,
        reason: ok ? '' : 'check',
        missing: ok ? [] : ['新提交测试失败'],
        logPath: '',
      }
    }
    const reviewProblems = ['连接池缺 error 监听']
    let reviewCalls = 0
    const runner = async ({ name }) => {
      if (name.startsWith('review-')) {
        reviewCalls += 1
        const ok = reviewCalls > 1
        return {
          ok: true,
          code: 0,
          stderr: '',
          stdout: `AFK_VERDICT ${JSON.stringify({
            ok,
            evidence: ['https://github.com/acme/demo/pull/7'],
            problems: ok ? [] : reviewProblems,
          })}`,
        }
      }
      return {
        ok: true,
        code: 0,
        stderr: '',
        stdout:
          'AFK_VERDICT {"ok":true,"evidence":[".audit/screenshots/after.png"],"problems":[],"tests":[{"command":"npm test","result":"pass"}]}',
      }
    }
    const fixerCalls = []
    const fixer = async ({ repoDir, findings }) => {
      fixerCalls.push(findings)
      await writeFile(join(repoDir, `fixed-${fixerCalls.length}.txt`), 'fixed\n')
      await git(repoDir, ['add', '-A'])
      await git(repoDir, ['commit', '-m', `FACTORY: 评审修复 #51 第${fixerCalls.length}轮`])
      return { ok: true, changed: true }
    }

    const result = await ensureEvidenceBeforeMerge({
      repoDir: dir,
      ticket: ticket(),
      ticketNumber: 51,
      branch: 'HEAD',
      runner: { run: runner },
      preview: fakePreview(),
      notifier: fakeNotifier(),
      now: NOW,
      fixer,
      cleanCheck,
    })

    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(fixerCalls.length, 2, '新 head 上干净检查失败要再修一轮')
    assert.equal(cleanHeads.length, 3, '旧 head 一次，修完的新 head 各一次')
    assert.notEqual(cleanHeads[1], oldHead)
    assert.match(fixerCalls[1].join('；'), /新提交测试失败/)
    assert.doesNotMatch(fixerCalls[1].join('；'), /连接池/, '第二轮只修新问题')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('同一 head 已经有干净检查 pass 就不再重跑', async () => {
  const dir = await makeRepo()
  try {
    const head = await git(dir, ['rev-parse', 'HEAD'])
    for (const [phase, decision] of [
      ['verify', head],
      ['test', 'npm test'],
      ['review', '标准'],
      ['review', 'spec'],
    ]) {
      await appendTrail({
        repoDir: dir,
        ticket: 51,
        ts: NOW,
        phase,
        decision,
        why: `head ${head}`,
        evidence: '.audit/screenshots/after.png',
        result: 'pass',
      })
    }
    const heads = []
    const cleanCheck = async ({ ref }) => {
      heads.push(ref)
      return { ok: true, headSha: ref, reason: '', missing: [], logPath: '' }
    }
    const options = {
      repoDir: dir,
      ticket: ticket(),
      ticketNumber: 51,
      branch: 'HEAD',
      runner: fakeRunner(true),
      preview: fakePreview(),
      notifier: fakeNotifier(),
      now: NOW,
      cleanCheck,
    }

    const first = await ensureEvidenceBeforeMerge(options)
    assert.equal(first.ok, true, JSON.stringify(first))
    assert.equal(heads.length, 1, '证据齐了也要补跑一次干净检查')

    const second = await ensureEvidenceBeforeMerge(options)
    assert.equal(second.ok, true, JSON.stringify(second))
    assert.equal(heads.length, 1, '同一 head 不重跑干净检查')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
