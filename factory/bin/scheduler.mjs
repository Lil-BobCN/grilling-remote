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
 * 点火贴上 `Sandcastle` 后在后台跑，不占住调度轮次；`--once` 等它跑完再退出。
 * `--dry-run` 只读 GitHub，打印每张父工单会做什么，不点火、不改标签、不写评论。
 *
 * `--once` 跑一轮并把每张父工单的结论打印成一行 JSON：
 * `{repo, parent, decision, actions, reason, executed, errors}`。`--loop` 每 30 秒跑一轮，
 * 每轮把 `{ts, executed, errors}` 追加到 `AFK_SCHEDULER_LOG`（默认 `~/.afkfactory/scheduler/runs.jsonl`）。
 * 测试可以注入 `gh`、`notifier`、`ignite`、`runner`、`openPr` 和 `config`。
 */
import { appendFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createAgentRunner } from '../lib/agent-runner.mjs'
import { ConfigError, createCustomersReader, loadConfig } from '../lib/config.mjs'
import { resolveMaxFixRounds } from '../lib/evidence.mjs'
import { createGithub } from '../lib/github.mjs'
import { runGh } from '../lib/helper.mjs'
import { createGhOpenPr, createIgnite, parentOrder } from '../lib/ignition.mjs'
import { createRepoEnv } from '../lib/repo-env.mjs'
import { createJobStore, defaultJobsPath } from '../lib/job.mjs'
import { logLine } from '../lib/log.mjs'
import { createNotifier } from '../lib/notify.mjs'
import { createTicketPipeline } from '../lib/pipeline.mjs'
import { createSandcastleRunner } from '../lib/sandcastle-runner.mjs'
import { runFinish } from './finish.mjs'
import {
  createDecompose,
  createFixTicket as createFixTicketJob,
  createGapProposal,
  createListMergedYesterday,
  createNeedsAnswer,
  createPreviewSweep,
} from '../lib/scheduler-jobs.mjs'
import {
  collectBranchFacts,
  collectRepos,
  collectSnapshot,
  hasLabel,
  resolveTimeouts,
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
      const errors = (report.errors || []).filter(
        (error) => error.repo === row.repo && (!error.parent || error.parent === parent.parent),
      )
      lines.push({
        repo: row.fullName || row.repo,
        parent: parent.parent,
        decision: parent.decision,
        actions: parent.actions,
        reason: parent.reason,
        executed: parent.executed,
        errors,
      })
    }
  }
  return lines
}

/** 每轮写进 JSONL 的一行：每张父工单的 executed，加这一轮的全部错误。 */
export function runSummary(report) {
  const executed = []
  for (const repo of report.repos || []) {
    for (const parent of repo.parents || []) {
      executed.push({
        repo: repo.fullName || repo.repo,
        parent: parent.parent,
        decision: parent.decision,
        executed: parent.executed,
      })
    }
    if (repo.pipeline) executed.push({ repo: repo.fullName || repo.repo, pipeline: repo.pipeline })
  }
  return { ts: report.now, executed, errors: report.errors || [] }
}

