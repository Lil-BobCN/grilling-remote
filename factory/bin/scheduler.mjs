#!/usr/bin/env node
/**
 * 调度器命令行。
 *
 *   node factory/bin/scheduler.mjs --once --customers customers.json --owner <owner>
 *   node factory/bin/scheduler.mjs --loop --customers customers.json --owner <owner>
 *
 * `--once` 跑一轮并把每张父工单的结论打印成一行 JSON：
 * `{repo, parent, decision, actions, reason}`。`--loop` 每 30 秒跑一轮。
 * 默认用环境变量 `GITHUB_TOKEN` 建 GitHub 客户端；测试注入 `gh`、`notifier` 和点火函数。
 */
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { createGithub } from '../lib/github.mjs'
import { createNotifier } from '../lib/notify.mjs'
import { runLoop, runOnce } from '../lib/scheduler.mjs'

function option(argv, name, fallback) {
  const index = argv.indexOf(name)
  if (index === -1) return fallback
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`缺 ${name} 的值`)
  return value
}

function parentLines(report) {
  const lines = []
  for (const row of report.repos) {
    for (const parent of row.parents) {
      lines.push({
        repo: row.fullName || row.repo,
        parent: parent.parent,
        decision: parent.decision,
        actions: parent.actions,
        reason: parent.reason,
      })
    }
  }
  return lines
}

export async function run(
  argv = process.argv.slice(2),
  {
    gh,
    notifier,
    ignite,
    decompose,
    createFixTicket,
    out = console.log,
    clock,
    signal,
    runOnceImpl = runOnce,
  } = {},
) {
  const once = argv.includes('--once')
  const loop = argv.includes('--loop')
  if (!once && !loop) throw new Error('要 --once 或 --loop')

  const customersPath = option(argv, '--customers', process.env.CUSTOMERS_FILE || 'customers.json')
  const owner = option(argv, '--owner', process.env.GITHUB_OWNER || '')
  if (!owner) throw new Error('缺 --owner（或环境变量 GITHUB_OWNER）')

  const customers = JSON.parse(await readFile(customersPath, 'utf8'))
  const client = gh || createGithub({ token: process.env.GITHUB_TOKEN || '' })
  const notify = notifier || createNotifier({ home: process.env.NOTIFIER_HOME })
  const config = { owner, lastSentDate: null }

  const options = {
    gh: client,
    customers,
    notifier: notify,
    ignite,
    decompose,
    createFixTicket,
    clock,
    config,
  }

  if (once) {
    const report = await runOnceImpl(options)
    for (const line of parentLines(report)) out(JSON.stringify(line))
    return report
  }

  await runLoop({
    intervalMs: Number(process.env.SCHEDULER_INTERVAL_MS) || 30000,
    signal,
    run: runOnceImpl,
    ...options,
  })
  return null
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
