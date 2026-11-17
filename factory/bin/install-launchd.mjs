#!/usr/bin/env node
/**
 * 把回传件拉取和调度器两个 launchd 任务装到运营者 Mac。
 *
 *   node factory/bin/install-launchd.mjs [--repo-root <仓库路径>] [--home <家目录>]
 *
 * 只写 plist 和 wrapper，不执行 `launchctl`。装完按打印的命令手动加载。
 * 凭证从 `~/.afkfactory/env` 读，不写进 plist。
 */
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { installLaunchd } from '../lib/launchd.mjs'

function option(argv, name, fallback) {
  const index = argv.indexOf(name)
  if (index === -1) return fallback
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`缺 ${name} 的值`)
  return value
}

export async function run(argv = process.argv.slice(2), { home = homedir(), out = console.log } = {}) {
  const defaultRepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const repoRoot = resolve(option(argv, '--repo-root', defaultRepoRoot))
  const result = await installLaunchd({ home: option(argv, '--home', home), repoRoot })

  for (const file of result.plists) out(`写入 ${file}`)
  for (const file of result.scripts) out(`写入 ${file}`)
  out(`日志目录 ${result.logsDir}`)
  out('')
  out('确认 ~/.afkfactory/env 里有 AFK_SERVER、AFK_SSH_KEY、GITHUB_OWNER、GITHUB_TOKEN，然后加载：')
  for (const command of result.commands) out(command)
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
