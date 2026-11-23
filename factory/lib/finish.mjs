/**
 * 收尾：全部子票合进需求分支后，跑一次收尾评审，写 /pr 四栏，验证和评审都过了自己合主干。
 *
 * 与 `evidence.mjs` 的分工：那里管单张子票的四样证据和子票进需求分支；
 * 这里管需求分支进主干。证据读票分支的 `.audit/<票号>.tsv`，合并行是
 * `phase=merge result=pass`。
 */
import { dirname } from 'node:path'
import { git } from './git.mjs'
import { sendEvent } from './notify.mjs'
import { hasLabel } from './scheduler.mjs'
import { parentCustomer, parentRequirement } from './ignition.mjs'
import {
  MANIFEST_RE,
  readTrail,
  resolveMaxFixRounds,
  riskLevel,
  riskReasons,
} from './evidence.mjs'

const SMALL_LABEL = '大小:小需求'

/**
 * 门方向由规则判定，agent 只能往危险方向改。
 * 规则判双向门时允许标成单向门；规则判单向门时不允许改回双向门。
 */
export function mergeRisk({ files = [], diffStat = {}, direction, maxLines = 400, maxFiles = 10 } = {}) {
  if (direction !== undefined && !['one-way', 'two-way'].includes(direction)) {
    throw new Error(`门方向只能是 one-way 或 two-way，收到：${String(direction)}`)
  }
  const ruleDirection =
    riskLevel({ files, diffStat, maxLines, maxFiles }) === 'high' ? 'one-way' : 'two-way'
  const reasons = riskReasons({ files, diffStat, maxLines, maxFiles })

  if (direction === 'one-way' && ruleDirection === 'two-way') {
    return { direction: 'one-way', reasons: [...reasons, '标成单向门（规则判的是双向门）'] }
  }
  if (direction === 'two-way' && ruleDirection === 'one-way') {
    throw new Error('门方向只能往危险方向改：规则判定单向门，不能改成双向门')
  }
  return { direction: ruleDirection, reasons }
}

function textBlock(value) {
  if (Array.isArray(value)) return value.map(String).join('\n')
  return String(value ?? '')
}

function bulletBlock(value) {
  const rows = Array.isArray(value) ? value.map(String) : [String(value ?? '')]
  return rows
    .filter((row) => row.trim() !== '')
    .map((row) => (row.trimStart().startsWith('-') || row.trimStart().startsWith(' ') ? row : `- ${row}`))
    .join('\n')
}

function renderRisk(risk) {
  const direction = risk?.direction === 'one-way' ? '单向门' : '双向门'
  const lines = [direction, '', '方向由规则判定，只能往危险方向改。']
  const reasons = Array.isArray(risk?.reasons) ? risk.reasons : []
  if (reasons.length) {
    lines.push('', ...reasons.map((reason) => `- ${reason}`))
  }
  return lines.join('\n')
}

function renderImpact(impact = {}) {
  const files = (Array.isArray(impact.files) ? impact.files : []).map((file) =>
    typeof file === 'string' ? file : file?.path || '',
  ).filter(Boolean)
  const directories = (Array.isArray(impact.directories) ? impact.directories : []).filter(Boolean)
  const behavior = Array.isArray(impact.behavior) ? impact.behavior.filter(Boolean) : []
  const shownFiles = files.slice(0, 20).join('、')
  const lines = [
    `- 改动文件 ${files.length} 个${shownFiles ? `：${shownFiles}` : ''}`,
    `- 功能目录：${directories.length ? directories.join('、') : '无'}`,
    `- 对外行为：${behavior.length ? behavior.join('；') : '见摘要里的提交说明'}`,
  ]
  return lines.join('\n')
}

/** `/pr` 四栏：摘要、证据、合并危险、影响范围。标题固定。 */
export function prBody({ summary = '', evidence = [], risk = {}, impact = {} } = {}) {
  return [
    '## 摘要',
    '',
    textBlock(summary),
    '',
    '## 证据',
    '',
    bulletBlock(evidence),
    '',
    '## 合并危险',
    '',
    renderRisk(risk),
    '',
    '## 影响范围',
    '',
    renderImpact(impact),
    '',
  ].join('\n')
}


