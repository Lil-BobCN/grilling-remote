import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { git } from '../lib/git.mjs'
import {
  appendMergeRow,
  appendTrail,
  assessMerge,
  diffInfo,
  evidenceReady,
  freshVerifiers,
  missingEvidenceAxes,
  readTrail,
  riskLevel,
  verifyPlan,
} from '../lib/evidence.mjs'

const HEADER = 'ts\tphase\tdecision\twhy\tevidence\tresult'

async function makeRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'afk-evidence-'))
  await git(dir, ['init', '-b', 'main'])
  await git(dir, ['config', 'user.name', 'AFK Test'])
  await git(dir, ['config', 'user.email', 'test@afkfactory.space'])
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

function row(overrides = {}) {
  return {
    ts: '2026-11-17T02:00:00.000Z',
    phase: 'verify',
    decision: '走完关键路径',
    why: '按验收条件点击',
    evidence: '',
    result: 'pass',
    ...overrides,
  }
}

test('readTrail 容错 BOM、CRLF 和空行', async () => {
  const dir = await makeRepo()
  try {
    await mkdir(join(dir, '.audit'), { recursive: true })
    const text = [
      `﻿${HEADER}`,
      '',
      '2026-11-17T02:00:00.000Z\tverify\t关键路径\t点应用\t.audit/a.png\tpass\r',
      '2026-11-17T02:01:00.000Z\ttest\t全量测试\t跑 npm test\t\tpass\r',
      '',
    ].join('\r\n')
    await writeFile(join(dir, '.audit', '51.tsv'), text, 'utf8')

    const rows = await readTrail({ repoDir: dir, ticket: 51 })
    assert.equal(rows.length, 2)
    assert.equal(rows[0].phase, 'verify')
    assert.equal(rows[0].evidence, '.audit/a.png')
    assert.equal(rows[1].result, 'pass')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('appendTrail 按六列追加，ts 用 UTC，单元格去 tab 和换行', async () => {
  const dir = await makeRepo()
  try {
    const first = await appendTrail({
      repoDir: dir,
      ticket: 51,
      ts: '2026-11-17T10:00:00+08:00',
      phase: 'verify',
      decision: '关键路径\t第 1 条',
      why: '第一行\n第二行',
      evidence: '.audit/a.png',
      result: 'pass',
    })
    assert.equal(first.ts, '2026-11-17T02:00:00.000Z')

    const text = await readTrailText(dir, 51)
    const lines = text.trimEnd().split(/\r?\n/)
    assert.equal(lines[0], HEADER)
    assert.equal(lines.length, 2)
    assert.equal(lines[1].split('\t').length, 6)
    assert.ok(!lines[1].includes('\n'))
    assert.equal(lines[1].split('\t')[2], '关键路径 第 1 条')
    assert.equal(lines[1].split('\t')[3], '第一行 第二行')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

async function readTrailText(dir, ticket) {
  const { readFile } = await import('node:fs/promises')
  return readFile(join(dir, '.audit', `${ticket}.tsv`), 'utf8')
}

async function readyFixture() {
  const dir = await makeRepo()
  await writeFile(join(dir, 'app.txt'), 'v1\n')
  await mkdir(join(dir, '.audit', 'screenshots'), { recursive: true })
  await writeFile(join(dir, '.audit', 'screenshots', 'after.png'), 'png')
  const codeSha = await commitAll(dir, 'code')

  const trail = [
    row({
      why: `验证 head ${codeSha}`,
      evidence: `.audit/screenshots/after.png sha=${codeSha}`,
    }),
    row({ phase: 'test', decision: '全量测试', why: `测试 head ${codeSha}` }),
    row({ phase: 'review', decision: '标准：通过', why: `标准轴 head ${codeSha}` }),
    row({ phase: 'review', decision: 'spec：符合验收条件', why: `spec 轴 head ${codeSha}` }),
  ]
  for (const item of trail) {
    await appendTrail({ repoDir: dir, ticket: 51, ...item })
  }
  const headSha = await commitAll(dir, 'trail')
  return { dir, trail, codeSha, headSha }
}

test('evidenceReady 四样证据齐，且证据指向代码提交时通过', async () => {
  const { dir, trail, headSha } = await readyFixture()
  try {
    const result = await evidenceReady({ trail, headSha, repoDir: dir })
    assert.equal(result.ready, true, JSON.stringify(result))
    assert.deepEqual(result.missing, [])
    assert.deepEqual(result.stale, [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('evidenceReady 缺任何一样都拒绝', async () => {
  const { dir, trail, headSha } = await readyFixture()
  try {
    const withoutVerify = trail.filter((item) => item.phase !== 'verify')
    const a = await evidenceReady({ trail: withoutVerify, headSha, repoDir: dir })
    assert.equal(a.ready, false)
    assert.ok(a.missing.some((text) => text.includes('验证')))

    const withoutTest = trail.filter((item) => item.phase !== 'test')
    const b = await evidenceReady({ trail: withoutTest, headSha, repoDir: dir })
    assert.equal(b.ready, false)
    assert.ok(b.missing.some((text) => text.includes('测试')))

    const withoutSpec = trail.filter((item) => item.decision !== 'spec：符合验收条件')
    const c = await evidenceReady({ trail: withoutSpec, headSha, repoDir: dir })
    assert.equal(c.ready, false)
    assert.ok(c.missing.some((text) => text.toLowerCase().includes('spec')))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('evidenceReady 证据路径不存在时拒绝', async () => {
  const { dir, trail, headSha } = await readyFixture()
  try {
    const broken = trail.map((item) =>
      item.phase === 'verify' ? { ...item, evidence: '.audit/screenshots/missing.png' } : item,
    )
    const result = await evidenceReady({ trail: broken, headSha, repoDir: dir })
    assert.equal(result.ready, false)
    assert.ok(result.missing.some((text) => text.includes('missing.png')))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('evidenceReady 代码头变了判过期，要求复验', async () => {
  const { dir, trail, headSha } = await readyFixture()
  try {
    await writeFile(join(dir, 'app.txt'), 'v2\n')
    const newHead = await commitAll(dir, 'code change')
    const result = await evidenceReady({ trail, headSha: newHead, repoDir: dir })
    assert.equal(result.ready, false)
    assert.ok(result.stale.length > 0)
    assert.ok(result.stale.some((text) => text.includes('复验')))
    assert.notEqual(headSha, newHead)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('riskLevel 碰迁移、删除、凭证、大版本依赖和大 diff 判高风险', () => {
  assert.equal(
    riskLevel({ files: ['db/migrations/001_init.sql'], diffStat: { additions: 2, deletions: 0 } }),
    'high',
  )
  assert.equal(
    riskLevel({ files: [{ path: 'src/old.mjs', status: 'D' }], diffStat: { additions: 0, deletions: 30 } }),
    'high',
  )
  assert.equal(riskLevel({ files: ['.env.local'], diffStat: { additions: 1, deletions: 0 } }), 'high')
  assert.equal(
    riskLevel({
      files: ['package.json'],
      diffStat: { additions: 2, deletions: 2, text: '-  "left-pad": "^1.3.0"\n+  "left-pad": "^2.0.0"' },
    }),
    'high',
  )
  assert.equal(
    riskLevel({ files: ['src/a.mjs'], diffStat: { additions: 401, deletions: 0 } }),
    'high',
  )
  assert.equal(
    riskLevel({ files: Array.from({ length: 11 }, (_, i) => `src/f${i}.mjs`), diffStat: { additions: 1, deletions: 1 } }),
    'high',
  )
  assert.equal(
    riskLevel({ files: ['src/a.mjs'], diffStat: { additions: 20, deletions: 4 } }),
    'normal',
  )
})

test('只有 .audit/ 改动不算高风险，文件数和行数都排除 .audit/', async () => {
  const dir = await makeRepo()
  try {
    await git(dir, ['checkout', '-b', 'ticket/9'])
    await mkdir(join(dir, '.audit', 'screenshots'), { recursive: true })
    for (let index = 0; index < 12; index += 1) {
      await writeFile(join(dir, '.audit', 'screenshots', `shot-${index}.txt`), 'png\n')
    }
    const rows = [HEADER]
    for (let index = 0; index < 450; index += 1) {
      rows.push(`2026-11-17T02:00:00.000Z\tverify\t第 ${index} 次\t证据\t.audit/a.png\tpass`)
    }
    await writeFile(join(dir, '.audit', '9.tsv'), `${rows.join('\n')}\n`, 'utf8')
    await commitAll(dir, 'audit only')

    const { files, diffStat } = await diffInfo(dir, 'main', 'ticket/9')
    assert.ok(files.length > 10, JSON.stringify(files))
    assert.equal(diffStat.additions + diffStat.deletions, 0, '审计文件的增删行不该算进 diff')
    assert.equal(riskLevel({ files, diffStat }), 'normal', JSON.stringify({ files, diffStat }))

    const withStats = [
      { path: 'src/a.mjs', additions: 2, deletions: 0 },
      { path: '.audit/9.tsv', additions: 900, deletions: 0 },
    ]
    assert.equal(
      riskLevel({ files: withStats, diffStat: { additions: 902, deletions: 0 } }),
      'normal',
      JSON.stringify(withStats),
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('diffInfo 返回 manifest patch，大版本规则能读到数据', async () => {
  const dir = await makeRepo()
  try {
    await writeFile(
      join(dir, 'package.json'),
      '{\n  "dependencies": {\n    "left-pad": "^1.3.0"\n  }\n}\n',
    )
    await commitAll(dir, 'deps base')
    await git(dir, ['checkout', '-b', 'ticket/3'])
    await writeFile(
      join(dir, 'package.json'),
      '{\n  "dependencies": {\n    "left-pad": "^2.0.0"\n  }\n}\n',
    )
    await commitAll(dir, 'major bump')

    const { files, diffStat } = await diffInfo(dir, 'main', 'ticket/3')
    assert.ok(String(diffStat.patch).includes('left-pad'), JSON.stringify(diffStat))
    assert.equal(riskLevel({ files, diffStat }), 'high')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('verifyPlan 按风险派验证队，只改文字不派', () => {
  const high = verifyPlan({ risk: 'high', changedLines: 120 })
  assert.ok(high.verifiers >= 2)
  assert.equal(high.reviewMode, 'interrogate')

  const normal = verifyPlan({ risk: 'normal', changedLines: 30 })
  assert.equal(normal.verifiers, 1)
  assert.equal(normal.reviewMode, 'standard')

  const text = verifyPlan({ risk: 'normal', changedLines: 3, textOnly: true })
  assert.equal(text.run, false)
  assert.equal(text.verifiers, 0)

  const laterFix = verifyPlan({ risk: 'high', changedLines: 8, fullTeamDone: true })
  assert.equal(laterFix.verifiers, 1)
})

test('freshVerifiers 按验证者 id 去重，旧行没有 id 时一行算一个', async () => {
  const dir = await makeRepo()
  try {
    await writeFile(join(dir, 'app.txt'), 'v1\n')
    const codeSha = await commitAll(dir, 'code')
    const rows = [
      row({ decision: codeSha, why: `验证 head ${codeSha} · verifier=v1` }),
      row({ decision: codeSha, why: `复验 head ${codeSha} · verifier=v1` }),
      row({ decision: codeSha, why: `验证 head ${codeSha} · verifier=v2` }),
      row({ decision: codeSha, why: `验证 head ${codeSha}` }),
    ]
    const ids = await freshVerifiers({ trail: rows, headSha: codeSha, repoDir: dir })
    assert.deepEqual(ids, ['v1', 'v2', 'legacy-4'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

import { createGithub } from '../lib/github.mjs'
import { startFakeGithub } from './fake-github.mjs'
import { mergeTicket } from '../lib/evidence.mjs'

function trailRow(phase, decision, why, evidence = '', result = 'pass') {
  return { ts: '2026-11-17T02:00:00.000Z', phase, decision, why, evidence, result }
}

async function mergeFixture({
  conflict = false,
  migration = false,
  previewRequired = false,
  untrackedEvidence = false,
} = {}) {
  const dir = await makeRepo()
  await git(dir, ['checkout', '-b', 'req/order-1'])
  await writeFile(join(dir, 'req.txt'), 'req\n')
  await writeFile(join(dir, 'shared.txt'), conflict ? 'req\n' : 'same\n')
  const preMergeSha = await commitAll(dir, 'req work')

  await git(dir, ['checkout', '-b', 'ticket/2', 'main'])
  await writeFile(join(dir, 'app.txt'), 'v1\n')
  await writeFile(join(dir, 'shared.txt'), conflict ? 'ticket\n' : 'same\n')
  if (migration) {
    await mkdir(join(dir, 'db', 'migrations'), { recursive: true })
    await writeFile(join(dir, 'db', 'migrations', '001_init.sql'), 'create table t;\n')
  }
  if (!untrackedEvidence) {
    await mkdir(join(dir, '.audit', 'screenshots'), { recursive: true })
    await writeFile(join(dir, '.audit', 'screenshots', 'after.png'), 'png')
  }
  const codeSha = await commitAll(dir, 'ticket work')

  const rows = [
    trailRow('verify', '走完关键路径', `验证 head ${codeSha}`, `.audit/screenshots/after.png sha=${codeSha}`),
    trailRow('test', '全量测试', `测试 head ${codeSha}`, 'npm test'),
    trailRow('review', '标准：通过', `标准轴 head ${codeSha}`, ''),
    trailRow('review', 'spec：符合验收条件', `spec 轴 head ${codeSha}`, ''),
  ]
  if (migration) {
    rows.unshift(trailRow('verify', '迁移也能跑', `第二个验证者 head ${codeSha}`, `.audit/screenshots/after.png`))
  }
  if (previewRequired) {
    rows.unshift(trailRow('preview', '有界面', '验收条件要看页面', '', 'required'))
  }
  for (const item of rows) {
    await appendTrail({ repoDir: dir, ticket: 2, ...item })
  }
  const ticketHead = await commitAll(dir, 'trail')
  if (untrackedEvidence) {
    // 验证者只写了 trail 行，截图留在工作树里没提交。
    await mkdir(join(dir, '.audit', 'screenshots'), { recursive: true })
    await writeFile(join(dir, '.audit', 'screenshots', 'after.png'), 'png')
  }

  const fake = await startFakeGithub({
    repos: [{ owner: 'acme', name: 'demo' }],
    issues: [
      { owner: 'acme', repo: 'demo', title: '父工单', body: '## 客户原话', labels: ['状态:开发中'] },
      { owner: 'acme', repo: 'demo', title: '子票', body: '## 垂直切片', labels: ['状态:开发中', 'Sandcastle'] },
    ],
  })
  const gh = createGithub({ apiBase: fake.base, token: 'test' })
  const ticket = {
    number: 2,
    title: '子票',
    owner: 'acme',
    repo: 'demo',
    parentNumber: 1,
    customer: 'B 店',
    requirement: '预约取货',
    path: '其余',
    round: 1,
    htmlUrl: 'https://github.com/acme/demo/issues/2',
  }
  return { dir, rows, codeSha, ticketHead, preMergeSha, fake, gh, ticket }
}

async function teardownFixture(fixture) {
  await fixture.fake.close()
  await rm(fixture.dir, { recursive: true, force: true })
}

test('证据齐时合进需求分支，写证据评论、加待验收、关票、摘 Sandcastle、父工单写进度', async () => {
  const fixture = await mergeFixture()
  const { dir, rows, gh, ticket, preMergeSha } = fixture
  try {
    const result = await mergeTicket({
      repoDir: dir,
      ticketBranch: 'ticket/2',
      reqBranch: 'req/order-1',
      ticket,
      trail: rows,
      verifier: async () => ({ ok: true, evidence: '关键路径通过' }),
      github: gh,
    })
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.ok(result.headSha)
    assert.ok(result.mergedSha)

    const reqHead = await git(dir, ['rev-parse', 'req/order-1'])
    assert.equal(reqHead, result.headSha)
    assert.notEqual(reqHead, preMergeSha)
    const parents = await git(dir, ['rev-list', '--parents', '-n', '1', result.mergedSha])
    assert.equal(parents.split(/\s+/).length, 3, '合并提交应有两个父提交')

    const issue = await gh.getIssue({ owner: 'acme', repo: 'demo', number: 2 })
    assert.equal(issue.state, 'closed')
    const names = issue.labels.map((label) => label.name)
    assert.ok(names.includes('状态:待验收'))
    assert.ok(!names.includes('Sandcastle'))
    assert.deepEqual(
      names.filter((name) => name.startsWith('状态:')),
      ['状态:待验收'],
      '合并后只留一个状态标签',
    )

    const comments = await gh.listComments({ owner: 'acme', repo: 'demo', number: 2 })
    assert.ok(
      comments.some((row) => row.body.includes('四样证据') && row.body.includes(result.headSha)),
      JSON.stringify(comments),
    )

    const parentComments = await gh.listComments({ owner: 'acme', repo: 'demo', number: 1 })
    assert.ok(
      parentComments.some(
        (row) => row.body.startsWith('进度 v1｜') && row.body.includes('细阶段：合分支'),
      ),
      JSON.stringify(parentComments),
    )

    const mergedTrail = await readTrail({ repoDir: dir, ticket: 2 })
    const last = mergedTrail[mergedTrail.length - 1]
    assert.equal(last.phase, 'verify')
    assert.equal(last.result, 'pass')
    assert.ok(last.evidence.includes(result.mergedSha))

    const mergeRow = mergedTrail.find((row) => row.phase === 'merge')
    assert.ok(mergeRow, JSON.stringify(mergedTrail))
    assert.equal(mergeRow.decision, 'merge')
    assert.equal(mergeRow.why, 'req/order-1')
    assert.equal(mergeRow.evidence, result.mergedSha)
    assert.equal(mergeRow.result, 'pass')
  } finally {
    await teardownFixture(fixture)
  }
})

test('截图未跟踪时合并把它带进票分支，req 分支和干净检出都能找到；仓库外路径不收', async () => {
  const fixture = await mergeFixture({ untrackedEvidence: true })
  const { dir, rows, gh, ticket, codeSha } = fixture
  const outsideDir = await mkdtemp(join(tmpdir(), 'afk-evidence-outside-'))
  const escapeName = `afk-evidence-escape-${process.pid}.png`
  const escapeFile = join(dir, '..', escapeName)
  const absoluteFile = join(outsideDir, 'abs.png')
  await writeFile(escapeFile, 'png')
  await writeFile(absoluteFile, 'png')
  rows.push(
    trailRow('verify', '越界证据', `验证 head ${codeSha}`, `${absoluteFile},../${escapeName}`),
  )
  let cleanRoot = ''
  try {
    const before = await git(dir, ['rev-parse', 'ticket/2'])
    const result = await mergeTicket({
      repoDir: dir,
      ticketBranch: 'ticket/2',
      reqBranch: 'req/order-1',
      ticket,
      trail: rows,
      verifier: async () => ({ ok: true, evidence: '关键路径通过' }),
      github: gh,
    })
    assert.equal(result.ok, true, JSON.stringify(result))

    const ticketHead = await git(dir, ['rev-parse', 'ticket/2'])
    assert.notEqual(ticketHead, before, '票分支应多一个证据提交')
    for (const ref of ['ticket/2', 'req/order-1']) {
      await git(dir, ['cat-file', '-e', `${ref}:.audit/screenshots/after.png`])
    }
    const names = (await git(dir, ['ls-tree', '-r', '--name-only', 'ticket/2'])).split(/\r?\n/)
    assert.ok(names.includes('.audit/screenshots/after.png'))
    assert.ok(!names.some((name) => name.includes('escape') || name.endsWith('abs.png')))

    cleanRoot = await mkdtemp(join(tmpdir(), 'afk-evidence-clean-'))
    const cleanDir = join(cleanRoot, 'repo')
    await git(dir, ['worktree', 'add', '--detach', cleanDir, 'ticket/2'])
    const cleanTrail = await readTrail({ repoDir: cleanDir, ticket: 2 })
    const check = await evidenceReady({ trail: cleanTrail, repoDir: cleanDir })
    assert.equal(check.ready, true, JSON.stringify(check))
  } finally {
    if (cleanRoot) await rm(cleanRoot, { recursive: true, force: true })
    await rm(outsideDir, { recursive: true, force: true })
    await rm(escapeFile, { force: true })
    await teardownFixture(fixture)
  }
})

test('复验失败时回滚合并，不关票，不摘 Sandcastle，发「出事」', async () => {
  const fixture = await mergeFixture()
  const { dir, rows, gh, ticket, preMergeSha } = fixture
  const sent = []
  try {
    const result = await mergeTicket({
      repoDir: dir,
      ticketBranch: 'ticket/2',
      reqBranch: 'req/order-1',
      ticket,
      trail: rows,
      verifier: async () => ({ ok: false, problems: ['首页打不开'] }),
      github: gh,
      notifier: { send: async (event) => sent.push(event) },
    })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'reverify_failed')
    assert.equal(await git(dir, ['rev-parse', 'req/order-1']), preMergeSha)

    const issue = await gh.getIssue({ owner: 'acme', repo: 'demo', number: 2 })
    assert.equal(issue.state, 'open')
    assert.ok(issue.labels.map((label) => label.name).includes('Sandcastle'))
    assert.ok(sent.some((event) => event.event === '出事'))
  } finally {
    await teardownFixture(fixture)
  }
})

test('冲突交给 merger 解，解完在合并 head 上重跑验证', async () => {
  const fixture = await mergeFixture({ conflict: true })
  const { dir, rows, gh, ticket } = fixture
  const mergerCalls = []
  const verifierHeads = []
  try {
    const result = await mergeTicket({
      repoDir: dir,
      ticketBranch: 'ticket/2',
      reqBranch: 'req/order-1',
      ticket,
      trail: rows,
      merger: async ({ files }) => {
        mergerCalls.push(files)
        await writeFile(join(dir, 'shared.txt'), 'resolved\n')
        return { ok: true }
      },
      verifier: async ({ headSha }) => {
        verifierHeads.push(headSha)
        return { ok: true }
      },
      github: gh,
    })
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.deepEqual(mergerCalls, [['shared.txt']])
    assert.equal(verifierHeads[0], result.mergedSha)
    assert.equal(await git(dir, ['show', `${result.mergedSha}:shared.txt`]), 'resolved')
  } finally {
    await teardownFixture(fixture)
  }
})

test('有界面的票先起预览，合完销毁；预览起不来只挡这张票', async () => {
  {
    const fixture = await mergeFixture({ previewRequired: true })
    const { dir, rows, gh, ticket } = fixture
    const calls = []
    try {
      const result = await mergeTicket({
        repoDir: dir,
        ticketBranch: 'ticket/2',
        reqBranch: 'req/order-1',
        ticket,
        trail: rows,
        preview: {
          async start(ctx) {
            calls.push(['start', ctx.headSha])
            return { ok: true, address: 'b-demo-pr7.afkfactory.space' }
          },
          async stop(ctx) {
            calls.push(['stop', ctx.address])
            return { ok: true }
          },
        },
        verifier: async () => ({ ok: true }),
        github: gh,
      })
      assert.equal(result.ok, true, JSON.stringify(result))
      assert.equal(calls[0][0], 'start')
      assert.deepEqual(calls[calls.length - 1], ['stop', 'b-demo-pr7.afkfactory.space'])
    } finally {
      await teardownFixture(fixture)
    }
  }

  {
    const fixture = await mergeFixture({ previewRequired: true })
    const { dir, rows, gh, ticket, preMergeSha } = fixture
    const sent = []
    try {
      const result = await mergeTicket({
        repoDir: dir,
        ticketBranch: 'ticket/2',
        reqBranch: 'req/order-1',
        ticket,
        trail: rows,
        preview: { async start() { return { ok: false, error: 'helper 挂了' } } },
        verifier: async () => ({ ok: true }),
        github: gh,
        notifier: { send: async (event) => sent.push(event) },
      })
      assert.equal(result.ok, false)
      assert.equal(result.reason, 'preview_failed')
      assert.equal(await git(dir, ['rev-parse', 'req/order-1']), preMergeSha)
      const issue = await gh.getIssue({ owner: 'acme', repo: 'demo', number: 2 })
      assert.equal(issue.state, 'open')
      assert.ok(sent.some((event) => event.event === '出事'))
    } finally {
      await teardownFixture(fixture)
    }
  }
})

test('高风险票要求两个验证者，并补 interrogate 评审', async () => {
  const fixture = await mergeFixture({ migration: true })
  const { dir, rows, gh, ticket } = fixture
  const reviewCalls = []
  try {
    const result = await mergeTicket({
      repoDir: dir,
      ticketBranch: 'ticket/2',
      reqBranch: 'req/order-1',
      ticket,
      trail: rows,
      review: async (ctx) => {
        reviewCalls.push(ctx)
        return { ok: true, decision: 'interrogate：没找到跑得出来的问题' }
      },
      verifier: async () => ({ ok: true }),
      github: gh,
    })
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(result.risk, 'high')
    assert.equal(reviewCalls.length, 1)
    assert.equal(reviewCalls[0].mode, 'interrogate')
  } finally {
    await teardownFixture(fixture)
  }
})

test('高风险票只有一个验证者时不合', async () => {
  const fixture = await mergeFixture({ migration: true })
  const { dir, rows, gh, ticket, preMergeSha } = fixture
  try {
    const single = rows.filter(
      (row) => !(row.phase === 'verify' && row.decision === '迁移也能跑'),
    )
    const result = await mergeTicket({
      repoDir: dir,
      ticketBranch: 'ticket/2',
      reqBranch: 'req/order-1',
      ticket,
      trail: single,
      verifier: async () => ({ ok: true }),
      github: gh,
    })
    assert.equal(result.ok, false)
    assert.ok(result.missing.some((text) => text.includes('高风险验证队')))
    assert.equal(await git(dir, ['rev-parse', 'req/order-1']), preMergeSha)
  } finally {
    await teardownFixture(fixture)
  }
})

test('高风险票两个验证者 id 不同才能合；同一个 id 写两行只算一个', async () => {
  const fixture = await mergeFixture({ migration: true })
  const { dir, rows, codeSha, gh, ticket, preMergeSha } = fixture
  const withIds = (ids) => {
    let index = 0
    return rows.map((row) => {
      if (row.phase !== 'verify') return row
      const id = ids[index] || ''
      index += 1
      return {
        ...row,
        decision: codeSha,
        why: `验证 head ${codeSha} · verifier=${id}`,
        evidence: `.audit/screenshots/after.png sha=${codeSha}`,
      }
    })
  }
  try {
    const same = await mergeTicket({
      repoDir: dir,
      ticketBranch: 'ticket/2',
      reqBranch: 'req/order-1',
      ticket,
      trail: withIds(['v1', 'v1']),
      verifier: async () => ({ ok: true }),
      github: gh,
    })
    assert.equal(same.ok, false, JSON.stringify(same))
    assert.ok(same.missing.some((text) => text.includes('高风险验证队')))
    assert.equal(await git(dir, ['rev-parse', 'req/order-1']), preMergeSha)

    const distinct = await mergeTicket({
      repoDir: dir,
      ticketBranch: 'ticket/2',
      reqBranch: 'req/order-1',
      ticket,
      trail: withIds(['v1', 'v2']),
      review: async () => ({ ok: true, decision: 'interrogate：通过' }),
      verifier: async () => ({ ok: true }),
      github: gh,
    })
    assert.equal(distinct.ok, true, JSON.stringify(distinct))
    assert.equal(distinct.plan.verifiers, 2)
  } finally {
    await teardownFixture(fixture)
  }
})

test('旧 head 的 interrogate pass 不算数：门禁按当前 head 重跑', async () => {
  const fixture = await mergeFixture({ migration: true })
  const { dir, rows, codeSha, gh, ticket } = fixture
  try {
    // 旧 head 上判过 interrogate pass，之后票分支又推了一个代码提交。
    await writeFile(join(dir, 'app.txt'), 'v2\n')
    const newerSha = await commitAll(dir, 'FACTORY: 后来改的代码')
    const trail = [
      ...rows,
      trailRow('verify', newerSha, `验证 head ${newerSha} · verifier=v1`, `.audit/screenshots/after.png sha=${newerSha}`),
      trailRow('verify', newerSha, `验证 head ${newerSha} · verifier=v2`, `.audit/screenshots/after.png sha=${newerSha}`),
      trailRow('review', '标准：通过', `标准轴 head ${newerSha}`, ''),
      trailRow('review', 'spec：符合验收条件', `spec 轴 head ${newerSha}`, ''),
      trailRow(
        'review',
        'interrogate：旧 head 通过',
        `head ${codeSha}`,
        'https://github.com/acme/demo/pull/7#discussion_r1',
      ),
    ]

    const assessment = await assessMerge({
      repoDir: dir,
      ticketBranch: 'ticket/2',
      reqBranch: 'req/order-1',
      ticket,
      trail,
    })
    assert.equal(assessment.ok, true, JSON.stringify(assessment))
    assert.equal(assessment.risk, 'high')
    assert.equal(assessment.interrogate, false, '旧 head 的 interrogate pass 不算数')

    const reviewCalls = []
    const result = await mergeTicket({
      repoDir: dir,
      ticketBranch: 'ticket/2',
      reqBranch: 'req/order-1',
      ticket,
      trail,
      review: async (ctx) => {
        reviewCalls.push(ctx)
        return { ok: true, decision: 'interrogate：当前 head 通过' }
      },
      verifier: async () => ({ ok: true }),
      github: gh,
    })
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(reviewCalls.length, 1, '旧 pass 不算数，要按当前 head 重跑 interrogate')
    assert.equal(reviewCalls[0].mode, 'interrogate')
  } finally {
    await teardownFixture(fixture)
  }
})

test('dry-run 复用合并的只读判定：阻塞项、risk、plan、fresh 与真合并一致', async () => {
  const fixture = await mergeFixture({ migration: true })
  const { dir, rows, gh, ticket, preMergeSha } = fixture
  try {
    const single = rows.filter((row) => !(row.phase === 'verify' && row.decision === '迁移也能跑'))
    const blocked = await assessMerge({
      repoDir: dir,
      ticketBranch: 'ticket/2',
      reqBranch: 'req/order-1',
      ticket,
      trail: single,
    })
    assert.equal(blocked.ok, false, JSON.stringify(blocked))
    assert.equal(blocked.risk, 'high')
    assert.equal(blocked.plan.verifiers, 2)
    assert.equal(blocked.fresh.length, 1)
    assert.deepEqual(blocked.preview, { required: false })

    const merged = await mergeTicket({
      repoDir: dir,
      ticketBranch: 'ticket/2',
      reqBranch: 'req/order-1',
      ticket,
      trail: single,
      verifier: async () => ({ ok: true }),
      github: gh,
    })
    assert.equal(merged.ok, false)
    assert.deepEqual(blocked.missing, merged.missing)
    assert.deepEqual(blocked.stale, merged.stale)
    assert.equal(await git(dir, ['rev-parse', 'req/order-1']), preMergeSha)

    const ready = await assessMerge({
      repoDir: dir,
      ticketBranch: 'ticket/2',
      reqBranch: 'req/order-1',
      ticket,
      trail: rows,
    })
    assert.equal(ready.ok, true, JSON.stringify(ready))
    assert.deepEqual(ready.missing, [])
    assert.equal(ready.risk, 'high')
    assert.equal(ready.fresh.length, 2)
    assert.equal(ready.preview.required, false)

    const mergedReady = await mergeTicket({
      repoDir: dir,
      ticketBranch: 'ticket/2',
      reqBranch: 'req/order-1',
      ticket,
      trail: rows,
      review: async () => ({ ok: true, decision: 'interrogate：通过' }),
      verifier: async () => ({ ok: true }),
      github: gh,
    })
    assert.equal(mergedReady.ok, true, JSON.stringify(mergedReady))
    assert.equal(mergedReady.risk, ready.risk)
    assert.equal(mergedReady.plan.verifiers, ready.plan.verifiers)
  } finally {
    await teardownFixture(fixture)
  }
})

test('重跑同一张已合并票不重复合', async () => {
  const fixture = await mergeFixture()
  const { dir, rows, gh, ticket } = fixture
  try {
    const first = await mergeTicket({
      repoDir: dir,
      ticketBranch: 'ticket/2',
      reqBranch: 'req/order-1',
      ticket,
      trail: rows,
      verifier: async () => ({ ok: true }),
      github: gh,
    })
    assert.equal(first.ok, true)
    const before = await gh.listComments({ owner: 'acme', repo: 'demo', number: 2 })

    const second = await mergeTicket({
      repoDir: dir,
      ticketBranch: 'ticket/2',
      reqBranch: 'req/order-1',
      ticket,
      trail: rows,
      verifier: async () => {
        throw new Error('不该再跑验证')
      },
      github: gh,
    })
    assert.equal(second.ok, true)
    assert.equal(second.alreadyMerged, true)
    assert.equal(await git(dir, ['rev-parse', 'req/order-1']), first.headSha)
    const after = await gh.listComments({ owner: 'acme', repo: 'demo', number: 2 })
    assert.equal(after.length, before.length)
  } finally {
    await teardownFixture(fixture)
  }
})

test('evidenceReady 缺标准轴意见也拒绝', async () => {
  const { dir, trail, headSha } = await readyFixture()
  try {
    const withoutStandard = trail.filter((item) => item.decision !== '标准：通过')
    const result = await evidenceReady({ trail: withoutStandard, headSha, repoDir: dir })
    assert.equal(result.ready, false)
    assert.ok(result.missing.some((text) => text.includes('标准')))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('证据不齐时 mergeTicket 不合、不跑复验、不关票', async () => {
  const fixture = await mergeFixture()
  const { dir, rows, gh, ticket, preMergeSha } = fixture
  let verified = false
  try {
    const withoutTest = rows.filter((row) => row.phase !== 'test')
    const result = await mergeTicket({
      repoDir: dir,
      ticketBranch: 'ticket/2',
      reqBranch: 'req/order-1',
      ticket,
      trail: withoutTest,
      verifier: async () => {
        verified = true
        return { ok: true }
      },
      github: gh,
    })
    assert.equal(result.ok, false)
    assert.ok(result.missing.some((text) => text.includes('测试')))
    assert.equal(verified, false)
    assert.equal(await git(dir, ['rev-parse', 'req/order-1']), preMergeSha)
    const issue = await gh.getIssue({ owner: 'acme', repo: 'demo', number: 2 })
    assert.equal(issue.state, 'open')
  } finally {
    await teardownFixture(fixture)
  }
})

test('appendMergeRow 写 phase=merge，同一个 mergedSha 不重复追加', async () => {
  const dir = await makeRepo()
  const mergedSha = 'abcdef1234567890abcdef1234567890abcdef12'
  try {
    const first = await appendMergeRow({
      repoDir: dir,
      ticket: 51,
      reqBranch: 'req/order-1',
      mergedSha,
    })
    assert.equal(first.phase, 'merge')
    assert.equal(first.decision, 'merge')
    assert.equal(first.why, 'req/order-1')
    assert.equal(first.evidence, mergedSha)
    assert.equal(first.result, 'pass')

    const again = await appendMergeRow({
      repoDir: dir,
      ticket: 51,
      reqBranch: 'req/order-1',
      mergedSha,
    })
    assert.equal(again, null)

    const rows = await readTrail({ repoDir: dir, ticket: 51 })
    assert.equal(rows.filter((row) => row.phase === 'merge').length, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('missingEvidenceAxes：验证和两条评审分开算，只有一条评审不算齐', () => {
  const base = {
    ts: '2026-11-17T02:00:00.000Z',
    phase: 'review',
    why: 'head abc1234',
    evidence: '.audit/screenshots/after.png',
    result: 'pass',
  }
  assert.deepEqual(missingEvidenceAxes([]), {
    verify: true,
    reviewStandard: true,
    reviewSpec: true,
  })
  assert.deepEqual(missingEvidenceAxes([{ ...base, phase: 'verify', decision: 'abc1234' }]), {
    verify: false,
    reviewStandard: true,
    reviewSpec: true,
  })
  assert.deepEqual(
    missingEvidenceAxes([
      { ...base, phase: 'verify', decision: 'abc1234' },
      { ...base, decision: '标准' },
    ]),
    { verify: false, reviewStandard: false, reviewSpec: true },
  )
  assert.deepEqual(
    missingEvidenceAxes([
      { ...base, phase: 'verify', decision: 'abc1234' },
      { ...base, decision: '标准' },
      { ...base, decision: 'spec' },
    ]),
    { verify: false, reviewStandard: false, reviewSpec: false },
  )
})
