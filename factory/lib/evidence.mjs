/**
 * 四样证据与合需求分支。
 *
 * trail store 在票分支的 `.audit/<票号>.tsv`，六列固定：
 * `ts phase decision why evidence result`。四样证据是：
 *
 * 1. `phase=verify result=pass`，evidence 里的截图或 trace 在仓库里存在；
 * 2. `phase=test result=pass`；
 * 3. `phase=review result=pass`，decision 分别含「标准」和 `spec`；
 * 4. 证据指向当前 head（trail 提交只改 `.audit/` 时，指向它前面的代码提交也算）。
 *
 * 证据不齐或过期，不合并。合并后必须在合并提交上重跑验证，失败就回滚。
 */
import { appendFile, mkdir, readFile, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { GitError, git, mergeNoFf } from './git.mjs'
import { ensureLabel } from './issues.mjs'
import { previewNeeded } from './preview.mjs'
import { progressLine } from './progress.mjs'

export const TRAIL_COLUMNS = ['ts', 'phase', 'decision', 'why', 'evidence', 'result']
export const TRAIL_HEADER = TRAIL_COLUMNS.join('\t')

const SHA_RE = /[0-9a-f]{7,40}/gi
const MEDIA_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'trace',
  'har',
  'zip',
  'json',
  'mp4',
  'webm',
  'mov',
])

function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

export function trailPath({ repoDir, ticket, path }) {
  if (path) return isAbsolute(path) ? path : resolve(repoDir, path)
  if (ticket === undefined || ticket === null || String(ticket).trim() === '') {
    throw new Error('读 trail 需要票号或显式路径')
  }
  return join(repoDir, '.audit', `${String(ticket).trim()}.tsv`)
}

/** 单元格不能带 tab 和换行，否则六列会错位。 */
export function sanitizeCell(value) {
  return String(value ?? '')
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export function formatTs(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now())
  if (Number.isNaN(date.getTime())) throw new Error(`时间格式不对：${String(value)}`)
  return date.toISOString()
}

/** 解析 trail 文本。表头顺序可变；没有表头时按固定六列读。 */
export function parseTrail(text) {
  const lines = String(text ?? '')
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
  if (lines.length === 0) return []

  let columns = TRAIL_COLUMNS
  let start = 0
  const first = lines[0].split('\t').map((cell) => cell.trim())
  if (first.includes('phase') && first.includes('result')) {
    columns = first
    start = 1
  }

  const rows = []
  for (const line of lines.slice(start)) {
    const cells = line.split('\t')
    const row = {}
    columns.forEach((column, index) => {
      row[column] = (cells[index] ?? '').trim()
    })
    if (!row.phase) continue
    rows.push(row)
  }
  return rows
}

export function serializeTrail(rows) {
  const lines = [TRAIL_HEADER]
  for (const row of rows) {
    lines.push(TRAIL_COLUMNS.map((column) => sanitizeCell(row[column])).join('\t'))
  }
  return `${lines.join('\n')}\n`
}

