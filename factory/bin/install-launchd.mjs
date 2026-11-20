#!/usr/bin/env node
/**
 * 把回传件拉取和调度器两个 launchd 任务装到运营者 Mac。
 *
 *   node factory/bin/install-launchd.mjs [--repo-root <仓库路径>] [--home <家目录>]
 *   node factory/bin/install-launchd.mjs --verify [--home <家目录>]
 *
 * 安装会写入 plist 和 wrapper，再加载并检查任务真的起来了；退出码 0 才算装好。
 * `--verify` 只检查，不改文件。凭证从 `~/.afkfactory/env` 读，不写进 plist。
 */
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { installLaunchd, launchdFailures, verifyLaunchd } from '../lib/launchd.mjs'

function option(argv, name, fallback) {
  const index = argv.indexOf(name)
  if (index === -1) return fallback
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`缺 ${name} 的值`)
  return value
}

function describe(row) {
  const pid = row.pid ? ` pid ${row.pid}` : ''
  return `${row.loaded ? '已加载' : '未加载'} ${row.label}${pid}${row.reason ? `：${row.reason}` : ''}`
}

export async function run(
  argv = process.argv.slice(2),
  { home = homedir(), out = console.log, uid, run: runCommandImpl, statFile, retries, waitMs } = {},
) {
  const homePath = option(argv, '--home', home)
  if (argv.includes('--verify')) {
    const result = await verifyLaunchd({ home: homePath, uid, run: runCommandImpl, statFile, retries, waitMs })
    for (const row of result.jobs) out(describe(row))
    if (!result.ok) throw new Error(`常驻任务没装好：${launchdFailures(result.jobs)}`)
    return result
  }

  const defaultRepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const repoRoot = resolve(option(argv, '--repo-root', defaultRepoRoot))
  const result = await installLaunchd({
    home: homePath,
    repoRoot,
    uid,
    run: runCommandImpl,
    statFile,
    retries,
    waitMs,
  })

  for (const file of result.plists) out(`写入 ${file}`)
  for (const file of result.scripts) out(`写入 ${file}`)
  out(`日志目录 ${result.logsDir}`)
  for (const row of result.verify.jobs) out(describe(row))
  out('')
  out('确认 ~/.afkfactory/env 里有 AFK_SERVER、AFK_SSH_KEY、GITHUB_OWNER、GITHUB_TOKEN；改完重跑一次安装。')
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
