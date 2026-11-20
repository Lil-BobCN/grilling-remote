import assert from 'node:assert/strict'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { verifyInCleanCheckout } from '../lib/clean-check.mjs'

const HEAD = 'a'.repeat(40)

function fakeGit({ head = HEAD, manifest = true, lockfile = true, worktreeFails = false } = {}) {
  const calls = []
  async function git(cwd, args) {
    calls.push(args)
    if (args[0] === 'rev-parse') return head
    if (args[0] === 'cat-file') {
      if (manifest) return ''
      throw new Error('path does not exist')
    }
    if (args[0] === 'worktree' && args[1] === 'add') {
      if (worktreeFails) throw new Error('fatal: 不是 git 仓库')
      const path = args[3]
      await mkdir(path, { recursive: true })
      await writeFile(join(path, 'package.json'), '{"scripts":{"test":"node --test"}}\n')
      if (lockfile) await writeFile(join(path, 'package-lock.json'), '{}\n')
      return ''
    }
    if (args[0] === 'worktree') return ''
    throw new Error(`意外的 git 调用：${args.join(' ')}`)
  }
  return { git, calls }
}

function fakeRun({ installOk = true, checkOk = true } = {}) {
  const calls = []
  async function run({ command, cwd }) {
    calls.push({ command, cwd })
    if (command.startsWith('npm ci') || command.startsWith('npm install')) {
      return {
        ok: installOk,
        code: installOk ? 0 : 1,
        stdout: '安装输出\n',
        stderr: installOk ? '' : 'npm ERR! 缺依赖\n',
      }
    }
    return {
      ok: checkOk,
      code: checkOk ? 0 : 1,
      stdout: '测试输出\n',
      stderr: checkOk ? '' : 'FAIL 首页白屏\n',
    }
  }
  return { run, calls }
}

