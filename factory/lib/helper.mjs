/**
 * 外部命令的公共入口：`gh` 和服务器上的 `afk-product` helper。
 * 调用方可以注入 `run`，测试不跑网络和服务器。
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolveHelperCommand } from './config.mjs'

const execFileAsync = promisify(execFile)

/** helper 命令的来源顺序：AFK_HELPER、AFK_SSH_TARGET、AFK_SERVER，最后本机 PATH。 */
export function helperCommand(env = process.env) {
  const resolved = resolveHelperCommand(env)
  return resolved ? resolved.command : ['afk-product']
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
