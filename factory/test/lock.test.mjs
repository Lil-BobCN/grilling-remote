import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  acquireTicketLease,
  releaseTicketLease,
  ticketLeasePath,
  touchTicketLease,
} from '../lib/lock.mjs'

async function dir(t) {
  const path = await mkdtemp(join(tmpdir(), 'afk-lease-'))
  t.after(() => rm(path, { recursive: true, force: true }))
  return path
}

test('新票能抢到租约，内容写 pid 和开始时间', async (t) => {
  const lockDir = await dir(t)
  const lease = await acquireTicketLease({ lockDir, owner: 'acme', repo: 'demo', ticket: 51, pid: 4242 })
  assert.equal(lease.acquired, true)
  assert.equal(lease.takeover, false)
  const content = JSON.parse(await readFile(lease.path, 'utf8'))
  assert.equal(content.pid, 4242)
  assert.match(content.startedAt, /^\d{4}-\d{2}-\d{2}T/)
  assert.equal(lease.path, ticketLeasePath({ lockDir, owner: 'acme', repo: 'demo', ticket: 51 }))
})

test('同一票活着且心跳新鲜时判 busy', async (t) => {
  const lockDir = await dir(t)
  await acquireTicketLease({ lockDir, owner: 'acme', repo: 'demo', ticket: 51, pid: 4242 })
  const second = await acquireTicketLease({
    lockDir,
    owner: 'acme',
    repo: 'demo',
    ticket: 51,
    pid: 4343,
    isAlive: () => true,
  })
  assert.equal(second.acquired, false)
  assert.equal(second.reason, 'busy')
  assert.equal(second.holder.pid, 4242)
})

test('pid 已死时接管旧租约', async (t) => {
  const lockDir = await dir(t)
  await acquireTicketLease({ lockDir, owner: 'acme', repo: 'demo', ticket: 51, pid: 4242 })
  const second = await acquireTicketLease({
    lockDir,
    owner: 'acme',
    repo: 'demo',
    ticket: 51,
    pid: 4343,
    isAlive: () => false,
  })
  assert.equal(second.acquired, true)
  assert.equal(second.takeover, true)
  assert.equal(second.previous.pid, 4242)
  const content = JSON.parse(await readFile(second.path, 'utf8'))
  assert.equal(content.pid, 4343)
})

test('pid 活着但心跳超过 10 分钟也能接管', async (t) => {
  const lockDir = await dir(t)
  const lease = await acquireTicketLease({ lockDir, owner: 'acme', repo: 'demo', ticket: 51, pid: 4242 })
  const old = new Date(Date.now() - 11 * 60 * 1000)
  await utimes(lease.path, old, old)
  const second = await acquireTicketLease({
    lockDir,
    owner: 'acme',
    repo: 'demo',
    ticket: 51,
    pid: 4343,
    isAlive: () => true,
  })
  assert.equal(second.acquired, true)
  assert.equal(second.takeover, true)
})

test('心跳更新 mtime，释放删掉文件', async (t) => {
  const lockDir = await dir(t)
  const lease = await acquireTicketLease({ lockDir, owner: 'acme', repo: 'demo', ticket: 51, pid: 4242 })
  const old = new Date(Date.now() - 60_000)
  await utimes(lease.path, old, old)
  await touchTicketLease(lease.path)
  const info = await stat(lease.path)
  assert.ok(Date.now() - info.mtimeMs < 5000, '心跳后 mtime 接近现在')
  await releaseTicketLease(lease.path)
  await assert.rejects(stat(lease.path))
})

test('租约被接管后，旧持有者不能删或改新租约', async (t) => {
  const lockDir = await dir(t)
  const first = await acquireTicketLease({ lockDir, owner: 'acme', repo: 'demo', ticket: 51, pid: 4242 })
  const second = await acquireTicketLease({
    lockDir,
    owner: 'acme',
    repo: 'demo',
    ticket: 51,
    pid: 4343,
    isAlive: () => false,
  })
  assert.equal(second.takeover, true)

  assert.equal(await releaseTicketLease(first.path, { token: first.token }), false)
  const content = JSON.parse(await readFile(second.path, 'utf8'))
  assert.equal(content.pid, 4343, '旧持有者释放后新租约还在')

  await assert.rejects(() => touchTicketLease(first.path, { token: first.token }), /已被接管/)
  await releaseTicketLease(second.path, { token: second.token })
  await assert.rejects(stat(second.path))
})
