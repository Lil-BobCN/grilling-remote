/**
 * 验证和评审 agent 的 trail 记录。
 *
 * 两个 agent 都不改代码，只在最后一行写 `AFK_VERDICT {json}`：
 * `{ok, evidence: [截图或 trace 路径], problems: [...], tests: [{command, result}], link}`。
 * 这里解析这一行，把结果追加成 `.audit/<票号>.tsv` 的行：
 *
 * - `phase=verify`，`decision=<head>`，`why` 可带 `verifier=<id>`，`evidence=<路径，逗号分隔>`，`result=pass|fail`；
 * - `phase=test`，有测试结果时一行一条；
 * - `phase=review`，`decision=标准`、`decision=spec` 或 `decision=interrogate`。
 *
 * 截图路径在仓库里不存在时判 fail，不把没留下的证据写成通过。
 */
import { mkdir, readFile, rename, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { appendTrail } from './evidence.mjs'
import { FIXER_TOOLS, REVIEW_TOOLS, NO_WRITE_TOOLS, VERIFY_TOOLS } from './agent-runner.mjs'
import { git } from './git.mjs'

export const AGENTS_DIR = fileURLToPath(new URL('../agents/', import.meta.url))
export const FIX_COMMIT_PREFIX = 'FACTORY: 评审修复'

function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

function tail(text, limit = 400) {
  const value = String(text ?? '').trim()
  return value.length > limit ? value.slice(-limit) : value
}

function stringList(value) {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item ?? '').trim()).filter(Boolean)
}

/**
 * 解析 agent 输出里的 `AFK_VERDICT` 行。支持新格式的 JSON 和旧的
 * `AFK_VERDICT: pass` / `AFK_VERDICT: fail 原因`。
 */
export function parseAuditVerdict(stdout) {
  const line = String(stdout ?? '')
    .split(/\r?\n/)
    .reverse()
    .find((row) => /^AFK_VERDICT\b/.test(row.trim()))
  if (!line) return { found: false, ok: false, problems: ['agent 没写 AFK_VERDICT 行'] }
  const body = line.trim().replace(/^AFK_VERDICT\s*:?\s*/, '')
  if (body.startsWith('{')) {
    let parsed
    try {
      parsed = JSON.parse(body)
    } catch {
      return { found: true, ok: false, problems: [`AFK_VERDICT 不是合法 JSON：${tail(body)}`] }
    }
    return {
      found: true,
      ok: parsed?.ok === true || parsed?.pass === true,
      evidence: stringList(parsed?.evidence),
      problems: stringList(parsed?.problems),
      tests: Array.isArray(parsed?.tests) ? parsed.tests : [],
      link: String(parsed?.link || parsed?.comment || parsed?.url || ''),
    }
  }
  if (/^pass\b/i.test(body)) return { found: true, ok: true, evidence: [], problems: [], tests: [], link: '' }
  return {
    found: true,
    ok: false,
    evidence: [],
    problems: [body.replace(/^fail\b\s*/i, '') || 'agent 判不过'],
    tests: [],
    link: '',
  }
}

