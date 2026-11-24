/**
 * 模拟环境的播种步骤。测试注入假 GitHub，runner 注入真 GitHub + 真 gap 命令。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { ensureLabel } from '../../lib/issues.mjs'
import { ensureMapIssues } from '../../lib/map-issues.mjs'
import { SIM_OWNER, SIM_REPO, buildParentBody, buildSpec } from './fixtures.mjs'

export const SIM_LABELS = [
  { name: '状态:已提交', color: 'ededed', description: '已建单，等技术闸门' },
  { name: '状态:排队中', color: 'fbca04', description: '轮到了，等点火' },
  { name: 'ready-for-agent', color: '0e8a16', description: '可以交给 agent' },
]

export function assertScratchRepo(repo, { force = false } = {}) {
  if (force) return true
  if (String(repo) === SIM_REPO) return true
  throw new Error(`只认模拟仓 ${SIM_REPO}，不删别的仓：${repo}。确实要用加 --force`)
}

export function simEnvPaths(stateDir) {
  return {
    stateDir,
    jobsFile: join(stateDir, 'jobs.json'),
    lockDir: join(stateDir, 'locks'),
    runLog: join(stateDir, 'runs.jsonl'),
    repoRoot: join(stateDir, 'repos'),
    notifierHome: join(stateDir, 'notifier'),
    customersPath: join(stateDir, 'customers.json'),
    inboxRoot: stateDir,
  }
}

export async function ensureSimLabels({ gh, owner = SIM_OWNER, repo = SIM_REPO }) {
  for (const label of SIM_LABELS) {
    await ensureLabel(gh, { owner, repo, ...label })
  }
}

export async function createSimParent({ gh, owner = SIM_OWNER, repo = SIM_REPO, def }) {
  return gh.createIssue({
    owner,
    repo,
    title: def.parentTitle,
    body: buildParentBody(def, { owner, repo }),
    labels: ['状态:已提交'],
  })
}

/** 换父工单状态标签：摘掉其它 `状态:*`，补上目标。 */
export async function setSimState({
  gh,
  owner = SIM_OWNER,
  repo = SIM_REPO,
  issue,
  state,
}) {
  const target = `状态:${state}`
  const current = await gh.getIssue({ owner, repo, number: issue.number })
  const names = (current.labels || []).map((row) => row.name || row)
  if (!names.includes(target)) {
    await ensureLabel(gh, { owner, repo, name: target, color: 'ededed' })
    await gh.addLabels({ owner, repo, number: issue.number, labels: [target] })
  }
  for (const name of names) {
    if (name.startsWith('状态:') && name !== target) {
      await gh.removeLabel({ owner, repo, number: issue.number, name })
    }
  }
  return target
}

export async function seedMapFromPackage({
  gh,
  owner = SIM_OWNER,
  repo = SIM_REPO,
  def,
  scratchDir,
  parentIssueUrl,
}) {
  return ensureMapIssues({
    gh,
    owner,
    repo,
    requirement: def.requirement,
    scratchDir,
    parentIssueUrl,
    mode: 'add',
  })
}

export async function closeMapDecisionTickets({
  gh,
  owner = SIM_OWNER,
  repo = SIM_REPO,
  mapIssueNumber,
}) {
  const children = await gh.listSubIssues({ owner, repo, number: mapIssueNumber })
  for (const child of children) {
    if (child.state === 'closed') continue
    await gh.closeIssue({ owner, repo, number: child.number, stateReason: 'completed' })
  }
  return children.map((child) => child.number)
}

export async function seedSpec({ gh, owner = SIM_OWNER, repo = SIM_REPO, def }) {
  const spec = buildSpec(def)
  return gh.createIssue({
    owner,
    repo,
    title: spec.title,
    body: spec.body,
    labels: ['ready-for-agent'],
  })
}

/** 模拟运营者点头拆票：写关口评论，子票由调用方另建。 */
export async function postSplitPoint({ gh, owner = SIM_OWNER, repo = SIM_REPO, parent }) {
  return gh.createComment({
    owner,
    repo,
    number: parent.number,
    body: '点头：拆票\n\n建了 1 张票。',
  })
}

export async function createQueuedChild({
  gh,
  owner = SIM_OWNER,
  repo = SIM_REPO,
  def,
  parent,
}) {
  const body = [
    '## 垂直切片',
    '',
    def.acceptance[0],
    '',
    '## 验收条件',
    '',
    `- [ ] ${def.acceptance[0]}`,
    '',
    '## 阻塞',
    '',
    '无',
  ].join('\n')
  const child = await gh.createIssue({
    owner,
    repo,
    title: `${def.parentTitle} 第一片`,
    body,
    labels: ['状态:排队中'],
  })
  await gh.addSubIssue({ owner, repo, number: parent.number, subIssueId: child.id })
  return child
}

export async function writeSimCustomers(path, { owner = SIM_OWNER, repo = SIM_REPO } = {}) {
  const rows = [
    {
      id: 'sim-customer',
      short_name: '模拟客户',
      status: 'active',
      repos: { [repo]: repo },
    },
  ]
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(rows, null, 2)}\n`, 'utf8')
  return rows
}

/**
 * 临时 notifier 配置：只有 `orca_bot` 开，邮件和推送都关，都在临时 NOTIFIER_HOME 下。
 * 主 config 不读也不改。
 */
export async function writeSimNotifierConfig(home, { command = '' } = {}) {
  const config = {
    channels: {
      email: {
        enabled: false,
        to: 'sim@example.invalid',
        from: 'sim@example.invalid',
        host: '127.0.0.1',
        port: 2525,
        timeout_seconds: 5,
      },
      push: { enabled: false, timeout_seconds: 5 },
      orca_bot: {
        enabled: true,
        bot: 'afk',
        timeout_seconds: 30,
        ...(command ? { command } : {}),
      },
    },
    log: { level: 'info' },
    retry: { attempts: 1, interval_seconds: 0 },
  }
  await mkdir(home, { recursive: true })
  await writeFile(join(home, 'config.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  return config
}
