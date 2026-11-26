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
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { CLEAN_CHECK_MARKER } from './clean-check.mjs'
import { GitError, git, mergeNoFf, pushOrigin } from './git.mjs'
import { ensureLabel } from './issues.mjs'
import { sendEvent } from './notify.mjs'
import { previewNeeded } from './preview.mjs'
import { progressLine } from './progress.mjs'

export const TRAIL_COLUMNS = ['ts', 'phase', 'decision', 'why', 'evidence', 'result']
export const TRAIL_HEADER = TRAIL_COLUMNS.join('\t')

/** 修复轮次上限默认值：真实缺陷曾要修到第 4 轮。 */
export const DEFAULT_MAX_FIX_ROUNDS = 4

/**
 * 解析修复轮次上限。调用方传值优先，没传看环境变量 AFK_MAX_FIX_ROUNDS；
 * 不是大于等于 1 的整数就回落默认 4。
 */
export function resolveMaxFixRounds(value = process.env.AFK_MAX_FIX_ROUNDS) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return DEFAULT_MAX_FIX_ROUNDS
  }
  const rounds = Number(value)
  return Number.isInteger(rounds) && rounds >= 1 ? rounds : DEFAULT_MAX_FIX_ROUNDS
}

const SHA_RE = /[0-9a-f]{7,40}/gi
const VERIFIER_RE = /(?:^|\s)verifier=([^\s,;]+)/i
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

