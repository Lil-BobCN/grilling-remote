/**
 * 回传导入：校验通过的上传变成客户仓和父工单。
 *
 * 一次扫描处理所有 `meta.status === 'ready'` 的上传：
 * 1. 校验未通过的订单发一次客户邮件（按上传 sha 去重）。
 * 2. 每个通过校验、还没有工单的订单：建或复用客户仓，把需求目录原样拷进
 *    `docs/requirements/<需求名>/`，推 main，推 `req/<订单号>` 分支，建父工单。
 * 3. 回写订单的工单链接、软件简称和分支，回写 `customers.json.repos[软件简称]`。
 *
 * 失败不删快照：`meta.status` 改成 `import_failed`，写 `operator_alert`。
 * 地图 `Decisions so far` 出现行首「已废」或「已被取代」时改成 `needs_operator`，不建单。
 * 成功改成 `imported`，快照留给 Mac 拉取桥存档，桥删远端。
 */
import { execFile } from 'node:child_process'
import { cp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { sendValidationMail } from './customer-mail.mjs'
import { readCustomers, setCustomerRepo } from './customers.mjs'
import { createGithubApi } from './github-api.mjs'
import { logLine } from './log.mjs'
import { readOrders, updateOrder } from './orders.mjs'
import { renderParentIssue } from './parent-issue.mjs'
import { scaffoldCustomerRepo } from './scaffold.mjs'
import { createSpecLock } from './spec-lock.mjs'
import { readJson, withFileLock, writeJsonAtomic } from './store.mjs'

const execFileAsync = promisify(execFile)
const SNAPSHOT_NOTE = '回传快照，以父工单和 spec 为准，不作为决策来源。'
const SMALL_LABEL = { name: '大小:小需求', color: 'ededed', description: '小需求，跳过 spec 和拆票' }
const SUBMITTED_LABEL = '状态:已提交'
const REUPLOAD_CLEAR_LABELS = ['状态:排队中', '状态:开发中', '状态:待验收', 'Sandcastle']

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** 小需求只有需求草稿，没有地图；建单即锁，不走重传。 */
async function isSmallRequirement(uploadDir, requirement) {
  const dir = join(uploadDir, 'work', 'scratch', requirement)
  return (await exists(join(dir, '需求草稿.md'))) && !(await exists(join(dir, 'map.md')))
}

function authEnv(config, remoteUrl) {
  const token = config.githubAdminToken || ''
  if (!token || !/^https:\/\/(www\.)?github\.com\//i.test(remoteUrl)) return {}
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64')
  return {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
  }
}

async function git(cwd, args, { env } = {}) {
  const result = await execFileAsync('git', ['-C', cwd, ...args], {
    timeout: 120000,
    maxBuffer: 8 * 1024 * 1024,
    ...(env ? { env: { ...process.env, ...env } } : {}),
  }).catch((error) => error)
  if (result.code) {
    const output = String(result.stderr || result.stdout || result.message || '').trim()
    throw new Error(`git ${args.join(' ')} 失败：${output}`)
  }
  return String(result.stdout || '').trim()
}

async function setIdentity(dir) {
  await git(dir, ['config', 'user.name', 'AFK Factory'])
  await git(dir, ['config', 'user.email', 'factory@afkfactory.space'])
}

/**
 * 找到这个上传对应客户的账号行。
 */
async function findAccount(config, meta, orders) {
  const customerId = orders[0]?.customer_id || meta.user?.id || ''
  const rows = await readCustomers(config)
  const row = rows.find((item) => item.id === customerId)
  if (!row) throw new Error(`customers.json 里找不到客户 ${customerId || '(未知)'}，不能建仓建单`)
  return row
}

/**
 * 建仓或复用仓，返回可提交的本地目录。
 */
export async function ensureRepo({
  config,
  gh,
  scaffold = scaffoldCustomerRepo,
  owner,
  repoName,
  shortName,
  product,
  workDir,
  remoteUrl,
}) {
  const env = authEnv(config, remoteUrl)

  if (await exists(join(workDir, '.git'))) {
    await git(workDir, ['fetch', 'origin'], { env })
    await git(workDir, ['checkout', '-B', 'main', 'origin/main'])
    await git(workDir, ['reset', '--hard', 'origin/main'])
    await setIdentity(workDir)
    return { workDir, created: false }
  }

  const existing = await gh.getRepoOrNull({ owner, repo: repoName })
  if (existing) {
    await rm(workDir, { recursive: true, force: true })
    await execFileAsync('git', ['clone', remoteUrl, workDir], {
      timeout: 120000,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, ...env },
    })
    await setIdentity(workDir)
    return { workDir, created: false }
  }

  const result = await scaffold({
    gh,
    owner,
    repoName,
    shortName,
    product,
    workDir,
    remoteUrl,
    token: config.githubAdminToken,
  })
  if (!result.created) {
    await rm(workDir, { recursive: true, force: true })
    await execFileAsync('git', ['clone', remoteUrl, workDir], {
      timeout: 120000,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, ...env },
    })
    await setIdentity(workDir)
    return { workDir, created: false }
  }
  return { workDir, created: true }
}

