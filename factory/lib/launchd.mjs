/**
 * launchd 常驻任务的模板渲染、安装和安装检查。
 *
 * 安装把 plist 写进 `~/Library/LaunchAgents`，wrapper 写进 `~/.afkfactory/bin`，
 * 日志目录建在 `~/.afkfactory/logs`。写完由这个模块调用 `launchctl` 加载，
 * 再检查任务真的起来了；加载和检查都可以注入替身，测试不碰真 launchd。
 */
import { execFile } from 'node:child_process'
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const TEMPLATE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'launchd')

export const LAUNCHD_JOBS = [
  {
    label: 'com.afkfactory.pull-inbox',
    plist: 'com.afkfactory.pull-inbox.plist',
    script: 'run-pull-inbox.sh',
    log: 'pull-inbox.log',
    persistent: false,
  },
  {
    label: 'com.afkfactory.scheduler',
    plist: 'com.afkfactory.scheduler.plist',
    script: 'run-scheduler.sh',
    log: 'scheduler.log',
    persistent: true,
  },
]

function stripTrailingSlash(path) {
  return path.replace(/\/+$/, '')
}

/** 把模板里的 `__HOME__` 和 `__REPO_ROOT__` 换成本机路径。 */
export function renderTemplate(text, { home, repoRoot }) {
  return text
    .replaceAll('__HOME__', stripTrailingSlash(home))
    .replaceAll('__REPO_ROOT__', stripTrailingSlash(repoRoot))
}

/** 跑一条外部命令，返回退出码和输出；找不到命令按退出码 1 算。 */
function runCommand(command, args) {
  return new Promise((done) => {
    execFile(command, args, { encoding: 'utf8', maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      done({
        code: error ? (Number.isInteger(error.code) ? error.code : 1) : 0,
        stdout: String(stdout ?? ''),
        stderr: String(stderr || error?.message || ''),
      })
    })
  })
}

function currentUid() {
  return typeof process.getuid === 'function' ? process.getuid() : 0
}

/** launchctl print 输出里的 pid。没有 pid 行说明任务不是常驻进程。 */
function launchdPid(text) {
  const match = /^\s*pid = (\d+)\s*$/m.exec(String(text ?? ''))
  return match ? Number(match[1]) : null
}

/** launchctl print 里的上次退出码；任务还没跑过时返回 null。 */
function lastExitCode(text) {
  const match = /last exit (?:code|status) = (-?\d+)/.exec(String(text ?? ''))
  return match ? Number(match[1]) : null
}

/** 把没通过的任务拼成一行错误说明。 */
export function launchdFailures(jobs = []) {
  return jobs
    .filter((row) => !row.ok)
    .map((row) => `${row.label}（${row.reason}）`)
    .join('；')
}

function schedulerPids(text) {
  return String(text ?? '')
    .split(/\s+/)
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0)
}

/**
 * 检查两个任务是否真的加载了。
 *
 * 判据：plist 在、`launchctl print` 成功；常驻任务（scheduler）还要有活着的进程。
 * 返回每个任务的结果，不抛错；调用方按 `ok` 决定退出码。
 */
export async function verifyLaunchd({
  home = homedir(),
  uid = currentUid(),
  run = runCommand,
  statFile = stat,
  retries = 0,
  waitMs = 200,
  wait = (ms) => new Promise((done) => setTimeout(done, ms)),
} = {}) {
  const homePath = resolve(home)
  const plistDir = join(homePath, 'Library', 'LaunchAgents')
  const check = async () => {
    const jobs = []
    for (const job of LAUNCHD_JOBS) {
      const plistFile = join(plistDir, job.plist)
      const row = { label: job.label, plist: plistFile, ok: false, loaded: false, pid: null, reason: '' }
      try {
        await statFile(plistFile)
      } catch {
        row.reason = `没安装：plist 不存在 ${plistFile}`
        jobs.push(row)
        continue
      }
      const printed = await run('launchctl', ['print', `gui/${uid}/${job.label}`])
      if (printed.code !== 0) {
        const detail = String(printed.stderr || printed.stdout || '').trim()
        row.reason = `未加载：launchctl print 退出码 ${printed.code}${detail ? `：${detail}` : ''}`
        jobs.push(row)
        continue
      }
      row.loaded = true
      row.pid = launchdPid(printed.stdout)
      if (job.persistent) {
        if (!row.pid) {
          row.reason = '已加载但没有进程：常驻任务要一直跑'
          jobs.push(row)
          continue
        }
        const alive = await run('ps', ['-p', String(row.pid), '-o', 'comm='])
        if (alive.code !== 0) {
          row.reason = `进程 ${row.pid} 不在了（ps 退出码 ${alive.code}）`
          jobs.push(row)
          continue
        }
        // pgrep -f 只要命令行里含这段字就会命中。编辑器、agent 的启动参数里也可能带它，
        // 所以再查一次进程命令行，只认真正由 node 跑起来的调度器。
        const listed = await run('pgrep', ['-f', 'factory/bin/scheduler.mjs --loop'])
        const candidates =
          listed.code === 0 ? schedulerPids(listed.stdout).filter((pid) => pid !== row.pid) : []
        const extra = []
        for (const pid of candidates) {
          const detail = await run('ps', ['-p', String(pid), '-o', 'command='])
          const command = String(detail.stdout || '').trim()
          if (detail.code === 0 && /^(?:\S*\/)?node(?=\s|$)/.test(command)) extra.push(pid)
        }
        if (extra.length) {
          row.reason = `launchd 之外还有调度器进程：${extra.join('、')}，停掉手工起的那份`
          jobs.push(row)
          continue
        }
      } else {
        const exitCode = lastExitCode(printed.stdout)
        if (exitCode !== null && exitCode !== 0) {
          row.reason = `上次运行退出码 ${exitCode}`
          jobs.push(row)
          continue
        }
      }
      row.ok = true
      jobs.push(row)
    }
    return { ok: jobs.every((row) => row.ok), jobs }
  }

  let result = await check()
  for (let attempt = 0; attempt < retries && !result.ok; attempt += 1) {
    await wait(waitMs)
    result = await check()
  }
  return result
}

