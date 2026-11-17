import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  addRemote,
  commitAll,
  createWorktree,
  currentBranch,
  initBareRepo,
  initRepo,
  isBranchCheckedOut,
  mergeNoFf,
  push,
} from '../lib/git.mjs'

async function tempDir(t, prefix = 'afk-git-') {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  t.after(() => {})
  return dir
}

test('初始化、提交、建工作树、合分支', async (t) => {
  const root = await tempDir(t)
  const repo = join(root, 'repo')
  await initRepo(repo)
  await writeFile(join(repo, 'a.txt'), 'one\n')
  const first = await commitAll(repo, '第一笔')
  assert.ok(first)
  assert.equal(await currentBranch(repo), 'main')

  const bare = join(root, 'remote.git')
  await initBareRepo(bare)
  await addRemote(repo, 'origin', bare)
  await push(repo, { branch: 'main', setUpstream: true })

  const wt = await createWorktree(repo, { path: join(root, 'wt'), branch: 'feature', base: 'main' })
  await writeFile(join(wt, 'b.txt'), 'two\n')
  await commitAll(wt, '第二笔')

  await mergeNoFf(repo, 'feature', '合 feature')
  const content = await import('node:fs/promises').then((fs) => fs.readFile(join(repo, 'b.txt'), 'utf8'))
  assert.equal(content, 'two\n')
})

test('分支被工作树占着时能查出来', async (t) => {
  const root = await tempDir(t)
  const repo = join(root, 'repo')
  await initRepo(repo)
  await writeFile(join(repo, 'a.txt'), 'one\n')
  await commitAll(repo, '第一笔')
  assert.equal(await isBranchCheckedOut(repo, 'main'), true)
  assert.equal(await isBranchCheckedOut(repo, 'missing'), false)
})