/** 未写成链接的本地证据路径。 */
function localPaths(evidence = []) {
  return evidence.filter((item) => item && !/^[a-z][a-z0-9+.-]*:\/\//i.test(item))
}

async function pathExists({ repoDir, headSha, token }) {
  if (isAbsolute(token)) {
    try {
      await stat(token)
      return true
    } catch {
      return false
    }
  }
  try {
    await git(repoDir, ['cat-file', '-e', `${headSha}:${token.replace(/^\.\//, '')}`])
    return true
  } catch {
    try {
      await stat(join(repoDir, token))
      return true
    } catch {
      return false
    }
  }
}

async function missingEvidence({ repoDir, headSha, verdict }) {
  const missing = []
  for (const token of localPaths(verdict.evidence)) {
    if (!(await pathExists({ repoDir, headSha, token }))) {
      missing.push(`截图或 trace 不存在：${token}`)
    }
  }
  return missing
}

/** 验证证据按票和验证者分目录，跨票、跨验证者同名不覆盖。 */
export function evidenceDirFor({ ticket, verifierId = '' }) {
  const id = String(verifierId || '').trim().replace(/\s+/g, '-') || 'default'
  return `.audit/evidence/${String(ticket).trim()}/${id}`
}

async function isTrackedPath(repoDir, path) {
  try {
    await git(repoDir, ['ls-files', '--error-unmatch', '--', path])
    return true
  } catch {
    return false
  }
}

/**
 * 把共享目录里的未跟踪证据挪进票和验证者自己的目录，返回改写后的路径。
 * 已经提交进 git 的证据不动：它挂在票分支上，已经按票隔离。
 */
async function relocateEvidence({ repoDir, ticket, verifierId, evidence = [] }) {
  const dir = evidenceDirFor({ ticket, verifierId })
  const moves = new Map()
  const used = new Set()
  for (const token of evidence) {
    if (!token || isAbsolute(token) || /^[a-z][a-z0-9+.-]*:\/\//i.test(token)) continue
    const clean = token.replace(/^\.\//, '')
    if (!clean || clean.startsWith(`${dir}/`)) continue
    if (clean.split('/').includes('..') || clean.startsWith('.git/')) continue
    try {
      if (!(await stat(join(repoDir, clean))).isFile()) continue
    } catch {
      continue
    }
    if (await isTrackedPath(repoDir, clean)) continue
    const relative = (clean.startsWith('.audit/') ? clean.slice('.audit/'.length) : clean).replace(
      /^\/+/,
      '',
    )
    if (!relative) continue
    let target = `${dir}/${relative}`
    let index = 2
    while (used.has(target)) {
      const dot = relative.lastIndexOf('.')
      const suffixed =
        dot > 0 ? `${relative.slice(0, dot)}-${index}${relative.slice(dot)}` : `${relative}-${index}`
      target = `${dir}/${suffixed}`
      index += 1
    }
    used.add(target)
    await mkdir(dirname(join(repoDir, target)), { recursive: true })
    await rename(join(repoDir, clean), join(repoDir, target))
    moves.set(token, target)
  }
  return evidence.map((token) => moves.get(token) || token)
}

function testPassed(row) {
  if (typeof row === 'string') return /^(pass|ok|通过|0)$/i.test(row.trim())
  if (row?.pass === true || row?.ok === true) return true
  if (typeof row?.result === 'string') return /^(pass|ok|通过|0)$/i.test(row.result.trim())
  if (Number.isInteger(row?.exitCode)) return row.exitCode === 0
  return false
}

function testCommand(row) {
  if (typeof row === 'string') return row
  return String(row?.command || row?.cmd || '').trim()
}

function testResultText(row) {
  if (typeof row === 'string') return row
  if (row?.result !== undefined) return String(row.result)
  if (row?.exitCode !== undefined) return `exit ${row.exitCode}`
  if (row?.output !== undefined) return tail(row.output)
  return testPassed(row) ? 'pass' : 'fail'
}

function verifyBrief({ ticket, branch, headSha, before, instructions, extraBrief = '', evidenceDir = '' }) {
  return [
    String(instructions || '').trim(),
    '',
    '## 这次验证',
    '',
    `票：#${ticket}`,
    `分支：${branch}`,
    `head：${headSha}`,
    before ? `改前提交：${before}` : '改前提交：没给',
    ...(evidenceDir ? [`证据目录：${evidenceDir}/`] : []),
    ...(extraBrief ? ['', String(extraBrief).trim()] : []),
    '',
    '要求：',
    '- 不改代码，不提交，不推分支。',
    '- 截图和 trace 写成相对仓库根目录的路径，放进上面的证据目录，不要放共享目录。',
    '- 最后一行只写一行 JSON：',
    `  AFK_VERDICT {"ok":true,"evidence":["${evidenceDir || '.audit/verify'}/after.png"],"problems":[],"tests":[{"command":"npm test","result":"pass"}]}`,
    '  判不过时 ok 写 false，problems 写清原因；没有跑测试就不写 tests。',
  ].join('\n')
}

/**
 * 跑一次验证 agent，写 verify 和 test 行。
 *
 * `verifierId` 记在 verify 行的 why 里（`verifier=<id>`），用于按验证者去重；
 * 不传时行为不变，旧 trail 一样能读。
 *
 * @returns {Promise<{ok: boolean, headSha: string, problems: string[], evidence: string[], rows: object[]}>}
 */
export async function runVerifyAudit({
  repoDir,
  ticket,
  branch,
  before = '',
  verifierId = '',
  runner,
  instructions,
  agentsDir = AGENTS_DIR,
  extraBrief = '',
  record = true,
  now,
} = {}) {
  if (!repoDir || !ticket || !branch) throw new Error('验证需要 repoDir、ticket 和 branch')
  if (typeof runner?.run !== 'function') throw new Error('验证需要注入 runner')
  const headSha = await git(repoDir, ['rev-parse', branch])
  const id = String(verifierId || '').trim().replace(/\s+/g, '-')
  const evidenceDir = evidenceDirFor({ ticket, verifierId: id })
  const text = instructions ?? (await readFile(join(agentsDir, 'verify.md'), 'utf8'))
  const run = await runner.run({
    name: `verify-${ticket}-${headSha.slice(0, 8)}${id ? `-${id}` : ''}`,
    cwd: repoDir,
    tools: NO_WRITE_TOOLS,
    allowedTools: VERIFY_TOOLS,
    brief: verifyBrief({ ticket, branch, headSha, before, instructions: text, extraBrief, evidenceDir }),
  })

  const verdict = run?.ok
    ? parseAuditVerdict(run.stdout)
    : { found: false, ok: false, problems: [`验证 agent 退出码 ${run?.code ?? 1}：${tail(run?.stderr || run?.stdout)}`], evidence: [], tests: [] }

  const evidence = await relocateEvidence({
    repoDir,
    ticket,
    verifierId: id,
    evidence: stringList(verdict.evidence),
  })
  const problems = [...(verdict.problems || [])]
  const missing = await missingEvidence({ repoDir, headSha, verdict: { evidence } })
  problems.push(...missing)
  if (!verdict.found && problems.length === 0) problems.push('验证 agent 没写 AFK_VERDICT 行')
  const ok = verdict.ok && problems.length === 0

  const rows = []
  if (record) {
    rows.push(
      await appendTrail({
        repoDir,
        ticket,
        ts: now,
        phase: 'verify',
        decision: headSha,
        why: `${before ? `改前 ${before}` : '按验收条件验证'}${id ? ` · verifier=${id}` : ''}`,
        evidence: evidence.join(','),
        result: ok ? 'pass' : 'fail',
      }),
    )
  }

  for (const test of verdict.tests || []) {
    const command = testCommand(test)
    if (!command || !record) continue
    rows.push(
      await appendTrail({
        repoDir,
        ticket,
        ts: now,
        phase: 'test',
        decision: command,
        why: '验证 agent 跑的测试',
        evidence: testResultText(test),
        result: testPassed(test) ? 'pass' : 'fail',
      }),
    )
  }

  return { ok, headSha, problems, evidence, rows }
}

function reviewBrief({ ticket, branch, headSha, mode, instructions, extraBrief = '' }) {
  return [
    String(instructions || '').trim(),
    '',
    '## 这次评审',
    '',
    `票：#${ticket}`,
    `分支：${branch}`,
    `head：${headSha}`,
    `模式：${mode}`,
    ...(extraBrief ? ['', String(extraBrief).trim()] : []),
    '',
    '要求：',
    '- 不改代码，不提交，不推分支。',
    '- 意见写文件路径和行号；有一个「采纳」就判 fail。',
    '- 最后一行只写一行 JSON：',
    '  AFK_VERDICT {"ok":true,"evidence":["https://github.com/…/pull/1#discussion_r1"],"problems":[]}',
    '  判不过时 ok 写 false，problems 写清原因。',
  ].join('\n')
}

const REVIEW_DECISIONS = {
  all: ['标准', 'spec'],
  standards: ['标准'],
  standard: ['标准'],
  spec: ['spec'],
  interrogate: ['interrogate'],
}

/** 跑一次评审 agent，按模式写一条或两条 review 行。 */
export async function runReviewAudit({
  repoDir,
  ticket,
  branch,
  mode = 'all',
  runner,
  instructions,
  agentsDir = AGENTS_DIR,
  extraBrief = '',
  record = true,
  now,
} = {}) {
  if (!repoDir || !ticket || !branch) throw new Error('评审需要 repoDir、ticket 和 branch')
  if (typeof runner?.run !== 'function') throw new Error('评审需要注入 runner')
  const decisions = REVIEW_DECISIONS[mode]
  if (!decisions) throw new Error(`评审模式只能是 ${Object.keys(REVIEW_DECISIONS).join('、')}`)

  const headSha = await git(repoDir, ['rev-parse', branch])
  const text = instructions ?? (await readFile(join(agentsDir, 'review.md'), 'utf8'))
  const run = await runner.run({
    name: `review-${ticket}-${mode}`,
    cwd: repoDir,
    tools: NO_WRITE_TOOLS,
    allowedTools: REVIEW_TOOLS,
    brief: reviewBrief({ ticket, branch, headSha, mode, instructions: text, extraBrief }),
  })

  const verdict = run?.ok
    ? parseAuditVerdict(run.stdout)
    : { found: false, ok: false, problems: [`评审 agent 退出码 ${run?.code ?? 1}：${tail(run?.stderr || run?.stdout)}`], evidence: [] }
  const problems = [...(verdict.problems || [])]
  if (!verdict.found && problems.length === 0) problems.push('评审 agent 没写 AFK_VERDICT 行')
  const ok = verdict.ok && problems.length === 0
  const link = verdict.link || (verdict.evidence || []).find((item) => /^https?:\/\//i.test(item)) || ''
  const summary = link || (ok ? 'AFK_VERDICT pass' : tail(problems.join('；') || '评审没过'))

  const rows = []
  for (const decision of record ? decisions : []) {
    rows.push(
      await appendTrail({
        repoDir,
        ticket,
        ts: now,
        phase: 'review',
        decision,
        why: `head ${headSha}`,
        evidence: summary,
        result: ok ? 'pass' : 'fail',
      }),
    )
  }

  return { ok, headSha, problems, evidence: [summary], decision: decisions.join('、'), rows }
}

function fixerBrief({ ticket, branch, headSha, round, findings, instructions }) {
  return [
    String(instructions || '').trim(),
    '',
    '## 这次修复',
    '',
    `票：#${ticket}`,
    `分支：${branch}`,
    `head：${headSha}`,
    `轮次：${round}`,
    '',
    '评审没过的问题：',
    ...(findings.length ? findings.map((finding) => `- ${finding}`) : ['- 见评审意见']),
    '',
    `改完提交，提交信息以 \`${FIX_COMMIT_PREFIX} #${ticket} 第${round}轮\` 开头。只改这些问题，不扩大范围；修不了就在正文写清原因，不要硬改。`,
  ].join('\n')
}

/**
 * 已经用掉的修复轮次：数票分支上 `FACTORY: 评审修复 #<票号>` 开头的提交。
 * 轮次上限靠它跨调度轮次累计。
 */
export async function fixerRoundsUsed({ repoDir, ticket, branch }) {
  const output = await git(repoDir, ['log', '--format=%s', branch]).catch(() => '')
  if (!output) return 0
  const marker = `${FIX_COMMIT_PREFIX} #${ticket}`
  return output.split(/\r?\n/).filter((line) => line.startsWith(marker)).length
}

/**
 * 跑一次修复 agent，只改票分支。
 *
 * agent 自己提交或把改动留在工作树都可以：留下未提交的代码改动由这里补提交，
 * 提交信息统一 `FACTORY: 评审修复 #<票号> 第<轮>轮`，复评跑在提交后的 head 上。
 * `.audit/` 不算代码改动，不因为证据行多了就记一轮。
 *
 * @returns {Promise<{ok: boolean, changed: boolean, headSha: string, problems: string[]}>}
 */
export async function runFixerAudit({
  repoDir,
  ticket,
  branch,
  round = 1,
  findings = [],
  runner,
  instructions,
  agentsDir = AGENTS_DIR,
} = {}) {
  if (!repoDir || !ticket || !branch) throw new Error('修复需要 repoDir、ticket 和 branch')
  if (typeof runner?.run !== 'function') throw new Error('修复需要注入 runner')
  const headSha = await git(repoDir, ['rev-parse', branch])
  const text = instructions ?? (await readFile(join(agentsDir, 'fixer.md'), 'utf8').catch(() => ''))
  const run = await runner.run({
    name: `fix-${ticket}-${headSha.slice(0, 8)}-r${round}`,
    cwd: repoDir,
    allowedTools: FIXER_TOOLS,
    brief: fixerBrief({ ticket, branch, headSha, round, findings, instructions: text }),
  })

  const problems = []
  if (!run?.ok) {
    problems.push(`修复 agent 退出码 ${run?.code ?? 1}：${tail(run?.stderr || run?.stdout)}`)
  }

  let after = headSha
  try {
    const status = await git(repoDir, ['status', '--porcelain'])
    const codeChanges = status
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .filter((line) => !line.slice(3).startsWith('.audit/'))
    if (codeChanges.length) {
      // 只提交代码改动；trail 还留在工作树里，等合并阶段按原有路径提交。
      await git(repoDir, ['add', '-A', '--', '.', ':(exclude).audit'])
      const staged = await git(repoDir, ['diff', '--cached', '--name-only'])
      if (staged) {
        await git(repoDir, ['commit', '-m', `${FIX_COMMIT_PREFIX} #${ticket} 第${round}轮`])
      }
    }
    after = await git(repoDir, ['rev-parse', branch])
  } catch (error) {
    problems.push(`修复提交失败：${errorText(error)}`)
  }
  if (after === headSha) problems.push('修复 agent 没改出提交')
  return { ok: problems.length === 0, changed: after !== headSha, headSha: after, problems }
}
