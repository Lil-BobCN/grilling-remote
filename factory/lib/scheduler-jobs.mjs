/**
 * 调度器的四个默认实现：叫拆票、建修复子票、读 PR head 的待答问题、
 * 读前一天合进主干的 PR。外部命令全部可注入，测试不跑真模型、不碰真 GitHub。
 *
 * 判断只看可检查的事实：父工单评论里的关口词、trail 的六列、PR 的
 * `mergedAt`。读不到就返回空，不猜。
 */
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAgentRunner, DECOMPOSE_TOOLS, GAP_TOOLS } from './agent-runner.mjs'
import { parseTrail } from './evidence.mjs'
import { latestGate } from './gate.mjs'
import { runGh, runHelper } from './helper.mjs'
import { ensureLabel, ensureSubIssue } from './issues.mjs'
import { logLine } from './log.mjs'
import { parseParentAcceptance } from './tickets.mjs'

const DEFAULT_AGENTS_DIR = fileURLToPath(new URL('../agents/', import.meta.url))
const QUEUED_LABEL = '状态:排队中'
const DECOMPOSE_GATES = ['提案：拆票', '点头：拆票']
const GATE_QUESTION = '问：'
const GATE_ANSWER = '答：'
const ANSWERED_RESULTS = new Set(['answered', 'parked'])
const RECOMMEND_PREFIX = '推荐：'
const MISSING_RECOMMEND = '未写推荐'
const TICKET_BRANCH_RE = /(?:^|\/)(?:ticket|issue)[-/](\d+)$/

function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

async function dirExists(path) {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/** 每天跑一次 `preview-sweep`，按 24 小时无提交且无访问、或满 7 天销毁预览。 */
export function createPreviewSweep({ run = null } = {}) {
  return async function previewSweep() {
    const output = await runHelper(['preview-sweep'], { run })
    return { ok: true, output: String(output || '').trim() }
  }
}

function parseJson(text, what) {
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`${what} 返回不是合法 JSON：${errorText(error)}`)
  }
}

/** 从票分支名取票号：`ticket/51`、`issue-51` 都认。 */
export function ticketFromBranch(ref) {
  const match = TICKET_BRANCH_RE.exec(String(ref || ''))
  return match ? Number(match[1]) : null
}

/**
 * 从 trail 里挑出还在等运营者答的 gate 行。
 *
 * 问的行 `decision` 以「问：」开头、`result=open`；答的行以「答：」开头，
 * `result` 是 `answered` 或 `parked`。答行按出现顺序配给最早的未答问题，
 * 配上的问题不再提醒。推荐答案写在「推荐：」后面，decision 和 why 都认。
 */
export function parseGateRows(text) {
  const pending = []
  for (const row of parseTrail(text)) {
    if (row.phase !== 'gate') continue
    const decision = String(row.decision || '').trim()
    const result = String(row.result || '').trim().toLowerCase()
    if (decision.startsWith(GATE_ANSWER) && ANSWERED_RESULTS.has(result)) {
      pending.shift()
      continue
    }
    if (result !== 'open' || !decision.startsWith(GATE_QUESTION)) continue
    const body = decision.slice(GATE_QUESTION.length).trim()
    let question = body
    let recommended = ''
    if (body.includes(RECOMMEND_PREFIX)) {
      const [left, right] = body.split(RECOMMEND_PREFIX)
      question = left
      recommended = right
    } else if (String(row.why || '').includes(RECOMMEND_PREFIX)) {
      recommended = String(row.why).split(RECOMMEND_PREFIX)[1]
    }
    question = question.trim().replace(/[；;，,。]+$/g, '')
    if (!question) continue
    pending.push({
      key: `${row.ts}:${question}`,
      question,
      recommended: (recommended || MISSING_RECOMMEND).trim().replace(/[；;，,。]+$/g, ''),
      created_at: row.ts,
    })
  }
  return pending
}

/**
 * 扫每个开放 PR 的 head，找到 `phase=gate result=open` 的行。
 *
 * @param {object} [options]
 * @param {Function} [options.run] 跑 gh 的函数，签名 `(args) => stdout`
 * @returns {(context: {owner: string, repo: string}) => Promise<Array<object>>}
 */
export function createNeedsAnswer({ run = runGh } = {}) {
  return async function needsAnswer({ owner, repo } = {}) {
    if (!owner || !repo) return []
    const pulls = parseJson(
      await run([
        'pr',
        'list',
        '--repo',
        `${owner}/${repo}`,
        '--state',
        'open',
        '--limit',
        '100',
        '--json',
        'number,headRefName,url',
      ]),
      'gh pr list',
    )
    const rows = []
    for (const pull of Array.isArray(pulls) ? pulls : []) {
      const ticket = ticketFromBranch(pull?.headRefName)
      if (!ticket) continue
      let text = ''
      try {
        text = await run([
          'api',
          '-H',
          'Accept: application/vnd.github.raw',
          `repos/${owner}/${repo}/contents/.audit/${ticket}.tsv?ref=${encodeURIComponent(String(pull.headRefName))}`,
        ])
      } catch {
        // PR head 没有 trail 文件，不算待答。
        continue
      }
      for (const row of parseGateRows(text)) {
        rows.push({
          ...row,
          key: `${pull.number}:${row.key}`,
          link: String(pull.url || ''),
          ticket,
        })
      }
    }
    return rows
  }
}

