import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createGithub } from '../lib/github.mjs'
import { startFakeGithub } from './fake-github.mjs'

async function setup(t) {
  const fake = await startFakeGithub()
  t.after(() => fake.close())
  const gh = createGithub({ apiBase: fake.base, token: 'test' })
  return { fake, gh }
}

test('建仓、标签、工单、子票和阻塞边', async (t) => {
  const { gh } = await setup(t)

  const repo = await gh.createRepo({ owner: 'acme', name: 'acme-shuiguo' })
  assert.equal(repo.full_name, 'acme/acme-shuiguo')
  assert.equal((await gh.getRepoOrNull({ owner: 'acme', repo: 'nope' })), null)

  await gh.createLabel({ owner: 'acme', repo: 'acme-shuiguo', name: '状态:已提交', color: 'ededed' })

  const parent = await gh.createIssue({
    owner: 'acme',
    repo: 'acme-shuiguo',
    title: '父工单',
    labels: ['状态:已提交'],
  })
  const child = await gh.createIssue({ owner: 'acme', repo: 'acme-shuiguo', title: '子票' })

  await gh.addSubIssue({ owner: 'acme', repo: 'acme-shuiguo', number: parent.number, subIssueId: child.id })
  await gh.addBlockedBy({ owner: 'acme', repo: 'acme-shuiguo', number: parent.number, issueId: child.id })

  const children = await gh.listSubIssues({ owner: 'acme', repo: 'acme-shuiguo', number: parent.number })
  assert.deepEqual(children.map((row) => row.title), ['子票'])
  const blockers = await gh.listBlockedBy({ owner: 'acme', repo: 'acme-shuiguo', number: parent.number })
  assert.deepEqual(blockers.map((row) => row.title), ['子票'])

  await gh.createComment({ owner: 'acme', repo: 'acme-shuiguo', number: parent.number, body: '提案：拆票' })
  const comments = await gh.listComments({ owner: 'acme', repo: 'acme-shuiguo', number: parent.number })
  assert.equal(comments[0].body, '提案：拆票')

  await gh.closeIssue({ owner: 'acme', repo: 'acme-shuiguo', number: child.number })
  const open = await gh.listIssues({ owner: 'acme', repo: 'acme-shuiguo', state: 'open' })
  assert.deepEqual(open.map((row) => row.title), ['父工单'])

  const loaded = await gh.getIssue({ owner: 'acme', repo: 'acme-shuiguo', number: parent.number })
  assert.equal(loaded.sub_issues_summary.total, 1)
  assert.equal(loaded.issue_dependencies_summary.blocked_by, 1)
})

test('打不存在的标签返回 422', async (t) => {
  const { gh } = await setup(t)
  await gh.createRepo({ owner: 'acme', name: 'repo' })
  await assert.rejects(
    gh.createIssue({ owner: 'acme', repo: 'repo', title: '票', labels: ['缺少'] }),
    (error) => error.status === 422,
  )
})

test('删除仓后读不到', async (t) => {
  const { gh } = await setup(t)
  await gh.createRepo({ owner: 'acme', name: 'repo' })
  await gh.deleteRepo({ owner: 'acme', repo: 'repo' })
  assert.equal(await gh.getRepoOrNull({ owner: 'acme', repo: 'repo' }), null)
})

test('假服务临时目录可用', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'afk-factory-'))
  assert.ok(dir)
})