function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

function passed(outcome) {
  if (outcome === true) return true
  if (!outcome || typeof outcome !== 'object') return false
  return outcome.ok === true || outcome.pass === true
}

function findingsOf(outcome) {
  if (!outcome || typeof outcome !== 'object') return []
  if (Array.isArray(outcome.findings)) return outcome.findings.map(String)
  if (Array.isArray(outcome.problems)) return outcome.problems.map(String)
  if (outcome.error) return [String(outcome.error)]
  return []
}

function issueLink(issue, owner, repo) {
  if (issue?.html_url) return issue.html_url
  if (owner && repo && issue?.number) {
    return `https://github.com/${owner}/${repo}/issues/${issue.number}`
  }
  return ''
}

function evidenceRows(rows, phase) {
  return rows.filter((row) => row.phase === phase && row.result === 'pass')
}

function ticketEvidence(ticket, rows) {
  return {
    ticket: ticket.number,
    title: ticket.title,
    merged: ticket.merged,
    verify: evidenceRows(rows, 'verify'),
    test: evidenceRows(rows, 'test'),
    review: evidenceRows(rows, 'review'),
    merge: evidenceRows(rows, 'merge'),
  }
}

/**
 * 读父工单、子票和每条子票的 trail。
 *
 * `repoDir` 是读 `.audit/<票号>.tsv` 的地方；契约里没列，但 trail 在本地仓库里，
 * 调用方要传。`reqBranch` 用来查票分支是否已合进需求分支（手工合并、trail 丢失时兜底）。
 * `unmerged` 是还开着、trail 没有 merge pass 行、票分支也不是需求分支祖先的子票号。
 */
export async function collectRequirementState({
  gh,
  owner,
  repo,
  parent,
  repoDir = '',
  reqBranch = '',
}) {
  if (!gh || !owner || !repo) throw new Error('collectRequirementState 缺 gh、owner 或 repo')
  const number = typeof parent === 'object' && parent?.number ? parent.number : Number(parent)
  if (!Number.isInteger(number) || number <= 0) throw new Error('collectRequirementState 缺父工单号')
  const parentIssue =
    typeof parent === 'object' && parent?.number
      ? parent
      : await gh.getIssue({ owner, repo, number })

  const children = await gh.listSubIssues({ owner, repo, number })
  const subIssues = []
  const evidence = []
  const unmerged = []

  for (const child of children) {
    const trail = repoDir ? await readTrail({ repoDir, ticket: child.number }) : []
    const mergeRow = trail.find((row) => row.phase === 'merge' && row.result === 'pass')
    const branchMerged =
      Boolean(repoDir) &&
      Boolean(reqBranch) &&
      (await isAncestor(repoDir, `ticket/${child.number}`, reqBranch))
    const merged = child.state === 'closed' && (Boolean(mergeRow) || branchMerged)
    const item = { ...child, trail, merged }
    subIssues.push(item)
    evidence.push(ticketEvidence(item, trail))
    if (!merged) unmerged.push(child.number)
  }

  return {
    parent: parentIssue,
    subIssues,
    allClosed: children.every((child) => child.state === 'closed'),
    unmerged,
    evidence,
  }
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
  } catch {
    return false
  }
}

async function commitSubjects(repoDir, base, head) {
  const output = await git(repoDir, ['log', '--no-decorate', '--format=%h %s', `${base}..${head}`]).catch(
    () => '',
  )
  return output ? output.split(/\r?\n/).filter(Boolean) : []
}

