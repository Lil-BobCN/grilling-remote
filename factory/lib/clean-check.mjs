/**
 * 门禁的干净检查：模拟 CI，在一个没有 node_modules 的检出上装依赖、跑测试。
 *
 * 检出用 `git worktree add --detach`，路径在系统临时目录，跑完删掉，不碰调用方的工作树。
 * 有 `package-lock.json` 或 `npm-shrinkwrap.json` 用 `npm ci`，没有用 `npm install`。
 * 测试命令按检出里的 `package.json` 选：有 `scripts.test` 用 `npm test`，
 * 否则有 `scripts.check` 用 `npm run check`，都没有报 `check` 失败。
 * 三类失败分开报：检出失败 `setup`、装依赖失败 `install`、测试失败 `check`。
 *
 * 结果绑在 head 上：返回的 `headSha` 就是这次检查的提交。调用方按它判断
 * 旧提交的结果能不能算数。仓库里没有 `package.json` 时跳过，返回 `skipped: true`，
 * 不创建检出、不跑命令，非 Node 仓库不受影响。
 */
import { execFile } from 'node:child_process'
import { statSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { git } from './git.mjs'

const execFileAsync = promisify(execFile)

const LOCKFILES = ['package-lock.json', 'npm-shrinkwrap.json']

/** trail 行里标记「这条 test 是干净检查写的」，用来区分验证 agent 自己的测试行。 */
export const CLEAN_CHECK_MARKER = '干净检出'

function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

function tail(text, limit = 4000) {
  const value = String(text ?? '').trim()
  return value.length > limit ? value.slice(-limit) : value
}

function stamp(at) {
  const date = at instanceof Date ? at : new Date(at ?? Date.now())
  const iso = Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
  return `${iso.slice(0, 19).replace(/[-:]/g, '')}Z`
}

function firstExisting(dir, names) {
  for (const name of names) {
    try {
      statSync(join(dir, name))
      return name
    } catch {
      // 换下一个
    }
  }
  return ''
}

/** 按 package.json 的 scripts 选测试命令；没有可用脚本返回 null。 */
function pickCheckCommand(manifestText) {
  let scripts = {}
  try {
    const manifest = JSON.parse(manifestText)
    if (manifest?.scripts && typeof manifest.scripts === 'object') scripts = manifest.scripts
  } catch {
    // 解析不了按缺脚本处理
  }
  if (typeof scripts.test === 'string' && scripts.test.trim()) return 'npm test'
  if (typeof scripts.check === 'string' && scripts.check.trim()) return 'npm run check'
  return null
}

/** 默认命令执行：`/bin/sh -c`，输出全收，超时杀进程。 */
export async function runShell({ command, cwd, env, timeoutMs }) {
  const result = await execFileAsync('/bin/sh', ['-c', command], {
    cwd,
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
    ...(env && Object.keys(env).length ? { env: { ...process.env, ...env } } : {}),
  }).catch((error) => error)
  const failed = result instanceof Error
  const code = failed ? (typeof result.code === 'number' ? result.code : 1) : 0
  return {
    ok: !failed,
    code,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
  }
}

function resultOf({ ok, headSha, reason = '', missing = [], logPath = '', command = '', skipped = false }) {
  return { ok, headSha, reason, missing, logPath, command, ...(skipped ? { skipped: true } : {}) }
}

async function writeLog(logPath, lines) {
  if (!logPath) return ''
  try {
    await mkdir(dirname(logPath), { recursive: true })
    await writeFile(logPath, `${lines.join('\n')}\n`, 'utf8')
    return logPath
  } catch {
    return ''
  }
}

/**
 * 在干净检出里跑一次门禁。
 *
 * @param {object} options
 * @param {string} options.repoDir 仓库或工作树路径，只用来建和删临时 checkout
 * @param {string} [options.ref] 要检查的提交或分支，默认 `HEAD`
 * @param {string} [options.checkCommand] 测试命令，默认按检出里的 `package.json` 选：有 `scripts.test` 用 `npm test`，否则有 `scripts.check` 用 `npm run check`
 * @param {Function} [options.git] git 命令替身，签名同 `lib/git.mjs` 的 `git(cwd, args)`
 * @param {Function} [options.run] 命令执行替身，收 `{command, cwd, env, timeoutMs}`
 * @param {string} [options.tempDir] 临时 checkout 的父目录，默认系统临时目录
 * @param {string} [options.logPath] 日志文件路径，默认临时目录里的按 head 命名文件
 * @param {object} [options.env] 追加给安装和测试命令的环境变量
 * @param {number} [options.timeoutMs] 单条命令超时，默认 15 分钟
 * @param {Function|Date|string} [options.now] 日志命名用的时间
 * @returns {Promise<{ok: boolean, headSha: string, reason: string, missing: string[], logPath: string}>}
 */
export async function verifyInCleanCheckout({
  repoDir,
  ref = 'HEAD',
  checkCommand = '',
  git: gitImpl = git,
  run = runShell,
  tempDir,
  logPath,
  env,
  timeoutMs = 15 * 60 * 1000,
  now = () => new Date(),
} = {}) {
  if (!repoDir) throw new Error('干净检查需要 repoDir')
  if (!ref) throw new Error('干净检查需要 ref')
  const at = typeof now === 'function' ? now() : now
  const lines = [`# 干净检查 ${ref}`, `时间：${stamp(at)}`]

  let headSha = ''
  try {
    headSha = await gitImpl(repoDir, ['rev-parse', '--verify', ref])
  } catch (error) {
    const setupLog =
      logPath ||
      join(
        tmpdir(),
        'afk-clean-check-logs',
        `clean-check-unknown-${stamp(at)}-${process.pid}.log`,
      )
    return resultOf({
      ok: false,
      headSha: '',
      reason: 'setup',
      missing: [`干净检出失败：检不出 ${ref}（${tail(errorText(error))}）`],
      logPath: await writeLog(setupLog, [...lines, `! rev-parse 失败：${errorText(error)}`]),
    })
  }

  let hasManifest = true
  try {
    await gitImpl(repoDir, ['cat-file', '-e', `${headSha}:package.json`])
  } catch {
    hasManifest = false
  }
  if (!hasManifest) {
    return resultOf({ ok: true, headSha, skipped: true })
  }

  const base = await mkdtemp(join(tempDir || tmpdir(), 'afk-clean-check-'))
  const checkout = join(base, 'checkout')
  // 日志不能放在 checkout 的父目录里：那个目录在 finally 会删掉。
  const logFile =
    logPath ||
    join(
      tmpdir(),
      'afk-clean-check-logs',
      `clean-check-${headSha.slice(0, 8)}-${stamp(at)}-${process.pid}.log`,
    )

  try {
    lines.push(`head：${headSha}`, `检出：${checkout}`)
    try {
      await gitImpl(repoDir, ['worktree', 'add', '--detach', checkout, headSha])
    } catch (error) {
      return resultOf({
        ok: false,
        headSha,
        reason: 'setup',
        missing: [`干净检出失败：${tail(errorText(error))}`],
        logPath: await writeLog(logFile, [...lines, `! worktree add 失败：${errorText(error)}`]),
      })
    }

    let command = checkCommand
    if (!command) {
      const manifestText = await readFile(join(checkout, 'package.json'), 'utf8').catch(() => '')
      const picked = pickCheckCommand(manifestText)
      if (!picked) {
        lines.push('! package.json 没有 scripts.test 或 scripts.check')
        return resultOf({
          ok: false,
          headSha,
          reason: 'check',
          missing: ['缺测试脚本：package.json 没有 scripts.test 或 scripts.check'],
          logPath: await writeLog(logFile, lines),
        })
      }
      command = picked
    }

    const lockfile = firstExisting(checkout, LOCKFILES)
    const install = lockfile ? 'npm ci' : 'npm install'
    lines.push(`$ ${install}`)
    const installed = await run({ command: install, cwd: checkout, env, timeoutMs })
    lines.push(tail(installed.stdout), tail(installed.stderr))
    if (!installed.ok) {
      return resultOf({
        ok: false,
        headSha,
        reason: 'install',
        missing: [`依赖安装失败：${install} 退出码 ${installed.code}`],
        logPath: await writeLog(logFile, lines),
        command: install,
      })
    }

    lines.push(`$ ${command}`)
    const checked = await run({ command, cwd: checkout, env, timeoutMs })
    lines.push(tail(checked.stdout), tail(checked.stderr))
    if (!checked.ok) {
      return resultOf({
        ok: false,
        headSha,
        reason: 'check',
        missing: [`干净检出测试失败：${command} 退出码 ${checked.code}`],
        logPath: await writeLog(logFile, lines),
        command,
      })
    }

    return resultOf({
      ok: true,
      headSha,
      logPath: await writeLog(logFile, lines),
      command,
    })
  } finally {
    await gitImpl(repoDir, ['worktree', 'remove', '--force', checkout]).catch(() => {})
    await gitImpl(repoDir, ['worktree', 'prune']).catch(() => {})
    await rm(base, { recursive: true, force: true }).catch(() => {})
  }
}
