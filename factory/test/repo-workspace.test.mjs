import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  abort,
  createRepoWorkspace,
  ensure,
  lock,
  parseWorktreeList,
  prepareTicket,
  release,
  sweep,
} from '../lib/repo-workspace.mjs'
import {
  addRemote,
  commitAll,
  currentBranch,
  git,
  initBareRepo,
  initRepo,
  push,
} from '../lib/git.mjs'

async function hasBranch(repoDir, branch) {
  try {
    await git(repoDir, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`])
    return true
  } catch {
    return false
  }
}

async function tempRoot(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'afk-workspace-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

async function seedCustomer(root, { reqBranch = 'req/7' } = {}) {
  const seed = join(root, 'seed')
  await initRepo(seed)
  await writeFile(join(seed, 'README.md'), '# 样本仓\n')
  await commitAll(seed, '第一笔')
  await git(seed, ['checkout', '-b', reqBranch])
  await writeFile(join(seed, 'req.txt'), `${reqBranch}\n`)
  await commitAll(seed, `建 ${reqBranch}`)
  await git(seed, ['checkout', 'main'])
  const origin = join(root, 'origin.git')
  await initBareRepo(origin)
  await addRemote(seed, 'origin', origin)
  await push(seed, { branch: 'main', setUpstream: true })
  await push(seed, { branch: reqBranch })
  return { seed, origin, reqBranch }
}

function workspaceFor(root, options = {}) {
  return createRepoWorkspace({
    repoRoot: join(root, 'repos'),
    lockDir: join(root, 'locks'),
    remoteUrlFor: () => join(root, 'origin.git'),
    ...options,
  })
}

async function worktrees(repoDir) {
  return parseWorktreeList(await git(repoDir, ['worktree', 'list', '--porcelain']))
}

function fakeExec({ images = [], ps = '', failBuild = false } = {}) {
  const calls = []
  const known = new Set(images)
  return {
    calls,
    async exec(command, args, options = {}) {
      calls.push({ command, args, options })
      if (command === 'docker' && args[0] === 'image' && args[1] === 'inspect') {
        const name = args.at(-1)
        return known.has(name)
          ? { code: 0, stdout: 'sha256:abc123\n', stderr: '' }
          : { code: 1, stdout: '', stderr: `Error: No such image: ${name}` }
      }
      if (command === 'docker' && args[0] === 'ps') return { code: 0, stdout: ps, stderr: '' }
      if (command === 'docker' && args[0] === 'rm') {
        return { code: 0, stdout: `${args.at(-1)}\n`, stderr: '' }
      }
      if (command === 'npx') {
        if (failBuild) return { code: 2, stdout: '', stderr: 'No .sandcastle/ found' }
        const name = args[args.indexOf('--image-name') + 1]
        known.add(name)
        return { code: 0, stdout: 'Build complete!', stderr: '' }
      }
      return { code: 0, stdout: '', stderr: '' }
    },
  }
}

test('模块导出六个命名接口', () => {
  for (const fn of [ensure, lock, prepareTicket, release, abort, sweep]) {
    assert.equal(typeof fn, 'function')
  }
})

test('ensure 克隆客户仓、拉取更新并切到需求分支', async (t) => {
  const root = await tempRoot(t)
  const { seed, reqBranch } = await seedCustomer(root)
  const ws = workspaceFor(root)

  const first = await ws.ensure({ owner: 'acme', repo: 'demo', reqBranch })
  assert.equal(first.repoDir, join(root, 'repos', 'demo'))
  assert.equal(first.cloned, true)
  assert.equal(await currentBranch(first.repoDir), reqBranch)
  assert.equal(await readFile(join(first.repoDir, 'req.txt'), 'utf8'), `${reqBranch}\n`)

  await git(seed, ['checkout', reqBranch])
  await writeFile(join(seed, 'req.txt'), '第二版\n')
  await commitAll(seed, '需求分支新提交')
  await push(seed, { branch: reqBranch })
  await git(seed, ['checkout', 'main'])

  const second = await ws.ensure({ owner: 'acme', repo: 'demo', reqBranch })
  assert.equal(second.cloned, false)
  assert.equal(await readFile(join(second.repoDir, 'req.txt'), 'utf8'), '第二版\n')
  assert.equal(await currentBranch(second.repoDir), reqBranch)
})

test('ensure 在客户仓没有需求分支时报错', async (t) => {
  const root = await tempRoot(t)
  await seedCustomer(root)
  const ws = workspaceFor(root)

  await assert.rejects(
    () => ws.ensure({ owner: 'acme', repo: 'demo', reqBranch: 'req/404' }),
    /没有需求分支 req\/404/,
  )
})

test('prepareTicket 建工作树，干净工作树 release 后 worktree list 无残留', async (t) => {
  const root = await tempRoot(t)
  const { reqBranch } = await seedCustomer(root)
  const ws = workspaceFor(root)
  const { repoDir } = await ws.ensure({ owner: 'acme', repo: 'demo', reqBranch })

  const prepared = await ws.prepareTicket({ repoDir, base: reqBranch, ticketBranch: 'ticket/11' })
  assert.equal(prepared.worktree, join(repoDir, '.sandcastle', 'worktrees', 'ticket-11'))
  assert.equal(await currentBranch(prepared.worktree), 'ticket/11')
  assert.ok((await worktrees(repoDir)).some((row) => row.branch === 'ticket/11'))

  const released = await ws.release({ ...prepared, deleteBranch: true })
  assert.equal(released.removed, true)
  assert.equal(released.kept, false)
  assert.deepEqual(released.archived, [])

  const left = await worktrees(repoDir)
  assert.ok(!left.some((row) => row.branch === 'ticket/11'))
  assert.ok(!left.some((row) => row.path.includes('.sandcastle/worktrees')))
  assert.equal(await hasBranch(repoDir, 'ticket/11'), false)
})

test('改了已跟踪文件的工作树 release 时保留并返回路径', async (t) => {
  const root = await tempRoot(t)
  const { reqBranch } = await seedCustomer(root)
  const ws = workspaceFor(root)
  const { repoDir } = await ws.ensure({ owner: 'acme', repo: 'demo', reqBranch })
  const prepared = await ws.prepareTicket({ repoDir, base: reqBranch, ticketBranch: 'ticket/11' })
  await writeFile(join(prepared.worktree, 'req.txt'), '未提交的改动\n')

  const released = await ws.release(prepared)
  assert.equal(released.removed, false)
  assert.equal(released.kept, true)
  assert.equal(released.path, prepared.worktree)
  assert.equal(released.dirty, true)
  assert.equal(await readFile(join(prepared.worktree, 'req.txt'), 'utf8'), '未提交的改动\n')
  assert.ok((await worktrees(repoDir)).some((row) => row.branch === 'ticket/11'))
})

test('只有未跟踪文件的工作树先归档再删除', async (t) => {
  const root = await tempRoot(t)
  const { reqBranch } = await seedCustomer(root)
  const ws = workspaceFor(root)
  const { repoDir } = await ws.ensure({ owner: 'acme', repo: 'demo', reqBranch })
  const prepared = await ws.prepareTicket({ repoDir, base: reqBranch, ticketBranch: 'ticket/11' })
  await mkdir(join(prepared.worktree, 'shots'), { recursive: true })
  await writeFile(join(prepared.worktree, 'shots', '首页.png'), 'png-bytes')

  const released = await ws.release(prepared)
  assert.equal(released.removed, true)
  assert.equal(released.archived.length, 1)
  assert.equal(released.archived[0].from, 'shots/首页.png')
  assert.match(
    released.archived[0].to,
    /^\.audit\/archive\/[0-9]{8}T[0-9]{6}Z-ticket-11\/shots\/首页\.png$/,
  )
  assert.equal(await readFile(join(repoDir, released.archived[0].to), 'utf8'), 'png-bytes')
  assert.ok(!(await worktrees(repoDir)).some((row) => row.branch === 'ticket/11'))
})

test('release 把 .audit 证据提交到票分支，只归档非证据文件', async (t) => {
  const root = await tempRoot(t)
  const { reqBranch } = await seedCustomer(root)
  const ws = workspaceFor(root)
  const { repoDir } = await ws.ensure({ owner: 'acme', repo: 'demo', reqBranch })
  const prepared = await ws.prepareTicket({ repoDir, base: reqBranch, ticketBranch: 'ticket/11' })

  // 模拟 ignore 写入口：证据被 exclude 挡住，仍要强制进分支。
  const common = (await git(prepared.worktree, ['rev-parse', '--git-common-dir'])).trim()
  const exclude = join(
    common.startsWith('/') ? common : join(prepared.worktree, common),
    'info',
    'exclude',
  )
  await mkdir(join(prepared.worktree, '.audit', 'evidence', '11'), { recursive: true })
  await writeFile(join(prepared.worktree, '.audit', 'evidence', '11', 'after.png'), 'png')
  await writeFile(exclude, '.audit/evidence/11/\n', { flag: 'a' })
  await mkdir(join(prepared.worktree, 'shots'), { recursive: true })
  await writeFile(join(prepared.worktree, 'shots', '临时.txt'), 'tmp')

  const released = await ws.release(prepared)
  assert.equal(released.removed, true)
  assert.equal(released.archived.length, 1)
  assert.equal(released.archived[0].from, 'shots/临时.txt')
  assert.ok(released.auditHead)

  const head = (await git(repoDir, ['rev-parse', 'ticket/11'])).trim()
  assert.equal(released.auditHead.trim(), head)
  assert.equal(
    await git(repoDir, ['show', 'ticket/11:.audit/evidence/11/after.png']),
    'png',
  )

  const batch = released.archived[0].to.split('/')[2]
  const record = JSON.parse(
    await readFile(join(repoDir, '.audit', 'archive', batch, 'record.json'), 'utf8'),
  )
  assert.equal(record.branch, 'ticket/11')
  assert.match(record.worktree, /ticket-11/)
  assert.match(record.at, /^\d{4}-\d{2}-\d{2}T/)
  assert.deepEqual(record.files, ['shots/临时.txt'])
})

test('abort 归档未跟踪文件并删掉脏工作树', async (t) => {
  const root = await tempRoot(t)
  const { reqBranch } = await seedCustomer(root)
  const ws = workspaceFor(root)
  const { repoDir } = await ws.ensure({ owner: 'acme', repo: 'demo', reqBranch })
  const prepared = await ws.prepareTicket({ repoDir, base: reqBranch, ticketBranch: 'ticket/11' })
  await writeFile(join(prepared.worktree, 'req.txt'), '坏掉的改动\n')
  await writeFile(join(prepared.worktree, '失败截图.png'), 'png')

  const aborted = await ws.abort(prepared)
  assert.equal(aborted.removed, true)
  assert.equal(aborted.archived.length, 1)
  assert.equal(await readFile(join(repoDir, aborted.archived[0].to), 'utf8'), 'png')
  assert.ok(!(await worktrees(repoDir)).some((row) => row.branch === 'ticket/11'))
})

test('已有脏工作树时 prepareTicket 报错并保留现场', async (t) => {
  const root = await tempRoot(t)
  const { reqBranch } = await seedCustomer(root)
  const ws = workspaceFor(root)
  const { repoDir } = await ws.ensure({ owner: 'acme', repo: 'demo', reqBranch })
  const prepared = await ws.prepareTicket({ repoDir, base: reqBranch, ticketBranch: 'ticket/11' })
  await writeFile(join(prepared.worktree, 'req.txt'), '未提交\n')

  await assert.rejects(
    () => ws.prepareTicket({ repoDir, base: reqBranch, ticketBranch: 'ticket/11' }),
    /未提交改动/,
  )
  assert.equal(await readFile(join(prepared.worktree, 'req.txt'), 'utf8'), '未提交\n')
})

test('工作树目录被删后 release 清掉残留登记', async (t) => {
  const root = await tempRoot(t)
  const { reqBranch } = await seedCustomer(root)
  const ws = workspaceFor(root)
  const { repoDir } = await ws.ensure({ owner: 'acme', repo: 'demo', reqBranch })
  const prepared = await ws.prepareTicket({ repoDir, base: reqBranch, ticketBranch: 'ticket/11' })
  await rm(prepared.worktree, { recursive: true, force: true })

  const released = await ws.release(prepared)
  assert.equal(released.removed, true)
  assert.equal(released.registered, false)
  assert.ok(!(await worktrees(repoDir)).some((row) => row.branch === 'ticket/11'))
})

test('重试时 prepareTicket 接上已有票分支，不重置上次的提交', async (t) => {  const root = await tempRoot(t)
  const { reqBranch } = await seedCustomer(root)
  const ws = workspaceFor(root)
  const { repoDir } = await ws.ensure({ owner: 'acme', repo: 'demo', reqBranch })

  const first = await ws.prepareTicket({ repoDir, base: reqBranch, ticketBranch: 'ticket/11' })
  await writeFile(join(first.worktree, 'ticket.txt'), '上次的提交\n')
  await commitAll(first.worktree, '票上的提交')
  const head = await git(first.worktree, ['rev-parse', 'HEAD'])
  const released = await ws.release(first)
  assert.equal(released.removed, true)
  assert.equal(await hasBranch(repoDir, 'ticket/11'), true)

  const second = await ws.prepareTicket({ repoDir, base: reqBranch, ticketBranch: 'ticket/11' })
  assert.equal(await git(second.worktree, ['rev-parse', 'HEAD']), head)
  assert.equal(await readFile(join(second.worktree, 'ticket.txt'), 'utf8'), '上次的提交\n')
})

test('lock 同一仓只能拿一把，释放后能再拿', async (t) => {
  const root = await tempRoot(t)
  const ws = workspaceFor(root)

  const first = await ws.lock({ owner: 'acme', repo: 'demo' })
  assert.equal(first.skipped, false)
  const second = await ws.lock({ owner: 'acme', repo: 'demo' })
  assert.equal(second.skipped, true)

  await first.release()
  const third = await ws.lock({ owner: 'acme', repo: 'demo' })
  assert.equal(third.skipped, false)
  await third.release()
})

test('sweep 列出并清理孤儿容器和工作树', async (t) => {
  const root = await tempRoot(t)
  const { reqBranch } = await seedCustomer(root)
  const stub = fakeExec({ ps: 'sandcastle-dead\texited\nsandcastle-live\trunning\n' })
  const ws = workspaceFor(root, { exec: stub.exec })
  const { repoDir } = await ws.ensure({ owner: 'acme', repo: 'demo', reqBranch })
  await ws.prepareTicket({ repoDir, base: reqBranch, ticketBranch: 'ticket/11' })
  const dirty = await ws.prepareTicket({ repoDir, base: reqBranch, ticketBranch: 'ticket/12' })
  await writeFile(join(dirty.worktree, 'req.txt'), '未提交\n')

  const listed = await ws.sweep()
  const orphans = listed.containers.filter((row) => row.orphan)
  assert.deepEqual(orphans.map((row) => row.name), ['sandcastle-dead'])
  assert.equal(orphans[0].removed, false)
  assert.ok(!listed.containers.find((row) => row.name === 'sandcastle-live').orphan)
  assert.deepEqual(
    listed.worktrees.map((row) => row.branch).sort(),
    ['ticket/11', 'ticket/12'],
  )
  assert.equal(
    stub.calls.filter((call) => call.command === 'docker' && call.args[0] === 'rm').length,
    0,
  )
  assert.ok((await worktrees(repoDir)).some((row) => row.branch === 'ticket/11'))

  const swept = await ws.sweep({ remove: true })
  assert.equal(swept.containers[0].removed, true)
  const rmCall = stub.calls.find((call) => call.command === 'docker' && call.args[0] === 'rm')
  assert.deepEqual(rmCall.args, ['rm', '-f', 'sandcastle-dead'])

  const remaining = await worktrees(repoDir)
  assert.ok(!remaining.some((row) => row.branch === 'ticket/11'), '干净工作树被清掉')
  assert.ok(remaining.some((row) => row.branch === 'ticket/12'), '脏工作树保留')
})
