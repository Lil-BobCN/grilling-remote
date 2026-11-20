#!/usr/bin/env node
/**
 * 客户仓凭证入口。
 *
 *   node factory/bin/repo-env.mjs ensure --repo-dir <客户仓> --owner <o> --repo <r> [--image <镜像>]
 *   node factory/bin/repo-env.mjs check --repo-dir <客户仓>
 *
 * ensure 生成或补齐 `.sandcastle/.env`，按仓换 1 小时 GH_TOKEN。
 * check 只读，缺文件或键时退出码 1，错误里列清楚缺什么。
 */
import { fileURLToPath } from 'node:url'
import { checkRepoEnv, createRepoEnv } from '../lib/repo-env.mjs'

function option(argv, name) {
  const index = argv.indexOf(name)
  if (index === -1) return ''
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`缺 ${name} 的值`)
  return value
}

export async function run(argv = process.argv.slice(2), { out = console.log } = {}) {
  const [command, ...rest] = argv
  const repoDir = option(rest, '--repo-dir')
  if (!repoDir) throw new Error('缺 --repo-dir')

  if (command === 'check') {
    const values = await checkRepoEnv({ repoDir })
    out(JSON.stringify({ ok: true, keys: Object.keys(values).length }))
    return { ok: true }
  }

  if (command === 'ensure') {
    const owner = option(rest, '--owner')
    const repo = option(rest, '--repo')
    if (!owner || !repo) throw new Error('ensure 需要 --owner 和 --repo')
    const repoEnv = createRepoEnv()
    const result = await repoEnv.ensure({
      repoDir,
      owner,
      repo,
      image: option(rest, '--image'),
    })
    out(JSON.stringify({ ok: true, path: result.path, minted: result.minted }))
    return result
  }

  throw new Error('用法：repo-env.mjs ensure|check --repo-dir <客户仓>')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
