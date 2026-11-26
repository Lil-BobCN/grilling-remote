import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  backoffMs,
  blockingStop,
  createJobStore,
  findJob,
  jobKey,
  policyBackoffMs,
  retryDelayMs,
} from '../lib/job.mjs'

async function tempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'afk-job-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

function clockFrom(value) {
  let current = new Date(value).getTime()
  const clock = () => new Date(current)
  clock.advance = (ms) => {
    current += ms
  }
  return clock
}

test('作业表记录 owner、repo、parent、ticket、action、attempt、lastBeat、stop、reason', async (t) => {
  const dir = await tempDir(t)
  const filePath = join(dir, 'jobs.json')
  const clock = clockFrom('2026-11-20T10:00:00+08:00')
  const store = createJobStore({ filePath, now: clock })
  await store.load()

  const row = await store.recordFailure({
    owner: 'acme',
    repo: 'demo',
    parent: 42,
    ticket: 51,
    action: 'ignite',
    reason: '点火失败',
    now: clock(),
    policy: { maxAttempts: 3, backoffBaseMs: 60000 },
  })

  assert.equal(row.owner, 'acme')
  assert.equal(row.repo, 'demo')
  assert.equal(row.parent, 42)
  assert.equal(row.ticket, 51)
  assert.equal(row.action, 'ignite')
  assert.equal(row.attempt, 1)
  assert.equal(row.stop, '')
  assert.equal(row.reason, '点火失败')
  assert.equal(row.lastBeat, clock().toISOString())

  const saved = JSON.parse(await readFile(filePath, 'utf8'))
  assert.equal(saved.jobs[jobKey({ owner: 'acme', repo: 'demo', parent: 42, ticket: 51, action: 'ignite' })].attempt, 1)
})

test('重启后 attempt 和 stop 还在', async (t) => {
  const dir = await tempDir(t)
  const filePath = join(dir, 'jobs.json')
  const clock = clockFrom('2026-11-20T10:00:00+08:00')
  const first = createJobStore({ filePath, now: clock })
  await first.load()
  await first.recordFailure({
    owner: 'acme',
    repo: 'demo',
    parent: 42,
    action: 'finish',
    reason: '评审没过',
    now: clock(),
    policy: { maxAttempts: 2, backoffBaseMs: 60000 },
  })
  await first.stop({
    owner: 'acme',
    repo: 'demo',
    parent: 42,
    action: 'finish',
    stop: 'deploy-failed',
    reason: '部署失败：地址不通',
    now: clock(),
  })

  const second = createJobStore({ filePath, now: clock })
  await second.load()
  const row = second.get(jobKey({ owner: 'acme', repo: 'demo', parent: 42, action: 'finish' }))
  assert.equal(row.attempt, 1)
  assert.equal(row.stop, 'deploy-failed')
  assert.match(row.reason, /部署失败/)
})

test('作业表读坏了要报出文件路径，不静默当空表', async (t) => {
  const dir = await tempDir(t)
  const filePath = join(dir, 'jobs.json')
  await writeFile(filePath, '{这不是 JSON', 'utf8')
  const store = createJobStore({ filePath })
  await assert.rejects(store.load(), /作业表.*jobs\.json/)
})

test('作业表写不进去要报错，不吞掉', async (t) => {
  const dir = await tempDir(t)
  const blocker = join(dir, 'blocker')
  await writeFile(blocker, 'not a directory', 'utf8')
  const store = createJobStore({ filePath: join(blocker, 'jobs.json') })
  await assert.rejects(
    store.stop({
      owner: 'acme',
      repo: 'demo',
      parent: 42,
      action: 'finish',
      stop: 'deploy-failed',
      reason: '部署失败',
      now: new Date(),
    }),
    /作业表.*写入失败/,
  )
})

test('连续失败按 attempt 退避，达到上限写 stop', async (t) => {
  const dir = await tempDir(t)
  const store = createJobStore({ filePath: join(dir, 'jobs.json') })
  await store.load()
  const clock = clockFrom('2026-11-20T10:00:00+08:00')
  const policy = { maxAttempts: 2, backoffBaseMs: 60_000 }

  const first = await store.recordFailure({
    owner: 'acme',
    repo: 'demo',
    parent: 42,
    action: 'finish',
    reason: 'PR 没过',
    now: clock(),
    policy,
  })
  assert.equal(first.attempt, 1)
  assert.equal(first.stop, '')
  assert.equal(
    retryDelayMs(first, { now: clock(), policy }),
    60_000,
    '第一次失败等一个基数',
  )

  clock.advance(60_000)
  assert.equal(retryDelayMs(first, { now: clock(), policy }), 0, '过了退避时间就能重试')

  const second = await store.recordFailure({
    owner: 'acme',
    repo: 'demo',
    parent: 42,
    action: 'finish',
    reason: 'PR 还没过',
    now: clock(),
    policy,
  })
  assert.equal(second.attempt, 2)
  assert.equal(second.stop, 'retry-exhausted')
  assert.match(second.reason, /PR 还没过/)

  const blocked = blockingStop(store.rowsFor({ owner: 'acme', repo: 'demo', parent: 42 }))
  assert.equal(blocked.stop, 'retry-exhausted')
})