test('干净检出通过：有 lockfile 用 npm ci，测试命令过，结果绑 head', async () => {
  const base = join(tmpdir(), `afk-clean-check-test-${process.pid}`)
  await mkdir(base, { recursive: true })
  const logPath = join(base, 'pass.log')
  const { git, calls } = fakeGit()
  const { run, calls: runs } = fakeRun()

  try {
    const result = await verifyInCleanCheckout({
      repoDir: '/repo',
      ref: 'ticket/51',
      git,
      run,
      tempDir: base,
      logPath,
      checkCommand: 'npm test',
    })

    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(result.headSha, HEAD)
    assert.equal(result.reason, '')
    assert.deepEqual(result.missing, [])
    assert.equal(result.logPath, logPath)
    assert.deepEqual(
      runs.map((row) => row.command),
      ['npm ci', 'npm test'],
    )

    const add = calls.find((args) => args[0] === 'worktree' && args[1] === 'add')
    assert.ok(add, '没建干净工作树')
    assert.ok(add.includes(HEAD), `worktree add 没绑 head：${add.join(' ')}`)
    assert.ok(
      calls.some((args) => args[0] === 'worktree' && args[1] === 'remove'),
      '用完没删干净工作树',
    )

    const log = await readFile(logPath, 'utf8')
    assert.match(log, /npm ci/)
    assert.match(log, /测试输出/)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('没有 lockfile 时用 npm install', async () => {
  const base = join(tmpdir(), `afk-clean-check-install-${process.pid}`)
  await mkdir(base, { recursive: true })
  try {
    const { git } = fakeGit({ lockfile: false })
    const { run, calls } = fakeRun()
    const result = await verifyInCleanCheckout({
      repoDir: '/repo',
      ref: HEAD,
      git,
      run,
      tempDir: base,
      logPath: join(base, 'install.log'),
    })
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.deepEqual(
      calls.map((row) => row.command),
      ['npm install', 'npm test'],
    )
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('检出失败报 setup，不跑安装和测试', async () => {
  const base = join(tmpdir(), `afk-clean-check-setup-${process.pid}`)
  await mkdir(base, { recursive: true })
  try {
    const { git } = fakeGit({ worktreeFails: true })
    const { run, calls } = fakeRun()
    const result = await verifyInCleanCheckout({
      repoDir: '/repo',
      ref: HEAD,
      git,
      run,
      tempDir: base,
      logPath: join(base, 'setup.log'),
    })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'setup')
    assert.equal(result.headSha, HEAD)
    assert.match(result.missing.join('；'), /干净检出失败/)
    assert.equal(result.logPath, join(base, 'setup.log'))
    assert.equal(calls.length, 0)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('检不出提交也报 setup，head 留空，日志可查', async () => {
  const base = join(tmpdir(), `afk-clean-check-ref-${process.pid}`)
  await mkdir(base, { recursive: true })
  try {
    const git = async () => {
      throw new Error('fatal: Needed a single revision')
    }
    const { run, calls } = fakeRun()
    const result = await verifyInCleanCheckout({
      repoDir: '/repo',
      ref: 'ticket/missing',
      git,
      run,
      tempDir: base,
      logPath: join(base, 'ref.log'),
    })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'setup')
    assert.equal(result.headSha, '')
    assert.equal(calls.length, 0)
    assert.match(await readFile(result.logPath, 'utf8'), /Needed a single revision/)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('依赖装不上报 install，不再跑测试', async () => {
  const base = join(tmpdir(), `afk-clean-check-dep-${process.pid}`)
  await mkdir(base, { recursive: true })
  try {
    const { git } = fakeGit()
    const { run, calls } = fakeRun({ installOk: false })
    const result = await verifyInCleanCheckout({
      repoDir: '/repo',
      ref: HEAD,
      git,
      run,
      tempDir: base,
      logPath: join(base, 'dep.log'),
    })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'install')
    assert.equal(result.headSha, HEAD)
    assert.match(result.missing.join('；'), /依赖安装失败/)
    assert.deepEqual(
      calls.map((row) => row.command),
      ['npm ci'],
    )
    assert.match(await readFile(result.logPath, 'utf8'), /缺依赖/)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('测试失败报 check，结果仍绑 head', async () => {
  const base = join(tmpdir(), `afk-clean-check-check-${process.pid}`)
  await mkdir(base, { recursive: true })
  try {
    const { git } = fakeGit()
    const { run } = fakeRun({ checkOk: false })
    const result = await verifyInCleanCheckout({
      repoDir: '/repo',
      ref: HEAD,
      git,
      run,
      tempDir: base,
      logPath: join(base, 'check.log'),
    })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'check')
    assert.equal(result.headSha, HEAD)
    assert.match(result.missing.join('；'), /干净检出测试失败/)
    assert.match(await readFile(result.logPath, 'utf8'), /首页白屏/)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('仓库没有 package.json 就跳过，不建工作树', async () => {
  const base = join(tmpdir(), `afk-clean-check-skip-${process.pid}`)
  await mkdir(base, { recursive: true })
  try {
    const { git, calls } = fakeGit({ manifest: false })
    const { run, calls: runs } = fakeRun()
    const result = await verifyInCleanCheckout({
      repoDir: '/repo',
      ref: HEAD,
      git,
      run,
      tempDir: base,
      logPath: join(base, 'skip.log'),
    })
    assert.equal(result.ok, true)
    assert.equal(result.skipped, true)
    assert.equal(result.headSha, HEAD)
    assert.equal(calls.some((args) => args[0] === 'worktree'), false)
    assert.equal(runs.length, 0)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('不传日志路径时，返回的日志在检查结束后还能读', async () => {
  const { git } = fakeGit()
  const { run } = fakeRun()
  const result = await verifyInCleanCheckout({ repoDir: '/repo', ref: HEAD, git, run })
  try {
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.ok(result.logPath, '没有日志路径')
    assert.match(await readFile(result.logPath, 'utf8'), /npm ci/)
  } finally {
    if (result.logPath) await rm(result.logPath, { force: true })
  }
})