async function ensureSmallLabel(gh, owner, repo) {
  const labels = await gh.listLabels({ owner, repo })
  if (Array.isArray(labels) && labels.some((row) => row.name === SMALL_LABEL.name)) return
  try {
    await gh.createLabel({ owner, repo, ...SMALL_LABEL })
  } catch (error) {
    // 并发下别的导入刚建出来，也算有。
    if (!(error && error.status === 422)) throw error
  }
}

async function commitAndPush({ config, workDir, remoteUrl, message }) {
  await git(workDir, ['add', '-A'])
  const status = await git(workDir, ['status', '--porcelain'])
  if (status) await git(workDir, ['commit', '-m', message])
  const env = authEnv(config, remoteUrl)
  await git(workDir, ['push', 'origin', 'main'], { env })
}

/** 这次上传要不要走重传：订单已有父工单，这包是最新上传，而且还没被导入过。 */
export function needsReupload(order, meta) {
  if (!order.issue) return false
  const latest = order.uploads?.at(-1)
  if (!latest || latest.sha256 !== meta.sha256) return false
  return order.import_sha256 !== meta.sha256
}

export function reuploadComment(at) {
  return `改口：重传 ${at}，旧的提案和点头作废。`
}

/** 同一 body 的评论只写一条；导入重跑不重复追加。 */
async function commentOnce(gh, { owner, repo, number, body }) {
  const comments = await gh.listComments({ owner, repo, number })
  if (comments.some((row) => String(row.body).trim() === String(body).trim())) return false
  await gh.createComment({ owner, repo, number, body })
  return true
}

async function gitExitCode(cwd, args) {
  const result = await execFileAsync('git', ['-C', cwd, ...args], {
    timeout: 120000,
    maxBuffer: 8 * 1024 * 1024,
  }).catch((error) => error)
  return {
    code: result.code ?? 0,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
  }
}

/**
 * 重传前查需求分支：to-spec 前分支上不该有实现提交。
 * 分支不是 main 的祖先，说明有 ticket 合入的痕迹，不覆盖，报运营者。
 */
export async function inspectRequirementBranch({ workDir, branch }) {
  await git(workDir, ['fetch', 'origin'])
  const remote = await gitExitCode(workDir, ['rev-parse', '--verify', `refs/remotes/origin/${branch}`])
  if (remote.code !== 0) return { exists: false, sha: '' }

  const ancestor = await gitExitCode(workDir, ['merge-base', '--is-ancestor', remote.stdout, 'main'])
  if (ancestor.code === 1) {
    throw new Error(
      `需求分支 ${branch} 上有没合进 main 的提交，可能已经有实现票合入。没有覆盖分支，停下报运营者。`,
    )
  }
  if (ancestor.code !== 0) {
    throw new Error(`检查需求分支 ${branch} 失败：${ancestor.stderr || `git 退出码 ${ancestor.code}`}`)
  }
  return { exists: true, sha: remote.stdout }
}

export async function resetRequirementBranch({ config, workDir, remoteUrl, branch, state }) {
  await git(workDir, ['checkout', '-B', branch, 'main'])
  const args = ['push']
  if (state.exists) args.push(`--force-with-lease=refs/heads/${branch}:${state.sha}`)
  args.push('origin', branch)
  await git(workDir, args, { env: authEnv(config, remoteUrl) })
  await git(workDir, ['checkout', 'main'])
}

