/**
 * 点火：把一张 frontier 子票交给 Sandcastle 跑一次。
 *
 * 提示词四样：spec、这张票、仓库规则 `AGENTS.md`、相关代码。
 * 第一行必须是 `/tdd`，Claude Code 把它当斜杠命令展开。
 */
import { execFile } from 'node:child_process'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'
import { createGithub } from './github.mjs'
import { backoffMs, DEFAULT_MAX_ATTEMPTS } from './job.mjs'
import { sendEvent } from './notify.mjs'
import { git, gitAuthEnv } from './git.mjs'
import { ensureCommentOnce, ensureLabel } from './issues.mjs'
import { logLine } from './log.mjs'
import { parseProgress, progressLine } from './progress.mjs'
import { createRepoWorkspace } from './repo-workspace.mjs'
import { hasLabel, labelNames, SMALL_LABEL } from './scheduler.mjs'

const execFileAsync = promisify(execFile)

export const SANDBOX_LABEL = 'Sandcastle'
export const TIMEOUT_LABEL = '点火超时'

export function parentOrder(body) {
  return /<!--\s*factory:order=([^\s>]+)\s*-->/.exec(String(body || ''))?.[1] || ''
}

export function parentRequirement(body) {
  return /^\s*-\s*需求名：\s*(.+?)\s*$/m.exec(String(body || ''))?.[1] || ''
}

export function parentCustomer(body) {
  return /^\s*-\s*客户简称：\s*(.+?)\s*$/m.exec(String(body || ''))?.[1] || ''
}

function section(title, body) {
  const text = String(body ?? '').trim()
  return `# ${title}\n\n${text || '（无）'}`
}

/**
 * @param {object} options
 * @param {{title?: string, body?: string}|null} [options.spec]
 * @param {{number?: number, title?: string, body?: string}} options.ticket
 * @param {string} [options.agentsMd]
 * @param {string} [options.featureMap]
 * @param {Array<{path: string, text: string, truncated?: boolean}>} [options.relevantCode]
 * @returns {string}
 */
export function buildPrompt({ spec, ticket, agentsMd = '', featureMap = '', relevantCode = [] }) {
  const parts = ['/tdd']
  const heading = ticket?.number ? `票 #${ticket.number} ${ticket.title || ''}`.trim() : ticket?.title || '这张票'
  parts.push(section('这张票', [`## ${heading}`, '', String(ticket?.body || '').trim()].join('\n')))

  parts.push(
    section(
      '做法',
      [
        '1. 先写失败的测试，再实现（TDD）。',
        '2. 类型检查和单文件测试常跑，全量测试最后跑一次。',
        '3. 提交信息以 `FACTORY:` 开头。',
        '4. 改动只覆盖这张票的验收条件，不顺手重构无关代码。',
      ].join('\n'),
    ),
  )

  if (spec) {
    parts.push(section('spec', [`## ${spec.title || ''}`.trim(), '', String(spec.body || '').trim()].join('\n')))
  } else {
    parts.push(section('spec', '（这张票没有 spec，按父工单的验收条件做。）'))
  }

  parts.push(section('仓库规则（AGENTS.md）', agentsMd))
  parts.push(section('功能地图（docs/agents/feature-map.md）', featureMap))

  if (relevantCode.length) {
    const blocks = relevantCode.map((file) => {
      const note = file.truncated ? '\n（文件超过 20 KB，已截断）' : ''
      return [`## ${file.path}`, '', '```text', String(file.text ?? '').trimEnd(), '```', note]
        .join('\n')
        .trimEnd()
    })
    parts.push(section('相关代码', blocks.join('\n\n')))
  }

  return `${parts.join('\n\n')}\n`
}

function defaultLockDir() {
  return join(homedir(), '.grilling', 'factory', 'locks')
}

function defaultRepoRoot() {
  return join(homedir(), '.afkfactory', 'repos')
}

async function runGit(args, { cwd, env } = {}) {
  return git(cwd || process.cwd(), args, { env, timeoutMs: 120000 })
}

