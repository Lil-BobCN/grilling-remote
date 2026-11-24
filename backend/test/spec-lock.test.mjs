import assert from 'node:assert/strict'
import test from 'node:test'
import { createGithubApi } from '../lib/github-api.mjs'
import { createSpecLock } from '../lib/spec-lock.mjs'
import { startFakeGithub } from '../../factory/test/fake-github.mjs'

const OWNER = 'acme'
const REPO = 'acme-shuiguo'
const REQUIREMENT = 'demo'
const POINT = '点头：补缺口\n\n## 最终答案\n\n- 技术栈：Next.js + Postgres'
const UNLOCK = '改口：重传 2026-11-24T10:00:00.000Z，旧的提案和点头作废。'

function configFor(fake) {
  return {
    githubToken: 'test',
    githubApi: fake.base,
    githubTimeoutMs: 2000,
  }
}

function clientFor(fake) {
  return createGithubApi({ apiBase: fake.base, token: 'test' })
}

async function seedSpec(fake, { title, body, labels = ['ready-for-agent'] }) {
  const gh = clientFor(fake)
  const existing = await gh.listLabels({ owner: OWNER, repo: REPO })
  if (!existing.some((row) => row.name === 'ready-for-agent')) {
    await gh.createLabel({ owner: OWNER, repo: REPO, name: 'ready-for-agent', color: '0e8a16' })
  }
  return gh.createIssue({ owner: OWNER, repo: REPO, title, body, labels })
}

async function seedParent(fake, { comments = [] } = {}) {
  const gh = clientFor(fake)
  const issue = await gh.createIssue({
    owner: OWNER,
    repo: REPO,
    title: '父工单',
    body: '<!-- factory:order=o-0001 -->',
  })
  for (const body of comments) {
    await gh.createComment({ owner: OWNER, repo: REPO, number: issue.number, body })
  }
  return issue
}

async function start(t) {
  const fake = await startFakeGithub({ repos: [{ owner: OWNER, name: REPO }] })
  t.after(() => fake.close())
  return fake
}

test('仓库里有带 ready-for-agent、提到需求名的 spec，判为已锁单', async (t) => {
  const fake = await start(t)
  await seedSpec(fake, { title: 'spec demo', body: '需求目录：demo' })

  const specLock = createSpecLock(configFor(fake))
  assert.equal(await specLock({ owner: OWNER, repo: REPO, requirement: REQUIREMENT }), true)
  assert.equal(await specLock({ owner: OWNER, repo: REPO, requirement: 'kucun' }), false)
})

test('没有 ready-for-agent 的 issue 不算锁单', async (t) => {
  const fake = await start(t)
  await seedSpec(fake, { title: 'spec demo', body: '需求目录：demo', labels: [] })

  const specLock = createSpecLock(configFor(fake))
  assert.equal(await specLock({ owner: OWNER, repo: REPO, requirement: REQUIREMENT }), false)
})

test('读不到 GitHub 时放行，不抛错', async (t) => {
  const fake = await start(t)
  fake.state.fail = { status: 500, message: 'boom' }

  const specLock = createSpecLock(configFor(fake))
  assert.equal(await specLock({ owner: OWNER, repo: REPO, requirement: REQUIREMENT }), false)
})

test('没配 GitHub token 时不发请求，按未锁放行', async (t) => {
  const fake = await start(t)

  const specLock = createSpecLock({ ...configFor(fake), githubToken: '' })
  assert.equal(await specLock({ owner: OWNER, repo: REPO, requirement: REQUIREMENT }), false)
  assert.equal(fake.state.requests.length, 0)
})

test('父工单最新一条是点头：补缺口，判为已锁单', async (t) => {
  const fake = await start(t)
  const parent = await seedParent(fake, { comments: [POINT] })

  const specLock = createSpecLock(configFor(fake))
  assert.equal(
    await specLock({
      owner: OWNER,
      repo: REPO,
      requirement: REQUIREMENT,
      parentIssue: parent.html_url,
    }),
    true,
  )
})

test('点头之后又写改口：重传，解锁；旧 spec 还在也不回退判锁', async (t) => {
  const fake = await start(t)
  await seedSpec(fake, { title: 'spec demo', body: '需求目录：demo' })
  const parent = await seedParent(fake, { comments: [POINT, UNLOCK] })

  const specLock = createSpecLock(configFor(fake))
  assert.equal(
    await specLock({
      owner: OWNER,
      repo: REPO,
      requirement: REQUIREMENT,
      parentIssue: String(parent.number),
    }),
    false,
  )
})

test('改口之后又写了新的点头，重新判锁', async (t) => {
  const fake = await start(t)
  const parent = await seedParent(fake, { comments: [POINT, UNLOCK, `${POINT}\n- 部署：香港`] })

  const specLock = createSpecLock(configFor(fake))
  assert.equal(
    await specLock({
      owner: OWNER,
      repo: REPO,
      requirement: REQUIREMENT,
      parentIssue: parent.html_url,
    }),
    true,
  )
})

test('没有点头但有 spec，回退按 spec 标签判锁', async (t) => {
  const fake = await start(t)
  await seedSpec(fake, { title: 'spec demo', body: '需求目录：demo' })
  const parent = await seedParent(fake, {
    comments: ['提案：补缺口\n\n1. 题：用什么技术栈？'],
  })

  const specLock = createSpecLock(configFor(fake))
  assert.equal(
    await specLock({
      owner: OWNER,
      repo: REPO,
      requirement: REQUIREMENT,
      parentIssue: parent.html_url,
    }),
    true,
  )
})

test('父工单没有点头，仓库里也没有 spec，不锁', async (t) => {
  const fake = await start(t)
  const parent = await seedParent(fake)

  const specLock = createSpecLock(configFor(fake))
  assert.equal(
    await specLock({
      owner: OWNER,
      repo: REPO,
      requirement: REQUIREMENT,
      parentIssue: parent.html_url,
    }),
    false,
  )
})

test('上传接收时间早于点头评论，按未锁放行', async (t) => {
  const fake = await start(t)
  const parent = await seedParent(fake, { comments: [POINT] })

  const specLock = createSpecLock(configFor(fake))
  assert.equal(
    await specLock({
      owner: OWNER,
      repo: REPO,
      requirement: REQUIREMENT,
      parentIssue: parent.html_url,
      uploadedAt: '2026-11-01T00:00:00.000Z',
    }),
    false,
  )
  assert.equal(
    await specLock({
      owner: OWNER,
      repo: REPO,
      requirement: REQUIREMENT,
      parentIssue: parent.html_url,
      uploadedAt: new Date(Date.now() + 60_000).toISOString(),
    }),
    true,
  )
})

test('读父工单评论失败时按未锁放行', async (t) => {
  const fake = await start(t)
  const parent = await seedParent(fake, { comments: [POINT] })
  fake.state.fail = { status: 500, message: 'boom' }

  const specLock = createSpecLock(configFor(fake))
  assert.equal(
    await specLock({
      owner: OWNER,
      repo: REPO,
      requirement: REQUIREMENT,
      parentIssue: parent.html_url,
    }),
    false,
  )
})
