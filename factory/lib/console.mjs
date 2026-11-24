/**
 * 运营入口的待办发现和写回编排。
 *
 * 入口契约见 I-0211 的评论 C-1152：通知带 GitHub 链接和
 * owner/repo/ticket/kind；`console.mjs open` 找或建控制台终端，
 * 终端里显示题目、推荐和写回命令。写回只调现有 gap、tickets、gate CLI。
 */
import { execFile } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { latestGate } from './gate.mjs'
import { parseGateRows } from './scheduler-jobs.mjs'
import { isParentIssue, isSpecIssue, specForParent, toSpecWaiting } from './scheduler.mjs'

const execFileAsync = promisify(execFile)

export const KINDS = ['gap', 'split', 'gate', 'spec']

const KIND_LABEL = {
  gap: '补缺口',
  split: '拆票',
  gate: 'gate',
  spec: 'to-spec',
}

export async function runCommand(command, args, options = {}) {
  const result = await execFileAsync(command, args, {
    timeout: 120000,
    maxBuffer: 8 * 1024 * 1024,
    ...options,
  }).catch((error) => error)
  if (result.code) {
    const detail = String(result.stderr || result.stdout || result.message || '').trim()
    throw new Error(`${command} ${args.join(' ')} 失败：${detail}`)
  }
  return String(result.stdout || '').trim()
}

/** 从评论里判断这张 issue 上还挂着哪种提案。 */
export function proposalKind(comments = []) {
  const latest = latestGate(comments)
  if (!latest) return null
  if (latest.kind === '提案：补缺口') return 'gap'
  if (latest.kind === '提案：拆票') return 'split'
  return null
}

export function entryFromIssue({ owner, repo, issue, comments }) {
  const kind = proposalKind(comments)
  if (!kind) return null
  const latest = latestGate(comments)
  return {
    kind,
    owner,
    repo,
    ticket: issue.number,
    title: issue.title || '',
    url: issue.html_url || `https://github.com/${owner}/${repo}/issues/${issue.number}`,
    source: 'github',
    proposal: latest?.body || '',
  }
}

/** 读本地 `.audit/<票号>.tsv` 里还没答的 gate 题。 */
export async function gateWaiting({ repoDir }) {
  const dir = join(repoDir, '.audit')
  const files = await readdir(dir).catch((error) => {
    if (error?.code === 'ENOENT') return []
    throw error
  })
  const rows = []
  for (const file of files) {
    if (!file.endsWith('.tsv')) continue
    const ticket = Number(file.slice(0, -4))
    if (!Number.isInteger(ticket) || ticket <= 0) continue
    const text = await readFile(join(dir, file), 'utf8')
    for (const question of parseGateRows(text)) {
      rows.push({
        kind: 'gate',
        owner: '',
        repo: '',
        ticket,
        title: `gate #${ticket}`,
        question: question.question,
        recommended: question.recommended,
        source: 'trail',
        repoDir,
      })
    }
  }
  return rows
}

/**
 * 列出待办。GitHub 上的提案、点头后没 spec 的父工单，和客户仓 `.audit` 里的 gate 题都算。
 * `gh` 只需要 listIssues、listComments。
 */
export async function listWaiting({ gh, owner, repo, repoDir = '', kinds = KINDS } = {}) {
  const rows = []
  const wantsIssueKinds = gh && (kinds.includes('gap') || kinds.includes('split') || kinds.includes('spec'))
  if (wantsIssueKinds) {
    const issues = await gh.listIssues({ owner, repo, state: 'open' })
    const commentsByNumber = new Map()
    const commentsFor = async (number) => {
      if (!commentsByNumber.has(number)) {
        commentsByNumber.set(number, await gh.listComments({ owner, repo, number }))
      }
      return commentsByNumber.get(number)
    }
    const specs = kinds.includes('spec') ? issues.filter(isSpecIssue) : []
    for (const issue of issues) {
      const comments = await commentsFor(issue.number)
      if (kinds.includes('gap') || kinds.includes('split')) {
        const entry = entryFromIssue({ owner, repo, issue, comments })
        if (entry && kinds.includes(entry.kind)) rows.push(entry)
      }
      if (kinds.includes('spec') && isParentIssue(issue)) {
        const { spec } = specForParent({ parent: issue, specs })
        const gate = latestGate(comments)
        if (!toSpecWaiting({ parent: { ...issue, spec }, latestGate: gate })) continue
        rows.push({
          kind: 'spec',
          owner,
          repo,
          ticket: issue.number,
          title: issue.title || '',
          url: issue.html_url || `https://github.com/${owner}/${repo}/issues/${issue.number}`,
          source: 'github',
          since: gate?.comment?.created_at || '',
        })
      }
    }
  }
  if (repoDir && kinds.includes('gate')) {
    rows.push(...(await gateWaiting({ repoDir })))
  }
  return rows
}