export async function replaceRequirementSnapshot({ config, workDir, remoteUrl, scratchDir, requirement }) {
  const destination = join(workDir, 'docs', 'requirements', requirement)
  await rm(destination, { recursive: true, force: true })
  await cp(scratchDir, destination, { recursive: true })
  await writeFile(join(destination, 'README.md'), `${SNAPSHOT_NOTE}\n`)
  await commitAndPush({
    config,
    workDir,
    remoteUrl,
    message: `FACTORY: 重传回传：${requirement}`,
  })
}

async function resetParentIssue({ gh, owner, repo, issue, rendered, orderId, small }) {
  await gh.updateIssue({
    owner,
    repo,
    number: issue.number,
    title: rendered.title,
    body: bodyWithMarker(rendered.body, orderId),
  })

  const labels = (issue.labels || []).map((label) => label.name)
  for (const name of REUPLOAD_CLEAR_LABELS) {
    if (!labels.includes(name)) continue
    await gh.removeLabel({ owner, repo, number: issue.number, name })
  }
  if (!labels.includes(SUBMITTED_LABEL)) {
    await gh.addLabels({ owner, repo, number: issue.number, labels: [SUBMITTED_LABEL] })
  }
  if (small) {
    await ensureSmallLabel(gh, owner, repo)
    if (!labels.includes(SMALL_LABEL.name)) {
      await gh.addLabels({ owner, repo, number: issue.number, labels: [SMALL_LABEL.name] })
    }
  }
}

/**
 * 重传一条已有父工单的订单：换父工单五段、换需求目录快照、重置需求分支，
 * 写 `改口：` 评论。父工单复用，不建第二张。
 * 地图和决定票的换新是补缺口 Agent 的活（`gap.mjs apply-map --mode replace`），
 * 不在这里做。
 */
export async function reuploadOrder({
  config,
  gh,
  account,
  order,
  uploadDir,
  remoteUrlFor,
  owner,
  commentAt,
  sha256,
}) {
  const repos =
    account.repos && typeof account.repos === 'object' && !Array.isArray(account.repos)
      ? account.repos
      : {}
  const product = order.product || order.requirement
  const repoName = repos[product] || repoFromIssue(order.issue) || `${account.short_name}-${product}`
  const scratchDir = join(uploadDir, 'work', 'scratch', order.requirement)
  if (!(await exists(scratchDir))) {
    throw new Error(`上传里找不到需求目录 ${order.requirement} 的快照，不能重传`)
  }

  const rendered = await renderParentIssue({
    scratchDir,
    shortName: account.short_name,
    requirement: order.requirement,
    owner,
    repo: repoName,
  })

  const existing = await findParentIssue(gh, { owner, repo: repoName, orderId: order.id })
  if (!existing) {
    throw new Error(
      `找不到带 <!-- factory:order=${order.id} --> 标记的父工单，不建第二张，报运营者。`,
    )
  }

  const remoteUrl = remoteUrlFor({ owner, repo: repoName })
  const { workDir } = await ensureRepo({
    config,
    gh,
    owner,
    repoName,
    shortName: account.short_name,
    product,
    workDir: join(uploadDir, `repo-${repoName}`),
    remoteUrl,
  })

  const branch = `req/${order.id}`
  const branchState = await inspectRequirementBranch({ workDir, branch })
  await replaceRequirementSnapshot({
    config,
    workDir,
    remoteUrl,
    scratchDir,
    requirement: order.requirement,
  })
  await resetRequirementBranch({ config, workDir, remoteUrl, branch, state: branchState })

  await resetParentIssue({
    gh,
    owner,
    repo: repoName,
    issue: existing,
    rendered,
    orderId: order.id,
    small: rendered.small,
  })
  await commentOnce(gh, {
    owner,
    repo: repoName,
    number: existing.number,
    body: reuploadComment(commentAt),
  })

  await updateOrder(config, order.id, {
    issue: existing.html_url,
    product,
    branch,
    import_sha256: sha256,
  })
  if (repos[product] !== repoName) {
    await setCustomerRepo(config, account.id, product, repoName)
  }

  return { issue: existing, repoName, branch, small: rendered.small }
}

/**
 * 导入一条订单。返回父工单。
 */
