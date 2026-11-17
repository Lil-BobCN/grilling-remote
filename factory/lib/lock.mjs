/**
 * 每仓一把文件锁，防止两个调度器实例同时点火同一个仓。
 *
 * 和 `backend/lib/store.mjs` 的 `withFileLock` 同一做法：`open(..., 'wx')` 抢锁，
 * 进程退出后内核关掉句柄，锁文件残留由 mtime 过期清掉。
 */
import { mkdir, open, stat, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * 抢到锁就跑 fn，抢不到返回 `{skipped:true}`；fn 的返回值放进 `{value}`。
 */
export async function tryWithFileLock(
  lockPath,
  fn,
  { timeoutMs = 0, staleMs = 10 * 60 * 1000 } = {},
) {
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
      if (Date.now() - started >= timeoutMs) return { skipped: true }
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }

  try {
    await handle.writeFile(String(process.pid))
    return { skipped: false, value: await fn() }
  } finally {
    await handle.close().catch(() => {})
    await unlink(lockPath).catch(() => {})
  }
}
