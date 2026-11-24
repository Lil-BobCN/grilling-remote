#!/usr/bin/env node
/**
 * I-0268 模拟环境 runner：scratch 仓 + 三张假父工单 + 测试调度器一轮。
 *
 * 用法（在仓库根跑）：
 *
 *   node factory/test/sim/run-sim.mjs            # 重置 scratch 仓并跑一轮
 *   node factory/test/sim/run-sim.mjs --cleanup  # 删 scratch 仓里的假 issue 和临时状态
 *
 * 默认仓 `Lil-BobCN/scratch-bot-sim`，私有，保留不删。守卫只删这个仓的 issue；
 * 换仓名必须加 `--force`。
 *
 * 环境都在 `factory/test/sim/.state/` 下：临时 customers.json、作业表、锁目录、
 * 调度日志、NOTIFIER_HOME 和假回传件。主作业表、主锁目录、主调度日志、主
 * notifier config 只做 mtime/size 元数据快照，用来证明没被改，不读内容。
 *
 * 调度器只跑一轮：`scheduler.mjs --once`。点火、拆票、补缺口、to-spec、流水线
 * 全部注入假实现；不建容器、不跑 Sandcastle、不建 PR、不叫真 agent。
 */
import { execFile } from 'node:child_process'
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { createGithub } from '../../lib/github.mjs'
import {
  collectRepos,
  collectSnapshot,
  latestSignal,
  stateOf,
} from '../../lib/scheduler.mjs'
import {
  SIM_OWNER,
  SIM_REPO,
  SIM_REQUIREMENTS,
  requirementByKey,
  writeInboxPackage,
} from './fixtures.mjs'
import {
  assertScratchRepo,
  closeMapDecisionTickets,
  createQueuedChild,
  createSimParent,
  ensureSimLabels,
  postSplitPoint,
  seedMapFromPackage,
  seedSpec,
  setSimState,
  simEnvPaths,
  writeSimCustomers,
  writeSimNotifierConfig,
} from './seed.mjs'
import { createFakeActions, runSimRound } from './round.mjs'

const execFileAsync = promisify(execFile)
const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, '..', '..', '..')
const GAP_CLI = join(REPO_ROOT, 'factory', 'bin', 'gap.mjs')
const STATE_ROOT = join(HERE, '.state')

function out(fields) {
  console.log(JSON.stringify(fields))
}

function parseArgs(argv) {
  const options = { cleanup: false, force: false, owner: '', repo: '' }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--cleanup') options.cleanup = true
    else if (arg === '--force') options.force = true
    else if (arg === '--owner') options.owner = argv[++index] || ''
    else if (arg === '--repo') options.repo = argv[++index] || ''
    else throw new Error(`不认识的参数：${arg}`)
  }
  return options
}

async function ghCli(args) {
  const result = await execFileAsync('gh', args, {
    maxBuffer: 16 * 1024 * 1024,
    timeout: 120000,
  })
  return String(result.stdout || '')
}

async function resolveOwner(options) {
  if (options.owner) return options.owner
  if (process.env.GITHUB_OWNER) return process.env.GITHUB_OWNER
  return (await ghCli(['api', 'user', '--jq', '.login'])).trim()
}

async function resolveToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN
  return (await ghCli(['auth', 'token'])).trim()
}

async function metaOf(path) {
  try {
    const info = await stat(path)
    return { exists: true, mtimeMs: Math.round(info.mtimeMs), size: info.size }
  } catch {
    return { exists: false }
  }
}

function sameMeta(before, after) {
  return (
    before.exists === after.exists &&
    before.mtimeMs === after.mtimeMs &&
    before.size === after.size
  )
}

async function snapshotMainPaths() {
  const paths = {
    jobs: join(homedir(), '.afkfactory', 'jobs.json'),
    lockDir: join(homedir(), '.grilling', 'factory', 'locks'),
    schedulerLog: join(homedir(), '.afkfactory', 'scheduler', 'runs.jsonl'),
    notifierConfig: join(homedir(), '.grilling', 'notifier', 'config.json'),
  }
  const snapshot = {}
  for (const [key, path] of Object.entries(paths)) snapshot[key] = await metaOf(path)
  return snapshot
}