function localDayStart(now) {
  const date = now instanceof Date ? new Date(now.getTime()) : new Date(now)
  date.setHours(0, 0, 0, 0)
  return date
}

function localDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function marker(body, name) {
  return new RegExp(`<!--\\s*factory:${name}=([^\\s>]+)\\s*-->`).exec(String(body || ''))?.[1] || ''
}

function titleFallback(title) {
  return String(title || '')
    .replace(/^合并\s*#\d+\s*/, '')
    .replace(/^票\s*#\d+\s*/, '')
    .trim()
}

/**
 * 前一天当地 00:00 到 24:00 合进主干的 PR，组装成每日抽样条目。
 * 客户简称和需求名优先读 PR 正文的 `<!-- factory:customer=... -->`
 * 和 `<!-- factory:requirement=... -->`，读不到再从标题和分支兜底。
 * 没有合并不发。
 */
export function createListMergedYesterday({ run = runGh } = {}) {
  return async function listMergedYesterday({ now = new Date(), repos = [] } = {}) {
    const start = localDayStart(now)
    start.setDate(start.getDate() - 1)
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
    const date = localDate(start)
    const items = []

    for (const row of Array.isArray(repos) ? repos : []) {
      if (!row?.owner || !row?.repo) continue
      const pulls = parseJson(
        await run([
          'pr',
          'list',
          '--repo',
          `${row.owner}/${row.repo}`,
          '--state',
          'merged',
          '--limit',
          '200',
          '--json',
          'number,title,mergedAt,headRefName,body',
        ]),
        'gh pr list',
      )
      for (const pull of Array.isArray(pulls) ? pulls : []) {
        const mergedAt = Date.parse(pull?.mergedAt || '')
        if (!Number.isFinite(mergedAt) || mergedAt < start.getTime() || mergedAt >= end.getTime()) {
          continue
        }
        const requirement =
          marker(pull.body, 'requirement') || titleFallback(pull.title) || String(pull.headRefName || '')
        items.push({
          customer: marker(pull.body, 'customer') || row.shortName || '',
          requirement,
          pr: Number(pull.number),
          url: `https://github.com/${row.owner}/${row.repo}/pull/${pull.number}`,
          date,
          mergedAt,
        })
      }
    }

    return items.sort((left, right) => left.mergedAt - right.mergedAt)
  }
}

function decomposeBrief({ instructions, parent, spec }) {
  return [
    String(instructions || '').trim(),
    '',
    '## 这次拆票',
    '',
    `父工单：#${parent.number} ${parent.title || ''}`.trim(),
    '',
    '父工单正文：',
    '',
    String(parent.body || ''),
    '',
    'spec：',
    '',
    spec ? `#${spec.number || ''} ${spec.title || ''}\n\n${String(spec.body || '')}`.trim() : '（没有 spec）',
    '',
    '把 `提案：拆票` 写成父工单的一条评论。提案阶段只写评论，不建子票。',
  ].join('\n')
}

/**
 * 叫拆票 agent 跑一次。父工单最新关口已经是 `提案：拆票` 或 `点头：拆票`
 * 时不再重复跑；`AFK_DECOMPOSE_SKIP=0` 关掉这个幂等判断。
 */
export function createDecompose({
  runner,
  command = process.env.AFK_AGENT_COMMAND || 'claude',
  agentsDir,
  repoRoot = '',
  skip = !['0', 'false'].includes(String(process.env.AFK_DECOMPOSE_SKIP || '').toLowerCase()),
} = {}) {
  const agentRunner = runner || createAgentRunner({ command })
  const agents = agentsDir || DEFAULT_AGENTS_DIR
  return async function decompose({ owner, repo, parent, spec } = {}) {
    const gate = latestGate(parent?.comments || [])
    if (skip && gate && DECOMPOSE_GATES.includes(gate.kind)) {
      return { ok: true, skipped: 'already-proposed' }
    }
    const instructions = await readFile(join(agents, '拆票.md'), 'utf8')
    const preferred = repoRoot ? join(repoRoot, repo || '') : ''
    const cwd = preferred && (await dirExists(preferred)) ? preferred : process.cwd()
    const run = await agentRunner.run({
      name: `decompose-${parent?.number || 'parent'}`,
      cwd,
      allowedTools: DECOMPOSE_TOOLS,
      brief: decomposeBrief({ instructions, parent, spec }),
    })
    return { ok: Boolean(run?.ok), code: run?.code, skipped: null }
  }
}

function gapBrief({ instructions, owner, repo, parent, factoryDir }) {
  const cli = join(factoryDir, 'bin', 'gap.mjs')
  return [
    String(instructions || '').trim(),
    '',
    '## 这次补缺口',
    '',
    `父工单：#${parent?.number || ''} ${parent?.title || ''}`.trim(),
    `仓库：${owner}/${repo}`,
    `工厂命令用绝对路径（客户仓里没有 factory/）：node ${cli}`,
    '',
    '依次跑这两条，两条的 stdout/stderr 都会随这一跑写进调度器日志：',
    `1. node ${cli} apply-map --scratch <回传件>/.scratch/<需求名> --owner ${owner} --repo ${repo} --requirement <需求名> --parent <父工单链接>`,
    `2. node ${cli} propose --scratch <回传件>/.scratch/<需求名> --owner ${owner} --repo ${repo} --number <地图编号>`,
    '',
    '失败时把错误原样留在 stderr，不要吞掉；也不要手改回传件。',
  ].join('\n')
}

/**
 * 叫补缺口 agent 跑一次：从回传件建图，写 `提案：补缺口`。
 * `apply-map` 和 `propose` 的 stdout/stderr 原样进日志；失败返回 `ok:false`。
 */
export function createGapProposal({
  runner,
  command = process.env.AFK_AGENT_COMMAND || 'claude',
  agentsDir,
  repoRoot = '',
  log = logLine,
} = {}) {
  const agentRunner = runner || createAgentRunner({ command })
  const agents = agentsDir || DEFAULT_AGENTS_DIR
  const factoryDir = fileURLToPath(new URL('..', import.meta.url))
  return async function gapProposal({ owner, repo, parent } = {}) {
    const instructions = await readFile(join(agents, '补缺口.md'), 'utf8')
    const preferred = repoRoot ? join(repoRoot, repo || '') : ''
    const cwd = preferred && (await dirExists(preferred)) ? preferred : process.cwd()
    const run = await agentRunner.run({
      name: `gap-${parent?.number || 'parent'}`,
      cwd,
      allowedTools: GAP_TOOLS,
      brief: gapBrief({ instructions, owner, repo, parent, factoryDir }),
    })
    const result = {
      ok: Boolean(run?.ok),
      code: run?.code,
      stdout: String(run?.stdout || ''),
      stderr: String(run?.stderr || ''),
    }
    log({
      level: result.ok ? 'info' : 'error',
      msg: result.ok ? '补缺口提案跑完' : '补缺口提案失败',
      owner,
      repo,
      parent: parent?.number,
      stdout: result.stdout,
      stderr: result.stderr,
    })
    return result
  }
}

function firstSentence(text) {
  const body = String(text || '')
    .replace(/^\s*驳回：\s*/, '')
    .trim()
  const line = body.split(/\r?\n/).find((row) => row.trim()) || ''
  const cut = line.split(/[。！？!?]/).find((row) => row.trim()) || ''
  return cut.trim() || '按驳回修好'
}

function acceptanceBlock({ parentBody, rejectionText, title }) {
  const items = parseParentAcceptance(parentBody)
  const rejection = String(rejectionText)
  const named = items.filter((item) => {
    const bare = item.replace(/[。；;，,]+$/g, '')
    return bare && (rejection.includes(item) || rejection.includes(bare))
  })
  const chosen = named.length ? named : items
  if (!chosen.length) return `- [ ] ${title}`
  return chosen.map((item) => `- [ ] ${item}`).join('\n')
}

/**
 * 从运营者的 `驳回：` 评论建一张修复子票。
 * 标题取驳回原话第一句；只挂 `状态:排队中`，挂成父工单 sub-issue，不写 `## 阻塞`。
 * 同一父工单下已有同名子票时复用，不建第二张。
 */
export function createFixTicket({ gh } = {}) {
  return async function createFixTicket({ owner, repo, parent, rejection } = {}) {
    if (!gh) throw new Error('建修复子票需要注入 gh')
    const rejectionText = String(rejection?.body || rejection?.rejection || '')
    const title = firstSentence(rejectionText)
    const children = await gh.listSubIssues({ owner, repo, number: parent.number })
    const existing = (children || []).find((child) => String(child.title || '').trim() === title)
    if (existing) return { created: false, number: existing.number, title }

    const body = [
      '## 垂直切片',
      '',
      '按驳回修好',
      '',
      '## 验收条件',
      '',
      acceptanceBlock({ parentBody: parent.body, rejectionText, title }),
      '',
    ].join('\n')

    await ensureLabel(gh, { owner, repo, name: QUEUED_LABEL, color: 'fbca04', description: '轮到了，等点火' })
    const created = await gh.createIssue({ owner, repo, title, body, labels: [QUEUED_LABEL] })
    await ensureSubIssue(gh, { owner, repo, parent: parent.number, childId: created.id })
    return { created: true, number: created.number, title }
  }
}
