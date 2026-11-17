#!/usr/bin/env node
/**
 * 调度器命令行。
 *
 *   node factory/bin/scheduler.mjs --once --customers customers.json --owner <owner>
 *   node factory/bin/scheduler.mjs --loop --customers customers.json --owner <owner>
 *   node factory/bin/scheduler.mjs --dry-run --customers customers.json --owner <owner>
 *
 * 默认接生产点火：调度器选中一张票后贴 `Sandcastle`、把父工单转 `开发中`，再跑
 * `createIgnite`（默认 runner 是 `createSandcastleRunner`，默认 PR 走 `gh pr create`）。
 * `--dry-run` 只读 GitHub，打印每张父工单会做什么，不点火、不改标签、不写评论。
 *
 * `--once` 跑一轮并把每张父工单的结论打印成一行 JSON：
 * `{repo, parent, decision, actions, reason}`。`--loop` 每 30 秒跑一轮。
 * 测试可以注入 `gh`、`notifier`、`ignite`、`runner`、`openPr` 和 `config`。
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createGithub } from '../lib/github.mjs'
import { runGh } from '../lib/helper.mjs'
import { createGhOpenPr, createIgnite } from '../lib/ignition.mjs'
import { createNotifier } from '../lib/notify.mjs'
import { createSandcastleRunner } from '../lib/sandcastle-runner.mjs'
import {
  createDecompose,
  createFixTicket as createFixTicketJob,
  createListMergedYesterday,
  createNeedsAnswer,
  createPreviewSweep,
} from '../lib/scheduler-jobs.mjs'
import {
  collectRepos,
  collectSnapshot,
  hasLabel,
  routeRepo,
  runLoop,
  runOnce,
} from '../lib/scheduler.mjs'

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

function previewDecision(actions) {
  if (actions.some((action) => action.type === 'createFixTicket')) return 'reject'
  if (actions.some((action) => action.type === 'ignite')) return 'develop'
  if (actions.some((action) => action.type === 'runDecompose')) return 'decompose'
  if (actions.some((action) => action.type === 'addLabel' && action.name === 'needs-info')) {
    return 'needs-info'
  }
  if (actions.some((action) => action.type === 'setState')) return 'advance'
  if (actions.some((action) => action.type === 'removeSandcastle')) return 'cleanup'
  return 'wait'
}

function stillSandcastle(ticket) {
  return (
    hasLabel(ticket, 'Sandcastle') &&
    ticket.state !== 'closed' &&
    !hasLabel(ticket, '状态:待验收')
  )
}

/** 只读预览：读快照、跑路由，打印结论，不执行任何动作。 */
async function preview({ gh, customers, owner, now, out, maxActive }) {
  const nowDate = now instanceof Date ? now : new Date(now)
  const repos = collectRepos({ gh, customers, owner })
  const snapshots = []
  for (const row of repos) {
    snapshots.push({
      row,
      snapshot: await collectSnapshot({ gh, owner: row.owner, repo: row.repo }),
    })
  }

  let activeCount = 0
  for (const { snapshot } of snapshots) {
    for (const parent of snapshot.parents) {
      for (const ticket of parent.subIssues) if (stillSandcastle(ticket)) activeCount += 1
    }
  }

  for (const { row, snapshot } of snapshots) {
    const routed = routeRepo({
      snapshot,
      now: nowDate,
      maxActive,
      activeCount,
      owner: row.owner,
      repo: row.repo,
    })
    activeCount = routed.activeCount
    for (const { parent, actions } of routed.decisions) {
      out(
        JSON.stringify({
          repo: row.fullName || row.repo,
          parent: parent.number,
          decision: previewDecision(actions),
          actions: actions.map((action) => action.type),
        }),
      )
    }
  }
}

export async function run(
  argv = process.argv.slice(2),
  {
    gh,
    notifier,
    ignite,
    decompose,
    createFixTicket,
    runner,
    openPr,
    out = console.log,
    clock,
    signal,
    runOnceImpl = runOnce,
    repoRoot: injectedRepoRoot,
    lockDir: injectedLockDir,
    ghRun: injectedGhRun,
    config: configOverrides = {},
  } = {},
) {
  const once = argv.includes('--once')
  const loop = argv.includes('--loop')
  const dryRun = argv.includes('--dry-run')
  if (!once && !loop && !dryRun) throw new Error('要 --once 或 --loop')

  const customersPath = option(argv, '--customers', process.env.CUSTOMERS_FILE || 'customers.json')
  const owner = option(argv, '--owner', process.env.GITHUB_OWNER || '')
  if (!owner) throw new Error('缺 --owner（或环境变量 GITHUB_OWNER）')

  const customers = JSON.parse(await readFile(customersPath, 'utf8'))
  const token = process.env.GITHUB_TOKEN || ''
  const client = gh || createGithub({ token })
  const notify = notifier || createNotifier({ home: process.env.NOTIFIER_HOME })
  const repoRoot =
    injectedRepoRoot ||
    process.env.AFK_REPO_ROOT ||
    join(homedir(), '.afkfactory', 'repos')
  const lockDir =
    injectedLockDir ||
    process.env.AFK_LOCK_DIR ||
    join(homedir(), '.grilling', 'factory', 'locks')
  const maxActive = Number(process.env.MAX_ACTIVE) || 5
  const timeoutMs = Number(process.env.AFK_IGNITE_TIMEOUT_MS) || 120000

  if (dryRun) {
    const now = clock ? clock() : new Date()
    await preview({ gh: client, customers, owner, now, out, maxActive })
    return { dryRun: true }
  }

  const config = {
    owner,
    lastSentDate: null,
    repoRoot,
    lockDir,
    maxActive,
    ...configOverrides,
    needsAnswer: configOverrides.needsAnswer ?? createNeedsAnswer({ run: injectedGhRun || runGh }),
    listMergedYesterday:
      configOverrides.listMergedYesterday ?? createListMergedYesterday({ run: injectedGhRun || runGh }),
    previewSweep: configOverrides.previewSweep ?? createPreviewSweep(),
  }

  const decomposeFn =
    decompose ||
    createDecompose({
      repoRoot,
      command: process.env.AFK_AGENT_COMMAND || 'claude',
    })
  const createFixTicketFn =
    createFixTicket || createFixTicketJob({ gh: client })

  const igniteFn =
    ignite ||
    createIgnite({
      config: {
        ...config,
        gh: client,
        owner,
        token,
        image: process.env.AFK_SANDCASTLE_IMAGE || '',
        timeoutMs,
      },
      runner:
        runner ||
        createSandcastleRunner({ home: process.env.AFK_SANDCASTLE_HOME, env: process.env }),
      openPr: openPr || createGhOpenPr({ token }),
      notifier: notify,
      clock,
    })

  const options = {
    gh: client,
    customers,
    notifier: notify,
    ignite: igniteFn,
    decompose: decomposeFn,
    createFixTicket: createFixTicketFn,
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