test('成功一次把 attempt 清零，不留下重试状态', async (t) => {
  const dir = await tempDir(t)
  const store = createJobStore({ filePath: join(dir, 'jobs.json') })
  await store.load()
  const clock = clockFrom('2026-11-20T10:00:00+08:00')
  await store.recordFailure({
    owner: 'acme',
    repo: 'demo',
    parent: 42,
    action: 'gap-proposal',
    reason: 'agent 退出码 1',
    now: clock(),
    policy: { maxAttempts: 3, backoffBaseMs: 60_000 },
  })
  const row = await store.recordSuccess({
    owner: 'acme',
    repo: 'demo',
    parent: 42,
    action: 'gap-proposal',
    now: clock(),
  })
  assert.equal(row.attempt, 0)
  assert.equal(row.stop, '')
  assert.equal(retryDelayMs(row, { now: clock(), policy: {} }), 0)
})

test('stop 挡住动作，清掉 stop 后放行', async (t) => {
  const dir = await tempDir(t)
  const store = createJobStore({ filePath: join(dir, 'jobs.json') })
  await store.load()
  const now = new Date('2026-11-20T10:00:00+08:00')
  await store.stop({
    owner: 'acme',
    repo: 'demo',
    parent: 42,
    action: 'needs-info',
    stop: 'needs-info',
    reason: '认证失败',
    now,
  })
  let rows = store.rowsFor({ owner: 'acme', repo: 'demo', parent: 42 })
  assert.equal(blockingStop(rows)?.stop, 'needs-info')

  await store.clearStop({ owner: 'acme', repo: 'demo', parent: 42, now })
  rows = store.rowsFor({ owner: 'acme', repo: 'demo', parent: 42 })
  assert.equal(blockingStop(rows), null)
})

test('心跳：开始写 lastBeat，结束记 lastEnd，停止进程后按注入时钟判断卡住', async (t) => {
  const dir = await tempDir(t)
  const store = createJobStore({ filePath: join(dir, 'jobs.json') })
  await store.load()
  const clock = clockFrom('2026-11-20T10:00:00+08:00')

  await store.startRound({ now: clock() })
  assert.equal(store.heartbeat.roundStart, clock().toISOString())
  assert.equal(store.heartbeat.lastBeat, clock().toISOString())
  assert.equal(store.stalledFor(clock(), { stallMs: 10 * 60_000 }), null)

  clock.advance(9 * 60_000)
  assert.equal(store.stalledFor(clock(), { stallMs: 10 * 60_000 }), null)

  clock.advance(2 * 60_000)
  const stalled = store.stalledFor(clock(), { stallMs: 10 * 60_000 })
  assert.equal(stalled.roundStart, new Date('2026-11-20T10:00:00+08:00').toISOString())
  assert.equal(stalled.stalledMs, 11 * 60_000)

  await store.endRound({ now: clock() })
  assert.equal(store.heartbeat.roundStart, null)
  assert.equal(store.stalledFor(clock(), { stallMs: 10 * 60_000 }), null, '一轮结束就不算卡住')
})

test('看门狗只看心跳：轮次跑了 31 分钟但心跳新鲜，不报', async (t) => {
  const dir = await tempDir(t)
  const store = createJobStore({ filePath: join(dir, 'jobs.json') })
  await store.load()
  const clock = clockFrom('2026-11-20T10:00:00+08:00')

  await store.startRound({ now: clock() })
  clock.advance(31 * 60_000)
  await store.beat({ now: clock() })
  assert.equal(store.stalledFor(clock(), { stallMs: 30 * 60_000 }), null)

  clock.advance(31 * 60_000)
  const stalled = store.stalledFor(clock(), { stallMs: 30 * 60_000 })
  assert.equal(stalled.stalledMs, 31 * 60_000)
  assert.equal(stalled.basis, 'heartbeat')
})

