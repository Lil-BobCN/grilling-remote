import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { run } from '../bin/scheduler.mjs'
import { createGithub } from '../lib/github.mjs'
import { ensureLabel } from '../lib/issues.mjs'
import { STATE_LABELS } from '../lib/scheduler.mjs'
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
  })

  assert.equal(lines.length, 1)
  assert.equal(lines[0].repo, 'acme/acme-demo')
  assert.equal(lines[0].parent, parent.number)
  assert.equal(lines[0].decision, 'advance')
  assert.ok(Array.isArray(lines[0].actions))
  assert.match(lines[0].reason, /点头：补缺口/)

  const stored = fake.state.issues.get(`${OWNER}/${REPO}`).find((row) => row.number === parent.number)
  assert.deepEqual(stored.labels, ['状态:排队中'])
})

test('--once 缺 --owner 时报错，不偷偷扫账号', async () => {
  await assert.rejects(
    run(['--once', '--customers', '/tmp/nope.json'], { gh: {}, notifier: {} }),
    /缺 --owner/,
  )
})
