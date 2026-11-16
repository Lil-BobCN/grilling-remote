/**
 * 外部命令的公共入口：`gh` 和服务器上的 `afk-product` helper。
 * 调用方可以注入 `run`，测试不跑网络和服务器。
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export function helperCommand(env = process.env) {
  if (env.AFK_HELPER?.trim()) return env.AFK_HELPER.trim().split(/\s+/)
  if (env.AFK_SSH_TARGET?.trim()) {
    return ['ssh', env.AFK_SSH_TARGET.trim(), 'sudo', '/usr/local/sbin/afk-product']
  }
  return ['afk-product']
}

/** 跑一次 `afk-product`，返回 stdout。 */
export async function runHelper(args, { run, env = process.env } = {}) {
  if (typeof run === 'function') return run(args)
  const [command, ...prefix] = helperCommand(env)
  const result = await execFileAsync(command, [...prefix, ...args], {
    timeout: 70 * 60 * 1000,
    maxBuffer: 8 * 1024 * 1024,
  }).catch((error) => {
    throw new Error(String(error.stderr || error.message || '').trim())
  })
  return String(result.stdout ?? '')
}

/** 跑一次 `gh`，返回 stdout。 */
export async function runGh(args, { run, timeoutMs = 60000 } = {}) {
  if (typeof run === 'function') return run(args)
  const result = await execFileAsync('gh', args, {
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
  }).catch((error) => {
    throw new Error(`gh ${args.join(' ')} 失败：${String(error.stderr || error.message || '').trim()}`)
  })
  return String(result.stdout || '')
}