async function diffSummary(repoDir, base, head) {
  const names = await git(repoDir, ['diff', '--name-status', `${base}...${head}`]).catch(() => '')
  const files = []
  for (const line of names.split(/\r?\n/)) {
    if (!line.trim()) continue
    const [status, ...rest] = line.split('\t')
    files.push({ path: rest[rest.length - 1] || '', status: status.toUpperCase() })
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

  const manifests = files.filter((file) => MANIFEST_RE.test(file.path)).map((file) => file.path)
  const text = manifests.length
    ? await git(repoDir, ['diff', `${base}...${head}`, '--', ...manifests]).catch(() => '')
    : ''
  return { files, diffStat: { additions, deletions, files: files.length, text } }
}

function directoriesOf(files) {
  const dirs = new Set()
  for (const file of files) {
    const dir = dirname(file.path || '') || '.'
    dirs.add(dir)
  }
  return [...dirs]
}

function evidenceTokens(text) {
  return String(text ?? '')
    .split(/[\s,;，；、]+/)
    .map((token) => token.replace(/^["'`([{]+|["'`\])}]+$/g, ''))
    .filter((token) => token && !token.startsWith('sha='))
    .filter((token) => !/^[a-z][a-z0-9+.-]*:\/\//i.test(token))
}

/** 证据栏按子票列：改前、改后、测试、评审、合并。 */
export function renderEvidence(evidence) {
  if (!Array.isArray(evidence) || evidence.length === 0) return '（没有子票证据）'
  const lines = []
  for (const item of evidence) {
    lines.push(`- #${item.ticket} ${item.title || ''}`.trimEnd())
    const before = []
    const after = []
    for (const row of item.verify || []) {
      const tokens = evidenceTokens(row.evidence)
      if (tokens.length === 0) {
        if (row.decision) (/改前|before/i.test(row.decision) ? before : after).push(row.decision)
        continue
      }
      for (const token of tokens) {
        if (/改前|before/i.test(token)) before.push(token)
        else if (/改后|after/i.test(token)) after.push(token)
        else if (/改前|before/i.test(row.decision || '')) before.push(token)
        else after.push(token)
      }
    }
    lines.push(`  - 改前：${before.length ? before.join('、') : '未留'}`)
    lines.push(`  - 改后：${after.length ? after.join('、') : '未留'}`)

    const tests = (item.test || []).map((row) => row.decision || row.evidence).filter(Boolean)
    lines.push(`  - 测试：${tests.length ? tests.join('；') : '未留'}`)

    const standard = (item.review || []).find((row) => String(row.decision).includes('标准'))
    const spec = (item.review || []).find((row) => /spec/i.test(String(row.decision)))
    lines.push(
      `  - 评审：标准 ${standard?.decision || '未留'}；spec ${spec?.decision || '未留'}`,
    )

    const merge = (item.merge || [])[0]
    if (merge) lines.push(`  - 合并：${merge.decision || '已合进需求分支'}`)
  }
  return lines.join('\n')
}

function prNumber(pr) {
  const raw = pr && typeof pr === 'object' ? pr.number : pr
  const direct = Number(raw)
  if (Number.isInteger(direct) && direct > 0) return direct
  const match = /\/pull\/(\d+)/.exec(String(pr?.html_url || pr?.url || pr || ''))
  return match ? Number(match[1]) : null
}

function normalizePr(pr, { owner, repo }) {
  const number = prNumber(pr)
  const htmlUrl =
    (pr && typeof pr === 'object' && (pr.html_url || pr.url)) ||
    (number ? `https://github.com/${owner}/${repo}/pull/${number}` : '')
  if (pr && typeof pr === 'object') return { ...pr, ...(number ? { number } : {}), html_url: htmlUrl }
  return { number, html_url: htmlUrl }
}

function factsOf(parentIssue) {
  const customer = parentCustomer(parentIssue?.body) || parentIssue?.customer || '未知客户'
  const requirement =
    parentRequirement(parentIssue?.body) || parentIssue?.requirement || parentIssue?.title || ''
  return { customer, requirement }
}

async function notifyIncident({ notifier, parentIssue, owner, repo, tag, tried, attempt = 1 }) {
  if (typeof notifier?.send !== 'function') return
  const facts = factsOf(parentIssue)
  try {
    await sendEvent(notifier, {
      owner,
      repo,
      subject: `#${parentIssue.number}`,
      event: '出事',
      scope: `验证评审修不过:${tag}`,
      now: new Date(),
      link: issueLink(parentIssue, owner, repo),
      data: {
        customer: facts.customer,
        requirement: facts.requirement,
        reason: '验证评审修不过',
        tried,
        attempt,
      },
    })
  } catch {
    // 通知失败不改变已经做出的判断。
  }
}

async function runReview({ review, repoDir, reqBranch, parentIssue, small }) {
  try {
    return await review({
      repoDir,
      branch: reqBranch,
      parent: parentIssue,
      axis: 'final',
      small,
    })
  } catch (error) {
    return { ok: false, error: `收尾评审跑不起来：${errorText(error)}` }
  }
}

async function runVerify({ verify, repoDir, branch, parentIssue }) {
  try {
    return await verify({ repoDir, branch, parent: parentIssue })
  } catch (error) {
    return { ok: false, error: `PR 验证跑不起来：${errorText(error)}` }
  }
}

/** 推需求分支；没注入 push 时跳过（测试或只读调用方）。 */
async function pushRequirement({ push, repoDir, owner, repo, reqBranch }) {
  if (typeof push !== 'function') return { ok: true }
  try {
    await push({ repoDir, owner, repo, branch: reqBranch })
    return { ok: true }
  } catch (error) {
    return { ok: false, error: errorText(error) }
  }
}

/**
 * 按分支 diff 生成 `/pr` 四栏，只读，不建 PR。`--dry-run` 也走这里。
 * 返回的 `title` 和 `body` 直接交给 `openPr`。
 */
export async function previewRequirement({ repoDir, parent, reqBranch, mainBranch = 'main' } = {}) {
  const parentIssue = parent?.parent
  if (!repoDir || !reqBranch || !parentIssue?.number) {
    throw new Error('previewRequirement 缺 repoDir、reqBranch 或 parent（collectRequirementState 的返回值）')
  }
  const commits = await commitSubjects(repoDir, mainBranch, reqBranch)
  const { files, diffStat } = await diffSummary(repoDir, mainBranch, reqBranch)
  const risk = mergeRisk({ files, diffStat })
  const evidence = renderEvidence(parent.evidence)
  const summary = [
    `需求：${parentIssue.title || ''}`.trim(),
    '',
    `提交 ${commits.length} 个：`,
    ...(commits.length ? commits.map((commit) => `- ${commit}`) : ['- 无']),
  ].join('\n')
  const impact = {
    files: files.map((file) => file.path).filter(Boolean),
    directories: directoriesOf(files),
    behavior: commits,
  }
  return {
    title: `合并 #${parentIssue.number} ${parentIssue.title || ''}`.trim(),
    summary,
    evidence,
    risk,
    impact,
    body: prBody({ summary, evidence, risk, impact }),
  }
}

/**
 * 收尾合并。
 *
 * `parent` 是 `collectRequirementState` 的返回值，不是 issue 本身。
 * 开 PR 前先推需求分支，fixer 的提交不能只留在本地。
 * 评审或验证过不了就停：通知「出事」，不改结论，不放宽检查。
 * 验证没过时把 problems 交给 fixer，修完重推、重跑评审和验证；
 * 修复轮次有上限（`maxFixRounds` 或环境变量 `AFK_MAX_FIX_ROUNDS`），用完仍失败就停。
 * 验证和评审都过就合主干，单向门只写进 PR 正文，不等人。
 */
export async function finishRequirement({
  repoDir,
  owner,
  repo,
  parent,
  reqBranch,
  mainBranch = 'main',
  review,
  verify,
  fixer,
  push,
  openPr,
  mergePr,
  notifier,
  cleanup,
  small,
  attempt = 1,
  maxFixRounds = resolveMaxFixRounds(),
} = {}) {
  const parentIssue = parent?.parent
  if (!repoDir || !reqBranch || !parentIssue?.number || parent?.allClosed === undefined) {
    return {
      ok: false,
      reason: 'bad_input',
      missing: ['repoDir、reqBranch、parent（collectRequirementState 的返回值）都要有'],
    }
  }
  if (parent.allClosed === false) {
    return {
      ok: false,
      reason: 'open_sub_tickets',
      open: (parent.subIssues || []).filter((ticket) => ticket.state !== 'closed').map((ticket) => ticket.number),
    }
  }
  const unmerged = Array.isArray(parent.unmerged) ? parent.unmerged : []
  if (unmerged.length) {
    return { ok: false, reason: 'unmerged_sub_tickets', unmerged }
  }

  const missing = []
  if (typeof review !== 'function') missing.push('review')
  if (typeof verify !== 'function') missing.push('verify')
  if (typeof openPr !== 'function') missing.push('openPr')
  if (typeof mergePr !== 'function') missing.push('mergePr')
  if (missing.length) return { ok: false, reason: 'bad_input', missing }

  const mainHead = await revParse(repoDir, mainBranch)
  const reqHead = await revParse(repoDir, reqBranch)
  if (mainHead && reqHead && (await isAncestor(repoDir, reqBranch, mainBranch))) {
    return { ok: true, alreadyMerged: true, mergeSha: mainHead }
  }

  const smallFlag =
    small === undefined ? hasLabel(parentIssue, SMALL_LABEL) : Boolean(small)

  let outcome = await runReview({ review, repoDir, reqBranch, parentIssue, small: smallFlag })
  let findings = findingsOf(outcome)
  if (!passed(outcome)) {
    if (typeof fixer !== 'function') {
      await notifyIncident({
        notifier,
        parentIssue,
        owner,
        repo,
        tag: '收尾评审',
        tried: `收尾评审没过${findings.length ? `：${findings.join('；')}` : ''}`,
        attempt,
      })
      return { ok: false, reason: 'review_failed', findings }
    }

    let fixNote = ''
    try {
      const fixed = await fixer({ repoDir, branch: reqBranch, findings })
      if (fixed && typeof fixed === 'object' && fixed.ok === false) {
        fixNote = `统一修没成：${findingsOf(fixed).join('；') || '未知原因'}`
      }
    } catch (error) {
      fixNote = `统一修没成：${errorText(error)}`
    }

    outcome = await runReview({ review, repoDir, reqBranch, parentIssue, small: smallFlag })
    if (!passed(outcome)) {
      const second = findingsOf(outcome)
      findings = second.length ? second : findings
      await notifyIncident({
        notifier,
        parentIssue,
        owner,
        repo,
        tag: '收尾评审',
        tried: `收尾评审两轮没过${findings.length ? `：${findings.join('；')}` : ''}${fixNote ? `。${fixNote}` : ''}`,
        attempt,
      })
      return { ok: false, reason: 'review_failed', findings }
    }
  }

  const pushed = await pushRequirement({ push, repoDir, owner, repo, reqBranch })
  if (!pushed.ok) {
    return { ok: false, reason: 'push_failed', error: pushed.error }
  }

  const preview = await previewRequirement({ repoDir, parent, reqBranch, mainBranch })
  const body = preview.body
  const title = preview.title
  const risk = preview.risk

  let created
  try {
    created = await openPr({ owner, repo, base: mainBranch, head: reqBranch, title, body })
  } catch (error) {
    return { ok: false, reason: 'pr_failed', error: errorText(error) }
  }
  const pr = normalizePr(created, { owner, repo })
  const alreadyMerged = Boolean(pr?.merged_at || pr?.merged === true)
  if (alreadyMerged) {
    // 部署失败后重试时，PR 可能已经合过。不能再建、再验、再合，直接复用合并结果。
    const mergeSha = pr.merge_commit_sha || ''
    if (!mergeSha) return { ok: false, reason: 'merged_pr_sha_missing', pr }
    let warning = ''
    let cleanupInfo = null
    if (typeof cleanup === 'function') {
      try {
        cleanupInfo = await cleanup({ repoDir, reqBranch })
      } catch (error) {
        warning = `合完了，但清理 worktree 失败：${errorText(error)}`
      }
    }
    return {
      ok: true,
      pr,
      mergeSha,
      risk,
      alreadyMerged: true,
      ...(cleanupInfo ? { cleanup: cleanupInfo } : {}),
      ...(warning ? { warning } : {}),
    }
  }

  const verifyBranch = pr?.head?.ref || reqBranch
  let verified = await runVerify({ verify, repoDir, branch: verifyBranch, parentIssue })
  let problems = passed(verified) ? [] : findingsOf(verified)
  let lastFailed = 'verify'
  let fixNote = ''

  if (problems.length && typeof fixer === 'function') {
    for (let round = 1; round <= maxFixRounds && problems.length > 0; round += 1) {
      let fixed
      try {
        fixed = await fixer({ repoDir, branch: verifyBranch, findings: problems, round })
      } catch (error) {
        fixNote = `统一修没成：${errorText(error)}`
        break
      }
      if (fixed && typeof fixed === 'object' && fixed.ok === false) {
        fixNote = `统一修没成：${findingsOf(fixed).join('；') || '未知原因'}`
        break
      }

      // 修完的提交要推上去，否则 PR 头仍是旧提交，合了会丢修复。
      const pushedFix = await pushRequirement({ push, repoDir, owner, repo, reqBranch })
      if (!pushedFix.ok) {
        return { ok: false, reason: 'push_failed', pr, error: pushedFix.error }
      }

      const reviewed = await runReview({ review, repoDir, reqBranch, parentIssue, small: smallFlag })
      if (!passed(reviewed)) {
        problems = findingsOf(reviewed)
        lastFailed = 'review'
        continue
      }

      verified = await runVerify({ verify, repoDir, branch: verifyBranch, parentIssue })
      problems = passed(verified) ? [] : findingsOf(verified)
      lastFailed = 'verify'
    }
  }

  if (problems.length) {
    const tag = lastFailed === 'review' ? '收尾评审' : 'PR 验证'
    const label =
      lastFailed === 'review' ? '收尾评审没过' : `PR #${prNumber(pr) || '?'} 上验证没过`
    await notifyIncident({
      notifier,
      parentIssue,
      owner,
      repo,
      tag,
      tried: `${label}${problems.length ? `：${problems.join('；')}` : ''}${fixNote ? `。${fixNote}` : ''}`,
      attempt,
    })
    return {
      ok: false,
      reason: lastFailed === 'review' ? 'review_failed' : 'verify_failed',
      pr,
      problems,
    }
  }

  let merged
  try {
    merged = await mergePr({ owner, repo, pr, method: 'merge' })
  } catch (error) {
    return { ok: false, reason: 'merge_failed', pr, error: errorText(error) }
  }
  if (merged && typeof merged === 'object' && merged.merged === false) {
    return { ok: false, reason: 'merge_failed', pr, error: merged.message || '' }
  }
  const mergeSha = merged?.sha || merged?.merge_commit_sha || ''

  const facts = factsOf(parentIssue)
  const number = prNumber(pr)
  if (typeof notifier?.send === 'function') {
    try {
      await sendEvent(notifier, {
        owner,
        repo,
        subject: `#${parentIssue.number}`,
        event: '自己合并',
        scope: `PR-${number ?? '?'}`,
        now: new Date(),
        link: pr?.html_url || issueLink(parentIssue, owner, repo),
        data: { customer: facts.customer, requirement: facts.requirement, pr: number },
      })
    } catch {
      // 合已经合了，通知失败不回滚。
    }
  }

  let warning = ''
  let cleanupInfo = null
  if (typeof cleanup === 'function') {
    try {
      cleanupInfo = await cleanup({ repoDir, reqBranch })
    } catch (error) {
      warning = `合完了，但清理 worktree 失败：${errorText(error)}`
    }
  }

  return {
    ok: true,
    pr,
    mergeSha,
    risk,
    ...(cleanupInfo ? { cleanup: cleanupInfo } : {}),
    ...(warning ? { warning } : {}),
  }
}