export async function readTrail({ repoDir, ticket, path }) {
  const file = trailPath({ repoDir, ticket, path })
  try {
    return parseTrail(await readFile(file, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

/** 追加一行，返回实际写入的行（ts 已转成 UTC）。 */
export async function appendTrail({
  repoDir,
  ticket,
  path,
  ts,
  phase,
  decision = '',
  why = '',
  evidence = '',
  result = '',
}) {
  if (!phase) throw new Error('trail 行缺 phase')
  const file = trailPath({ repoDir, ticket, path })
  const row = {
    ts: formatTs(ts),
    phase: sanitizeCell(phase),
    decision: sanitizeCell(decision),
    why: sanitizeCell(why),
    evidence: sanitizeCell(evidence),
    result: sanitizeCell(result),
  }

  let existing = ''
  try {
    existing = await readFile(file, 'utf8')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  await mkdir(dirname(file), { recursive: true })
  if (!existing) {
    await appendFile(file, `${TRAIL_HEADER}\n${TRAIL_COLUMNS.map((column) => row[column]).join('\t')}\n`, 'utf8')
    return row
  }
  const prefix = existing.endsWith('\n') ? '' : '\n'
  await appendFile(file, `${prefix}${TRAIL_COLUMNS.map((column) => row[column]).join('\t')}\n`, 'utf8')
  return row
}

/**
 * 合并成功后写一行 `phase=merge`，供 #466 的 collectRequirementState 判「子票已合」。
 * 同一个 mergedSha 已经有记录就不重复追加。
 *
 * @returns {Promise<object|null>} 新写的行；已存在时返回 null
 */
export async function appendMergeRow({ repoDir, ticket, reqBranch, mergedSha, trail }) {
  if (!mergedSha) throw new Error('写 merge 行缺 mergedSha')
  const known = [
    ...normalizeTrail(trail),
    ...(await readTrail({ repoDir, ticket })),
  ]
  const exists = known.some(
    (row) =>
      row.phase === 'merge' &&
      row.result === 'pass' &&
      sameSha(row.evidence.trim(), mergedSha),
  )
  if (exists) return null
  return appendTrail({
    repoDir,
    ticket,
    phase: 'merge',
    decision: 'merge',
    why: reqBranch,
    evidence: mergedSha,
    result: 'pass',
  })
}

function normalizeTrail(trail) {  if (Array.isArray(trail)) {
    return trail.map((row) => {
      const result = {}
      for (const column of TRAIL_COLUMNS) result[column] = String(row?.[column] ?? '')
      return result
    })
  }
  if (typeof trail === 'string') return parseTrail(trail)
  return []
}

function sameSha(left, right) {
  if (!left || !right) return false
  const a = String(left).toLowerCase()
  const b = String(right).toLowerCase()
  return a === b || a.startsWith(b) || b.startsWith(a)
}

function mentionsSha(text, sha) {
  if (!sha) return false
  const value = String(text ?? '')
  if (value.toLowerCase().includes(String(sha).toLowerCase())) return true
  for (const token of value.match(SHA_RE) || []) {
    if (sameSha(token, sha)) return true
  }
  return false
}

function shaTokens(text) {
  return (String(text ?? '').match(SHA_RE) || []).map((token) => token.toLowerCase())
}

function evidenceTokens(evidence) {
  return String(evidence ?? '')
    .split(/[\s,;，；、]+/)
    .map((token) => token.replace(/^["'`([{]+|["'`\])}]+$/g, ''))
    .filter((token) => token && !token.startsWith('sha='))
    .filter((token) => !/^[a-z][a-z0-9+.-]*:\/\//i.test(token))
    .filter((token) => token.includes('/') || /\.[a-z0-9]{2,8}$/i.test(token))
}

function mediaTokens(tokens) {
  return tokens.filter((token) => {
    const match = /\.([a-z0-9]{2,8})$/i.exec(token)
    return match ? MEDIA_EXTENSIONS.has(match[1].toLowerCase()) : false
  })
}

async function existsInRepo(repoDir, token, headShas = []) {
  const clean = token.replace(/^\.\//, '')
  if (isAbsolute(clean)) {
    try {
      await stat(clean)
      return true
    } catch {
      return false
    }
  }
  for (const sha of headShas.filter(Boolean)) {
    try {
      await git(repoDir, ['cat-file', '-e', `${sha}:${clean}`])
      return true
    } catch {
      // 这个 head 里没有，再看工作树。
    }
  }
  try {
    await stat(join(repoDir, clean))
    return true
  } catch {
    return false
  }
}

/**
 * 当前 head 往前，最后一个碰了 `.audit/` 以外文件的提交。
 * 验证者写完 trail 行再提交时，head 会变成只改 audit 的提交；
 * 证据指向它前面那个代码提交，仍算当前。
 */
async function lastCodeCommit(repoDir, headSha) {
  let sha = headSha
  if (!sha) {
    try {
      sha = await git(repoDir, ['rev-parse', 'HEAD'])
    } catch {
      return ''
    }
  }
  for (let index = 0; index < 30; index += 1) {
    let files = []
    try {
      const parents = (await git(repoDir, ['rev-list', '--parents', '-n', '1', sha])).split(/\s+/).slice(1)
      if (parents.length > 1) {
        const output = await git(repoDir, ['diff', '--name-only', parents[0], sha])
        files = output ? output.split(/\r?\n/).filter(Boolean) : []
      } else {
        const output = await git(repoDir, ['diff-tree', '--no-commit-id', '--name-only', '-r', '--root', sha])
        files = output ? output.split(/\r?\n/).filter(Boolean) : []
      }
    } catch {
      return sha
    }
    if (files.some((file) => !file.startsWith('.audit/'))) return sha
    try {
      sha = await git(repoDir, ['rev-parse', `${sha}^`])
    } catch {
      return sha
    }
  }
  return sha
}

/**
 * 四样证据里靠 trail 行就能判断的三条轴：验证、评审标准、评审 spec。
 * 测试行和截图路径另外查；合并前补齐证据也用它，避免两处判据不一致。
 *
 * @returns {{verify: boolean, reviewStandard: boolean, reviewSpec: boolean}}
 *   每条轴 true 表示缺
 */
export function missingEvidenceAxes(rows = []) {
  return {
    verify: !rows.some((row) => row.phase === 'verify' && row.result === 'pass'),
    reviewStandard: !rows.some(
      (row) => row.phase === 'review' && row.result === 'pass' && row.decision.includes('标准'),
    ),
    reviewSpec: !rows.some(
      (row) => row.phase === 'review' && row.result === 'pass' && /spec/i.test(row.decision),
    ),
  }
}

/**
 * 四样证据逐项检查。
 *
 * @param {object} options
 * @param {Array|string} options.trail
 * @param {string} [options.headSha]
 * @param {string} options.repoDir
 * @returns {Promise<{ready: boolean, missing: string[], stale: string[]}>}
 */
export async function evidenceReady({ trail, headSha, repoDir }) {
  const rows = normalizeTrail(trail)
  let head = headSha
  if (!head && repoDir) {
    head = await git(repoDir, ['rev-parse', 'HEAD']).catch(() => '')
  }
  const codeHead = repoDir ? await lastCodeCommit(repoDir, head) : head

  const missing = []
  const axes = missingEvidenceAxes(rows)
  const verifyRows = rows.filter((row) => row.phase === 'verify' && row.result === 'pass')
  if (axes.verify) {
    missing.push('验证（phase=verify result=pass）')
  } else {
    const tokens = verifyRows.flatMap((row) => evidenceTokens(row.evidence))
    const media = mediaTokens(tokens)
    if (media.length === 0) {
      missing.push('验证截图或 trace（phase=verify 的 evidence）')
    } else {
      for (const token of media) {
        if (repoDir && !(await existsInRepo(repoDir, token, [head, codeHead]))) {
          missing.push(`证据路径不存在：${token}`)
        }
      }
    }
  }

  if (!rows.some((row) => row.phase === 'test' && row.result === 'pass')) {
    missing.push('测试（phase=test result=pass）')
  }
  if (axes.reviewStandard) {
    missing.push('评审·标准（phase=review decision 含「标准」）')
  }
  if (axes.reviewSpec) {
    missing.push('评审·spec（phase=review decision 含 spec）')
  }

  const stale = []
  if (missing.length === 0) {
    const fresh =
      rows.some(
        (row) =>
          [head, codeHead].filter(Boolean).some(
            (sha) => mentionsSha(row.why, sha) || mentionsSha(row.decision, sha),
          ),
      ) ||
      verifyRows.some((row) =>
        [head, codeHead].filter(Boolean).some((sha) =>
          shaTokens(row.evidence.replace(/sha=([0-9a-f]{7,40})/gi, '$1')).some((token) =>
            sameSha(token, sha),
          ),
        ),
      )
    if (!fresh) stale.push(`证据没指向当前 head（${head}），需要复验`)
  }

  return { ready: missing.length === 0 && stale.length === 0, missing, stale }
}

const MIGRATION_RE = /(^|\/)(migrations?|db\/migrate|alembic|prisma\/migrations)(\/|$)|\.sql$/i
const CREDENTIAL_RE =
  /(^|\/)\.env(\.[^/]+)?$|(^|\/)(credentials?|secrets?)(\.[^/]+)?$|(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$|\.(pem|key|p12|pfx)$|(^|\/)\.npmrc$/i
const MANIFEST_RE =
  /(^|\/)(package\.json|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|requirements[^/]*\.txt|pyproject\.toml|poetry\.lock|go\.mod|go\.sum|Cargo\.toml|Cargo\.lock|Gemfile|Gemfile\.lock|composer\.json|composer\.lock)$/i

export { MANIFEST_RE }

function normalizeFiles(files) {
  return (Array.isArray(files) ? files : []).map((file) => {
    if (typeof file === 'string') return { path: file, status: '' }
    return {
      path: String(file?.path || file?.filename || file?.file || ''),
      status: String(file?.status || '').toUpperCase(),
      deletions: Number(file?.deletions) || 0,
    }
  })
}

function changedLineCount(diffStat) {
  if (typeof diffStat === 'number') return diffStat
  if (typeof diffStat === 'string') {
    const insertions = /(\d+)\s+insertions?/.exec(diffStat)
    const deletions = /(\d+)\s+deletions?/.exec(diffStat)
    return Number(insertions?.[1] || 0) + Number(deletions?.[1] || 0)
  }
  if (diffStat && typeof diffStat === 'object') {
    if (Number.isFinite(Number(diffStat.changedLines))) return Number(diffStat.changedLines)
    return Number(diffStat.additions || 0) + Number(diffStat.deletions || 0)
  }
  return 0
}

function versionPairs(text) {
  const removed = new Map()
  const added = new Map()
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const sign = line[0]
    if (sign !== '-' && sign !== '+') continue
    const body = line.slice(1)
    const match =
      /"([@a-z0-9/_.-]+)"\s*:\s*"[~^>=<\s]*v?(\d+)(?:\.\d+){0,2}"/i.exec(body) ||
      /\b([@a-z0-9/_.-]+)\s*==\s*v?(\d+)(?:\.\d+){0,2}/i.exec(body) ||
      /\b([@a-z0-9/_.-]+)@v?(\d+)(?:\.\d+){0,2}/i.exec(body)
    if (!match) continue
    const table = sign === '-' ? removed : added
    table.set(match[1], Number(match[2]))
  }
  for (const [name, major] of added) {
    if (removed.has(name) && removed.get(name) !== major) return true
  }
  return false
}

/**
 * 风险两栏：单向门和影响范围。碰迁移、删除、凭证、大版本依赖，
 * 或 diff 超过阈值（默认 400 行或 10 个文件）判高风险。
 *
 * @returns {string[]} 触发原因；没有触发时给一句「没碰…」的说明。
 */
export function riskReasons({ files = [], diffStat = {}, maxLines = 400, maxFiles = 10 } = {}) {
  const list = normalizeFiles(files)
  const text = typeof diffStat === 'object' && diffStat ? String(diffStat.text || diffStat.patch || '') : ''
  const reasons = []

  const migrations = list.filter((file) => MIGRATION_RE.test(file.path))
  if (migrations.length) reasons.push(`碰迁移：${migrations.map((file) => file.path).join('、')}`)
  const deleted = list.filter(
    (file) => file.status === 'D' || file.status === 'DELETED' || /\(deleted\)/.test(file.path),
  )
  if (deleted.length) reasons.push(`删文件：${deleted.map((file) => file.path).join('、')}`)
  const credentials = list.filter((file) => CREDENTIAL_RE.test(file.path))
  if (credentials.length) reasons.push(`碰凭证：${credentials.map((file) => file.path).join('、')}`)
  const manifests = list.filter((file) => MANIFEST_RE.test(file.path))
  if (Boolean(diffStat?.dependencyMajor) || (manifests.length && versionPairs(text))) {
    reasons.push(`依赖大版本变化：${manifests.map((file) => file.path).join('、')}`)
  }
  const lines = changedLineCount(diffStat)
  const fileCount = Number(diffStat && typeof diffStat === 'object' ? diffStat.files : 0) || list.length
  if (lines > maxLines) reasons.push(`改动 ${lines} 行，超过 ${maxLines} 行`)
  if (fileCount > maxFiles) reasons.push(`改动 ${fileCount} 个文件，超过 ${maxFiles} 个`)
  if (reasons.length === 0) reasons.push('没碰迁移、删除、凭证、大版本依赖，改动范围不大')
  return reasons
}

/**
 * @returns {'high'|'normal'}
 */
export function riskLevel(options = {}) {
  return riskReasons(options).some((reason) => !reason.startsWith('没碰')) ? 'high' : 'normal'
}

/**
 * 验证队计划。完整验证队只在代码就绪提交跑一次；之后小改只派一个，
 * 只改文字不派。高风险票验证者 >=2，评审加 interrogate。
 */
export function verifyPlan({ risk = 'normal', changedLines = 0, textOnly = false, fullTeamDone = false } = {}) {
  if (textOnly) return { run: false, verifiers: 0, mode: 'none', reviewMode: 'skip' }
  if (risk === 'high') {
    const small = Number(changedLines) < 100
    const verifiers = fullTeamDone && small ? 1 : 2
    return {
      run: true,
      verifiers,
      mode: verifiers > 1 ? 'full' : 'single',
      reviewMode: 'interrogate',
    }
  }
  return { run: true, verifiers: 1, mode: 'single', reviewMode: 'standard' }
}

const STATE_PENDING = '状态:待验收'
const SANDBOX_LABEL = 'Sandcastle'

function passed(outcome) {
  if (outcome === true) return true
  if (!outcome || typeof outcome !== 'object') return false
  return outcome.ok === true || outcome.pass === true
}

function problemsOf(outcome) {
  if (!outcome || typeof outcome !== 'object') return []
  if (Array.isArray(outcome.problems)) return outcome.problems.map(String)
  if (outcome.error) return [String(outcome.error)]
  return []
}

function issueLabelNames(issue) {
  return (issue?.labels || []).map((label) => (typeof label === 'string' ? label : label?.name)).filter(Boolean)
}

async function revParse(repoDir, ref) {
  try {
    return await git(repoDir, ['rev-parse', ref])
  } catch {
    return ''
  }
}

async function isAncestor(repoDir, ancestor, descendant) {
  try {
    await git(repoDir, ['merge-base', '--is-ancestor', ancestor, descendant])
    return true
  } catch (error) {
    if (error instanceof GitError && error.code === 1) return false
    throw error
  }
}

async function unmergedFiles(repoDir) {
  const output = await git(repoDir, ['diff', '--name-only', '--diff-filter=U']).catch(() => '')
  return output ? output.split(/\r?\n/).filter(Boolean) : []
}

/** merger 交回来的文件里不能留冲突标记。 */
async function conflictMarkers(repoDir, files) {
  const found = []
  for (const file of files) {
    let text = ''
    try {
      text = await readFile(join(repoDir, file), 'utf8')
    } catch {
      continue
    }
    if (/^(<{7}|>{7})(\s|$)/m.test(text)) found.push(file)
  }
  return found
}

async function diffInfo(repoDir, base, head) {
  const names = await git(repoDir, ['diff', '--name-status', `${base}...${head}`]).catch(() => '')
  const files = []
  for (const line of names.split(/\r?\n/)) {
    if (!line.trim()) continue
    const [status, ...rest] = line.split('\t')
    files.push({ path: rest[rest.length - 1] || '', status })
  }
  const numstat = await git(repoDir, ['diff', '--numstat', `${base}...${head}`]).catch(() => '')
  let additions = 0
  let deletions = 0
  for (const line of numstat.split(/\r?\n/)) {
    const match = /^(\d+|-)\t(\d+|-)\t/.exec(line)
    if (!match) continue
    additions += Number(match[1]) || 0
    deletions += Number(match[2]) || 0
  }
  return { files, diffStat: { additions, deletions, files: files.length } }
}

function freshFor(row, shas) {
  return shas.filter(Boolean).some((sha) => {
    if (mentionsSha(row.why, sha) || mentionsSha(row.decision, sha)) return true
    if (row.phase !== 'verify') return false
    const seen = shaTokens(row.evidence)
    return seen.some((token) => sameSha(token, sha))
  })
}

async function notifyIncident({ notifier, ticket, reason, tried, link }) {
  if (typeof notifier?.send !== 'function') return
  const at = new Date()
  try {
    await notifier.send({
      v: 1,
      key: `#${ticket.number}:出事:${reason}:${at.toISOString()}`,
      event: '出事',
      occurred_at: at.toISOString(),
      link,
      data: {
        customer: ticket.customer || '未知客户',
        requirement: ticket.requirement || ticket.title || '',
        reason,
        tried,
      },
    })
  } catch {
    // 通知失败不回滚已经做出的判断。
  }
}

function issueLink(ticket) {
  if (ticket.htmlUrl) return ticket.htmlUrl
  if (ticket.owner && ticket.repo) {
    return `https://github.com/${ticket.owner}/${ticket.repo}/issues/${ticket.number}`
  }
  return ''
}

function renderEvidenceComment({ rows, ticketBranch, reqBranch, headSha, risk, preview }) {
  const verify = rows.find((row) => row.phase === 'verify' && row.result === 'pass')
  const test = rows.find((row) => row.phase === 'test' && row.result === 'pass')
  const standard = rows.find(
    (row) => row.phase === 'review' && row.result === 'pass' && row.decision.includes('标准'),
  )
  const spec = rows.find(
    (row) => row.phase === 'review' && row.result === 'pass' && /spec/i.test(row.decision),
  )
  const lines = [
    '四样证据齐，已合进需求分支。',
    '',
    `- 验证：pass${verify?.evidence ? `，${verify.evidence}` : ''}`,
    `- 测试：pass${test?.decision ? `，${test.decision}` : ''}`,
    `- 评审：标准 pass${standard?.decision ? `（${standard.decision}）` : ''}；spec pass${spec?.decision ? `（${spec.decision}）` : ''}`,
    `- 分支：\`${ticketBranch}\` → \`${reqBranch}\``,
    `- head：\`${headSha}\``,
  ]
  if (risk === 'high') {
    const interrogate = rows.find(
      (row) => row.phase === 'review' && row.result === 'pass' && /interrogate|攻击/i.test(`${row.decision} ${row.why}`),
    )
    lines.push(`- 高风险：已过 interrogate${interrogate?.decision ? `（${interrogate.decision}）` : ''}`)
  }
  if (preview?.url || preview?.address) {
    lines.push(`- 预览：${preview.url || `https://${preview.address}/`}（已销毁）`)
  }
  return lines.join('\n')
}

/**
 * 合进需求分支。四样证据不齐不合；合完在合并提交上重跑验证，
 * 失败就回滚到合并前的需求分支。
 *
 * 注入点签名（给 #466 用）：
 * - `verifier({ repoDir, headSha, ticket }) => {ok|pass, problems?, evidence?}`
 * - `review({ repoDir, headSha, ticket, mode }) => {ok|pass, decision?, evidence?}`
 * - `merger({ repoDir, files, ticket, ticketBranch, reqBranch }) => {ok}`
 * - `preview.start({ repoDir, ticket, ticketBranch, headSha, risk }) => {ok, address, url}`
 * - `preview.stop({ address, ticket, repoDir }) => {ok}`
 * - `notifier.send(event)` 见 `docs/通知.md` 第五节
 * - `github` 是 `lib/github.mjs` 的客户端；也可放在 `ticket.gh`
 */
export async function mergeTicket({
  repoDir,
  ticketBranch,
  reqBranch,
  ticket,
  trail,
  verifier,
  review,
  merger,
  preview,
  notifier,
  github,
} = {}) {
  const gh = github || ticket?.gh || ticket?.github
  if (!repoDir || !ticketBranch || !reqBranch || !ticket?.number) {
    return { ok: false, reason: 'bad_input', missing: ['repoDir、ticketBranch、reqBranch、ticket.number 都要有'] }
  }
  if (typeof verifier !== 'function') {
    return { ok: false, reason: 'verifier_required', missing: ['没有注入 verifier，合并后没法复验'] }
  }

  const owner = ticket.owner || ''
  const repo = ticket.repo || ''
  const link = issueLink(ticket)

  let ticketHead = await revParse(repoDir, ticketBranch)
  if (!ticketHead) return { ok: false, reason: 'branch_not_found', missing: [`分支不存在：${ticketBranch}`] }
  const reqHeadBefore = await revParse(repoDir, reqBranch)
  if (!reqHeadBefore) return { ok: false, reason: 'branch_not_found', missing: [`分支不存在：${reqBranch}`] }

  if (await isAncestor(repoDir, ticketBranch, reqBranch)) {
    const current = await revParse(repoDir, reqBranch)
    return { ok: true, alreadyMerged: true, headSha: current, mergedSha: current, missing: [], stale: [] }
  }

  const rows = trail ? normalizeTrail(trail) : await readTrail({ repoDir, ticket: ticket.number })
  const evidence = await evidenceReady({ trail: rows, headSha: ticketHead, repoDir })
  if (!evidence.ready) {
    return { ok: false, reason: 'evidence_not_ready', missing: evidence.missing, stale: evidence.stale }
  }

  const { files, diffStat } = await diffInfo(repoDir, reqBranch, ticketBranch)
  const risk = riskLevel({ files, diffStat })
  const changedLines = diffStat.additions + diffStat.deletions
  const plan = verifyPlan({ risk, changedLines })
  const shas = [ticketHead, await lastCodeCommit(repoDir, ticketHead)]

  if (risk === 'high') {
    const freshVerifiers = rows.filter(
      (row) => row.phase === 'verify' && row.result === 'pass' && freshFor(row, shas),
    ).length
    if (freshVerifiers < 2) {
      return {
        ok: false,
        reason: 'evidence_not_ready',
        missing: [`高风险验证队（至少 2 个验证者，当前 ${freshVerifiers} 个）`],
        stale: [],
      }
    }
    const hasInterrogate = rows.some(
      (row) =>
        row.phase === 'review' &&
        row.result === 'pass' &&
        /interrogate|攻击/i.test(`${row.decision} ${row.why}`),
    )
    if (!hasInterrogate) {
      if (typeof review !== 'function') {
        return {
          ok: false,
          reason: 'evidence_not_ready',
          missing: ['高风险评审（interrogate）'],
          stale: [],
        }
      }
      let outcome
      try {
        outcome = await review({ repoDir, headSha: ticketHead, ticket, mode: 'interrogate' })
      } catch (error) {
        outcome = { ok: false, error: errorText(error) }
      }
      if (!passed(outcome)) {
        return {
          ok: false,
          reason: 'evidence_not_ready',
          missing: ['高风险评审（interrogate）'],
          stale: [],
          problems: problemsOf(outcome),
        }
      }
      const appended = await appendTrail({
        repoDir,
        ticket: ticket.number,
        phase: 'review',
        decision: outcome.decision || 'interrogate：攻击性评审通过',
        why: `高风险 head ${ticketHead}`,
        evidence: outcome.evidence || '',
        result: 'pass',
      })
      rows.push(appended)
      await git(repoDir, ['add', '--', `.audit/${ticket.number}.tsv`]).catch(() => {})
      await git(repoDir, ['commit', '-m', `FACTORY: 补 interrogate 评审 #${ticket.number}`]).catch(() => {})
      ticketHead = (await revParse(repoDir, ticketBranch)) || ticketHead
    }
  }

  const previewText = serializeTrail(rows)
  const previewRequired = Boolean(preview?.needed) || previewNeeded({ trail: previewText })
  let previewInfo = null
  if (previewRequired) {
    if (typeof preview?.start !== 'function') {
      return { ok: false, reason: 'preview_required', missing: ['这张票有界面，但没有注入预览'] }
    }
    let started
    try {
      started = await preview.start({ repoDir, ticket, ticketBranch, headSha: ticketHead, risk })
    } catch (error) {
      started = { ok: false, error: errorText(error) }
    }
    if (!started || started.ok === false) {
      await notifyIncident({
        notifier,
        ticket,
        reason: '验证评审修不过',
        tried: `预览起不来：${started?.error || '未知原因'}`,
        link,
      })
      return { ok: false, reason: 'preview_failed', error: started?.error || '预览起不来' }
    }
    previewInfo = started
  }

  let mergedSha = ''
  let originalBranch = ''
  try {
    originalBranch = await git(repoDir, ['branch', '--show-current']).catch(() => '')
    try {
      await git(repoDir, ['checkout', reqBranch])
    } catch (error) {
      return { ok: false, reason: 'checkout_failed', error: errorText(error) }
    }

    let conflictFiles = []
    try {
      mergedSha = await mergeNoFf(
        repoDir,
        ticketBranch,
        `合并 #${ticket.number} ${ticket.title || ''}`.trim(),
      )
    } catch (error) {
      if (!(error instanceof GitError)) throw error
      conflictFiles = await unmergedFiles(repoDir)
      if (conflictFiles.length === 0) {
        await git(repoDir, ['reset', '--hard', reqHeadBefore]).catch(() => {})
        return { ok: false, reason: 'merge_failed', error: errorText(error) }
      }
      if (typeof merger !== 'function') {
        await git(repoDir, ['reset', '--hard', reqHeadBefore]).catch(() => {})
        return { ok: false, reason: 'conflict_needs_merger', files: conflictFiles }
      }
      let resolved
      try {
        resolved = await merger({ repoDir, files: conflictFiles, ticket, ticketBranch, reqBranch })
      } catch (mergeError) {
        resolved = { ok: false, error: errorText(mergeError) }
      }
      await git(repoDir, ['add', '-A']).catch(() => {})
      const remaining = await unmergedFiles(repoDir)
      const markers = await conflictMarkers(repoDir, conflictFiles)
      if (!passed(resolved) || remaining.length > 0 || markers.length > 0) {
        await git(repoDir, ['reset', '--hard', reqHeadBefore]).catch(() => {})
        await notifyIncident({
          notifier,
          ticket,
          reason: '三圈没进展',
          tried: `冲突解不了：${conflictFiles.join('、')}。${resolved?.error || ''}`.trim(),
          link,
        })
        return {
          ok: false,
          reason: 'conflict_unresolved',
          files: remaining.length ? remaining : conflictFiles,
          error: resolved?.error || '',
        }
      }
      const status = await git(repoDir, ['status', '--porcelain']).catch(() => '')
      if (status) {
        await git(repoDir, ['add', '-A'])
        await git(repoDir, ['commit', '--no-edit'])
      }
      mergedSha = await revParse(repoDir, 'HEAD')
    }

    let verified
    try {
      verified = await verifier({ repoDir, headSha: mergedSha, ticket })
    } catch (error) {
      verified = { ok: false, error: errorText(error) }
    }
    if (!passed(verified)) {
      await git(repoDir, ['reset', '--hard', reqHeadBefore]).catch(() => {})
      await notifyIncident({
        notifier,
        ticket,
        reason: '验证评审修不过',
        tried: `合并后复验没过${problemsOf(verified).length ? `：${problemsOf(verified).join('；')}` : ''}`,
        link,
      })
      return {
        ok: false,
        reason: 'reverify_failed',
        problems: problemsOf(verified),
        missing: [],
        stale: [],
      }
    }

    await appendMergeRow({
      repoDir,
      ticket: ticket.number,
      reqBranch,
      mergedSha,
      trail: rows,
    })
    await appendTrail({
      repoDir,
      ticket: ticket.number,
      phase: 'verify',
      decision: '合并后复验',
      why: `在合并 head ${mergedSha} 上重跑验证`,
      evidence: `sha=${mergedSha}${verified?.evidence ? ` ${verified.evidence}` : ''}`,
      result: 'pass',
    })
    const status = await git(repoDir, ['status', '--porcelain']).catch(() => '')
    if (status) {
      await git(repoDir, ['add', '--', `.audit/${ticket.number}.tsv`])
      await git(repoDir, ['commit', '-m', `FACTORY: 合并后复验记录 #${ticket.number}`])
    }
    const finalHead = await revParse(repoDir, 'HEAD')

    if (gh && owner && repo) {
      try {
        await gh.createComment({
          owner,
          repo,
          number: ticket.number,
          body: renderEvidenceComment({
            rows,
            ticketBranch,
            reqBranch,
            headSha: finalHead,
            risk,
            preview: previewInfo,
          }),
        })
        await ensureLabel(gh, {
          owner,
          repo,
          name: STATE_PENDING,
          color: '0e8a16',
          description: '活干完了，等下一步确认',
        })
        const current = await gh.getIssue({ owner, repo, number: ticket.number })
        const names = issueLabelNames(current)
        if (!names.includes(STATE_PENDING)) {
          await gh.addLabels({ owner, repo, number: ticket.number, labels: [STATE_PENDING] })
        }
        await gh.closeIssue({ owner, repo, number: ticket.number })
        if (names.includes(SANDBOX_LABEL)) {
          await gh.removeLabel({ owner, repo, number: ticket.number, name: SANDBOX_LABEL })
        }
        const parentNumber =
          ticket.parentNumber ||
          (typeof ticket.parent === 'number' ? ticket.parent : ticket.parent?.number)
        if (parentNumber) {
          await gh.createComment({
            owner,
            repo,
            number: parentNumber,
            body: progressLine({
              path: ticket.path || '其余',
              tier: '开发中',
              step: '合分支',
              round: ticket.round || 1,
              stuck: false,
            }),
          })
        }
      } catch (error) {
        return {
          ok: true,
          headSha: finalHead,
          mergedSha,
          risk,
          plan,
          warning: `合完了，但 GitHub 写回失败：${errorText(error)}`,
          originalBranch,
        }
      }
    }

    return { ok: true, headSha: finalHead, mergedSha, risk, plan, originalBranch }
  } finally {
    if (previewInfo) {
      try {
        await preview.stop({ address: previewInfo.address, ticket, repoDir })
      } catch {
        // 预览销毁失败归 #469 的 swarm 兜底，不回滚合并。
      }
    }
  }
}

