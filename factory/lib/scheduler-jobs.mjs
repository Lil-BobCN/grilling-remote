/**
 * 调度器的默认实现：叫 to-spec、叫拆票、建修复子票、读 PR head 的待答问题、
 * 读前一天合进主干的 PR。外部命令全部可注入，测试不跑真模型、不碰真 GitHub。
 *
 * 判断只看可检查的事实：父工单评论里的关口词、trail 的六列、PR 的
 * `mergedAt`。读不到就返回空，不猜。
 */
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseTicketsPayload } from '../../backend/lib/protocol.mjs'
import { createAgentRunner, DECOMPOSE_TOOLS, GAP_TOOLS } from './agent-runner.mjs'
import { parseTrail } from './evidence.mjs'
import { latestGate } from './gate.mjs'
import { runGh, runHelper } from './helper.mjs'
import { parentRequirement } from './ignition.mjs'
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

/** 最新一条 `驳回：` 评论全文；没有返回空串。 */
function latestRejectionText(comments = []) {
  for (let index = comments.length - 1; index >= 0; index -= 1) {
    const first = String(comments[index]?.body || '')
      .replace(/^﻿/, '')
      .trimStart()
      .split(/\r?\n/)[0]
      .trim()
    if (first.startsWith('驳回：')) return String(comments[index].body || '')
  }
  return ''
}

/** 重跑时把驳回理由原样递给 agent；没有驳回就不加这一节。 */
function rejectionSection(comments = []) {
  const text = latestRejectionText(comments)
  return text ? ['', '## 这次驳回的理由', '', text] : []
}

