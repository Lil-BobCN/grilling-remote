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
import { readJson, withFileLock, writeJsonAtomic } from './store.mjs'

const execFileAsync = promisify(execFile)
const SNAPSHOT_NOTE = '回传快照，以父工单和 spec 为准，不作为决策来源。'
const SMALL_LABEL = { name: '大小:小需求', color: 'ededed', description: '小需求，跳过 spec 和拆票' }

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
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

  const issue = await gh.createIssue({
    owner,
    repo: repoName,
    title: rendered.title,
    body: rendered.body,
    labels,
  })

  await updateOrder(config, order.id, {
    issue: issue.html_url,
    product,
    branch,
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

async function importUpload({ config, gh, scaffold, mailSender, remoteUrlFor, dir, meta, now }) {
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
  if (passedOrders.length === 0) return meta

  for (const order of pending) {
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
    })
  }

  await backfillRepos(config, account, passedOrders)

  const next = {
    ...meta,
    status: 'imported',
    orders: uploadOrders.map((order) => order.id),
    imported_at: stamp,
  }
  await writeJsonAtomic(join(dir, 'meta.json'), next)
  return next
}

async function scan({ config, gh, scaffold, mailSender, remoteUrlFor, now }) {
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

  try {
    return await withFileLock(
      join(config.uploadDir, '.import.lock'),
      () => scan({ config, gh: client, scaffold, mailSender, remoteUrlFor, now }),
      { timeoutMs: 2000 },
    )
  } catch (error) {
    if (/等锁超时/.test(String(error.message || ''))) {
      return { skipped: 'locked', uploads: [] }
    }
    throw error
  }
}