function remoteUrlFor(config, owner, repo) {
  return config.remoteUrlFor
    ? config.remoteUrlFor({ owner, repo })
    : `https://github.com/${owner}/${repo}.git`
}

/** 默认 push：用仓库现有的凭据配置把票分支推到 origin。 */
export function createGitPush() {
  return async function pushBranch({ config, repoDir, owner, repo, branch }) {
    const env = gitAuthEnv(remoteUrlFor(config, owner, repo), config.token)
    await runGit(['push', '-u', 'origin', branch], { cwd: repoDir, env })
    return { branch }
  }
}

/** 锁文件里的 pid 还活着且不是自己，说明别的进程正在跑这个仓。 */
async function lockHeldByOther(lockPath, staleMs = 10 * 60 * 1000) {
  try {
    const info = await stat(lockPath)
    if (Date.now() - info.mtimeMs > staleMs) return false
    let holder = 0
    try {
      holder = Number((await readFile(lockPath, 'utf8')).trim())
    } catch {
      return false
    }
    if (!Number.isInteger(holder) || holder <= 0 || holder === process.pid) return false
    try {
      process.kill(holder, 0)
      return true
    } catch (error) {
      return error.code === 'EPERM'
    }
  } catch {
    return false
  }
}

function stillSandcastle(issue) {
  return (
    hasLabel(issue, SANDBOX_LABEL) &&
    issue.state !== 'closed' &&
    !hasLabel(issue, '状态:待验收')
  )
}

async function readText(path) {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return ''
  }
}

async function findSpec({ gh, owner, repo, requirement }) {
  if (!requirement) return null
  const specs = await gh.listIssues({ owner, repo, state: 'open', labels: 'ready-for-agent' })
  return (
    specs.find(
      (issue) =>
        String(issue.title || '').includes(requirement) ||
        String(issue.body || '').includes(requirement),
    ) || null
  )
}