export async function importOrder({
  config,
  gh,
  scaffold,
  account,
  order,
  uploadDir,
  remoteUrlFor,
  owner,
  sha256,
}) {
  const repos =
    account.repos && typeof account.repos === 'object' && !Array.isArray(account.repos)
      ? account.repos
      : {}
  const product = order.product || order.requirement
  const repoName = repos[product] || `${account.short_name}-${product}`
  const scratchDir = join(uploadDir, 'work', 'scratch', order.requirement)
  if (!(await exists(scratchDir))) {
    throw new Error(`上传里找不到需求目录 ${order.requirement} 的快照，不能建单`)
  }

  const rendered = await renderParentIssue({
    scratchDir,
    shortName: account.short_name,
    requirement: order.requirement,
    owner,
    repo: repoName,
  })

  const remoteUrl = remoteUrlFor({ owner, repo: repoName })
  const { workDir } = await ensureRepo({
    config,
    gh,
    scaffold,
    owner,
    repoName,
    shortName: account.short_name,
    product,
    workDir: join(uploadDir, `repo-${repoName}`),
    remoteUrl,
  })

  const destination = join(workDir, 'docs', 'requirements', order.requirement)
  await rm(destination, { recursive: true, force: true })
  await cp(scratchDir, destination, { recursive: true })
  await writeFile(join(destination, 'README.md'), `${SNAPSHOT_NOTE}\n`)

  await commitAndPush({
    config,
    workDir,
    remoteUrl,
    message: `FACTORY: 导入回传：${order.requirement}`,
  })

  const branch = `req/${order.id}`
  await git(workDir, ['checkout', '-B', branch, 'main'])
  await git(workDir, ['push', 'origin', branch], { env: authEnv(config, remoteUrl) })
  await git(workDir, ['checkout', 'main'])

  const labels = ['状态:已提交']
  if (rendered.small) {
    await ensureSmallLabel(gh, owner, repoName)
    labels.push(SMALL_LABEL.name)
  }

  const body = bodyWithMarker(rendered.body, order.id)
  const existing = await findParentIssue(gh, { owner, repo: repoName, orderId: order.id })
  const issue = existing
    ? await gh.updateIssue({
        owner,
        repo: repoName,
        number: existing.number,
        title: rendered.title,
        body,
      })
    : await gh.createIssue({
        owner,
        repo: repoName,
        title: rendered.title,
        body,
        labels,
      })

  await updateOrder(config, order.id, {
    issue: issue.html_url,
    product,
    branch,
    import_sha256: sha256,
  })

  if (repos[product] !== repoName) {
    await setCustomerRepo(config, account.id, product, repoName)
  }

  return { issue, repoName, branch, small: rendered.small }
}

function importFailure(meta, stamp, error) {
  const message = String(error && error.message ? error.message : error)
  return {
    ...meta,
    status: 'import_failed',
    reason: error?.step || 'import_failed',
    operator_alert: {
      reason: error?.step || 'import_failed',
      message,
      at: stamp,
    },
  }
}

function repoFromIssue(issueUrl) {
  try {
    const parts = new URL(String(issueUrl)).pathname.split('/').filter(Boolean)
    return parts[1] || ''
  } catch {
    return ''
  }
}

function orderMarker(orderId) {
  return `<!-- factory:order=${orderId} -->`
}

function bodyWithMarker(body, orderId) {
  return `${String(body).trimEnd()}\n\n${orderMarker(orderId)}\n`
}

/**
 * 父工单幂等：建单前先找带同一不可见标记的 open issue。
 * 建单成功但回写订单失败时，重跑会复用这张单并更新五段，不建第二张。
 */
async function findParentIssue(gh, { owner, repo, orderId }) {
  const issues = await gh.listIssues({ owner, repo, state: 'open' })
  if (!Array.isArray(issues)) return null
  const marker = orderMarker(orderId)
  return issues.find((issue) => typeof issue?.body === 'string' && issue.body.includes(marker)) || null
}

/**
 * 重跑时补回 `customers.json.repos`：上一轮可能已经建好工单，
 * 但在写仓指针前失败，这时订单已有 `issue`，不能只靠新单流程补。
 */
