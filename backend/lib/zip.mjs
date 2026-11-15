import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const script = fileURLToPath(new URL('../py/checkzip.py', import.meta.url))

export async function inspectZip(config, zipPath, outDir) {
  const env = {
    ...process.env,
    AFK_MAX_ENTRIES: String(config.maxEntries),
    AFK_MAX_UNCOMPRESSED: String(config.maxUncompressed),
    AFK_MAX_FILE: String(config.maxFileBytes),
  }

  try {
    const { stdout } = await execFileAsync(config.python, [script, 'inspect', zipPath, outDir], {
      env,
      timeout: 120000,
      maxBuffer: 4 * 1024 * 1024,
    })
    const line = stdout.trim().split('\n').pop()
    return JSON.parse(line)
  } catch (error) {
    const stdout = String(error.stdout || '').trim()
    if (stdout) {
      try {
        return JSON.parse(stdout.split('\n').pop())
      } catch {
        // 走下面的 internal
      }
    }
    return { ok: false, code: 'internal', detail: String(error.message || error) }
  }
}
