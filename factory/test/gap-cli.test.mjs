import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { run } from '../bin/gap.mjs'
import { createGithub } from '../lib/github.mjs'
import { startFakeGithub } from './fake-github.mjs'

const FIXTURE = fileURLToPath(
  new URL('../../docs/回传样例/工作区/.scratch/xianguopu/', import.meta.url),
)

const PARENT_BODY = `## 客户原话

> 「顾客想在我的微信小程序里看今天有什么水果，下单，选到店取还是送货。」

## 客户确认的结论

- 店里贴二维码

## 验收条件

- [ ] 顾客扫码进小程序，看到当天水果的名单。

## 不做清单

- 无

## 需求全文

- 客户简称：acme
- 需求名：xianguopu
`

async function setup(t) {
  const fake = await startFakeGithub({
    repos: [{ owner: 'acme', name: 'acme-shuiguo' }],
    issues: [{ owner: 'acme', repo: 'acme-shuiguo', title: '我想要一个卖水果的小程序', body: PARENT_BODY }],
  })
  t.after(() => fake.close())
  const gh = createGithub({ apiBase: fake.base, token: 'test' })
  const parent = await gh.getIssue({ owner: 'acme', repo: 'acme-shuiguo', number: 1 })
  const sink = { log() {} }
  return { fake, gh, parent, sink }
}

test('CLI apply-map 建图，propose 发到父工单，point 过关后写点头', async (t) => {
  const { gh, parent, sink } = await setup(t)

  const applied = await run(
    [
      'apply-map',
      '--scratch',
      FIXTURE,
      '--owner',
      'acme',
      '--repo',
      'acme-shuiguo',
      '--requirement',
      'xianguopu',
      '--parent',
      parent.html_url,
    ],
    { gh, log: sink },
  )
  assert.equal(applied.mapIssue.title, 'xianguopu 地图')

  const scratch = await mkdtemp(join(tmpdir(), 'gap-cli-rec-'))
  t.after(() => rm(scratch, { recursive: true, force: true }))
  const recommendationsFile = join(scratch, 'recommendations.json')
  await writeFile(recommendationsFile, JSON.stringify({ '做成小程序还是网页，放哪家云？': '自建服务器' }))

  const proposed = await run(
    [
      'propose',
      '--scratch',
      FIXTURE,
      '--owner',
      'acme',
      '--repo',
      'acme-shuiguo',
      '--number',
      String(applied.mapIssue.number),
      '--recommendations',
      recommendationsFile,
    ],
    { gh, log: sink },
  )
  assert.equal(proposed.parent, parent.number)
  let comments = await gh.listComments({ owner: 'acme', repo: 'acme-shuiguo', number: parent.number })
  const proposal = comments.find((row) => row.body.startsWith('提案：补缺口'))
  assert.ok(proposal)
  assert.match(proposal.body, /小程序用哪家云/)
  assert.match(proposal.body, /推荐：自建服务器/)

  const children = await gh.listSubIssues({ owner: 'acme', repo: 'acme-shuiguo', number: applied.mapIssue.number })
  for (const child of children) {
    await gh.closeIssue({ owner: 'acme', repo: 'acme-shuiguo', number: child.number })
  }

  const pointed = await run(
    [
      'point',
      '--owner',
      'acme',
      '--repo',
      'acme-shuiguo',
      '--number',
      String(parent.number),
      '--answers',
      JSON.stringify(['技术栈：Next.js + Postgres']),
    ],
    { gh, log: sink },
  )
  assert.equal(pointed.posted, true)
  comments = await gh.listComments({ owner: 'acme', repo: 'acme-shuiguo', number: parent.number })
  const point = comments.find((row) => row.body.startsWith('点头：补缺口'))
  assert.ok(point)
  assert.match(point.body, /## 最终答案\n\n- 技术栈：Next\.js \+ Postgres/)
  assert.match(point.body, /## 正文影响\n\n无/)
})

test('CLI point 在父工单出现改口：时拒绝，不写点头', async (t) => {
  const { gh, parent, sink } = await setup(t)
  await gh.updateIssue({
    owner: 'acme',
    repo: 'acme-shuiguo',
    number: parent.number,
    body: `${PARENT_BODY}\n\n- 地图：https://github.com/acme/acme-shuiguo/issues/99`,
  })
  await gh.createComment({
    owner: 'acme',
    repo: 'acme-shuiguo',
    number: parent.number,
    body: '提案：补缺口\n\n1. 题：用什么技术栈？',
  })
  await gh.createComment({
    owner: 'acme',
    repo: 'acme-shuiguo',
    number: parent.number,
    body: '改口：重传 2026-11-24T10:00:00.000Z，旧的提案和点头作废。',
  })

  await assert.rejects(
    run(
      [
        'point',
        '--owner',
        'acme',
        '--repo',
        'acme-shuiguo',
        '--number',
        String(parent.number),
        '--answers',
        JSON.stringify(['技术栈：Next.js + Postgres']),
      ],
      { gh, log: sink },
    ),
    (error) => error.name === 'GateConflictError' && error.kind === '改口：',
  )

  const comments = await gh.listComments({
    owner: 'acme',
    repo: 'acme-shuiguo',
    number: parent.number,
  })
  assert.equal(comments.filter((row) => row.body.startsWith('点头：补缺口')).length, 0)
})

test('CLI apply-map 小需求返回 skipped', async (t) => {
  const { gh, parent, sink } = await setup(t)
  const { mkdtemp, rm, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const scratch = await mkdtemp(join(tmpdir(), 'gap-cli-small-'))
  t.after(() => rm(scratch, { recursive: true, force: true }))
  await writeFile(join(scratch, '需求草稿.md'), '# 需求草稿\n')

  const result = await run(
    [
      'apply-map',
      '--scratch',
      scratch,
      '--owner',
      'acme',
      '--repo',
      'acme-shuiguo',
      '--requirement',
      'xianguopu',
      '--parent',
      parent.html_url,
    ],
    { gh, log: sink },
  )
  assert.deepEqual(result, { skipped: 'small' })
})