async function backfillRepos(config, account, orders) {
  const repos =
    account.repos && typeof account.repos === 'object' && !Array.isArray(account.repos)
      ? account.repos
      : {}
  for (const order of orders) {
    const product = order.product || order.requirement
    if (repos[product]) continue
    const repoName = repoFromIssue(order.issue) || `${account.short_name}-${product}`
    await setCustomerRepo(config, account.id, product, repoName)
  }
}

async function findLockedReupload({ specLock, account, orders, owner }) {
  if (!specLock) return null
  const repos =
    account.repos && typeof account.repos === 'object' && !Array.isArray(account.repos)
      ? account.repos
      : {}
  for (const order of orders) {
    const product = order.product || order.requirement
    const repo = repos[product] || repoFromIssue(order.issue) || `${account.short_name}-${product}`
    let locked = false
    try {
      locked = await specLock({ owner, repo, requirement: order.requirement })
    } catch (error) {
      logLine({
        ts: new Date().toISOString(),
        level: 'warning',
        msg: '重传导入锁单检查读不到 GitHub，按未锁放行',
        owner,
        repo,
        requirement: order.requirement,
        error: String(error && error.message ? error.message : error),
      })
      locked = false
    }
    if (locked) return order
  }
  return null
}

async function importUpload({
  config,
  gh,
  scaffold,
  mailSender,
  remoteUrlFor,
  specLock,
  dir,
  meta,
  now,
}) {
  const stamp = now.toISOString()
  const orders = await readOrders(config)
  const uploadOrders = (Array.isArray(meta.orders) ? meta.orders : [])
    .map((id) => orders.find((order) => order.id === id))
    .filter(Boolean)
  if (!uploadOrders.length) throw new Error('这份上传记录里没有订单，不能导入')

  const account = await findAccount(config, meta, uploadOrders)
  const owner = config.githubOwner
  if (!owner) throw new Error('没配 GITHUB_OWNER，不知道该把仓建在哪个账号下')

  const failedOrders = uploadOrders.filter((order) => order.validation?.passed === false)
  if (failedOrders.length && meta.mail?.sha256 !== meta.sha256) {
    for (const order of failedOrders) {
      await sendValidationMail({ config, customer: account, order, sender: mailSender })
    }
    meta = { ...meta, mail: { sha256: meta.sha256, sent_at: stamp } }
    await writeJsonAtomic(join(dir, 'meta.json'), meta)
  }

  const pending = uploadOrders.filter((order) => order.validation?.passed !== false && !order.issue)
  const passedOrders = uploadOrders.filter((order) => order.validation?.passed !== false)
  if (passedOrders.length === 0) {
    // 全部内容校验未通过：只存快照，按 7 天保留期清掉，不按导入成功处理。
    const next = { ...meta, status: 'validation_failed' }
    await writeJsonAtomic(join(dir, 'meta.json'), next)
    return next
  }

  const reuploadOrders = []
  for (const order of passedOrders) {
    if (!needsReupload(order, meta)) continue
    // 小需求建单即锁，没有重传窗口；上传端已经拦，这里不补做。
    if (await isSmallRequirement(dir, order.requirement)) continue
    reuploadOrders.push(order)
  }
  const lockedOrder = await findLockedReupload({ specLock, account, orders: reuploadOrders, owner })
  if (lockedOrder) {
    // 上传端已拦；这里兜底：锁单后同目录不能再改，不覆盖父工单和快照。
    const next = {
      ...meta,
      status: 'needs_operator',
      operator_alert: {
        reason: 'requirement_locked',
        message: `需求「${lockedOrder.requirement}」已经锁单（spec 已发布），这次重传没有覆盖父工单和快照。请新建需求目录再上传。`,
        at: stamp,
      },
    }
    await writeJsonAtomic(join(dir, 'meta.json'), next)
    return next
  }

  for (const order of [...pending, ...reuploadOrders]) {
    const scratchDir = join(dir, 'work', 'scratch', order.requirement)
    const rendered = await renderParentIssue({
      scratchDir,
      shortName: account.short_name,
      requirement: order.requirement,
      owner,
      repo: (account.repos && account.repos[order.product || order.requirement]) || `${account.short_name}-${order.product || order.requirement}`,
    })
    if (rendered.deprecated) {
      const next = {
        ...meta,
        status: 'needs_operator',
        operator_alert: {
          reason: 'deprecated_map_decisions',
          message: `需求「${order.requirement}」的地图 Decisions so far 里有行首「已废」或「已被取代」，是旧格式回传件。没有建仓建单，快照已保留。`,
          at: stamp,
        },
      }
      await writeJsonAtomic(join(dir, 'meta.json'), next)
      return next
    }
  }

  for (const order of pending) {
    await importOrder({
      config,
      gh,
      scaffold,
      account,
      order,
      uploadDir: dir,
      remoteUrlFor,
      owner,
      sha256: meta.sha256,
    })
  }

  for (const order of reuploadOrders) {
    await reuploadOrder({
      config,
      gh,
      account,
      order,
      uploadDir: dir,
      remoteUrlFor,
      owner,
      commentAt: meta.at || stamp,
      sha256: meta.sha256,
    })
  }

  await backfillRepos(config, account, passedOrders)

  // 给 Mac 上的补缺口 Agent：#460 要从 inbox 的 meta 找到仓、父工单和分支。
  const freshOrders = await readOrders(config)
  const imported = passedOrders.map((order) => {
    const fresh = freshOrders.find((item) => item.id === order.id) || order
    const product = fresh.product || fresh.requirement
    const repo =
      repoFromIssue(fresh.issue) ||
      (account.repos && account.repos[product]) ||
      `${account.short_name}-${product}`
    return {
      order_id: fresh.id,
      requirement: fresh.requirement,
      product,
      owner,
      repo,
      issue_url: fresh.issue || '',
      branch: fresh.branch || `req/${fresh.id}`,
    }
  })

  const next = {
    ...meta,
    status: 'imported',
    orders: uploadOrders.map((order) => order.id),
    imported,
    imported_at: stamp,
  }
  await writeJsonAtomic(join(dir, 'meta.json'), next)
  return next
}

