import assert from 'node:assert/strict'
import test from 'node:test'
import { createGithubApi } from '../lib/github-api.mjs'
import { createSpecLock } from '../lib/spec-lock.mjs'
import { startFakeGithub } from '../../factory/test/fake-github.mjs'

function configFor(fake) {
  return {
    githubToken: 'test',
    githubApi: fake.base,
    githubTimeoutMs: 2000,
  }
}

async function seedSpec(fake, { title, body }) {
  const gh = createGithubApi({ apiBase: fake.base, token: 'test' })
  const labels = await gh.listLabels({ owner: 'acme', repo: 'acme-shuiguo' })
  if (!labels.some((row) => row.name === 'ready-for-agent')) {
    await gh.createLabel({ owner: 'acme', repo: 'acme-shuiguo', name: 'ready-for-agent', color: '0e8a16' })
  }
  await gh.createIssue({
    owner: 'acme',
    repo: 'acme-shuiguo',
    title,
    body,
    labels: ['ready-for-agent'],
  })
}

test('仓库里有带 ready-for-agent、提到需求名的 spec，判为已锁单', async (t) => {
  const fake = await startFakeGithub({
    repos: [{ owner: 'acme', name: 'acme-shuiguo' }],
  })
  t.after(() => fake.close())
  await seedSpec(fake, { title: 'spec demo', body: '需求目录：demo' })

  const specLock = createSpecLock(configFor(fake))
  assert.equal(await specLock({ owner: 'acme', repo: 'acme-shuiguo', requirement: 'demo' }), true)
  assert.equal(await specLock({ owner: 'acme', repo: 'acme-shuiguo', requirement: 'kucun' }), false)
})

test('没有 ready-for-agent 的 issue 不算锁单', async (t) => {
  const fake = await startFakeGithub({
    repos: [{ owner: 'acme', name: 'acme-shuiguo' }],
  })
  t.after(() => fake.close())
  const gh = createGithubApi({ apiBase: fake.base, token: 'test' })
  await gh.createIssue({
    owner: 'acme',
    repo: 'acme-shuiguo',
    title: 'spec demo',
    body: '需求目录：demo',
  })

  const specLock = createSpecLock(configFor(fake))
  assert.equal(await specLock({ owner: 'acme', repo: 'acme-shuiguo', requirement: 'demo' }), false)
})

test('读不到 GitHub 时放行，不抛错', async (t) => {
  const fake = await startFakeGithub({
    repos: [{ owner: 'acme', name: 'acme-shuiguo' }],
  })
  t.after(() => fake.close())
  fake.state.fail = { status: 500, message: 'boom' }

  const specLock = createSpecLock(configFor(fake))
  assert.equal(await specLock({ owner: 'acme', repo: 'acme-shuiguo', requirement: 'demo' }), false)
})

test('没配 GitHub token 时不发请求，按未锁放行', async (t) => {
  const fake = await startFakeGithub({
    repos: [{ owner: 'acme', name: 'acme-shuiguo' }],
  })
  t.after(() => fake.close())

  const specLock = createSpecLock({ ...configFor(fake), githubToken: '' })
  assert.equal(await specLock({ owner: 'acme', repo: 'acme-shuiguo', requirement: 'demo' }), false)
  assert.equal(fake.state.requests.length, 0)
})