function ticketPaths(body) {
  const paths = new Set()
  const pattern = /(?:^|[\s`"'([{])((?:src|scripts)\/[A-Za-z0-9._/-]+)/g
  let match = pattern.exec(String(body || ''))
  while (match) {
    paths.add(match[1])
    match = pattern.exec(String(body || ''))
  }
  return [...paths]
}

const FILE_LIMIT = 20 * 1024
const TOTAL_LIMIT = 100 * 1024

async function collectRelevantCode({ repoDir, ticket }) {
  const paths = ticketPaths(ticket?.body)
  const rows = []
  let total = 0

  for (const path of paths) {
    let bytes
    try {
      bytes = Buffer.from(await readFile(join(repoDir, path), 'utf8'))
    } catch {
      continue
    }
    let truncated = false
    if (bytes.length > FILE_LIMIT) {
      bytes = bytes.subarray(0, FILE_LIMIT)
      truncated = true
    }
    const room = TOTAL_LIMIT - total
    if (room <= 0) break
    if (bytes.length > room) {
      bytes = bytes.subarray(0, room)
      truncated = true
    }
    total += bytes.length
    rows.push({ path, text: bytes.toString('utf8'), truncated })
  }

  if (rows.length) return rows

  if (paths.length) {
    return [{ path: '（票里点的文件不在仓库里）', text: paths.join('\n'), truncated: false }]
  }

  try {
    const files = (await runGit(['ls-files'], { cwd: repoDir }))
      .split('\n')
      .filter(Boolean)
      .slice(0, 100)
    if (files.length) {
      rows.push({ path: 'git ls-files（前 100 行）', text: files.join('\n'), truncated: false })
    }
  } catch {
    // 没有 checkout 或 git 不可用时，相关代码这一段留空。
  }
  return rows
}

export function buildPrBody({ ticket, reqBranch, ticketBranch, customer = '', requirement = '' }) {
  return [
    '## 摘要',
    '',
    `- 票：#${ticket.number} ${ticket.title || ''}`.trimEnd(),
    `- 分支：\`${ticketBranch}\` → \`${reqBranch}\``,
    ...(customer ? [`- 客户简称：${customer}`] : []),
    ...(requirement ? [`- 需求名：${requirement}`] : []),
    '',
    '## 证据',
    '',
    '- 待验证队补全：验证技能、前后截图或 trace、测试结果。',
    '',
    '## 合并危险',
    '',
    '待验证队和评审判定（单向门还是双向门）。',
    '',
    '## 影响范围',
    '',
    '- 待补全：这次改动碰到哪些功能、顾客从哪里能看到。',
    '',
    ...(customer ? [`<!-- factory:customer=${customer} -->`] : []),
    ...(requirement ? [`<!-- factory:requirement=${requirement} -->`] : []),
  ].join('\n')
}

/** 从 GitHub 和客户仓取齐四样，拼成一次会话的提示词。dry-run 也用这个。 */
export async function buildPromptForTicket({ gh, owner, repo, parent, ticket, repoDir = '' }) {
  const requirement =
    parentRequirement(parent?.body) || parent?.requirement || parent?.title || ''
  const spec = await findSpec({ gh, owner, repo, requirement })
  const agentsMd = repoDir ? await readText(join(repoDir, 'AGENTS.md')) : ''
  const featureMap = repoDir
    ? await readText(join(repoDir, 'docs', 'agents', 'feature-map.md'))
    : ''
  const relevantCode = repoDir ? await collectRelevantCode({ repoDir, ticket }) : []
  return buildPrompt({ spec, ticket, agentsMd, featureMap, relevantCode })
}

function commandTail(result, limit = 2000) {
  const text = String(result?.stderr || result?.stdout || '').trim()
  return text.length > limit ? text.slice(-limit) : text
}

const PULL_REQUEST_URL = /https?:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/\d+/

/** 从 gh 输出里找 PR 地址：`gh pr create` 偶发建出 PR 却退出非零。 */
function findPullRequestUrl(result) {
  for (const text of [result?.stdout, result?.stderr]) {
    const found = PULL_REQUEST_URL.exec(String(text || ''))
    if (found) return found[0]
  }
  return ''
}

/** 默认 openPr：在客户仓里跑 `gh pr create`。 */
export function createGhOpenPr({ token = '', exec = null } = {}) {
  async function runCommand(command, args, options) {
    if (typeof exec === 'function') return exec(command, args, options)
    const result = await execFileAsync(command, args, {
      timeout: 120000,
      maxBuffer: 4 * 1024 * 1024,
      ...options,
    }).catch((error) => error)
    if (result.code === 0) {
      return { code: 0, stdout: String(result.stdout || ''), stderr: String(result.stderr || '') }
    }
    return {
      code: typeof result.code === 'number' ? result.code : 1,
      stdout: String(result.stdout || ''),
      stderr: String(result.stderr || result.message || ''),
    }
  }

  return async function openPr({ repoDir, base, head, title, body }) {
    const env = { ...process.env }
    if (token) env.GH_TOKEN = token
    const result = await runCommand(
      'gh',
      ['pr', 'create', '--base', base, '--head', head, '--title', title, '--body', body],
      { cwd: repoDir, env },
    )
    if (result.code !== 0) {
      const url = findPullRequestUrl(result)
      if (url) return { url }
      throw new Error(`gh pr create 失败（退出码 ${result.code}）：${commandTail(result)}`)
    }
    return { url: String(result.stdout || '').trim() }
  }
}

function createStartedGate() {
  let resolveStarted
  let started = false
  const promise = new Promise((resolve) => {
    resolveStarted = resolve
  })
  return {
    promise,
    started() {
      if (started) return
      started = true
      resolveStarted()
    },
  }
}

function delay(ms) {
  let timer
  const promise = new Promise((resolve) => {
    timer = setTimeout(() => resolve('timeout'), ms)
  })
  return { promise, cancel: () => clearTimeout(timer) }
}

function normalizeCommits(commits) {
  return (Array.isArray(commits) ? commits : [])
    .map((row) => (typeof row === 'string' ? row : row?.sha))
    .filter(Boolean)
}

async function ensureSandcastleLabel({ gh, owner, repo, number }) {
  const current = await gh.getIssue({ owner, repo, number })
  if (hasLabel(current, SANDBOX_LABEL)) return false
  await ensureLabel(gh, { owner, repo, name: SANDBOX_LABEL })
  await gh.addLabels({ owner, repo, number, labels: [SANDBOX_LABEL] })
  return true
}

/** 实现子票从 `排队中` 进 `开发中`；同时只留一个状态标签。 */
async function setTicketInProgress({ gh, owner, repo, number }) {
  const target = '状态:开发中'
  const current = await gh.getIssue({ owner, repo, number })
  const names = labelNames(current)
  if (!names.includes(target)) {
    await ensureLabel(gh, { owner, repo, name: target })
    await gh.addLabels({ owner, repo, number, labels: [target] })
  }
  for (const name of names.filter((row) => row.startsWith('状态:') && row !== target)) {
    await gh.removeLabel({ owner, repo, number, name })
  }
}

async function removeSandcastleIfPresent({ gh, owner, repo, number, log }) {
  try {
    const current = await gh.getIssue({ owner, repo, number })
    if (!hasLabel(current, SANDBOX_LABEL)) return false
    await gh.removeLabel({ owner, repo, number, name: SANDBOX_LABEL })
    return true
  } catch (error) {
    log({
      level: 'warning',
      msg: '摘 Sandcastle 标签失败',
      owner,
      repo,
      ticket: number,
      error: String(error?.message || error),
    })
    return false
  }
}

/**
 * @param {Array<{body?: string}>} comments
 * @returns {number} 父工单已有进度的最大轮次；没有进度行时是 0
 */
function maxProgressRound(comments = []) {
  let round = 0
  for (const comment of comments) {
    for (const line of String(comment?.body || '').split(/\r?\n/)) {
      const parsed = parseProgress(line)
      if (parsed) round = Math.max(round, parsed.round)
    }
  }
  return round
}

function oneLine(text, limit = 200) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit)
}