function previewDecision(actions) {
  if (actions.some((action) => action.type === 'finish')) return 'finish'
  if (actions.some((action) => action.type === 'createFixTicket')) return 'reject'
  if (actions.some((action) => action.type === 'ignite')) return 'develop'
  if (actions.some((action) => action.type === 'runGapProposal')) return 'gap-proposal'
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
async function preview({ gh, customers, owner, now, out, maxActive, repoRoot = '' }) {
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
    if (repoRoot) {
      await collectBranchFacts({ repoDir: join(repoRoot, row.repo), parents: snapshot.parents })
    }
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
    gapProposal,
    ticketPipeline,
    createFixTicket,
    finish,
    runner,
    openPr,
    push,
    out = console.log,
    clock,
    signal,
    runOnceImpl = runOnce,
    repoRoot: injectedRepoRoot,
    lockDir: injectedLockDir,
    runLog: injectedRunLog,
    ghRun: injectedGhRun,
    customers: injectedCustomers,
    readFile: injectedReadFile,
    jobsFile: injectedJobsFile,
    jobs: injectedJobs,
    intervalMs: injectedIntervalMs,
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

  const loadCustomers =
    injectedCustomers === undefined
      ? createCustomersReader(customersPath, { readFile: injectedReadFile })
      : typeof injectedCustomers === 'function'
        ? injectedCustomers
        : async () => injectedCustomers
  const customers = await loadCustomers()
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
  const runLogPath =
    injectedRunLog ||
    process.env.AFK_SCHEDULER_LOG ||
    join(homedir(), '.afkfactory', 'scheduler', 'runs.jsonl')
  const maxActive = Number(process.env.MAX_ACTIVE) || 5
  const timeoutMs = Number(process.env.AFK_IGNITE_TIMEOUT_MS) || 120000
  const maxFixRounds = resolveMaxFixRounds(process.env.AFK_MAX_FIX_ROUNDS)
  const jobsPath = injectedJobsFile || process.env.AFK_JOBS_FILE || defaultJobsPath()
  let jobs = injectedJobs || configOverrides.jobs || null
  if (!jobs && !dryRun) {
    jobs = createJobStore({ filePath: jobsPath })
    try {
      await jobs.load()
    } catch (error) {
      // 读坏了也要跑：这一轮按空表走，错误写进日志让人看到。
      const write = configOverrides.log || ((fields) => console.error(JSON.stringify(fields)))
      write({
        level: 'error',
        msg: '作业表读不了，这一轮按空表跑',
        file: jobsPath,
        error: error.message,
      })
    }
  }

  if (dryRun) {
    const now = clock ? clock() : new Date()
    await preview({ gh: client, customers, owner, now, out, maxActive, repoRoot })
    return { dryRun: true }
  }

  const config = {
    owner,
    lastSentDate: null,
    repoRoot,
    lockDir,
    maxActive,
    jobs,
    runsLogPath: runLogPath,
    jobPolicy: configOverrides.jobPolicy ?? {
      maxAttempts: Number(process.env.AFK_JOB_MAX_ATTEMPTS) || undefined,
      backoffBaseMs: Number(process.env.AFK_JOB_BACKOFF_MS) || undefined,
    },
    stepTimeoutMs: Number(process.env.AFK_STEP_TIMEOUT_MS) || undefined,
    agentTimeoutMs: Number(process.env.AFK_AGENT_TIMEOUT_MS) || undefined,
    pipelineTimeoutMs: Number(process.env.AFK_PIPELINE_TIMEOUT_MS) || undefined,
    jobHeartbeatMs: Number(process.env.AFK_JOB_HEARTBEAT_MS) || undefined,
    roundTimeoutMs: Number(process.env.AFK_ROUND_TIMEOUT_MS) || undefined,
    watchdogIntervalMs: Number(process.env.AFK_HEARTBEAT_MS) || undefined,
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
      gh: client,
      command: process.env.AFK_AGENT_COMMAND || 'claude',
    })
  const createFixTicketFn =
    createFixTicket || createFixTicketJob({ gh: client })
  const gapProposalFn =
    gapProposal ||
    createGapProposal({
      repoRoot,
      command: process.env.AFK_AGENT_COMMAND || 'claude',
      log: configOverrides.log || logLine,
    })
  const ticketPipelineFn =
    ticketPipeline ||
    createTicketPipeline({
      runner: createAgentRunner({
        command: process.env.AFK_AGENT_COMMAND || 'claude',
        model: process.env.AFK_AGENT_MODEL || process.env.ANTHROPIC_MODEL || '',
        timeoutMs: Number(process.env.AFK_AGENT_TIMEOUT_MS) || undefined,
      }),
      notifier: notify,
      log: configOverrides.log || logLine,
      maxFixRounds,
    })

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
        repoEnv:
          configOverrides.repoEnv ??
          (process.env.GITHUB_APP_ID ? createRepoEnv({ env: process.env }) : null),
      },
      runner:
        runner ||
        createSandcastleRunner({ home: process.env.AFK_SANDCASTLE_HOME, env: process.env }),
      openPr: openPr || createGhOpenPr({ token }),
      push,
      notifier: notify,
      clock,
    })

  // 收尾复用 bin/finish 的入口：收尾评审、PR、合主干、部署都不另写一套。
  const finishFn =
    finish ||
    (async ({ owner, repo, parent, reqBranch }) => {
      const order = parentOrder(parent?.body)
      const branch = reqBranch || (order ? `req/${order}` : '')
      if (!branch) return { ok: false, reason: 'no-order' }
      const finishJob = jobs
        ? jobs.rowsFor({ owner, repo, parent: parent.number }).find((row) => row.action === 'finish')
        : null
      const result = await runFinish(
        {
          owner,
          repo,
          parent: String(parent.number),
          'req-branch': branch,
          main: 'main',
          'repo-dir': join(repoRoot, repo),
        },
        { gh: client, notifier: notify, attempt: (finishJob?.attempt || 0) + 1 },
      )
      return { ...result.output, ok: result.exitCode === 0, exitCode: result.exitCode }
    })

  const options = {
    gh: client,
    customers,
    notifier: notify,
    ignite: igniteFn,
    decompose: decomposeFn,
    gapProposal: gapProposalFn,
    ticketPipeline: ticketPipelineFn,
    createFixTicket: createFixTicketFn,
    finish: finishFn,
    clock,
    config,
  }

  // 每轮都走读取器：mtime 没变就复用，变了就重读并重新校验。
  options.customers = loadCustomers

  if (once) {
    const report = await runOnceImpl(options)
    for (const line of parentLines(report)) out(JSON.stringify(line))
    // 没挂到任何父工单上的错误（作业表读写等）走 stderr，不污染 --once 的 JSONL。
    const orphans = report.errors.filter((error) => !error.repo)
    if (orphans.length) console.error(JSON.stringify({ errors: orphans }))
    // 点火在后台跑；--once 是手工跑一次，等它跑完再退出，进程结束不丢活。
    await Promise.allSettled([...(config.pendingIgnitions || [])])
    return report
  }

  await runLoop({
    intervalMs: injectedIntervalMs ?? (Number(process.env.SCHEDULER_INTERVAL_MS) || 30000),
    signal,
    run: runOnceImpl,
    onReport: async (report) => {
      await mkdir(dirname(runLogPath), { recursive: true })
      await appendFile(runLogPath, `${JSON.stringify(runSummary(report))}\n`, 'utf8')
    },
    ...options,
  })
  return null
}

