/**
 * 跑一轮测试调度器：只走 `scheduler.mjs --once`，点火、拆票、补缺口全部注入假实现。
 *
 * 主作业表、主锁目录、主调度日志都不碰；临时路径全在 stateDir 下。
 */
import { mkdir, rm } from 'node:fs/promises'
import { run as runScheduler } from '../../bin/scheduler.mjs'
import { simEnvPaths } from './seed.mjs'

/** 假动作：只记录调用，不建容器、不跑 Sandcastle、不建 PR、不叫真 agent。 */
export function createFakeActions() {
  const igniteCalls = []
  const decomposeCalls = []
  const gapCalls = []
  const toSpecCalls = []
  const pipelineCalls = []
  return {
    igniteCalls,
    decomposeCalls,
    gapCalls,
    toSpecCalls,
    pipelineCalls,
    async ignite({ owner, repo, parent, ticket }) {
      igniteCalls.push({
        owner,
        repo,
        parent: parent.number,
        ticket: ticket.number,
        action: 'ignite',
      })
      return { ok: true }
    },
    async decompose({ owner, repo, parent, spec }) {
      decomposeCalls.push({
        owner,
        repo,
        parent: parent.number,
        spec: spec?.number ?? null,
      })
      return { ok: true, skipped: 'sim' }
    },
    async gapProposal({ owner, repo, parent }) {
      gapCalls.push({ owner, repo, parent: parent.number })
      return { ok: true }
    },
    async toSpec({ owner, repo, parent, spec }) {
      toSpecCalls.push({
        owner,
        repo,
        parent: parent.number,
        spec: spec?.number ?? null,
      })
      return { ok: true, skipped: 'sim' }
    },
    async ticketPipeline({ owner, repo }) {
      pipelineCalls.push({ owner, repo })
      return null
    },
  }
}

export async function runSimRound({
  gh,
  owner,
  repo,
  customersPath,
  stateDir,
  notifier,
  actions = createFakeActions(),
  clock = () => new Date(),
}) {
  const paths = simEnvPaths(stateDir)
  await mkdir(paths.lockDir, { recursive: true })
  await mkdir(paths.repoRoot, { recursive: true })
  await rm(paths.jobsFile, { force: true })
  await rm(paths.runLog, { force: true })

  const lines = []
  const report = await runScheduler(
    ['--once', '--customers', customersPath, '--owner', owner],
    {
      gh,
      notifier,
      ignite: actions.ignite,
      decompose: actions.decompose,
      gapProposal: actions.gapProposal,
      toSpec: actions.toSpec,
      ticketPipeline: actions.ticketPipeline,
      out: (line) => lines.push(JSON.parse(line)),
      clock,
      jobsFile: paths.jobsFile,
      lockDir: paths.lockDir,
      repoRoot: paths.repoRoot,
      runLog: paths.runLog,
      config: {
        needsAnswer: async () => [],
        listMergedYesterday: async () => [],
        previewSweep: async () => ({ skipped: 'sim' }),
        log: () => {},
      },
    },
  )
  return { lines, report, actions, paths }
}
