/**
 * 通知模块的命令行调用。事件字段见 `docs/通知.md` 第五节。
 *
 * 调度器把一条事件 JSON 写到临时文件，跑 `python3 -m notifier send --event-file <路径>`，
 * 读退出码和 stdout。怎么送到、失败怎么重试、按 `key` 去重都归 notifier。
 * 测试注入 `runner`，不跑真实通知命令。
 */
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))

function defaultRunner(command, args, options) {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { cwd: options.cwd, env: options.env, timeout: 60000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        if (!error) {
          resolve({ code: 0, stdout: String(stdout || '') })
          return
        }
        resolve({
          code: typeof error.code === 'number' ? error.code : 1,
          stdout: String(stdout || ''),
        })
      },
    )
  })
}

/**
 * @param {object} [options]
 * @param {string} [options.command] 默认 `python3`
 * @param {string} [options.home] 设 `NOTIFIER_HOME`，默认沿用环境变量
 * @param {string} [options.cwd] 命令的工作目录，默认仓库根
 * @param {Function} [options.runner] 测试替身，签名 `(command, args, {cwd, env}) => {code, stdout}`
 */
export function createNotifier({
  command = 'python3',
  home,
  cwd = REPO_ROOT,
  runner = defaultRunner,
} = {}) {
  async function send(event) {
    const dir = await mkdtemp(join(tmpdir(), 'afkfactory-notify-'))
    const file = join(dir, 'event.json')
    try {
      await writeFile(file, `${JSON.stringify(event, null, 2)}\n`, 'utf8')
      const env = { ...process.env }
      if (home) env.NOTIFIER_HOME = home
      const result = await runner(
        command,
        ['-m', 'notifier', 'send', '--event-file', file],
        { cwd, env },
      )
      return {
        code: Number.isInteger(result?.code) ? result.code : 1,
        stdout: String(result?.stdout || ''),
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  return { send }
}
