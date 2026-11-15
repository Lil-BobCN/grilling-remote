import { execFile } from 'node:child_process'
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export async function ensureDir(dir) {
  await mkdir(dir, { recursive: true, mode: 0o700 })
}

export async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return fallback
    throw error
  }
}

export async function writeJsonAtomic(file, value) {
  await ensureDir(dirname(file))
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o640 })
  await rename(tmp, file)
}

export async function withFileLock(lockPath, fn, { timeoutMs = 5000, staleMs = 60000 } = {}) {
  await ensureDir(dirname(lockPath))
  const started = Date.now()
  let handle

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
      if (Date.now() - started > timeoutMs) throw new Error(`等锁超时：${lockPath}`)
      await new Promise((resolve) => setTimeout(resolve, 25 + Math.floor(Math.random() * 50)))
    }
  }

  try {
    await handle.writeFile(String(process.pid))
    return await fn()
  } finally {
    await handle.close().catch(() => {})
    await unlink(lockPath).catch(() => {})
  }
}

export async function gitSync(dataDir, message, { enabled = true, timeoutMs = 15000 } = {}) {
  if (!enabled) return { skipped: 'disabled' }
  try {
    await stat(join(dataDir, '.git'))
  } catch {
    return { skipped: 'not a git repo' }
  }

  const run = (args) =>
    execFileAsync('git', ['-C', dataDir, ...args], {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
    })

  try {
    await run(['add', '-A'])
    try {
      await run(['commit', '-m', message])
    } catch (error) {
      const text = `${error.stdout || ''}${error.stderr || ''}`
      if (!/nothing to commit|no changes added|working tree clean/i.test(text)) throw error
    }
    await run(['push'])
    return { ok: true }
  } catch (error) {
    return { error: String(error.stderr || error.message || error).trim() }
  }
}
