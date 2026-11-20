#!/usr/bin/env node
/**
 * 运营入口。待办从通知或 `list` 来，`open` 在 Orca 控制台终端里显示，
 * `answer` 调现有 gap、tickets、gate CLI 写回。
 *
 *   node factory/bin/console.mjs list --owner <o> --repo <r> [--repo-dir <客户仓>] [--json]
 *   node factory/bin/console.mjs show --owner <o> --repo <r> --ticket <n> --kind <gap|split|gate|spec> [--repo-dir <客户仓>]
 *   node factory/bin/console.mjs open --owner <o> --repo <r> --ticket <n> --kind <k> [--repo-dir <客户仓>] [--worktree <selector>]
 *   node factory/bin/console.mjs answer --kind <k> --owner <o> --repo <r> --ticket <n> \
 *     [--answer '<文本或 JSON>'] [--question '<gate 题>'] [--repo-dir <客户仓>] [--commit] [--push]
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  answerWaiting,
  listWaiting,
  openWaiting,
  pickWaiting,
  KINDS,
} from '../lib/console.mjs'
import { parseEnvFile } from '../lib/config.mjs'
import { createGithub } from '../lib/github.mjs'

function option(argv, name) {
  const index = argv.indexOf(name)
  if (index === -1) return undefined
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`缺 ${name} 的值`)
  return value
}

function required(argv, name) {
  const value = option(argv, name)
  if (!value) throw new Error(`缺 --${name}`)
  return value
}

function kindOf(argv) {
  const kind = required(argv, '--kind')
  if (!KINDS.includes(kind)) throw new Error(`--kind 只能是 ${KINDS.join('、')}`)
  return kind
}

function parseAnswer(text) {
  const raw = String(text ?? '').trim()
  if (!raw) return ''
  if (raw.startsWith('[') || raw.startsWith('{')) {
    try {
      return JSON.parse(raw)
    } catch {
      throw new Error('--answer 看起来是 JSON，但解析失败')
    }
  }
  return raw
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

async function clientFor() {
  const token = await githubToken()
  if (!token) throw new Error('缺 GITHUB_TOKEN：进程环境和 ~/.afkfactory/env 都没有')
  return createGithub({ token })
}

function printEntry(entry, out) {
  out(`${entry.kind} #${entry.ticket} ${entry.title}`)
  if (entry.url) out(`  ${entry.url}`)
  if (entry.question) out(`  题：${entry.question}`)
  if (entry.recommended) out(`  推荐：${entry.recommended}`)
}

export async function run(argv = process.argv.slice(2), { gh, out = console.log } = {}) {
  const [command, ...rest] = argv
  if (!command) throw new Error('缺命令：list、show、open、answer')

  const owner = required(rest, '--owner')
  const repo = required(rest, '--repo')

  if (command === 'list') {
    const repoDir = option(rest, '--repo-dir') || ''
    const client = gh || await clientFor()
    const rows = await listWaiting({ gh: client, owner, repo, repoDir })
    if (rest.includes('--json')) {
      for (const row of rows) out(JSON.stringify(row))
      return rows
    }
    if (rows.length === 0) {
      out('没有待办')
      return rows
    }
    for (const row of rows) printEntry(row, out)
    return rows
  }

  if (command === 'show') {
    const kind = kindOf(rest)
    const ticket = Number(required(rest, '--ticket'))
    const repoDir = option(rest, '--repo-dir') || ''
    const client = gh || await clientFor()
    const rows = await listWaiting({ gh: client, owner, repo, repoDir, kinds: [kind] })
    const entry = pickWaiting(rows, { owner, repo, ticket, kind })
    if (!entry) {
      throw new Error(`没有找到待办：${kind} #${ticket}（${owner}/${repo}）。先跑 console.mjs list 看当前待办。`)
    }
    printEntry(entry, out)
    if (entry.proposal) {
      out('')
      out(entry.proposal)
    }
    out('')
    if (entry.kind === 'gap') {
      out(`写回：node factory/bin/console.mjs answer --kind gap --owner ${owner} --repo ${repo} --ticket ${entry.ticket} --answer '[...]'`)
    } else if (entry.kind === 'split') {
      out(`写回：node factory/bin/console.mjs answer --kind split --owner ${owner} --repo ${repo} --ticket ${entry.ticket}`)
    } else if (entry.kind === 'gate') {
      out(`写回：node factory/bin/console.mjs answer --kind gate --owner ${owner} --repo ${repo} --ticket ${entry.ticket} --repo-dir <客户仓> --question '${entry.question}' --answer '<答案>'`)
    }
    return entry
  }

  if (command === 'open') {
    const kind = kindOf(rest)
    const ticket = Number(required(rest, '--ticket'))
    const repoDir = option(rest, '--repo-dir') || ''
    const client = gh || await clientFor()
    const rows = await listWaiting({ gh: client, owner, repo, repoDir, kinds: [kind] })
    const entry = pickWaiting(rows, { owner, repo, ticket, kind })
    if (!entry) {
      throw new Error(`没有找到待办：${kind} #${ticket}（${owner}/${repo}）。先跑 console.mjs list 看当前待办。`)
    }
    const result = await openWaiting({
      entry,
      consolePath: fileURLToPath(import.meta.url),
      worktree: option(rest, '--worktree') || '',
    })
    out(`终端已打开：${result.title}`)
    out(result.command)
    return result
  }

  if (command === 'answer') {
    const kind = kindOf(rest)
    const ticket = Number(required(rest, '--ticket'))
    const repoDir = option(rest, '--repo-dir') || ''
    const entry = {
      kind,
      owner,
      repo,
      ticket,
      repoDir,
      question: option(rest, '--question') || '',
    }
    const result = await answerWaiting({
      entry,
      answer: parseAnswer(option(rest, '--answer')),
      question: entry.question,
      repoDir,
      commit: rest.includes('--commit'),
      push: rest.includes('--push'),
    })
    out(result)
    return result
  }

  throw new Error(`未知命令：${command}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
