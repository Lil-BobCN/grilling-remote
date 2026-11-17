/**
 * launchd 常驻任务的模板渲染和安装。
 *
 * 安装只写文件：plist 进 `~/Library/LaunchAgents`，wrapper 进 `~/.afkfactory/bin`，
 * 日志目录建在 `~/.afkfactory/logs`。加载和卸载由运营者跑 `launchctl`，
 * 这个模块不执行任何命令。
 */
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
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
  },
  {
    label: 'com.afkfactory.scheduler',
    plist: 'com.afkfactory.scheduler.plist',
    script: 'run-scheduler.sh',
    log: 'scheduler.log',
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

/** 运营者要手动跑的加载命令。 */
export function launchdCommands({ home, plistDir }) {
  const dir = plistDir || join(home, 'Library', 'LaunchAgents')
  return LAUNCHD_JOBS.map((job) => `launchctl bootstrap gui/$(id -u) ${join(dir, job.plist)}`)
}

/**
 * 装两个任务，返回写过的文件和加载命令。
 * 只写文件，不调用 `launchctl`，避免装的时候就把调度器点起来。
 */
export async function installLaunchd({ home = homedir(), repoRoot, templateDir = TEMPLATE_DIR } = {}) {
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

  return { plists, scripts, logsDir, commands: launchdCommands({ home: homePath, plistDir }) }
}