/** 媒体 token 归一化成仓库内相对路径；绝对路径、`..` 逃逸和 `.git/` 都拒。 */
function repoRelativeEvidencePath(repoDir, token) {
  const clean = token.replace(/^\.\//, '')
  if (!clean || isAbsolute(clean)) return ''
  const root = resolve(repoDir)
  const path = relative(root, resolve(root, clean))
  if (!path || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) return ''
  if (path === '.git' || path.startsWith(`.git${sep}`)) return ''
  return path
}

/** trail 引用、工作树里存在的媒体证据，按出现顺序去重。 */
async function evidenceFilesInWorktree(repoDir, rows) {
  const tokens = rows.flatMap((row) => evidenceTokens(row.evidence))
  const files = []
  for (const token of mediaTokens(tokens)) {
    const path = repoRelativeEvidencePath(repoDir, token)
    if (!path || files.includes(path)) continue
    try {
      if (!(await stat(join(repoDir, path))).isFile()) continue
    } catch {
      continue
    }
    files.push(path)
  }
  return files
}

/**
 * 把 trail 引用的媒体证据提交到票分支，干净检出也能找到。
 * 只收仓库内相对路径；工作树里没有的不带。
 */
async function commitEvidenceFiles({ repoDir, rows, ticketBranch, ticket }) {
  const files = await evidenceFilesInWorktree(repoDir, rows)
  if (files.length === 0) return { headSha: '', files: [] }
  await git(repoDir, ['checkout', ticketBranch])
  await git(repoDir, ['add', '-f', '--', ...files])
  const staged = await git(repoDir, ['diff', '--cached', '--name-only', '--', ...files])
  const changed = staged ? staged.split(/\r?\n/).filter(Boolean) : []
  if (changed.length === 0) return { headSha: '', files: [] }
  await git(repoDir, ['commit', '-m', `FACTORY: 证据进 git #${ticket.number}`, '--', ...changed])
  return { headSha: await revParse(repoDir, 'HEAD'), files: changed }
}

/**
 * 当前 head 往前，最后一个碰了 `.audit/` 以外文件的提交。
 * 验证者写完 trail 行再提交时，head 会变成只改 audit 的提交；
 * 证据指向它前面那个代码提交，仍算当前。
 */
export async function lastCodeCommit(repoDir, headSha) {
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
 * evidenceReady 的候选 SHA：head、最近代码提交，以及两者之间的提交。
 * 干净检查可能跑在中间的 audit-only 证据提交上，这一层不能丢。
 */
async function evidenceCandidates({ repoDir, head, codeHead }) {
  const shas = [head, codeHead].filter(Boolean)
  if (repoDir && head && codeHead) {
    try {
      const output = await git(repoDir, ['rev-list', `${codeHead}..${head}`])
      for (const sha of output
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)) {
        shas.push(sha)
      }
    } catch {
      // 查不了就只用 head 和代码头
    }
  }
  return [...new Set(shas)]
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
  const candidates = await evidenceCandidates({ repoDir, head, codeHead })

  const missing = []
  const missingAxes = missingEvidenceAxes(rows)
  const verifyRows = rows.filter((row) => row.phase === 'verify' && row.result === 'pass')
  if (missingAxes.verify) {
    missing.push('验证（phase=verify result=pass）')
  } else {
    const tokens = verifyRows.flatMap((row) => evidenceTokens(row.evidence))
    const media = mediaTokens(tokens)
    if (media.length === 0) {
      missing.push('验证截图或 trace（phase=verify 的 evidence）')
    } else {
      for (const token of media) {
        if (repoDir && !(await existsInRepo(repoDir, token, candidates))) {
          missing.push(`证据路径不存在：${token}`)
        }
      }
    }
  }

  if (!rows.some((row) => row.phase === 'test' && row.result === 'pass')) {
    missing.push('测试（phase=test result=pass）')
  } else {
    // 有干净检查行时，它必须指向当前 head；旧提交的测试不能替新提交作证。
    const cleanChecks = rows.filter(
      (row) =>
        row.phase === 'test' &&
        row.result === 'pass' &&
        String(row.why || '').includes(CLEAN_CHECK_MARKER),
    )
    const fresh = cleanChecks.some((row) =>
      candidates.some((sha) => mentionsSha(row.why, sha) || mentionsSha(row.decision, sha)),
    )
    if (cleanChecks.length > 0 && !fresh) {
      missing.push(`测试（干净检查的 pass 行没有指向当前 head ${head || '未知'}）`)
    }
  }
  if (missingAxes.reviewStandard) {
    missing.push('评审·标准（phase=review decision 含「标准」）')
  }
  if (missingAxes.reviewSpec) {
    missing.push('评审·spec（phase=review decision 含 spec）')
  }

  const stale = []
  if (missing.length === 0) {
    const fresh =
      rows.some(
        (row) =>
          candidates.some(
            (sha) => mentionsSha(row.why, sha) || mentionsSha(row.decision, sha),
          ),
      ) ||
      verifyRows.some((row) =>
        candidates.some((sha) =>
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
    const normalized = {
      path: String(file?.path || file?.filename || file?.file || ''),
      status: String(file?.status || '').toUpperCase(),
    }
    if (file?.additions !== undefined || file?.deletions !== undefined) {
      normalized.additions = Number(file.additions) || 0
      normalized.deletions = Number(file.deletions) || 0
    }
    return normalized
  })
}

/** 证据目录里的文件不算风险：它们只增不删代码，行数也随 trail 变长。 */
function isAuditFile(path) {
  return /(^|\/)\.audit\//.test(String(path ?? ''))
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
 * `.audit/` 是证据目录，文件数和行数都不算进影响范围。
 *
 * @returns {string[]} 触发原因；没有触发时给一句「没碰…」的说明。
 */
export function riskReasons({ files = [], diffStat = {}, maxLines = 400, maxFiles = 10 } = {}) {
  const list = normalizeFiles(files)
  const codeFiles = list.filter((file) => !isAuditFile(file.path))
  const text = typeof diffStat === 'object' && diffStat ? String(diffStat.text || diffStat.patch || '') : ''
  const reasons = []

  const migrations = codeFiles.filter((file) => MIGRATION_RE.test(file.path))
  if (migrations.length) reasons.push(`碰迁移：${migrations.map((file) => file.path).join('、')}`)
  const deleted = codeFiles.filter(
    (file) => file.status === 'D' || file.status === 'DELETED' || /\(deleted\)/.test(file.path),
  )
  if (deleted.length) reasons.push(`删文件：${deleted.map((file) => file.path).join('、')}`)
  const credentials = codeFiles.filter((file) => CREDENTIAL_RE.test(file.path))
  if (credentials.length) reasons.push(`碰凭证：${credentials.map((file) => file.path).join('、')}`)
  const manifests = codeFiles.filter((file) => MANIFEST_RE.test(file.path))
  if (Boolean(diffStat?.dependencyMajor) || (manifests.length && versionPairs(text))) {
    reasons.push(`依赖大版本变化：${manifests.map((file) => file.path).join('、')}`)
  }
  const measured =
    list.length > 0 && list.every((file) => file.additions !== undefined && file.deletions !== undefined)
  const lines = measured
    ? codeFiles.reduce((sum, file) => sum + file.additions + file.deletions, 0)
    : changedLineCount(diffStat)
  const fileCount = list.length
    ? codeFiles.length
    : Number(diffStat && typeof diffStat === 'object' ? diffStat.files : 0) || 0
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

export async function diffInfo(repoDir, base, head) {
  const names = await git(repoDir, ['diff', '--name-status', `${base}...${head}`]).catch(() => '')
  const files = []
  for (const line of names.split(/\r?\n/)) {
    if (!line.trim()) continue
    const [status, ...rest] = line.split('\t')
    files.push({ path: rest[rest.length - 1] || '', status })
  }
  const numstat = await git(repoDir, ['diff', '--numstat', `${base}...${head}`]).catch(() => '')
  const stats = new Map()
  let additions = 0
  let deletions = 0
  for (const line of numstat.split(/\r?\n/)) {
    const match = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line)
    if (!match) continue
    const stat = { additions: Number(match[1]) || 0, deletions: Number(match[2]) || 0 }
    stats.set(match[3], stat)
    if (isAuditFile(match[3])) continue
    additions += stat.additions
    deletions += stat.deletions
  }
  const manifests = files.filter((file) => MANIFEST_RE.test(file.path)).map((file) => file.path)
  const patch = manifests.length
    ? await git(repoDir, ['diff', `${base}...${head}`, '--', ...manifests]).catch(() => '')
    : ''
  return {
    files: files.map((file) => ({ ...file, ...(stats.get(file.path) || {}) })),
    diffStat: { additions, deletions, files: files.length, patch },
  }
}

function freshFor(row, shas) {
  return shas.filter(Boolean).some((sha) => {
    if (mentionsSha(row.why, sha) || mentionsSha(row.decision, sha)) return true
    if (row.phase !== 'verify') return false
    const seen = shaTokens(row.evidence)
    return seen.some((token) => sameSha(token, sha))
  })
}

async function freshRowsByPhase({ trail, headSha = '', repoDir = '', phase }) {
  const rows = normalizeTrail(trail)
  let head = headSha
  if (!head && repoDir) head = await git(repoDir, ['rev-parse', 'HEAD']).catch(() => '')
  const codeHead = repoDir ? await lastCodeCommit(repoDir, head) : head
  const shas = [head, codeHead].filter(Boolean)
  return rows.filter((row) => row.phase === phase && row.result === 'pass' && freshFor(row, shas))
}

/**
 * 指向当前 head 或最后一个代码提交的 pass verify 行。
 * D3 用它判断「已经有人验过这个 head 了」，同一 head 不再重跑。
 */
export async function freshVerifyRows(options = {}) {
  return freshRowsByPhase({ ...options, phase: 'verify' })
}

/**
 * 指向当前 head 或最后一个代码提交的 pass test 行。
 * 干净检查用它判断这个 head 的测试是否已经跑过；旧 head 的测试不算数。
 */
export async function freshTestRows(options = {}) {
  return freshRowsByPhase({ ...options, phase: 'test' })
}

/** 从 trail 行读验证者 id；旧行没写时返回空串。 */
export function verifierIdOf(row) {
  const match = VERIFIER_RE.exec(`${row?.why ?? ''} ${row?.decision ?? ''}`)
  return match ? match[1].toLowerCase() : ''
}

/** 是不是高风险 interrogate 的评审行。 */
export function isInterrogateRow(row) {
  return (
    row?.phase === 'review' && /interrogate|攻击/i.test(`${row?.decision ?? ''} ${row?.why ?? ''}`)
  )
}

/**
 * 当前 head 上（含最后一个代码提交）的 interrogate 结论。
 * 旧 head 的评审不算数，和 freshVerifyRows 用同一套新鲜度判据。
 *
 * @returns {Promise<{pass: boolean, passRow: object|null, fail: object|null}>}
 */
export async function interrogateStatus({ trail, headSha = '', repoDir = '' } = {}) {
  const rows = normalizeTrail(trail)
  let head = headSha
  if (!head && repoDir) head = await revParse(repoDir, 'HEAD')
  const codeHead = repoDir ? await lastCodeCommit(repoDir, head) : head
  const shas = [head, codeHead].filter(Boolean)
  let pass = false
  let passRow = null
  let fail = null
  for (const row of rows) {
    if (!isInterrogateRow(row) || !freshFor(row, shas)) continue
    if (row.result === 'pass') {
      pass = true
      passRow = row
    } else if (row.result === 'fail' && !fail) {
      fail = row
    }
  }
  return { pass, passRow, fail }
}

/**
 * 新鲜的验证者 id，按 id 去重。同一 id 写几行都算一个。
 * 旧行没有 id 时一行算一个，避免旧 trail 突然凑不够验证队。
 *
 * @returns {Promise<string[]>}
 */
export async function freshVerifiers({ trail, headSha = '', repoDir = '' } = {}) {
  const rows = await freshVerifyRows({ trail, headSha, repoDir })
  const ids = []
  rows.forEach((row, index) => {
    const id = verifierIdOf(row) || `legacy-${index + 1}`
    if (!ids.includes(id)) ids.push(id)
  })
  return ids
}

async function notifyIncident({ notifier, ticket, owner = '', repo = '', reason, tried, link }) {
  if (typeof notifier?.send !== 'function') return
  try {
    await sendEvent(notifier, {
      owner,
      repo,
      subject: `#${ticket.number}`,
      event: '出事',
      scope: reason,
      now: new Date(),
      link,
      data: {
        customer: ticket.customer || '未知客户',
        requirement: ticket.requirement || ticket.title || '',
        reason,
        tried,
        round: ticket.round ?? 1,
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

/** 默认推需求分支：读环境里的 token，仓库自己的 origin 决定要不要带认证头。 */
function defaultPushBranch({ repoDir, branch }) {
  return pushOrigin(repoDir, branch, {
    token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '',
  })
}

function renderEvidenceComment({ rows, ticketBranch, reqBranch, mergedHead, finalHead, risk, preview, interrogateRow }) {
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
    `- 合并时的版本：\`${mergedHead}\``,
    `- 关票时的版本：\`${finalHead}\``,
  ]
  if (risk === 'high') {
    lines.push(`- 高风险：已过 interrogate${interrogateRow?.decision ? `（${interrogateRow.decision}）` : ''}`)
  }
  if (preview?.url || preview?.address) {
    lines.push(`- 预览：${preview.url || `https://${preview.address}/`}（已销毁）`)
  }
  return lines.join('\n')
}

/**
 * 合并前的只读判定：分支、四样证据、风险、验证队、预览需求。
 * `mergeTicket` 和 `--dry-run` 共用这一份，避免两边判据不一致。
 * 只读仓库和 trail，不跑 agent、不起预览、不写 GitHub。
 *
 * @returns {Promise<object>} ok、reason、missing、stale，以及
 *   risk（high|normal）、plan（verifyPlan 结果）、fresh（新验证者 id）、
 *   preview.required、rows、interrogate（trail 里有没有 interrogate 行）
 */
export async function assessMerge({ repoDir, ticketBranch, reqBranch, ticket, trail } = {}) {
  if (!repoDir || !ticketBranch || !reqBranch || !ticket?.number) {
    return {
      ok: false,
      reason: 'bad_input',
      missing: ['repoDir、ticketBranch、reqBranch、ticket.number 都要有'],
      stale: [],
    }
  }

  const ticketHead = await revParse(repoDir, ticketBranch)
  if (!ticketHead) {
    return { ok: false, reason: 'branch_not_found', missing: [`分支不存在：${ticketBranch}`], stale: [] }
  }
  const reqHead = await revParse(repoDir, reqBranch)
  if (!reqHead) {
    return { ok: false, reason: 'branch_not_found', missing: [`分支不存在：${reqBranch}`], stale: [] }
  }
  if (await isAncestor(repoDir, ticketBranch, reqBranch)) {
    return {
      ok: true,
      alreadyMerged: true,
      headSha: reqHead,
      mergedSha: reqHead,
      missing: [],
      stale: [],
    }
  }

  const rows = trail ? normalizeTrail(trail) : await readTrail({ repoDir, ticket: ticket.number })
  const evidence = await evidenceReady({ trail: rows, headSha: ticketHead, repoDir })
  const { files, diffStat } = await diffInfo(repoDir, reqBranch, ticketBranch)
  const risk = riskLevel({ files, diffStat })
  const plan = verifyPlan({ risk, changedLines: diffStat.additions + diffStat.deletions })
  const fresh = await freshVerifiers({ trail: rows, headSha: ticketHead, repoDir })
  const preview = { required: previewNeeded({ trail: serializeTrail(rows) }) }
  const interrogate = (await interrogateStatus({ trail: rows, headSha: ticketHead, repoDir })).pass

  const missing = [...evidence.missing]
  if (risk === 'high' && fresh.length < plan.verifiers) {
    missing.push(`高风险验证队（至少 ${plan.verifiers} 个验证者，当前 ${fresh.length} 个）`)
  }

  return {
    ok: missing.length === 0 && evidence.stale.length === 0,
    ...(missing.length || evidence.stale.length ? { reason: 'evidence_not_ready' } : {}),
    headSha: ticketHead,
    reqHead,
    missing,
    stale: evidence.stale,
    risk,
    plan,
    fresh,
    preview,
    rows,
    interrogate,
  }
}

/**
 * 合进需求分支。四样证据不齐不合；合完在合并提交上重跑验证，
 * 失败就回滚到合并前的需求分支。
 *
 * 注入点签名（给 #466 用）：
 * - `verifier({ repoDir, headSha, ticket }) => {ok|pass, problems?, evidence?}`
 * - `review({ repoDir, headSha, ticket, mode }) => {ok|pass, decision?, evidence?}`
 * - `merger({ repoDir, files, ticket, ticketBranch, reqBranch }) => {ok}`
 * - `push({ repoDir, owner, repo, branch }) => void`，合并前推票分支、合并后推需求分支；默认带 `GITHUB_TOKEN` 推 origin
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
  push,
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

  const assessment = await assessMerge({ repoDir, ticketBranch, reqBranch, ticket, trail })
  if (!assessment.ok) {
    return {
      ok: false,
      reason: assessment.reason || 'evidence_not_ready',
      missing: assessment.missing,
      stale: assessment.stale,
    }
  }
  if (assessment.alreadyMerged) {
    return {
      ok: true,
      alreadyMerged: true,
      headSha: assessment.headSha,
      mergedSha: assessment.mergedSha,
      missing: [],
      stale: [],
    }
  }

  let ticketHead = assessment.headSha
  const reqHeadBefore = assessment.reqHead
  const rows = assessment.rows
  const { risk, plan } = assessment
  let interrogateRow = null

  if (risk === 'high' && !assessment.interrogate) {
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
    interrogateRow = appended
    await git(repoDir, ['add', '--', `.audit/${ticket.number}.tsv`]).catch(() => {})
    await git(repoDir, ['commit', '-m', `FACTORY: 补 interrogate 评审 #${ticket.number}`]).catch(() => {})
    ticketHead = (await revParse(repoDir, ticketBranch)) || ticketHead
  }

  const evidenceCommit = await commitEvidenceFiles({ repoDir, rows, ticketBranch, ticket })
  if (evidenceCommit.headSha) ticketHead = evidenceCommit.headSha

  if (risk === 'high' && !interrogateRow) {
    interrogateRow = (await interrogateStatus({ trail: rows, headSha: ticketHead, repoDir })).passRow
  }

  const previewRequired = Boolean(preview?.needed) || assessment.preview.required
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
        owner,
        repo,
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
    // 票分支上的 fixer、证据提交只留在本地时，PR 头还是旧提交。
    // 合进需求分支前先推票分支；推失败本轮不合，下一轮重试。
    const pushTicket = typeof push === 'function' ? push : defaultPushBranch
    try {
      await pushTicket({ repoDir, owner, repo, branch: ticketBranch })
    } catch (error) {
      return { ok: false, reason: 'push_failed', error: errorText(error), headSha: ticketHead }
    }

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
          owner,
          repo,
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
        owner,
        repo,
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

    // 合并只在本地完成时，下一张票点火会把需求分支重置回 origin。
    // 先推，推成功才关票；推失败保留本地合并且不关票。
    const pushReq = typeof push === 'function' ? push : defaultPushBranch
    try {
      await pushReq({ repoDir, owner, repo, branch: reqBranch })
    } catch (error) {
      return {
        ok: false,
        reason: 'push_failed',
        error: errorText(error),
        headSha: finalHead,
        mergedSha,
        originalBranch,
      }
    }

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
            mergedHead: ticketHead,
            finalHead,
            risk,
            preview: previewInfo,
            interrogateRow,
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
        for (const name of names.filter((row) => row.startsWith('状态:') && row !== STATE_PENDING)) {
          await gh.removeLabel({ owner, repo, number: ticket.number, name })
        }
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
              ticket: ticket.number,
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