/** 把 env 文件里缺的键补进进程环境，模型始终显式设成解析后的值。 */
function applyConfigEnv(loaded) {
  for (const [key, value] of Object.entries(loaded.values)) {
    if (process.env[key] === undefined || process.env[key] === '') {
      process.env[key] = String(value)
    }
  }
  if (loaded.model?.name) process.env.ANTHROPIC_MODEL = loaded.model.name
}

/**
 * 命令行启动：先读 env 文件并自检，再进调度循环。
 * 缺 token、helper、模型或 customers 形状不对时，在这里失败退出。
 */
export async function start(
  argv = process.argv.slice(2),
  { env = process.env, envFile, probeModel, readFile, ...runOptions } = {},
) {
  const loaded = await loadConfig({ env, envFile, probeModel, readFile })
  applyConfigEnv(loaded)
  const timeouts = resolveTimeouts(process.env)
  logLine({ level: 'info', msg: '启动配置', ...timeouts })
  const owner = option(argv, '--owner', process.env.GITHUB_OWNER || '')
  if (!owner) {
    const target = loaded.found ? `${loaded.envFile} 里也没有` : `${loaded.envFile} 不存在`
    throw new ConfigError(`缺 GITHUB_OWNER：--owner 和进程环境都没有，${target}`, {
      key: 'GITHUB_OWNER',
      file: loaded.envFile,
    })
  }
  return run(argv, { ...runOptions, readFile })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
