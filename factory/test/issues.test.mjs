import assert from 'node:assert/strict'
import test from 'node:test'
import { createGithub } from '../lib/github.mjs'
import { ensureBlockedBy, ensureCommentOnce, ensureLabel, ensureSubIssue } from '../lib/issues.mjs'
import { startFakeGithub } from './fake-github.mjs'

async function setup(t) {
  const fake = await startFakeGithub({ repos: [{ owner: 'acme', name: 'repo' }] })
  t.after(() => fake.close())
  const gh = createGithub({ apiBase: fake.base, token: 'test' })
  return { fake, gh }
}

test('建标签、子票、阻塞边和评论都幂等', async (t) => {
  const { gh } = await setup(t)
  const parent = await gh.createIssue({ owner: 'acme', repo: 'repo', title: '父' })
  const child = await gh.createIssue({ owner: 'acme', repo: 'repo', title: '子' })

  assert.equal(await ensureLabel(gh, { owner: 'acme', repo: 'repo', name: '状态:排队中' }), true)
  assert.equal(await ensureLabel(gh, { owner: 'acme', repo: 'repo', name: '状态:排队中' }), false)

  assert.equal(await ensureSubIssue(gh, { owner: 'acme', repo: 'repo', parent: parent.number, childId: child.id }), true)
  assert.equal(await ensureSubIssue(gh, { owner: 'acme', repo: 'repo', parent: parent.number, childId: child.id }), false)

  assert.equal(await ensureBlockedBy(gh, { owner: 'acme', repo: 'repo', issue: parent.number, blockerId: child.id }), true)
  assert.equal(await ensureBlockedBy(gh, { owner: 'acme', repo: 'repo', issue: parent.number, blockerId: child.id }), false)

  assert.equal(await ensureCommentOnce(gh, { owner: 'acme', repo: 'repo', number: parent.number, body: '提案：补缺口' }), true)
  assert.equal(await ensureCommentOnce(gh, { owner: 'acme', repo: 'repo', number: parent.number, body: '提案：补缺口' }), false)
  const comments = await gh.listComments({ owner: 'acme', repo: 'repo', number: parent.number })
  assert.equal(comments.length, 1)
})
