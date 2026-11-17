/**
 * 验证和评审 agent 的 trail 记录。
 *
 * 两个 agent 都不改代码，只在最后一行写 `AFK_VERDICT {json}`：
 * `{ok, evidence: [截图或 trace 路径], problems: [...], tests: [{command, result}], link}`。
 * 这里解析这一行，把结果追加成 `.audit/<票号>.tsv` 的行：
 *
 * - `phase=verify`，`decision=<head>`，`evidence=<路径，逗号分隔>`，`result=pass|fail`；
 * - `phase=test`，有测试结果时一行一条；
 * - `phase=review`，`decision=标准`、`decision=spec` 或 `decision=interrogate`。
 *
 * 截图路径在仓库里不存在时判 fail，不把没留下的证据写成通过。
 */
import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { appendTrail } from './evidence.mjs'
import { REVIEW_TOOLS, NO_WRITE_TOOLS, VERIFY_TOOLS } from './agent-runner.mjs'
import { git } from './git.mjs'

export const AGENTS_DIR = fileURLToPath(new URL('../agents/', import.meta.url))

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

function verifyBrief({ ticket, branch, headSha, before, instructions, extraBrief = '' }) {
  return [
    String(instructions || '').trim(),
    '',
    '## 这次验证',
    '',
    `票：#${ticket}`,
    `分支：${branch}`,
    `head：${headSha}`,
    before ? `改前提交：${before}` : '改前提交：没给',
    ...(extraBrief ? ['', String(extraBrief).trim()] : []),
    '',
    '要求：',
    '- 不改代码，不提交，不推分支。',
    '- 截图和 trace 写成相对仓库根目录的路径。',
    '- 最后一行只写一行 JSON：',
    '  AFK_VERDICT {"ok":true,"evidence":[".audit/verify/after.png"],"problems":[],"tests":[{"command":"npm test","result":"pass"}]}',
    '  判不过时 ok 写 false，problems 写清原因；没有跑测试就不写 tests。',
  ].join('\n')
}

/**
 * 跑一次验证 agent，写 verify 和 test 行。
 *
 * @returns {Promise<{ok: boolean, headSha: string, problems: string[], evidence: string[], rows: object[]}>}
 */
export async function runVerifyAudit({
  repoDir,
  ticket,
  branch,
  before = '',
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
  const text = instructions ?? (await readFile(join(agentsDir, 'verify.md'), 'utf8'))
  const run = await runner.run({
    name: `verify-${ticket}-${headSha.slice(0, 8)}`,
    cwd: repoDir,
    tools: NO_WRITE_TOOLS,
    allowedTools: VERIFY_TOOLS,
    brief: verifyBrief({ ticket, branch, headSha, before, instructions: text, extraBrief }),
  })

  const verdict = run?.ok
    ? parseAuditVerdict(run.stdout)
    : { found: false, ok: false, problems: [`验证 agent 退出码 ${run?.code ?? 1}：${tail(run?.stderr || run?.stdout)}`], evidence: [], tests: [] }

  const problems = [...(verdict.problems || [])]
  const missing = await missingEvidence({ repoDir, headSha, verdict })
  problems.push(...missing)
  if (!verdict.found && problems.length === 0) problems.push('验证 agent 没写 AFK_VERDICT 行')
  const ok = verdict.ok && problems.length === 0

  const evidence = stringList(verdict.evidence)
  const rows = []
  if (record) {
    rows.push(
      await appendTrail({
        repoDir,
        ticket,
        ts: now,
        phase: 'verify',
        decision: headSha,
        why: before ? `改前 ${before}` : '按验收条件验证',
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
