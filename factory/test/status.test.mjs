import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { run as runStatus } from '../bin/status.mjs'
import { createGithub } from '../lib/github.mjs'
import { ensureLabel } from '../lib/issues.mjs'
import { STATE_LABELS } from '../lib/scheduler.mjs'
import { startFakeGithub } from './fake-github.mjs'

const OWNER = 'acme'
const REPO = 'demo'
const HEADER = 'ts\tphase\tdecision\twhy\tevidence\tresult'

function parentBody() {
  return [
    '## 需求全文',
    '',
    `- 客户简称：${OWNER}`,
    '- 需求名：yuyue-quhuo',
    '',
    '<!-- factory:order=o-0001 -->',
  ].join('\n')
}

async function fixture(t) {
  const fake = await startFakeGithub({ repos: [{ owner: OWNER, name: REPO }] })
  t.after(() => fake.close())
  const gh = createGithub({ apiBase: fake.base, token: 'test' })
  for (const [name, meta] of Object.entries(STATE_LABELS)) {
    await ensureLabel(gh, { owner: OWNER, repo: REPO, name, ...meta })
  }
  for (const name of ['Sandcastle', 'needs-info', 'ready-for-agent']) {
    await ensureLabel(gh, { owner: OWNER, repo: REPO, name })
  }
  const parent = await gh.createIssue({
    owner: OWNER,
    repo: REPO,
    title: '要个预约取货',
    body: parentBody(),
    labels: ['状态:开发中'],
  })
  const running = await gh.createIssue({
    owner: OWNER,
    repo: REPO,
    title: '看到今天水果',
    body: '',
    labels: ['状态:排队中', 'Sandcastle'],
  })
  const done = await gh.createIssue({
    owner: OWNER,
    repo: REPO,
    title: '下单',
    body: '',
    labels: ['状态:待验收'],
  })
  for (const child of [running, done]) {
    await gh.addSubIssue({ owner: OWNER, repo: REPO, number: parent.number, subIssueId: child.id })
  }
  await fetch(`${fake.base}/repos/${OWNER}/${REPO}/pulls`, {
    method: 'POST',
    headers: { authorization: 'token test', 'content-type': 'application/json' },
    body: JSON.stringify({ title: '票 9', head: `ticket/${running.number}`, base: 'req/o-0001' }),
  })

  const root = await mkdtemp(join(tmpdir(), 'afk-status-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const repoDir = join(root, REPO)
  await mkdir(join(repoDir, '.audit'), { recursive: true })
  await writeFile(
    join(repoDir, '.audit', `${running.number}.tsv`),
    [
      HEADER,
      '2026-11-17T02:00:00.000Z\tverify\tabc123\t按验收条件验证\t.audit/a.png\tpass',
    ].join('\n') + '\n',
  )
  await writeFile(
    join(repoDir, '.audit', `${done.number}.tsv`),
    [
      HEADER,
      '2026-11-17T03:00:00.000Z\tmerge\treq/o-0001\t合进需求分支\tdef456\tpass',
    ].join('\n') + '\n',
  )

  const customersPath = join(root, 'customers.json')
  await writeFile(
    customersPath,
    JSON.stringify([{ id: 'c-0001', short_name: 'acme', status: 'active', repos: { demo: REPO } }]),
  )
  const runLog = join(root, 'runs.jsonl')
  await writeFile(
    runLog,
    JSON.stringify({
      ts: '2026-11-17T10:00:00.000Z',
      executed: [],
      errors: [{ repo: REPO, parent: parent.number, message: '点火失败：push 被拒' }],
    }) + '\n',
  )

  return { fake, gh, parent, running, done, root, repoDir, customersPath, runLog }
}

test('status 列出父工单、子票、最新 trail、PR、正在跑的 job 和最后错误', async (t) => {
  const { gh, parent, running, done, root, customersPath, runLog } = await fixture(t)
  const out = []

  await runStatus(
    [
      '--customers',
      customersPath,
      '--owner',
      OWNER,
      '--repo-root',
      root,
      '--run-log',
      runLog,
    ],
    { gh, out: (line) => out.push(line) },
  )

  const text = out.join('\n')
  assert.match(text, new RegExp(`父工单 #${parent.number}`))
  assert.match(text, new RegExp(`子票 #${running.number}`))
  assert.match(text, new RegExp(`子票 #${done.number}`))
  assert.match(text, /最新：2026-11-17T02:00:00.000Z verify pass/)
  assert.match(text, new RegExp(`PR #1 open`))
  assert.match(text, new RegExp(`#${running.number} 正在跑：是`))
  assert.match(text, new RegExp(`#${done.number} 正在跑：否`))
  assert.match(text, /最后错误：.*点火失败：push 被拒/)
})

test('status --json 每张父工单一条 JSON', async (t) => {
  const { gh, parent, running, root, customersPath, runLog } = await fixture(t)
  const out = []

  await runStatus(
    [
      '--json',
      '--customers',
      customersPath,
      '--owner',
      OWNER,
      '--repo-root',
      root,
      '--run-log',
      runLog,
    ],
    { gh, out: (line) => out.push(line) },
  )

  assert.equal(out.length, 1)
  const row = JSON.parse(out[0])
  assert.equal(row.repo, `${OWNER}/${REPO}`)
  assert.equal(row.parent.number, parent.number)
  assert.equal(row.parent.state, '开发中')
  const child = row.tickets.find((ticket) => ticket.number === running.number)
  assert.equal(child.running, true)
  assert.equal(child.latest.phase, 'verify')
  assert.equal(child.pull.number, 1)
  assert.match(row.lastError, /push 被拒/)
})