test('看门狗：没有心跳才退回轮次开始时间', async (t) => {
  const dir = await tempDir(t)
  const store = createJobStore({ filePath: join(dir, 'jobs.json') })
  await store.load()
  const clock = clockFrom('2026-11-20T10:00:00+08:00')

  await store.startRound({ now: clock() })
  store.heartbeat.lastBeat = ''
  clock.advance(31 * 60_000)
  const stalled = store.stalledFor(clock(), { stallMs: 30 * 60_000 })
  assert.equal(stalled.stalledMs, 31 * 60_000)
  assert.equal(stalled.basis, 'roundStart')
})

test('退避按指数增长，有上限', () => {
  assert.equal(backoffMs(1, { baseMs: 60_000 }), 60_000)
  assert.equal(backoffMs(2, { baseMs: 60_000 }), 120_000)
  assert.equal(backoffMs(3, { baseMs: 60_000 }), 240_000)
  assert.equal(backoffMs(20, { baseMs: 60_000, maxMs: 600_000 }), 600_000)
})

test('调度器的退避配置键 backoffBaseMs/backoffMaxMs 映射到退避参数', () => {
  assert.equal(policyBackoffMs(1, { backoffBaseMs: 60_000 }), 60_000)
  assert.equal(policyBackoffMs(2, { backoffBaseMs: 60_000 }), 120_000)
  assert.equal(policyBackoffMs(20, { backoffBaseMs: 60_000, backoffMaxMs: 600_000 }), 600_000)
  assert.equal(policyBackoffMs(1, {}), 10 * 60_000, '没配就用默认基数')
})

test('一次写失败后，下一次写还能成功', async () => {
  let fail = true
  const store = createJobStore({
    filePath: '/tmp/afk-job-never-written.json',
    mkdir: async () => {},
    writeFile: async () => {
      if (fail) throw new Error('disk full')
    },
    rename: async () => {},
  })
  const now = new Date('2026-11-20T10:00:00+08:00')
  await assert.rejects(
    store.stop({ owner: 'acme', repo: 'demo', parent: 42, action: 'finish', stop: 'deploy-failed', reason: 'x', now }),
    /作业表写入失败/,
  )
  fail = false
  const row = await store.recordSuccess({ owner: 'acme', repo: 'demo', parent: 42, action: 'finish', now })
  assert.equal(row.attempt, 0)
})

test('findJob 按 action 和 ticket 找记录，parent 级记录不串到票级', async (t) => {
  const dir = await tempDir(t)
  const store = createJobStore({ filePath: join(dir, 'jobs.json') })
  await store.load()
  const now = new Date()
  await store.recordFailure({
    owner: 'acme',
    repo: 'demo',
    parent: 42,
    ticket: 51,
    action: 'ignite',
    reason: '点火失败',
    now,
    policy: {},
  })
  const rows = store.rowsFor({ owner: 'acme', repo: 'demo', parent: 42 })
  assert.equal(findJob(rows, { action: 'ignite', ticket: 51 }).attempt, 1)
  assert.equal(findJob(rows, { action: 'ignite', ticket: 52 }), null)
  assert.equal(findJob(rows, { action: 'finish' }), null)
})

test('管道运行标记：开始可见，心跳更新 lastBeat，结束清掉 running', async (t) => {
  const dir = await tempDir(t)
  const clock = clockFrom('2026-11-20T10:00:00+08:00')
  const store = createJobStore({ filePath: join(dir, 'jobs.json'), now: clock })
  await store.load()

  const row = await store.markRunning({
    owner: 'acme',
    repo: 'demo',
    parent: 42,
    ticket: 51,
    action: 'pipeline',
    reason: '管道运行中',
    now: clock(),
  })
  assert.equal(row.running, true)
  assert.equal(row.reason, '管道运行中')

  clock.advance(60_000)
  const beat = await store.beatJob({
    owner: 'acme',
    repo: 'demo',
    parent: 42,
    ticket: 51,
    action: 'pipeline',
    now: clock(),
  })
  assert.equal(beat.lastBeat, clock().toISOString())
  assert.equal(beat.running, true)

  const cleared = await store.clearRunning({
    owner: 'acme',
    repo: 'demo',
    parent: 42,
    ticket: 51,
    action: 'pipeline',
    now: clock(),
  })
  assert.equal(cleared.running, false)
  assert.equal(cleared.reason, '管道运行中')
  assert.equal(store.rowsFor({ owner: 'acme', repo: 'demo', parent: 42 }).length, 1)
})