/**
 * 装两个任务：写 plist 和 wrapper，用 launchctl 加载，再检查真的起来了。
 *
 * 重装先 `bootout` 旧任务，再 `bootstrap` 新 plist，避免继续跑旧路径。
 * 装完检查不过就回滚（卸掉两个任务）并抛错，退出码非零，不假装装好。
 */
export async function installLaunchd({
  home = homedir(),
  repoRoot,
  templateDir = TEMPLATE_DIR,
  uid = currentUid(),
  run = runCommand,
  statFile = stat,
  retries = 20,
  waitMs = 100,
  wait,
} = {}) {
  if (!repoRoot) throw new Error('缺 repoRoot（仓库路径）')
  const homePath = resolve(home)
  const repoPath = resolve(repoRoot)
  const plistDir = join(homePath, 'Library', 'LaunchAgents')
  const binDir = join(homePath, '.afkfactory', 'bin')
  const logsDir = join(homePath, '.afkfactory', 'logs')
  for (const dir of [plistDir, binDir, logsDir]) await mkdir(dir, { recursive: true })

  const plists = []
  const scripts = []
  for (const job of LAUNCHD_JOBS) {
    const values = { home: homePath, repoRoot: repoPath }

    const plistFile = join(plistDir, job.plist)
    await writeFile(plistFile, renderTemplate(await readFile(join(templateDir, job.plist), 'utf8'), values), 'utf8')
    await chmod(plistFile, 0o644)
    plists.push(plistFile)

    const scriptFile = join(binDir, job.script)
    await writeFile(scriptFile, renderTemplate(await readFile(join(templateDir, job.script), 'utf8'), values), 'utf8')
    await chmod(scriptFile, 0o755)
    scripts.push(scriptFile)
  }

  const bootstrapped = []
  try {
    for (const job of LAUNCHD_JOBS) {
      // 没加载过时 bootout 会失败，属于正常情况。
      await run('launchctl', ['bootout', `gui/${uid}/${job.label}`])
      const loaded = await run('launchctl', ['bootstrap', `gui/${uid}`, join(plistDir, job.plist)])
      if (loaded.code !== 0) {
        const detail = String(loaded.stderr || loaded.stdout || '').trim()
        throw new Error(
          `加载 ${job.label} 失败：launchctl bootstrap 退出码 ${loaded.code}${detail ? `：${detail}` : ''}`,
        )
      }
      bootstrapped.push(job)
    }
  } catch (error) {
    // 已经 bootstrap 成功的任务现在真的在跑，不卸掉会留下半安装状态。
    for (const job of bootstrapped) {
      await run('launchctl', ['bootout', `gui/${uid}/${job.label}`])
    }
    throw error
  }

  const verify = await verifyLaunchd({ home: homePath, uid, run, statFile, retries, waitMs, wait })
  if (!verify.ok) {
    for (const job of LAUNCHD_JOBS) {
      await run('launchctl', ['bootout', `gui/${uid}/${job.label}`])
    }
    throw new Error(`常驻任务没装好：${launchdFailures(verify.jobs)}`)
  }

  return { plists, scripts, logsDir, verify }
}