async function scan({ config, gh, scaffold, mailSender, remoteUrlFor, specLock, now }) {
  let names = []
  try {
    names = await readdir(config.uploadDir)
  } catch {
    return { uploads: [] }
  }

  const results = []
  for (const name of names.filter((item) => item.startsWith('upload-')).sort()) {
    const dir = join(config.uploadDir, name)
    const meta = await readJson(join(dir, 'meta.json'), null)
    if (!meta || meta.status !== 'ready') continue

    try {
      const next = await importUpload({
        config,
        gh,
        scaffold,
        mailSender,
        remoteUrlFor,
        specLock,
        dir,
        meta,
        now,
      })
      results.push({ id: name, status: next.status })
      logLine({ ts: now.toISOString(), level: 'info', msg: '回传导入处理完', upload: name, status: next.status })
    } catch (error) {
      // 导入途中可能已经写过邮件去重记录，合并磁盘上的最新 meta，别覆盖掉。
      const latest = (await readJson(join(dir, 'meta.json'), null)) || {}
      const failed = importFailure({ ...meta, ...latest }, now.toISOString(), error)
      await writeJsonAtomic(join(dir, 'meta.json'), failed)
      results.push({ id: name, status: failed.status, error: failed.operator_alert.message })
      logLine({
        ts: now.toISOString(),
        level: 'error',
        msg: '回传导入失败，快照保留',
        upload: name,
        reason: failed.reason,
        error: failed.operator_alert.message,
      })
    }
  }

  return { uploads: results }
}

/**
 * 跑一轮导入。`--once` 用；同一时间只让一个进程跑。
 */
export async function importOnce({
  config,
  gh,
  scaffold = scaffoldCustomerRepo,
  mailSender,
  specLock,
  remoteUrlFor = ({ owner, repo }) => `https://github.com/${owner}/${repo}.git`,
  now = new Date(),
}) {
  const client =
    gh ||
    createGithubApi({
      token: config.githubAdminToken,
      apiBase: config.githubApi,
      timeoutMs: config.githubTimeoutMs,
    })
  const lock = specLock || config.specLock || createSpecLock(config)

  try {
    return await withFileLock(
      join(config.uploadDir, '.import.lock'),
      () => scan({ config, gh: client, scaffold, mailSender, remoteUrlFor, specLock: lock, now }),
      { timeoutMs: 2000 },
    )
  } catch (error) {
    if (/等锁超时/.test(String(error.message || ''))) {
      return { skipped: 'locked', uploads: [] }
    }
    throw error
  }
}