/** 生产调度器是否在跑：只读进程列表，不碰它的作业表和锁。 */
async function mainSchedulerRunning() {
  try {
    const result = await execFileAsync('ps', ['-axo', 'command'], { maxBuffer: 1024 * 1024 })
    return String(result.stdout || '')
      .split('\n')
      .some((line) => line.includes('scheduler.mjs') && line.includes('--loop'))
  } catch {
    return false
  }
}

async function ensureRepo({ gh, owner, repo }) {
  try {
    const info = await gh.getRepo({ owner, repo })
    return { created: false, private: Boolean(info.private), url: info.html_url }
  } catch (error) {
    if (error?.status !== 404) throw error
  }
  await ghCli([
    'repo', 'create', `${owner}/${repo}`,
    '--private',
    '--add-readme',
    '--description', '模拟环境 scratch 仓：bot 传递人工点消息演练用，不接真实客户',
  ])
  // 新仓 API 有短暂延迟，等它能读到再建 issue。
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const info = await gh.getRepo({ owner, repo })
      return { created: true, private: Boolean(info.private), url: info.html_url }
    } catch (error) {
      if (error?.status !== 404) throw error
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }
  throw new Error(`建仓后 10 秒还读不到 ${owner}/${repo}`)
}

async function deleteAllIssues({ gh, owner, repo }) {
  const issues = await gh.listIssues({ owner, repo, state: 'all' })
  let deleted = 0
  for (const issue of issues) {
    await ghCli(['issue', 'delete', String(issue.number), '--repo', `${owner}/${repo}`, '--yes'])
    deleted += 1
  }
  return deleted
}

async function runGapCli(args, token) {
  const result = await execFileAsync(process.execPath, [GAP_CLI, ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env, GITHUB_TOKEN: token },
    maxBuffer: 16 * 1024 * 1024,
    timeout: 120000,
  })
  const lines = String(result.stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  return JSON.parse(lines.at(-1))
}

