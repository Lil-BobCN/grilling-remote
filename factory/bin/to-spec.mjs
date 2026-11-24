#!/usr/bin/env node
/**
 * 手动触发一次 to-spec。调度器正常会自动跑；这个入口给控制台「重试」用。
 *
 *   node factory/bin/to-spec.mjs --owner <o> --repo <r> --parent <父工单号>
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseEnvFile } from '../lib/config.mjs'
import { createGithub } from '../lib/github.mjs'
import { createToSpec } from '../lib/scheduler-jobs.mjs'

function option(argv, name) {
  const index = argv.indexOf(name)
  if (index === -1) return ''
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`缺 ${name} 的值`)
  return value
}

async function githubToken() {
  const direct = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  if (direct) return direct
  const file = process.env.AFK_ENV_FILE || join(homedir(), '.afkfactory', 'env')
  try {
    return parseEnvFile(await readFile(file, 'utf8'), { file }).GITHUB_TOKEN || ''
  } catch (error) {
    if (error?.code === 'ENOENT') return ''
    throw error
  }
}

export async function run(argv = process.argv.slice(2), { gh, out = console.log } = {}) {
  const owner = option(argv, '--owner')
  const repo = option(argv, '--repo')
  const parentNumber = Number(option(argv, '--parent'))
  if (!owner || !repo || !Number.isInteger(parentNumber)) {
    throw new Error('用法：to-spec.mjs --owner <o> --repo <r> --parent <父工单号>')
  }
  let client = gh
  if (!client) {
    const token = await githubToken()
    if (!token) throw new Error('缺 GITHUB_TOKEN：进程环境和 ~/.afkfactory/env 都没有')
    client = createGithub({ token })
  }
  const parent = await client.getIssue({ owner, repo, number: parentNumber })
  const toSpec = createToSpec({
    gh: client,
    repoRoot: process.env.AFK_REPO_ROOT || join(homedir(), '.afkfactory', 'repos'),
    command: process.env.AFK_AGENT_COMMAND || 'claude',
  })
  const result = await toSpec({ owner, repo, parent })
  out(JSON.stringify(result))
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
