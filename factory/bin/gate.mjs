#!/usr/bin/env node
/**
 * gate 回答的命令行入口。控制台用。
 *
 *   node factory/bin/gate.mjs answer --repo-dir <客户仓> --ticket <票号> \
 *     --question '<题目>' [--answer '<运营者的答案>'] [--result answered|parked] \
 *     [--commit] [--push]
 *
 * 追加一行 `phase=gate`、`decision=答：<题目>`、`result=answered|parked`。
 * 表头由 `appendTrail` 维护，不手改。`--commit` 提交这一行，`--push` 推到票分支。
 */
import { pathToFileURL } from 'node:url'
import { appendTrail } from '../lib/evidence.mjs'
import { git } from '../lib/git.mjs'

export const RESULTS = ['answered', 'parked']

const USAGE =
  "用法：node factory/bin/gate.mjs answer --repo-dir <客户仓> --ticket <票号> --question '<题目>' [--answer '<答案>'] [--result answered|parked] [--commit] [--push]"

function parseArgs(argv) {
  const options = { flags: new Set() }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) throw new Error(`不认识的参数：${arg}`)
    const key = arg.slice(2)
    if (key === 'commit' || key === 'push') {
      options.flags.add(key)
      continue
    }
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`${arg} 后面要跟值`)
    options[key] = value
    index += 1
  }
  return options
}

export async function run(argv = process.argv.slice(2), { out = console.log, now } = {}) {
  const [command, ...rest] = argv
  if (command !== 'answer') throw new Error(USAGE)
  const options = parseArgs(rest)
  const repoDir = options['repo-dir'] || process.cwd()
  const ticket = Number(options.ticket)
  if (!Number.isInteger(ticket) || ticket <= 0) throw new Error('--ticket 必须是正整数')
  const question = String(options.question || '').trim()
  if (!question) throw new Error('--question 不能为空')
  const result = options.result || 'answered'
  if (!RESULTS.includes(result)) throw new Error('--result 只能是 answered 或 parked')

  const row = await appendTrail({
    repoDir,
    ticket,
    ts: now,
    phase: 'gate',
    decision: `答：${question}`,
    why: String(options.answer || '').trim(),
    evidence: '',
    result,
  })

  if (options.flags.has('commit')) {
    await git(repoDir, ['add', '--', `.audit/${ticket}.tsv`])
    await git(repoDir, ['commit', '-m', `FACTORY: 回答 gate #${ticket}`])
  }
  if (options.flags.has('push')) {
    await git(repoDir, ['push', 'origin', 'HEAD'], { timeoutMs: 120000 })
  }

  out(JSON.stringify(row))
  return row
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