async function cleanup({ gh, owner, repo }) {
  let deleted = 0
  try {
    await gh.getRepo({ owner, repo })
    deleted = await deleteAllIssues({ gh, owner, repo })
  } catch (error) {
    if (error?.status !== 404) throw error
  }
  await rm(STATE_ROOT, { recursive: true, force: true })
  out({ step: 'cleanup', owner, repo, deleted, stateRemoved: true, repoKept: true })
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const owner = await resolveOwner(options)
  const repo = options.repo || SIM_REPO
  const token = await resolveToken()
  if (!token) throw new Error('没有 GitHub token：先 gh auth login 或设 GITHUB_TOKEN')
  const gh = createGithub({ token })

  assertScratchRepo(repo, { force: options.force })

  if (options.cleanup) {
    await cleanup({ gh, owner, repo })
    return
  }

  const mainBefore = await snapshotMainPaths()
  const repoInfo = await ensureRepo({ gh, owner, repo })
  out({ step: 'preflight', owner, repo, private: repoInfo.private, created: repoInfo.created, url: repoInfo.url })

  const deleted = await deleteAllIssues({ gh, owner, repo })
  out({ step: 'reset', deleted })

  await rm(STATE_ROOT, { recursive: true, force: true })
  const paths = simEnvPaths(STATE_ROOT)
  await mkdir(paths.lockDir, { recursive: true })
  await mkdir(paths.repoRoot, { recursive: true })

  await ensureSimLabels({ gh, owner, repo })
  out({ step: 'labels', names: ['状态:已提交', '状态:排队中', 'ready-for-agent'] })

  const parents = {}
  for (const def of SIM_REQUIREMENTS) {
    const issue = await createSimParent({ gh, owner, repo, def })
    parents[def.key] = issue
    out({ step: 'parent', key: def.key, number: issue.number, url: issue.html_url })
  }

  const packages = {}
  for (const def of SIM_REQUIREMENTS) {
    const parent = parents[def.key]
    packages[def.key] = await writeInboxPackage({
      root: paths.inboxRoot,
      def,
      owner,
      repo,
      issueUrl: parent.html_url,
    })
  }
  out({ step: 'inbox', root: paths.inboxRoot, count: SIM_REQUIREMENTS.length })

  const maps = {}
  for (const def of SIM_REQUIREMENTS) {
    const pkg = packages[def.key]
    const parent = parents[def.key]
    const result = await runGapCli(
      [
        'apply-map',
        '--scratch', pkg.scratchDir,
        '--owner', owner,
        '--repo', repo,
        '--requirement', def.requirement,
        '--parent', parent.html_url,
      ],
      token,
    )
    maps[def.key] = result
    out({
      step: 'apply-map',
      parent: parent.number,
      map: result.number,
      url: result.map,
      tickets: result.tickets.map((ticket) => ticket.number),
    })
    await closeMapDecisionTickets({
      gh,
      owner,
      repo,
      mapIssueNumber: result.number,
    })
  }

  for (const def of SIM_REQUIREMENTS) {
    const pkg = packages[def.key]
    const parent = parents[def.key]
    if (def.key === 'gap') continue
    const proposal = await runGapCli(
      [
        'propose',
        '--scratch', pkg.scratchDir,
        '--owner', owner,
        '--repo', repo,
        '--number', String(maps[def.key].number),
      ],
      token,
    )
    out({ step: 'propose', parent: parent.number, questions: proposal.questions.length })
    const point = await runGapCli(
      [
        'point',
        '--owner', owner,
        '--repo', repo,
        '--number', String(parent.number),
        '--answers', JSON.stringify({ answers: ['技术栈：Next.js + Postgres'], impacts: ['无'] }),
      ],
      token,
    )
    out({ step: 'point', parent: parent.number, posted: point.posted })
    await setSimState({ gh, owner, repo, issue: parent, state: '排队中' })
  }

  const specs = {}
  for (const def of SIM_REQUIREMENTS) {
    const spec = await seedSpec({ gh, owner, repo, def })
    specs[def.key] = spec
    out({ step: 'spec', key: def.key, parent: parents[def.key].number, number: spec.number, title: spec.title })
  }

  await postSplitPoint({ gh, owner, repo, parent: parents.ignite })
  const child = await createQueuedChild({
    gh,
    owner,
    repo,
    def: requirementByKey('ignite'),
    parent: parents.ignite,
  })
  out({ step: 'split-point', parent: parents.ignite.number, child: child.number })

  // GitHub 列表有短暂延迟：等三张父工单都能匹配到 spec、状态和关口再跑调度。
  const seedStarted = Date.now()
  let seedReady = false
  let lastSeen = null
  while (!seedReady && Date.now() - seedStarted < 30000) {
    const snapshot = await collectSnapshot({ gh, owner, repo })
    const byNumber = new Map(snapshot.parents.map((row) => [row.number, row]))
    const gap = byNumber.get(parents.gap.number)
    const split = byNumber.get(parents.split.number)
    const ignite = byNumber.get(parents.ignite.number)
    lastSeen = {
      gap: { spec: gap?.spec?.number ?? null, state: gap ? stateOf(gap) : null },
      split: {
        spec: split?.spec?.number ?? null,
        state: split ? stateOf(split) : null,
        children: split?.subIssues?.length ?? null,
        gate: split ? latestSignal(split.comments || [])?.kind ?? null : null,
      },
      ignite: {
        spec: ignite?.spec?.number ?? null,
        state: ignite ? stateOf(ignite) : null,
        children: ignite?.subIssues?.map((row) => row.number) ?? null,
        gate: ignite ? latestSignal(ignite.comments || [])?.kind ?? null : null,
      },
    }
    seedReady =
      Boolean(gap?.spec) &&
      Boolean(split?.spec) &&
      Boolean(ignite?.spec) &&
      stateOf(split) === '排队中' &&
      stateOf(ignite) === '排队中' &&
      (split?.subIssues || []).length === 0 &&
      (ignite?.subIssues || []).some((row) => row.number === child.number) &&
      latestSignal(split?.comments || [])?.kind === '点头：补缺口' &&
      latestSignal(ignite?.comments || [])?.kind === '点头：拆票'
    if (!seedReady) await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  if (!seedReady) {
    throw new Error(`播种后 30 秒还没准备好：${JSON.stringify(lastSeen)}`)
  }
  out({ step: 'seed-ready', waitMs: Date.now() - seedStarted })

  await writeSimCustomers(paths.customersPath, { owner, repo })
  await writeSimNotifierConfig(paths.notifierHome, { sender: 'bot:sim-notifier' })
  const customers = JSON.parse(await readFile(paths.customersPath, 'utf8'))
  const repos = collectRepos({ gh, customers, owner })
  if (repos.length !== 1 || repos[0].fullName !== `${owner}/${repo}`) {
    throw new Error(`临时 customers.json 应只扫到 ${owner}/${repo}，实际：${JSON.stringify(repos)}`)
  }
  out({ step: 'customers', path: paths.customersPath, repos: repos.length, fullName: repos[0].fullName })

  // 真 notifier 只认临时 NOTIFIER_HOME。这一轮用记录替身，不往外发；
  // orca_bot 的 chat 路径由 sim.test.mjs 用假 orca 命令验证。
  const events = []
  const notifier = {
    async send(event) {
      events.push(event)
      return { code: 0, stdout: '{"ok":true}' }
    },
  }
  const notifierHomeCheck = await execFileAsync(
    'python3',
    [
      '-c',
      'from notifier.config import load_config; c = load_config(); print(str(c.home))',
    ],
    { cwd: REPO_ROOT, env: { ...process.env, NOTIFIER_HOME: paths.notifierHome } },
  )
  const loadedHome = String(notifierHomeCheck.stdout || '').trim()
  if (loadedHome !== paths.notifierHome) {
    throw new Error(`测试 notifier 读的不是临时 home：${loadedHome}`)
  }

  const actions = createFakeActions()
  const round = await runSimRound({
    gh,
    owner,
    repo,
    customersPath: paths.customersPath,
    stateDir: STATE_ROOT,
    notifier,
    actions,
  })
  out({
    step: 'notifier',
    home: paths.notifierHome,
    loadedHome,
    isolated: true,
    mode: 'recording',
    events: events.length,
  })
  for (const line of round.lines) {
    out({
      step: 'round',
      repo: line.repo,
      parent: line.parent,
      decision: line.decision,
      actions: line.actions,
      reason: line.reason,
      errors: line.errors,
    })
  }

  const decisions = Object.fromEntries(
    round.lines.map((line) => [line.parent, line.decision]),
  )
  if (round.lines.length !== SIM_REQUIREMENTS.length) {
    throw new Error(`一轮应只输出三张父工单，实际 ${round.lines.length} 行`)
  }
  if (
    round.report.repos.length !== 1 ||
    round.report.repos[0].fullName !== `${owner}/${repo}`
  ) {
    throw new Error(`只该扫到 ${owner}/${repo}，实际：${JSON.stringify(round.report.repos.map((row) => row.fullName))}`)
  }
  const expected = {
    [parents.gap.number]: 'gap-proposal',
    [parents.split.number]: 'decompose',
    [parents.ignite.number]: 'develop',
  }
  for (const [parentNumber, decision] of Object.entries(expected)) {
    if (decisions[Number(parentNumber)] !== decision) {
      throw new Error(`父工单 #${parentNumber} 决策应为 ${decision}，实际 ${decisions[Number(parentNumber)]}`)
    }
  }
  if (actions.toSpecCalls.length !== 0) throw new Error('调度器不该跑 to-spec')
  if (actions.pipelineCalls.length !== 1) throw new Error('流水线应只跑一次')
  if (actions.gapCalls.length !== 1) throw new Error('补缺口应只跑一次')
  if (actions.decomposeCalls.length !== 1) throw new Error('拆票应只跑一次')
  if (actions.igniteCalls.length !== 1) throw new Error('点火应只跑一次')
  const igniteCall = actions.igniteCalls[0]
  if (
    igniteCall.owner !== owner ||
    igniteCall.repo !== repo ||
    igniteCall.parent !== parents.ignite.number ||
    igniteCall.ticket !== child.number ||
    igniteCall.action !== 'ignite'
  ) {
    throw new Error(`假 ignite 记录不对：${JSON.stringify(igniteCall)}`)
  }
  out({ step: 'fake-ignite', calls: actions.igniteCalls, sandcastle: false, containers: 0 })

  const pulls = await gh.listPulls({ owner, repo, state: 'all' })
  if (pulls.length !== 0) throw new Error(`scratch 仓不该有 PR，实际 ${pulls.length} 个`)
  out({ step: 'no-pull', pulls: 0 })

  const jobs = JSON.parse(await readFile(paths.jobsFile, 'utf8'))
  const igniteRow = Object.values(jobs.jobs).find((row) => row.action === 'ignite')
  if (!igniteRow || igniteRow.ticket !== child.number || igniteRow.stop !== '') {
    throw new Error(`临时作业表没有成功的点火行：${JSON.stringify(igniteRow)}`)
  }
  out({ step: 'jobs', path: paths.jobsFile, row: igniteRow })

  const lockFiles = (await readdir(paths.lockDir)).filter((name) => name.endsWith('.lock'))
  if (lockFiles.length !== 0) throw new Error(`临时锁目录还有残留锁：${lockFiles.join(', ')}`)
  out({ step: 'lock', dir: paths.lockDir, staleFiles: 0 })

  if (round.report.errors.length !== 0) {
    throw new Error(`调度轮次有错误：${JSON.stringify(round.report.errors)}`)
  }

  const mainAfter = await snapshotMainPaths()
  const unchanged = {}
  for (const key of Object.keys(mainBefore)) {
    unchanged[key] = sameMeta(mainBefore[key], mainAfter[key])
  }
  out({
    step: 'main-paths',
    unchanged,
    metadataOnly: true,
    mainSchedulerInvoked: false,
    mainSchedulerRunning: await mainSchedulerRunning(),
    note: '主作业表和主日志若变了，是生产调度器自己的活动；本次只写临时路径',
    snapshot: mainAfter,
  })

  out({
    step: 'summary',
    repo: repoInfo.url,
    parents: {
      gap: { number: parents.gap.number, url: parents.gap.html_url, decision: decisions[parents.gap.number], inbox: packages.gap.uploadDir },
      split: { number: parents.split.number, url: parents.split.html_url, decision: decisions[parents.split.number], inbox: packages.split.uploadDir },
      ignite: { number: parents.ignite.number, url: parents.ignite.html_url, decision: decisions[parents.ignite.number], inbox: packages.ignite.uploadDir },
    },
    maps: Object.fromEntries(
      SIM_REQUIREMENTS.map((def) => [def.key, maps[def.key].map]),
    ),
    specs: Object.fromEntries(
      SIM_REQUIREMENTS.map((def) => [def.key, specs[def.key].number]),
    ),
    child: child.number,
    fakeIgnite: igniteCall,
    jobs: paths.jobsFile,
    notifierHome: paths.notifierHome,
    stateDir: STATE_ROOT,
  })
  out({ step: 'ok', checks: 12 })
}

main().catch((error) => {
  out({ step: 'error', message: String(error?.message || error) })
  if (error?.stderr) out({ step: 'error-detail', stderr: String(error.stderr).trim().slice(-2000) })
  process.exit(1)
})