function shellQuote(value) {
  const text = String(value ?? '')
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(text)) return text
  return `'${text.replace(/'/g, `'\\''`)}'`
}

export function showCommand({ node = process.execPath, consolePath, entry }) {
  const parts = [
    node,
    consolePath,
    'show',
    '--owner', entry.owner,
    '--repo', entry.repo,
    '--ticket', String(entry.ticket),
    '--kind', entry.kind,
  ]
  if (entry.repoDir) parts.push('--repo-dir', entry.repoDir)
  return parts.map(shellQuote).join(' ')
}

async function findWorktree({ entry, run }) {
  if (entry.worktree) return entry.worktree
  const output = await run('orca', ['reference', 'find', entry.url]).catch(() => '')
  const text = String(output || '').trim()
  if (!text) return ''
  try {
    const data = JSON.parse(text)
    return data.worktree || data.selector || data.id || (data.result && (data.result.worktree || data.result.selector)) || ''
  } catch {
    return text.split(/\s+/).find((part) => part.startsWith('id:')) || ''
  }
}

/**
 * 打开待办：找或建控制台终端，终端里跑 `console.mjs show`。
 * Orca 没开、没工作区、没终端都直接报可执行的错，不静默。
 */
export async function openWaiting({
  entry, run = runCommand, node = process.execPath, consolePath,
  worktree = '',
}) {
  const statusText = await run('orca', ['status', '--json']).catch((error) => {
    throw new Error(`Orca 没响应：${error.message}。先跑：orca open`)
  })
  let status
  try {
    status = JSON.parse(statusText)
  } catch {
    throw new Error(`orca status 不是 JSON：${statusText}`)
  }
  // Orca 1.4 返回 result.app.running，优先用它；旧的两种返回结构继续兼容。
  const running = status?.result?.app?.running ?? status?.result?.running ?? status.running
  if (!running) throw new Error('Orca 没在运行。先跑：orca open')

  const selector = worktree || await findWorktree({ entry, run })
  if (!selector) {
    throw new Error(
      `没找到控制台工作区。先建：orca worktree create --repo id:<仓库 id> --name "控制台 · ${entry.repo}" --no-parent`,
    )
  }

  const title = `${KIND_LABEL[entry.kind] || entry.kind} · ${entry.repo} #${entry.ticket}`
  const command = showCommand({ node, consolePath, entry })
  const output = await run('orca', [
    'terminal', 'create',
    '--worktree', selector,
    '--title', title,
    '--command', command,
  ])
  return { selector, title, command, output }
}

/**
 * 写回：只拼现有 CLI 的命令，不重写业务。
 * gap 的 `answer` 是答案数组或 `{answers, impacts}`；split 只认提案里的票单。
 */
export async function answerWaiting({
  entry, answer = [], question = '', result = 'answered',
  repoDir = '', commit = false, push = false, env,
  run = runCommand, node = process.execPath, repoRoot = '.',
}) {
  const bin = (name) => join(repoRoot, 'factory', 'bin', name)
  // 子进程 CLI 只读 process.env.GITHUB_TOKEN；入口读到的 token 要随 env 传下去。
  const runNode = (args) => (env ? run(node, args, { env }) : run(node, args))
  if (entry.kind === 'gap') {
    const payload = Array.isArray(answer) ? { answers: answer, impacts: [] } : answer
    return runNode([
      bin('gap.mjs'), 'point',
      '--owner', entry.owner,
      '--repo', entry.repo,
      '--number', String(entry.ticket),
      '--answers', JSON.stringify(payload),
    ])
  }
  if (entry.kind === 'split') {
    return runNode([
      bin('tickets.mjs'), 'create',
      '--owner', entry.owner,
      '--repo', entry.repo,
      '--parent', String(entry.ticket),
      '--from-proposal', '--point',
    ])
  }
  if (entry.kind === 'gate') {
    const dir = repoDir || entry.repoDir
    if (!dir) throw new Error('gate 写回缺 --repo-dir（客户仓路径）')
    const asked = question || entry.question
    if (!asked) throw new Error('gate 写回缺 --question')
    const args = [
      bin('gate.mjs'), 'answer',
      '--repo-dir', dir,
      '--ticket', String(entry.ticket),
      '--question', asked,
      '--answer', String(answer || ''),
      '--result', result,
    ]
    if (commit) args.push('--commit')
    if (push) args.push('--push')
    return runNode(args)
  }
  if (entry.kind === 'spec') {
    // 不在这里同步跑 agent：重置作业退避，调度器下一轮重新跑 to-spec。
    return runNode([
      bin('job-reset.mjs'),
      '--owner', entry.owner,
      '--repo', entry.repo,
      '--parent', String(entry.ticket),
      '--action', 'to-spec',
    ])
  }
  throw new Error(`不认识的待办类型：${entry.kind}`)
}

/** 在一组待办里按 owner/repo/ticket/kind 找一条。 */
export function pickWaiting(rows, { owner, repo, ticket, kind }) {
  return rows.find(
    (row) =>
      row.kind === kind &&
      Number(row.ticket) === Number(ticket) &&
      (!row.owner || row.owner === owner) &&
      (!row.repo || row.repo === repo),
  ) || null
}
