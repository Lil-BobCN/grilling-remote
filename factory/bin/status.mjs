#!/usr/bin/env node
/**
 * 状态汇总。控制台和运营者用。
 *
 *   node factory/bin/status.mjs --customers <customers.json> --owner <owner>
 *     [--repo-root <路径>] [--run-log <JSONL>] [--json]
 *
 * 每张父工单列：父工单状态、子票、每张子票的最新 trail 行、PR、是否正在跑，
 * 以及调度器最后一轮的错误。数据只从 GitHub、`.audit` 和调度器 JSONL 读。
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readTrail } from '../lib/evidence.mjs'
import { createGithub } from '../lib/github.mjs'
import { collectRepos, collectSnapshot, hasLabel, labelNames } from '../lib/scheduler.mjs'

function option(argv, name, fallback) {
  const index = argv.indexOf(name)
  if (index === -1) return fallback
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`缺 ${name} 的值`)
  return value
}

export function defaultRunLog() {
  return process.env.AFK_SCHEDULER_LOG || join(homedir(), '.afkfactory', 'scheduler', 'runs.jsonl')
}

function runLogPath(value) {
  return value || process.env.AFK_SCHEDULER_LOG || defaultRunLog()
}

async function readLastRun(path) {
  const text = await readFile(path, 'utf8').catch(() => '')
  const line = String(text).trimEnd().split(/\r?\n/).filter(Boolean).at(-1)
  if (!line) return null
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

function stateOf(parent) {
  const name = labelNames(parent).find((label) => label.startsWith('状态:'))
  return name ? name.slice('状态:'.length) : '无状态'
}

function pullState(pull) {
  if (pull?.merged || pull?.merged_at) return 'merged'
  return String(pull?.state || '未知')
}

function childLine(ticket) {
  const latest = ticket.latest
    ? `${ticket.latest.ts} ${ticket.latest.phase} ${ticket.latest.result}`
    : '无'
  const pull = ticket.pull ? `PR #${ticket.pull.number} ${pullState(ticket.pull)}` : 'PR 无'
  return `  子票 #${ticket.number} ${ticket.title}  ${ticket.state}  最新：${latest}  ${pull}  #${ticket.number} 正在跑：${ticket.running ? '是' : '否'}`
}

export async function run(
  argv = process.argv.slice(2),
  { gh, out = console.log, owner, repoRoot, runLog } = {},
) {
  const asJson = argv.includes('--json')
  const customersPath = option(argv, '--customers', process.env.CUSTOMERS_FILE || 'customers.json')
  const targetOwner = owner || option(argv, '--owner', process.env.GITHUB_OWNER || '')
  const root =
    repoRoot || option(argv, '--repo-root', process.env.AFK_REPO_ROOT || join(homedir(), '.afkfactory', 'repos'))
  const logPath = runLogPath(runLog || option(argv, '--run-log', ''))
  const customers = JSON.parse(await readFile(customersPath, 'utf8'))
  const client = gh || createGithub({ token: process.env.GITHUB_TOKEN || '' })
  const lastRun = await readLastRun(logPath)
  const errors = Array.isArray(lastRun?.errors) ? lastRun.errors : []

  const rows = []
  for (const entry of collectRepos({ gh: client, customers, owner: targetOwner })) {
    const snapshot = await collectSnapshot({ gh: client, owner: entry.owner, repo: entry.repo })
    const pulls = client.listPulls
      ? await client.listPulls({ owner: entry.owner, repo: entry.repo }).catch(() => [])
      : []
    const pullByHead = new Map((pulls || []).map((pull) => [String(pull?.head?.ref || ''), pull]))
    const repoDir = join(root, entry.repo)
    const repoErrors = errors.filter(
      (error) => error.repo === entry.repo || error.repo === entry.fullName,
    )

    for (const parent of snapshot.parents) {
      const tickets = []
      for (const ticket of parent.subIssues || []) {
        const trail = await readTrail({ repoDir, ticket: ticket.number }).catch(() => [])
        tickets.push({
          number: ticket.number,
          title: ticket.title,
          state: ticket.state,
          labels: labelNames(ticket),
          running:
            ticket.state !== 'closed' &&
            hasLabel(ticket, 'Sandcastle') &&
            !hasLabel(ticket, '状态:待验收'),
          latest: trail.at(-1) || null,
          pull: pullByHead.get(`ticket/${ticket.number}`) || null,
        })
      }
      rows.push({
        repo: entry.fullName,
        parent: { number: parent.number, title: parent.title, state: stateOf(parent) },
        tickets,
        lastError: repoErrors.at(-1)?.message || '',
      })
    }
  }

  if (asJson) {
    for (const row of rows) out(JSON.stringify(row))
    return rows
  }

  for (const row of rows) {
    out(`仓库 ${row.repo}`)
    out(`父工单 #${row.parent.number} ${row.parent.title}  状态:${row.parent.state}`)
    for (const ticket of row.tickets) out(childLine(ticket))
    out(`最后错误：${row.lastError || '无'}`)
  }
  return rows
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
