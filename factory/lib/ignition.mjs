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
import { git } from './git.mjs'
import { ensureCommentOnce, ensureLabel } from './issues.mjs'
import { logLine } from './log.mjs'
import { hasLabel, labelNames } from './scheduler.mjs'

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

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function gitAuthEnv(url, token) {
  if (!token || !/^https:\/\/(www\.)?github\.com\//i.test(url)) return {}
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64')
  return {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
  }
}

async function runGit(args, { cwd, env } = {}) {
  return git(cwd || process.cwd(), args, { env, timeoutMs: 120000 })
}

/** 客户仓 checkout：没有就 clone，有就 fetch，然后切到需求分支。 */
async function ensureRepoCheckout({ config, owner, repo, reqBranch }) {
  const root = config.repoRoot || defaultRepoRoot()
  const repoDir = join(root, repo)
  const url = config.remoteUrlFor
    ? config.remoteUrlFor({ owner, repo })
    : `https://github.com/${owner}/${repo}.git`
  const env = gitAuthEnv(url, config.token)

  if (await exists(join(repoDir, '.git'))) {
    await runGit(['fetch', 'origin'], { cwd: repoDir, env })
  } else {
    await mkdir(root, { recursive: true })
    await runGit(['clone', url, repoDir], { env })
  }

  const remoteRef = `origin/${reqBranch}`
  const found = await runGit(['rev-parse', '--verify', '--quiet', `refs/remotes/${remoteRef}`], {
    cwd: repoDir,
  }).catch(() => '')
  if (!found) throw new Error(`客户仓里没有需求分支 ${reqBranch}`)
  await runGit(['checkout', '-B', reqBranch, remoteRef], { cwd: repoDir })
  return repoDir
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
 * @param {object} options
 * @param {object} [options.config]
 * @param {object} [options.config.gh] 注入的 GitHub 客户端；不传就用 token 新建
 * @param {Function} options.runner 跑一次实现的函数，参数见 `ignite`
 * @param {Function} options.openPr 开 PR 的函数
 * @param {{send: Function}} options.notifier 通知模块
 * @param {Function} [options.clock]
 */
export function createIgnite({ config = {}, runner, openPr, notifier, clock = () => new Date() }) {
  const gh =
    config.gh ||
    createGithub({
      token: config.token || process.env.GITHUB_TOKEN || '',
      apiBase: config.apiBase,
    })
  const log = config.log || logLine
  const timeoutMs = config.timeoutMs ?? 120000

  function now() {
    const value = clock()
    return value instanceof Date ? value : new Date(value)
  }

  async function markTimeout({ owner, repo, ticket, customer, requirement, reqBranch, ticketBranch }) {
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
        await notifier.send({
          v: 1,
          key: `#${ticket.number}:点火超时:${at.toISOString()}`,
          event: '点火超时',
          occurred_at: at.toISOString(),
          link,
          data: { customer, requirement },
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

  async function ignite({ owner = config.owner, repo, parent, ticket }) {
    const order = parentOrder(parent?.body)
    const requirement =
      parentRequirement(parent?.body) || parent?.requirement || parent?.title || ''
    const customer = parentCustomer(parent?.body) || parent?.customer || '未知客户'
    const reqBranch = order ? `req/${order}` : ''
    const ticketBranch = config.ticketBranch
      ? config.ticketBranch({ ticket, parent })
      : `ticket/${ticket.number}`

    try {
      if (!order) throw new Error('父工单正文里没有 <!-- factory:order=... --> 标记')

      // frontier 由调度器先筛一遍；这里再查一次，防止手工点火绕过。
      const blockers = await gh.listBlockedBy({ owner, repo, number: ticket.number })
      if (blockers.some((row) => row.state !== 'closed')) {
        await removeSandcastleIfPresent({ gh, owner, repo, number: ticket.number, log })
        return { ok: false, skipped: 'blocked', reqBranch, requirement }
      }

      const repoDir = join(config.repoRoot || defaultRepoRoot(), repo)
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

      await ensureRepoCheckout({ config, owner, repo, reqBranch })
      await ensureSandcastleLabel({ gh, owner, repo, number: ticket.number })
      await setTicketInProgress({ gh, owner, repo, number: ticket.number })

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

      const worktree = join(
        repoDir,
        '.sandcastle',
        'worktrees',
        ticketBranch.replace(/\//g, '-'),
      )
      const envFile = join(repoDir, '.sandcastle', '.env')

      const runnerArgs = {
        repoDir,
        worktree,
        branch: reqBranch,
        ticketBranch,
        prompt,
        image: config.image,
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
        })
      }

      const gate = createStartedGate()
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
        // 超时后不再等这次 run；它晚到的结果不写回工单，等人处理。
        runPromise.catch(() => {})
        await markTimeout({
          owner,
          repo,
          ticket,
          customer,
          requirement,
          reqBranch,
          ticketBranch,
        })
        return { ok: false, timeout: true, reqBranch, ticketBranch }
      }

      const result = outcome.kind === 'done' ? outcome.value : await runPromise
      const commits = normalizeCommits(result?.commits)

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
        return { ok: false, error: 'no-commits', reqBranch, ticketBranch }
      }

      let prUrl = result?.prUrl || ''
      if (!prUrl) {
        if (typeof openPr !== 'function') throw new Error('没有注入 openPr，runner 也没返回 PR 链接')
        const created = await openPr({
          repoDir,
          base: reqBranch,
          head: ticketBranch,
          title: ticket.title || `票 #${ticket.number}`,
          body: buildPrBody({ ticket, reqBranch, ticketBranch, customer, requirement }),
        })
        prUrl =
          typeof created === 'string'
            ? created.trim()
            : created?.url || created?.html_url || String(created?.stdout || '').trim()
        if (!prUrl) throw new Error('开 PR 后没拿到链接')
      }

      await ensureCommentOnce(gh, {
        owner,
        repo,
        number: ticket.number,
        body: `点火完成：分支 \`${ticketBranch}\`，${commits.length} 个提交，PR ${prUrl}`,
      })
      log({
        level: 'info',
        msg: '点火完成',
        owner,
        repo,
        ticket: ticket.number,
        branch: result?.branch || ticketBranch,
        commits: commits.length,
        pr: prUrl,
      })
      return { ok: true, branch: result?.branch || ticketBranch, commits, prUrl }
    } catch (error) {
      const message = String(error?.message || error)
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
        error: message,
      })
      return { ok: false, error: message, reqBranch, ticketBranch }
    }
  }

  return ignite
}