/** 本地时间 HH:MM，给父工单进度行写「下次约 … 重试」。 */
function localHhMm(date) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * @param {object} options
 * @param {object} [options.config]
 * @param {object} [options.config.gh] 注入的 GitHub 客户端；不传就用 token 新建
 * @param {Function} options.runner 跑一次实现的函数，参数见 `ignite`
 * @param {Function} options.openPr 开 PR 的函数
 * @param {{send: Function}} options.notifier 通知模块
 * @param {Function} [options.clock]
 */
export function createIgnite({ config = {}, runner, openPr, push, notifier, clock = () => new Date() }) {
  const gh =
    config.gh ||
    createGithub({
      token: config.token || process.env.GITHUB_TOKEN || '',
      apiBase: config.apiBase,
    })
  const log = config.log || logLine
  const timeoutMs = config.timeoutMs ?? 120000
  const pushBranch = typeof push === 'function' ? push : createGitPush()
  // 客户仓、票分支、工作树的唯一 owner；点火不再自己拼路径。
  const workspace = createRepoWorkspace({
    repoRoot: config.repoRoot || defaultRepoRoot(),
    lockDir: config.lockDir || defaultLockDir(),
    token: config.token || '',
    remoteUrlFor: ({ owner, repo }) => remoteUrlFor(config, owner, repo),
    pushBranch: ({ repoDir, owner, repo, branch }) =>
      pushBranch({ config, repoDir, owner, repo, branch }),
  })

  function now() {
    const value = clock()
    return value instanceof Date ? value : new Date(value)
  }

  async function markTimeout({ owner, repo, ticket, customer, requirement, reqBranch, ticketBranch, attempt = 1 }) {
    const at = now()
    const link =
      ticket.html_url || `https://github.com/${owner}/${repo}/issues/${ticket.number}`
    await ensureCommentOnce(gh, {
      owner,
      repo,
      number: ticket.number,
      body: '点火超时\n\n两分钟没收到回执，已打标签，不自动补点，等人。',
    }).catch((error) =>
      log({
        level: 'error',
        msg: '写点火超时评论失败',
        owner,
        repo,
        ticket: ticket.number,
        error: String(error?.message || error),
      }),
    )
    try {
      await ensureLabel(gh, { owner, repo, name: TIMEOUT_LABEL })
      const current = await gh.getIssue({ owner, repo, number: ticket.number })
      if (!hasLabel(current, TIMEOUT_LABEL)) {
        await gh.addLabels({ owner, repo, number: ticket.number, labels: [TIMEOUT_LABEL] })
      }
    } catch (error) {
      log({
        level: 'error',
        msg: '打点火超时标签失败',
        owner,
        repo,
        ticket: ticket.number,
        error: String(error?.message || error),
      })
    }
    try {
      if (typeof notifier?.send === 'function') {
        await sendEvent(notifier, {
          owner,
          repo,
          subject: `#${ticket.number}`,
          event: '点火超时',
          now: at,
          link,
          data: { customer, requirement, attempt },
        })
      }
    } catch (error) {
      log({
        level: 'error',
        msg: '发点火超时通知失败',
        owner,
        repo,
        ticket: ticket.number,
        error: String(error?.message || error),
      })
    }
    log({
      level: 'error',
      msg: '点火超时',
      owner,
      repo,
      ticket: ticket.number,
      reqBranch,
      ticketBranch,
    })
  }

  /**
   * 点火失败收尾：摘 `Sandcastle`、发「出事」、父工单写一条进度行。
   * 三步各自兜底，任何一步失败都不改点火的返回结果。
   */
  async function markIgnitionFailure({
    owner,
    repo,
    parent,
    ticket,
    customer,
    requirement,
    stage,
    error,
    attempt = 1,
  }) {
    const at = now()
    const message = oneLine(error) || '未知错误'
    const link =
      ticket.html_url || `https://github.com/${owner}/${repo}/issues/${ticket.number}`
    const maxAttempts = config.jobPolicy?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
    const retryNote =
      attempt >= maxAttempts
        ? '已停线，等运营者处理'
        : `下次约 ${localHhMm(new Date(at.getTime() + backoffMs(attempt, config.jobPolicy || {})))} 重试`

    await removeSandcastleIfPresent({ gh, owner, repo, number: ticket.number, log })

    try {
      if (typeof notifier?.send === 'function') {
        await sendEvent(notifier, {
          owner,
          repo,
          subject: `#${ticket.number}`,
          event: '出事',
          scope: '点火失败',
          now: at,
          link,
          data: {
            customer,
            requirement,
            reason: oneLine(`点火失败：${stage}：${message}`),
            tried: oneLine(`${stage}阶段报错：${message}`),
            attempt,
          },
        })
      }
    } catch (err) {
      log({
        level: 'error',
        msg: '发点火失败通知失败',
        owner,
        repo,
        ticket: ticket.number,
        error: String(err?.message || err),
      })
    }

    const parentNumber = parent?.number
    if (!parentNumber) return
    try {
      const [current, comments] = await Promise.all([
        gh.getIssue({ owner, repo, number: parentNumber }).catch(() => parent),
        gh.listComments({ owner, repo, number: parentNumber }),
      ])
      await gh.createComment({
        owner,
        repo,
        number: parentNumber,
        body: progressLine({
          path: hasLabel(current, SMALL_LABEL) ? '小需求' : '其余',
          tier: '开发中',
          step: '点火失败',
          round: maxProgressRound(comments) + 1,
          stuck: true,
          note: oneLine(`${stage}（第 ${attempt} 次，${retryNote}）：${message}`, 160),
        }),
      })
    } catch (err) {
      log({
        level: 'error',
        msg: '写点火失败进度失败',
        owner,
        repo,
        ticket: ticket.number,
        error: String(err?.message || err),
      })
    }
  }

  async function ignite({ owner = config.owner, repo, parent, ticket, attempt = 1 }) {
    const order = parentOrder(parent?.body)
    const requirement =
      parentRequirement(parent?.body) || parent?.requirement || parent?.title || ''
    const customer = parentCustomer(parent?.body) || parent?.customer || '未知客户'
    const reqBranch = order ? `req/${order}` : ''
    const ticketBranch = config.ticketBranch
      ? config.ticketBranch({ ticket, parent })
      : `ticket/${ticket.number}`
    let pushedBranch = ticketBranch
    let runCommits = []
    const repoDir = join(config.repoRoot || defaultRepoRoot(), repo)
    let worktree = ''
    let archived = []
    let cleaned = false
    // 失败时用来写清是哪一步出的事：准备、运行、推送、开 PR。
    let stage = '准备'

    /** 归档未跟踪文件后释放工作树；abort 用在失败路径，release 用在正常路径。 */
    async function tidyWorktree({ abort = false, path = worktree }) {
      if (!path || cleaned) return
      try {
        const released = abort
          ? await workspace.abort({ repoDir, worktree: path, branch: ticketBranch })
          : await workspace.release({ repoDir, worktree: path, branch: ticketBranch })
        cleaned = true
        archived = released.archived || []
        if (archived.length) {
          log({
            level: 'info',
            msg: '归档票工作树里的未跟踪文件',
            owner,
            repo,
            ticket: ticket.number,
            worktree: released.path || path,
            files: archived.map((row) => row.to),
          })
        }
        if (released.errors?.length) {
          log({
            level: 'error',
            msg: '归档票工作树失败，保留现场',
            owner,
            repo,
            ticket: ticket.number,
            worktree: released.path || path,
            errors: released.errors,
          })
        }
        if (released.kept) {
          log({
            level: 'warning',
            msg: '票工作树有未提交改动，保留',
            owner,
            repo,
            ticket: ticket.number,
            worktree: released.path || path,
            dirty: Boolean(released.dirty),
          })
          worktree = released.path || path
        } else {
          worktree = ''
        }
      } catch (error) {
        log({
          level: 'error',
          msg: '清票工作树失败',
          owner,
          repo,
          ticket: ticket.number,
          worktree: path,
          error: String(error?.message || error),
        })
      }
    }

    try {
      if (!order) throw new Error('父工单正文里没有 <!-- factory:order=... --> 标记')

      // frontier 由调度器先筛一遍；这里再查一次，防止手工点火绕过。
      const blockers = await gh.listBlockedBy({ owner, repo, number: ticket.number })
      if (blockers.some((row) => row.state !== 'closed')) {
        await removeSandcastleIfPresent({ gh, owner, repo, number: ticket.number, log })
        return { ok: false, skipped: 'blocked', reqBranch, requirement }
      }

      const lockPath = join(config.lockDir || defaultLockDir(), `${owner}__${repo}.lock`)
      if (await lockHeldByOther(lockPath, config.lockStaleMs)) {
        await removeSandcastleIfPresent({ gh, owner, repo, number: ticket.number, log })
        return { ok: false, skipped: 'busy', reqBranch, requirement, repoDir, reason: 'lock' }
      }

      const openIssues = await gh.listIssues({ owner, repo, state: 'open' })
      const running = openIssues.find(
        (issue) => issue.number !== ticket.number && stillSandcastle(issue),
      )
      if (running) {
        await removeSandcastleIfPresent({ gh, owner, repo, number: ticket.number, log })
        return {
          ok: false,
          skipped: 'busy',
          reqBranch,
          requirement,
          repoDir,
          reason: `Sandcastle:#${running.number}`,
        }
      }

      await workspace.ensure({ owner, repo, reqBranch })
      // 点火前补齐客户仓凭证：按仓签 1 小时 token，再检查缺文件和缺键。
      if (config.repoEnv) {
        await config.repoEnv.ensure({ repoDir, owner, repo, image: config.image })
        await config.repoEnv.check({ repoDir })
      }
      await ensureSandcastleLabel({ gh, owner, repo, number: ticket.number })
      await setTicketInProgress({ gh, owner, repo, number: ticket.number })

      const preparedTicket = await workspace.prepareTicket({
        repoDir,
        base: reqBranch,
        ticketBranch,
      })
      worktree = preparedTicket.worktree

      const promptText = await buildPromptForTicket({
        gh,
        owner,
        repo,
        parent,
        ticket,
        repoDir,
      })
      const promptDir = config.promptDir
        ? isAbsolute(config.promptDir)
          ? config.promptDir
          : join(repoDir, config.promptDir)
        : join(repoDir, '.sandcastle')
      await mkdir(promptDir, { recursive: true })
      const prompt = join(promptDir, `prompt-${ticket.number}.md`)
      await writeFile(prompt, promptText, 'utf8')

      const worktreePath = preparedTicket.worktree
      const envFile = join(repoDir, '.sandcastle', '.env')

      const runnerArgs = {
        repoDir,
        worktree: worktreePath,
        branch: reqBranch,
        ticketBranch,
        prompt,
        image: config.image,
        dockerfile: config.dockerfile || '',
        envFile,
        timeoutMs,
      }
      const execute = typeof runner === 'function' ? runner : runner?.run
      if (typeof execute !== 'function') throw new Error('没有注入 runner')

      // 装依赖、建镜像不算在两分钟回执里；这两步慢不该报点火超时。
      let prepared = null
      if (typeof runner?.prepare === 'function') {
        log({
          level: 'info',
          msg: '点火准备开始',
          owner,
          repo,
          ticket: ticket.number,
          reqBranch,
          ticketBranch,
        })
        prepared = await runner.prepare(runnerArgs)
        log({
          level: 'info',
          msg: '点火准备完成',
          owner,
          repo,
          ticket: ticket.number,
          reqBranch,
          ticketBranch,
          image: prepared?.imageName,
          imageHash: prepared?.hash,
        })
      }

      const gate = createStartedGate()
      stage = '运行'
      const timer = delay(timeoutMs)
      const runPromise = Promise.resolve().then(() =>
        execute({ ...runnerArgs, started: gate.started, prepared }),
      )

      let outcome
      try {
        outcome = await Promise.race([
          runPromise.then((value) => ({ kind: 'done', value })),
          gate.promise.then(() => ({ kind: 'started' })),
          timer.promise.then(() => ({ kind: 'timeout' })),
        ])
      } finally {
        timer.cancel()
      }

      if (outcome.kind === 'timeout') {
        // 超时后不再等这次 run；它晚到时在后台归档并释放票工作树，结果不写回工单。
        runPromise
          .then((late) =>
            tidyWorktree({ path: String(late?.preservedWorktreePath || '') || worktree }),
          )
          .catch(() => tidyWorktree({ abort: true }))
        await markTimeout({
          owner,
          repo,
          ticket,
          customer,
          requirement,
          reqBranch,
          ticketBranch,
          attempt,
        })
        await markIgnitionFailure({
          owner,
          repo,
          parent,
          ticket,
          customer,
          requirement,
          stage: '点火超时',
          error: '两分钟没收到回执',
          attempt,
        })
        return { ok: false, timeout: true, reqBranch, ticketBranch }
      }

      const result = outcome.kind === 'done' ? outcome.value : await runPromise
      const preservedWorktreePath = String(result?.preservedWorktreePath || '')
      if (preservedWorktreePath) {
        log({
          level: 'info',
          msg: 'Sandcastle 保留了工作树',
          owner,
          repo,
          ticket: ticket.number,
          worktree: preservedWorktreePath,
        })
      }
      // 脏文件先归档，再释放；改了已跟踪文件的工作树保留，路径回传给下一环。
      await tidyWorktree({ path: preservedWorktreePath || worktree })
      const commits = normalizeCommits(result?.commits)
      runCommits = commits
      pushedBranch = result?.branch || ticketBranch

      if (!commits.length) {
        await ensureCommentOnce(gh, {
          owner,
          repo,
          number: ticket.number,
          body: '点火失败：这次 run 没有产生提交。',
        })
        log({
          level: 'error',
          msg: '点火没有产生提交',
          owner,
          repo,
          ticket: ticket.number,
          reqBranch,
          ticketBranch,
        })
        await markIgnitionFailure({
          owner,
          repo,
          parent,
          ticket,
          customer,
          requirement,
          stage: '没有提交',
          error: '这次 run 没有产生提交',
          attempt,
        })
        return { ok: false, error: 'no-commits', reqBranch, ticketBranch, archived }
      }

      stage = '推送'
      try {
        await pushBranch({
          config,
          repoDir,
          owner,
          repo,
          branch: pushedBranch,
          commits,
        })
      } catch (error) {
        throw new Error(
          `推送 ${pushedBranch} 失败（${commits.length} 个提交）：${String(error?.message || error)}`,
        )
      }

      let prUrl = result?.prUrl || ''
      if (!prUrl) {
        stage = '开 PR'
        if (typeof openPr !== 'function') throw new Error('没有注入 openPr，runner 也没返回 PR 链接')
        const created = await openPr({
          repoDir,
          base: reqBranch,
          head: pushedBranch,
          title: ticket.title || `票 #${ticket.number}`,
          body: buildPrBody({
            ticket,
            reqBranch,
            ticketBranch: pushedBranch,
            customer,
            requirement,
          }),
        })
        prUrl =
          typeof created === 'string'
            ? created.trim()
            : created?.url ||
              created?.html_url ||
              findPullRequestUrl(created) ||
              String(created?.stdout || '').trim()
        if (!prUrl) throw new Error('开 PR 后没拿到链接')
      }

      await ensureCommentOnce(gh, {
        owner,
        repo,
        number: ticket.number,
        body: `点火完成：分支 \`${pushedBranch}\`，${commits.length} 个提交，PR ${prUrl}`,
      })
      log({
        level: 'info',
        msg: '点火完成',
        owner,
        repo,
        ticket: ticket.number,
        branch: pushedBranch,
        commits: commits.length,
        pr: prUrl,
        afkResult: result,
      })
      return {
        ok: true,
        branch: pushedBranch,
        commits,
        prUrl,
        archived,
        ...(worktree ? { worktree } : {}),
      }
    } catch (error) {
      const message = String(error?.message || error)
      // runner 把 Sandcastle 抛出的保留路径挂在 error 上，不能丢。
      const preservedWorktreePath = String(error?.preservedWorktreePath || '')
      if (preservedWorktreePath) {
        log({
          level: 'info',
          msg: 'Sandcastle 保留了工作树',
          owner,
          repo,
          ticket: ticket.number,
          worktree: preservedWorktreePath,
        })
      }
      // 失败现场：未跟踪文件先归档，再连脏工作树一起删；已经释放过的不重复动。
      await tidyWorktree({ abort: true, path: preservedWorktreePath || worktree })
      await ensureCommentOnce(gh, {
        owner,
        repo,
        number: ticket.number,
        body: `点火失败\n\n${message}`,
      }).catch(() => {})
      log({
        level: 'error',
        msg: '点火失败',
        owner,
        repo,
        ticket: ticket.number,
        reqBranch,
        ticketBranch,
        branch: pushedBranch,
        commits: runCommits.length,
        error: message,
      })
      await markIgnitionFailure({
        owner,
        repo,
        parent,
        ticket,
        customer,
        requirement,
        stage,
        error: message,
        attempt,
      })
      return { ok: false, error: message, reqBranch, ticketBranch, archived }
    }
  }

  return ignite
}
