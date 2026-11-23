/**
 * 每仓一把文件锁，防止两个调度器实例同时点火同一个仓。
 *
 * 和 `backend/lib/store.mjs` 的 `withFileLock` 同一做法：`open(..., 'wx')` 抢锁，
 * 进程退出后内核关掉句柄，锁文件残留由 mtime 过期清掉。
 */
import { mkdir, open, readFile, stat, unlink, utimes, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

async function openLock(lockPath, { timeoutMs, staleMs }) {
  await mkdir(dirname(lockPath), { recursive: true })
  const started = Date.now()
  let handle = null

  while (!handle) {
    try {
      handle = await open(lockPath, 'wx', 0o600)
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      try {
        const info = await stat(lockPath)
        if (Date.now() - info.mtimeMs > staleMs) {
          await unlink(lockPath)
          continue
        }
      } catch {
        continue
      }
      if (Date.now() - started >= timeoutMs) return null
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }

  await handle.writeFile(String(process.pid))
  return handle
}

/**
 * 抢到锁立刻返回 `{skipped:false, release}`，由调用方决定什么时候放。
 * 抢不到返回 `{skipped:true}`。
 */
export async function acquireFileLock(
  lockPath,
  { timeoutMs = 0, staleMs = 10 * 60 * 1000 } = {},
) {
  const handle = await openLock(lockPath, { timeoutMs, staleMs })
  if (!handle) return { skipped: true }
  let released = false
  return {
    skipped: false,
    async release() {
      if (released) return
      released = true
      await handle.close().catch(() => {})
      await unlink(lockPath).catch(() => {})
    },
  }
}

/**
 * 抢到锁就跑 fn，抢不到返回 `{skipped:true}`；fn 的返回值放进 `{value}`。
 */
export async function tryWithFileLock(
  lockPath,
  fn,
  { timeoutMs = 0, staleMs = 10 * 60 * 1000 } = {},
) {
  const lock = await acquireFileLock(lockPath, { timeoutMs, staleMs })
  if (lock.skipped) return { skipped: true }
  try {
    return { skipped: false, value: await fn() }
  } finally {
    await lock.release()
  }
}

// ---- 票租约：同一票同一时间只允许一条管道 ----

/** 租约路径：每票一个文件，跨进程可见。 */
export function ticketLeasePath({ lockDir, owner, repo, ticket }) {
  return join(lockDir, `${owner}__${repo}__ticket-${ticket}.lock`)
}

/** `kill(pid, 0)` 判活；EPERM 说明进程在，只是不归我们。 */
export function pidAlive(pid) {
  const value = Number(pid)
  if (!Number.isInteger(value) || value <= 0) return false
  try {
    process.kill(value, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

function leaseStamp(now) {
  const value = typeof now === 'function' ? now() : now
  const date = value instanceof Date ? value : new Date(value ?? Date.now())
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString()
}

/**
 * 抢一张票的租约。抢不到返回 `{acquired:false, reason:'busy'}`。
 * 死 pid 或心跳超过 staleMs 的旧租约可以接管，接管时返回 previous 写进日志。
 */
export async function acquireTicketLease({
  lockDir,
  owner,
  repo,
  ticket,
  now = () => new Date(),
  staleMs = 10 * 60 * 1000,
  isAlive = pidAlive,
  pid = process.pid,
} = {}) {
  const path = ticketLeasePath({ lockDir, owner, repo, ticket })
  await mkdir(dirname(path), { recursive: true })
  const content = `${JSON.stringify({ pid, startedAt: leaseStamp(now) })}\n`

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await writeFile(path, content, { flag: 'wx', mode: 0o600 })
      return { acquired: true, path, takeover: false, token: content }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      let previous = null
      let mtimeMs = 0
      try {
        previous = JSON.parse(await readFile(path, 'utf8'))
      } catch {
        previous = null
      }
      try {
        mtimeMs = (await stat(path)).mtimeMs
      } catch {
        continue
      }
      const alive = isAlive(previous?.pid)
      const fresh = Date.now() - mtimeMs <= staleMs
      if (alive && fresh) {
        return { acquired: false, reason: 'busy', path, holder: { ...previous, mtimeMs } }
      }
      await unlink(path).catch(() => {})
      try {
        await writeFile(path, content, { flag: 'wx', mode: 0o600 })
        return { acquired: true, path, takeover: true, previous: previous || {}, mtimeMs, token: content }
      } catch (retry) {
        if (retry.code !== 'EEXIST') throw retry
      }
    }
  }
  return { acquired: false, reason: 'busy', path }
}

/**
 * 心跳：把租约 mtime 改成现在。带 token 时先确认文件还是自己写的；
 * 被接管后旧持有者不能再改、也不能删新租约。
 */
export async function touchTicketLease(path, { now = () => new Date(), token } = {}) {
  if (token !== undefined) {
    const current = await readFile(path, 'utf8').catch(() => null)
    if (current !== token) throw new Error('票租约已被接管，停止管道')
  }
  const at = new Date(leaseStamp(now))
  await utimes(path, at, at)
}

export async function releaseTicketLease(path, { token } = {}) {
  if (token !== undefined) {
    const current = await readFile(path, 'utf8').catch(() => null)
    if (current !== token) return false
  }
  await unlink(path).catch(() => {})
  return true
}