/** 子票关联要移出父工单才清得掉，只关闭不清关联；给运营者可复制的命令。 */
function removeSubIssuesAdvice({ owner, repo, parent, numbers = [] }) {
  const list = numbers.map((number) => `#${number}`).join('、')
  const command = `gh issue edit ${parent?.number ?? '<父工单号>'} --repo ${owner || '<owner>'}/${repo || '<repo>'} --remove-sub-issue ${numbers.join(',')}`
  return {
    list,
    command,
    text: `只关闭不够，要移出父工单的子票关联：${command}。移出后重跑拆票作业。`,
  }
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

/** 去掉标题带「运营者」或「工作台 bot」的段落，这些段落不是给拆票 agent 的。 */
function agentFacingInstructions(text) {
  const lines = String(text || '').split('\n')
  const kept = []
  let skipping = false
  for (const line of lines) {
    const heading = /^##\s+(.+)$/.exec(line)
    if (heading) {
      skipping = /运营者|工作台 bot/.test(heading[1])
    }
    if (!skipping) kept.push(line)
  }
  return kept.join('\n').trim()
}

function decomposeBrief({ instructions, parent, spec, factoryDir }) {
  const cli = join(factoryDir, 'bin', 'tickets.mjs')
  return [
    agentFacingInstructions(instructions),
    '',
    '## 这次拆票',
    '',
    `父工单：#${parent.number} ${parent.title || ''}`.trim(),
    `工厂命令用绝对路径（客户仓里没有 factory/）：node ${cli} proposal --seams <接缝文件> --tickets <票文件>`,
    ...rejectionSection(parent?.comments),
    '',
    '父工单正文：',
    '',
    String(parent.body || ''),
    '',
    'spec：',
    '',
    spec ? `#${spec.number || ''} ${spec.title || ''}\n\n${String(spec.body || '')}`.trim() : '（没有 spec）',
    '',
    '把 `提案：拆票` 写成父工单的一条评论（`gh issue comment <父工单号> --body-file <提案文件>`）。',
    '提案阶段只写这一条评论，不建任何子票。',
    '不要运行建票命令（`tickets.mjs` 的 `create`、`point` 子命令），也不要运行 `gh issue create`。点头后的建票由运营者在控制台执行，不在这一跑里做。',
  ].join('\n')
}

/**
 * 读父工单最新关口，确认它是 `提案：拆票`，并且末尾票单 marker 能解析。
 * 没接 gh、读评论失败、最新关口不是提案、marker 缺失、票单为空都算失败，带原因返回。
 */
async function readLatestProposal({ gh, owner, repo, parent }) {
  if (!gh) return { ok: false, reason: '拆票 job 没有 GitHub 客户端，读不到提案评论' }
  let comments
  try {
    comments = await gh.listComments({ owner, repo, number: parent?.number })
  } catch (error) {
    return { ok: false, reason: `读提案评论失败：${errorText(error)}` }
  }
  const gate = latestGate(Array.isArray(comments) ? comments : [])
  if (gate?.kind !== '提案：拆票') {
    return { ok: false, reason: `最新关口不是「提案：拆票」：${gate?.kind || '没有关口'}` }
  }
  const tickets = parseTicketsPayload(gate.body)
  if (!Array.isArray(tickets)) {
    return { ok: false, reason: '提案缺票单 marker 或票单解析失败' }
  }
  if (!tickets.length) return { ok: false, reason: '提案票单是空的' }
  return { ok: true, tickets }
}

/**
 * 读父工单当前子票号。客户端没有 listSubIssues 或读取失败都算失败，不猜。
 */
async function listChildNumbers({ gh, owner, repo, parent }) {
  if (!gh || typeof gh.listSubIssues !== 'function') {
    return {
      ok: false,
      reason: '拆票 job 的 GitHub 客户端不支持 listSubIssues，读不到父工单子票',
    }
  }
  try {
    const children = await gh.listSubIssues({ owner, repo, number: parent?.number })
    return {
      ok: true,
      numbers: (Array.isArray(children) ? children : [])
        .map((row) => Number(row?.number))
        .filter((number) => Number.isFinite(number)),
    }
  } catch (error) {
    return { ok: false, reason: `读父工单子票失败：${errorText(error)}` }
  }
}

/**
 * 叫拆票 agent 跑一次。父工单最新关口已经是 `提案：拆票` 或 `点头：拆票`
 * 时不再重复跑；`AFK_DECOMPOSE_SKIP=0` 关掉这个幂等判断。
 *
 * 跑完读父工单最新评论，用 protocol.parseTicketsPayload 校验提案票单。
 * 缺 marker、票单解不开或最新关口不是 `提案：拆票`，这次作业算失败，
 * 调度器按 attempt 退避重跑。已有提案但票单读不出来时也不跳过，直接重跑。
 * 校验要读 GitHub，装配时必须传 `gh`；没传时作业判失败，不假装成功。
 *
 * 提案阶段不允许建子票：跑 agent 前后各读一次父工单子票号，多出子票就
 * 判失败，在父工单写一条说明评论，给出移出子票关联的命令，移出后重跑。
 */
export function createDecompose({
  runner,
  command = process.env.AFK_AGENT_COMMAND || 'claude',
  agentsDir,
  repoRoot = '',
  gh = null,
  skip = !['0', 'false'].includes(String(process.env.AFK_DECOMPOSE_SKIP || '').toLowerCase()),
} = {}) {
  const agentRunner = runner || createAgentRunner({ command })
  const agents = agentsDir || DEFAULT_AGENTS_DIR
  const factoryDir = fileURLToPath(new URL('..', import.meta.url))
  return async function decompose({ owner, repo, parent, spec } = {}) {
    const gate = latestGate(parent?.comments || [])
    if (skip && gate && DECOMPOSE_GATES.includes(gate.kind)) {
      // 点头说明票已经建过，不再拿 marker 判失败，免得建票后重出一份提案。
      if (gate.kind === '点头：拆票') return { ok: true, skipped: 'already-proposed' }
      // 提案还在，但子票已经有了：跳过会把这件事盖掉，判失败让运营者处理。
      const children = await listChildNumbers({ gh, owner, repo, parent })
      if (!children.ok) return { ok: false, code: null, skipped: null, reason: children.reason }
      if (children.numbers.length) {
        const advice = removeSubIssuesAdvice({
          owner,
          repo,
          parent,
          numbers: children.numbers,
        })
        return {
          ok: false,
          code: null,
          skipped: null,
          reason: `最新关口是「提案：拆票」，父工单已有子票：${advice.list}。提案阶段只出评论，跳过会掩盖这些票。${advice.text}`,
        }
      }
      const existing = parseTicketsPayload(gate.body)
      if (Array.isArray(existing) && existing.length) {
        return { ok: true, skipped: 'already-proposed' }
      }
      // 已有提案但票单读不出来：不跳过，下面的重跑会出一条新提案。
    }
    const before = await listChildNumbers({ gh, owner, repo, parent })
    if (!before.ok) return { ok: false, code: null, skipped: null, reason: before.reason }
    const instructions = await readFile(join(agents, '拆票.md'), 'utf8')
    const preferred = repoRoot ? join(repoRoot, repo || '') : ''
    const cwd = preferred && (await dirExists(preferred)) ? preferred : process.cwd()
    const run = await agentRunner.run({
      name: `decompose-${parent?.number || 'parent'}`,
      cwd,
      allowedTools: DECOMPOSE_TOOLS,
      brief: decomposeBrief({ instructions, parent, spec, factoryDir }),
    })
    const after = await listChildNumbers({ gh, owner, repo, parent })
    if (!after.ok) {
      return {
        ok: false,
        code: run?.code,
        skipped: null,
        reason: after.reason,
        stderr: String(run?.stderr || ''),
      }
    }
    const beforeNumbers = new Set(before.numbers)
    const created = after.numbers.filter((number) => !beforeNumbers.has(number))
    if (created.length) {
      const advice = removeSubIssuesAdvice({ owner, repo, parent, numbers: created })
      const reason = `拆票 agent 在提案阶段建了子票：${advice.list}。提案阶段只出评论，子票应由运营者点头后建。${advice.text}`
      let commentError = ''
      try {
        await gh.createComment({
          owner,
          repo,
          number: parent.number,
          body: [
            `拆票 agent 在提案阶段建了子票：${advice.list}。`,
            '',
            '提案阶段只出评论，子票应由运营者点头后建。只关闭不够，要移出父工单的子票关联：',
            '',
            advice.command,
            '',
            '移出后重跑拆票作业。',
          ].join('\n'),
        })
      } catch (error) {
        commentError = errorText(error)
      }
      return {
        ok: false,
        code: run?.code,
        skipped: null,
        reason: commentError ? `${reason}父工单写说明评论也失败：${commentError}` : reason,
        created,
        stderr: String(run?.stderr || ''),
      }
    }
    if (!run?.ok) {
      return {
        ok: false,
        code: run?.code,
        skipped: null,
        reason: '拆票 agent 失败',
        stderr: String(run?.stderr || ''),
      }
    }
    const proposal = await readLatestProposal({ gh, owner, repo, parent })
    if (!proposal.ok) {
      return { ok: false, code: run?.code, skipped: null, reason: proposal.reason }
    }
    return { ok: true, code: run?.code, skipped: null, ticketCount: proposal.tickets.length }
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
    ...rejectionSection(parent?.comments),
    '',
    '依次跑这两条，两条的 stdout/stderr 都会随这一跑写进调度器日志：',
    `1. node ${cli} apply-map --scratch <回传件>/work/.scratch/<需求名> --owner ${owner} --repo ${repo} --requirement <需求名> --parent <父工单链接>`,
    `2. node ${cli} propose --scratch <回传件>/work/.scratch/<需求名> --owner ${owner} --repo ${repo} --number <地图编号>`,
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

function issueHasLabel(issue, name) {
  return (issue?.labels || []).some((label) => (typeof label === 'string' ? label : label?.name) === name)
}

function specIssueFor(issues, requirement) {
  return (
    (issues || []).find(
      (issue) =>
        issueHasLabel(issue, 'ready-for-agent') &&
        requirement &&
        (String(issue.title || '').includes(requirement) ||
          String(issue.body || '').includes(requirement)),
    ) || null
  )
}

function toSpecBrief({ instructions, parent, owner, repo }) {
  return [
    String(instructions || '').trim(),
    '',
    '## 这次 to-spec',
    '',
    `父工单：#${parent?.number || ''} ${parent?.title || ''}`.trim(),
    `客户仓：${owner}/${repo}`,
    `用 gh 发 spec issue 时必须带 --repo ${owner}/${repo}。`,
    '',
    '父工单正文：',
    '',
    String(parent?.body || ''),
  ].join('\n')
}

async function readParentGate({ gh, owner, repo, parent }) {
  if (!gh || typeof gh.listComments !== 'function') {
    return { ok: false, reason: 'to-spec job 的 GitHub 客户端不支持 listComments，读不到父工单评论' }
  }
  try {
    const comments = await gh.listComments({ owner, repo, number: parent?.number })
    return { ok: true, gate: latestGate(Array.isArray(comments) ? comments : []) }
  } catch (error) {
    return { ok: false, reason: `读父工单评论失败：${errorText(error)}` }
  }
}

/** 发布后发现父工单已解锁：关闭 spec 并留一条作废评论。 */
async function discardSpec({ gh, owner, repo, spec }) {
  if (!gh || typeof gh.createComment !== 'function' || typeof gh.closeIssue !== 'function') {
    return { ok: false, reason: 'GitHub 客户端不支持关闭 spec' }
  }
  try {
    await gh.createComment({ owner, repo, number: spec.number, body: '作废：已解锁' })
    await gh.closeIssue({ owner, repo, number: spec.number, stateReason: 'not_planned' })
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: errorText(error) }
  }
}

/**
 * 调度器自动跑 to-spec：没有 spec 时叫 agent 生成并发布。
 * 先查已有 spec，已有就跳过；跑完重读父工单最新关口，不是 `点头：补缺口`
 * 就把新 spec 关掉并判失败；最后查标题、标签和需求名。
 * 读不到 GitHub 或 agent 没产出都返回原因，调度器按 attempt 退避。
 */
export function createToSpec({
  runner,
  command = process.env.AFK_AGENT_COMMAND || 'claude',
  agentsDir,
  repoRoot = '',
  gh = null,
} = {}) {
  const agentRunner = runner || createAgentRunner({ command })
  const agents = agentsDir || DEFAULT_AGENTS_DIR
  return async function toSpec({ owner, repo, parent, spec = null } = {}) {
    if (spec) return { ok: true, skipped: 'spec-exists', number: spec.number }
    if (!gh || typeof gh.listIssues !== 'function') {
      return { ok: false, reason: 'to-spec job 没有 GitHub 客户端，读不到已有 spec' }
    }
    const requirement =
      parentRequirement(parent?.body) || parent?.requirement || parent?.title || ''
    let issues
    try {
      issues = await gh.listIssues({ owner, repo, state: 'open' })
    } catch (error) {
      return { ok: false, reason: `读 issue 列表失败：${errorText(error)}` }
    }
    const existing = specIssueFor(issues, requirement)
    if (existing) return { ok: true, skipped: 'spec-exists', number: existing.number }

    const instructions = await readFile(join(agents, 'to-spec.md'), 'utf8')
    const preferred = repoRoot ? join(repoRoot, repo || '') : ''
    const cwd = preferred && (await dirExists(preferred)) ? preferred : process.cwd()
    const run = await agentRunner.run({
      name: `to-spec-${parent?.number || 'parent'}`,
      cwd,
      allowedTools: GAP_TOOLS,
      brief: toSpecBrief({ instructions, parent, owner, repo }),
    })
    if (!run?.ok) {
      const detail = String(run?.stderr || run?.stdout || '').trim().slice(-500)
      return {
        ok: false,
        code: run?.code,
        reason: `to-spec agent 退出码 ${run?.code ?? 1}${detail ? `：${detail}` : ''}`,
      }
    }

    try {
      issues = await gh.listIssues({ owner, repo, state: 'open' })
    } catch (error) {
      return { ok: false, reason: `读 to-spec 结果失败：${errorText(error)}` }
    }
    const created = specIssueFor(issues, requirement)

    const parentGate = await readParentGate({ gh, owner, repo, parent })
    if (!parentGate.ok) {
      return { ok: false, code: run?.code, reason: parentGate.reason }
    }
    if (parentGate.gate?.kind !== '点头：补缺口') {
      const reason = '父工单已解锁，本次 spec 作废'
      if (!created) return { ok: false, code: run?.code, reason }
      const discarded = await discardSpec({ gh, owner, repo, spec: created })
      if (!discarded.ok) {
        return {
          ok: false,
          code: run?.code,
          reason: `${reason}；关闭 spec #${created.number} 失败：${discarded.reason}`,
          number: created.number,
        }
      }
      return { ok: false, code: run?.code, reason, number: created.number }
    }

    if (!created) {
      return { ok: false, reason: 'to-spec agent 没有产出挂 ready-for-agent 的 spec issue' }
    }
    return { ok: true, number: created.number, title: created.title }
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
