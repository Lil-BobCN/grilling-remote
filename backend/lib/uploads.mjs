import { createHash, randomUUID } from 'node:crypto'
import { readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { HttpError } from './errors.mjs'
import { readCustomers } from './customers.mjs'
import { readBody } from './http.mjs'
import { logLine } from './log.mjs'
import { parseMultipart } from './multipart.mjs'
import { publicOrder, readOrders, recordUpload } from './orders.mjs'
import { FAILED_UPLOAD_STATUSES } from './protocol.mjs'
import { createSpecLock } from './spec-lock.mjs'
import { ensureDir, readJson, writeJsonAtomic } from './store.mjs'
import { validateRequirement } from './validate-package.mjs'
import { inspectZip } from './zip.mjs'

const MISSING_SCRATCH = {
  'original-package':
    '包里没找到 .scratch 文件夹。你可能传的是下载的原始工作区包，或者压缩时漏了隐藏文件。请打开做完需求的那个工作区文件夹，把里面所有文件一起压缩再上传。',
  'requirement-only':
    '压缩的是需求文件夹里的内容，不是整个工作区。回到上一层，把整个工作区文件夹压缩再上传。',
  'not-unzipped':
    '上传的还是下载包里的 zip，没有解压。先把工作区 zip 解压，再把解压出来的整个文件夹压缩上传。',
  'wrong-folder':
    '没认出这是工作区。确认上传的是做完需求的那个工作区文件夹，里面要有 .scratch。',
}

function rejection(result) {
  switch (result.code) {
    case 'not_zip':
      return { status: 415, message: '这个文件不是 zip。把工作区文件夹压缩成 zip 再上传。' }
    case 'unsafe':
      return {
        status: 422,
        message: '压缩包里有不安全的路径，已拒绝。重新压缩整个工作区，不要手动改包里的目录。',
      }
    case 'encrypted':
      return { status: 422, message: '压缩包加了密码，服务器打不开。去掉密码，重新压缩再上传。' }
    case 'too_large':
      return {
        status: 422,
        message: '压缩包解压后太大或文件太多，服务器处理不了。确认传的是工作区文件夹，不是整个磁盘或备份。',
      }
    case 'missing_scratch':
      return {
        status: 422,
        message: MISSING_SCRATCH[result.kind] || MISSING_SCRATCH['wrong-folder'],
        missing: [MISSING_SCRATCH[result.kind] || MISSING_SCRATCH['wrong-folder']],
      }
    case 'no_requirements':
      return {
        status: 422,
        message:
          '包里有 .scratch，但下面没有需求文件夹。让 agent 把这次的需求写进 .scratch 下的需求目录，再重新压缩上传。',
        missing: [
          '包里有 .scratch，但下面没有需求文件夹。让 agent 把这次的需求写进 .scratch 下的需求目录，再重新压缩上传。',
        ],
      }
    case 'internal':
    default:
      return { status: 500, message: '服务器处理这个压缩包时出错了。过一会儿再传一次，还不行就找客服。' }
  }
}

function knownRepos(account) {
  const repos = account && account.repos
  if (!repos || typeof repos !== 'object' || Array.isArray(repos)) return {}
  const known = {}
  for (const [key, value] of Object.entries(repos)) {
    if (typeof value !== 'string') continue
    const name = String(key || '').trim()
    if (name && value.trim()) known[name] = value.trim()
  }
  return known
}

/**
 * 受理前查客户白名单：登录账号必须在 customers.json 里有一行。
 * 管理员账号默认没有客户行，直接 422，不建死单；
 * 要替客户上传，先用客户账号，或把这个账号显式映射到一行客户档案。
 */
async function requireCustomer(config, account) {
  const rows = await readCustomers(config)
  const row = rows.find((item) => item.id === account.id)
  if (row) return row
  throw new HttpError(
    422,
    '这个账号没有客户档案，上传不会建单。请用客户账号登录上传；要给管理员账号开上传，需要把它显式映射到一行客户档案。',
  )
}

function repoNameFor(account, product) {
  const shortName = String((account && account.short_name) || '').trim()
  return shortName && product ? `${shortName}-${product}` : ''
}

function rejectSoftware({ account, now, reason, message, extra = {} }) {
  logLine({
    ts: now,
    level: 'error',
    msg: `上传未建单：${message}`,
    customer_id: account.id,
    ...extra,
  })
  return { status: 422, reason, message, missing: [message] }
}

function resolveProducts({ account, software, requirements, now }) {
  const repos = knownRepos(account)
  const known = Object.keys(repos)
  const usedRepoNames = new Set(Object.values(repos).map((name) => name.toLowerCase()))
  let products

  if (software) {
    products = requirements.map((requirement) => ({ requirement, product: software }))
  } else {
    products = requirements.map((requirement) => {
      let match = ''
      for (const key of known) {
        if (requirement.includes(key) && key.length > match.length) match = key
      }
      return { requirement, product: match || requirement, fresh: !match }
    })
  }

  // 新软件第一次上传只能有一个需求目录：有 软件.md 也一样，仓还没建出来。
  if (products.length > 1) {
    const fresh = products.filter((item) => !Object.hasOwn(repos, item.product))
    if (fresh.length) {
      const names = products.map((item) => item.requirement).join('、')
      const labels = [...new Set(fresh.map((item) => item.product))].join('、')
      return rejectSoftware({
        account,
        now,
        reason: 'multiple_new_requirements',
        message: `这次上传要算作新软件「${labels}」的第一次上传，但 .scratch/ 下有多个需求目录（${names}）。新软件第一次上传只能有一个需求目录，先只留一个再上传，其他目录请找客服。`,
        extra: { requirements },
      })
    }
  }

  for (const item of products) {
    if (Object.hasOwn(repos, item.product)) continue
    const clash = known.find((key) => key.toLowerCase() === item.product.toLowerCase())
    if (clash) {
      return rejectSoftware({
        account,
        now,
        reason: 'duplicate_software',
        message: `软件简称「${item.product}」和已有软件「${clash}」重名，大小写不区分。请联系客服确认软件简称。`,
        extra: { product: item.product, existing: clash },
      })
    }
    const expected = repoNameFor(account, item.product)
    if (expected && usedRepoNames.has(expected.toLowerCase())) {
      return rejectSoftware({
        account,
        now,
        reason: 'duplicate_software',
        message: `软件简称「${item.product}」对应的仓名 ${expected} 已经属于另一个软件。请联系客服确认软件简称。`,
        extra: { product: item.product, repo: expected },
      })
    }
  }

  return { products: products.map(({ requirement, product }) => ({ requirement, product })) }
}

async function isFile(path) {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/** 小需求只有需求草稿，没有地图。 */
async function isSmallRequirement(uploadDir, requirement) {
  const dir = join(uploadDir, 'work', 'scratch', requirement)
  return (await isFile(join(dir, '需求草稿.md'))) && !(await isFile(join(dir, 'map.md')))
}

/**
 * to-spec 窗口的两条规则：当前单没交付时不收新的需求目录；已锁单的目录不能重传。
 * 小需求建单即锁，没有重传窗口。
 * 返回 null 表示放行，否则返回拒绝结果。
 */
async function checkUploadWindow({ config, account, products, uploadDir, now }) {
  const repos = knownRepos(account)
  const orders = (await readOrders(config)).filter((order) => order.customer_id === account.id)
  const productNames = [...new Set(products.map((item) => item.product))]

  for (const product of productNames) {
    const productOrders = orders.filter((order) => (order.product || '') === product)
    if (!productOrders.some((order) => !order.closed_at)) continue
    const existing = new Set(productOrders.map((order) => order.requirement))
    const fresh = products
      .filter((item) => item.product === product && !existing.has(item.requirement))
      .map((item) => item.requirement)
    if (fresh.length) {
      return rejectSoftware({
        account,
        now,
        reason: 'new_requirement_while_open',
        message: `软件「${product}」还有没交付的单，这次上传里又出现了新的需求目录（${fresh.join('、')}）。当前单在 to-spec 前可以把改好的内容整包重传，但不能加新的需求目录；等这单交付后再传。`,
        extra: { product, requirements: fresh },
      })
    }
  }

  const specLock = config.specLock || createSpecLock(config)
  for (const item of products) {
    const existing = orders.find(
      (order) => (order.product || '') === item.product && order.requirement === item.requirement,
    )
    if (!existing || existing.closed_at) continue
    // 小需求校验通过、建单后锁住；校验未通过时还要允许补传。
    const lockedSmall =
      existing.validation?.passed === true && (await isSmallRequirement(uploadDir, item.requirement))
    if (lockedSmall) {
      return rejectSoftware({
        account,
        now,
        reason: 'small_requirement_locked',
        message: '小需求建单即锁，改主意请等这一版交付后开新单。',
        extra: { product: item.product, requirement: item.requirement },
      })
    }
    const repoName = repos[item.product] || repoNameFor(account, item.product)
    let locked = false
    try {
      locked = await specLock({
        owner: config.githubOwner || '',
        repo: repoName,
        requirement: item.requirement,
      })
    } catch (error) {
      logLine({
        ts: now,
        level: 'warning',
        msg: '锁单检查出错，按未锁放行',
        customer_id: account.id,
        requirement: item.requirement,
        error: String(error && error.message ? error.message : error),
      })
      locked = false
    }
    if (locked) {
      return rejectSoftware({
        account,
        now,
        reason: 'requirement_locked',
        message: `需求目录「${item.requirement}」已经锁单（spec 已发布），这一版不能再改。请新建需求目录再上传。`,
        extra: { product: item.product, requirement: item.requirement },
      })
    }
  }

  return null
}

export async function handleUpload({ req, config, session, limiters, ip }) {
  const customer = await requireCustomer(config, session.account)

  if (!limiters.uploadsIp.allow(ip)) {
    throw new HttpError(429, '上传太频繁，过几分钟再试')
  }
  if (!limiters.uploadsUser.allow(customer.id)) {
    throw new HttpError(429, '上传太频繁，过几分钟再试')
  }

  const declared = Number(req.headers['content-length'] || 0)
  const maxBody = config.maxUploadBytes + 1024 * 1024
  if (declared && declared > maxBody) throw new HttpError(413, '文件太大，最大 50 MB')

  const body = await readBody(req, maxBody)
  const { fields, files } = parseMultipart(body, req.headers['content-type'])
  const file = files.file
  if (!file) throw new HttpError(400, '没收到文件，请重新选择工作区 zip')

  const finishedText = String(fields.finished || '').trim().toLowerCase()
  if (finishedText !== 'true' && finishedText !== 'false') {
    throw new HttpError(400, '缺少「已问完」状态，请刷新页面再试')
  }
  const finished = finishedText === 'true'

  if (file.data.length === 0) throw new HttpError(400, '文件是空的，请重新压缩工作区')
  if (file.data.length > config.maxUploadBytes) throw new HttpError(413, '文件太大，最大 50 MB')

  const filename = (file.filename || 'workspace.zip').split(/[\\/]/).pop().slice(0, 200)
  if (!/\.zip$/i.test(filename)) {
    throw new HttpError(415, '只收 zip 文件。把工作区文件夹压缩成 zip 再上传。')
  }

  const now = new Date().toISOString()
  const sha256 = createHash('sha256').update(file.data).digest('hex')
  const uploadId = `upload-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
  const dir = join(config.uploadDir, uploadId)
  await ensureDir(dir)
  const zipPath = join(dir, 'package.zip')
  await writeFile(zipPath, file.data, { mode: 0o600 })

  const meta = {
    id: uploadId,
    at: now,
    filename,
    size: file.data.length,
    sha256,
    user: { id: customer.id, short_name: customer.short_name || '' },
    status: 'received',
  }

  const result = await inspectZip(config, zipPath, join(dir, 'work'))
  if (!result.ok) {
    const failure = rejection(result)
    await writeJsonAtomic(join(dir, 'meta.json'), {
      ...meta,
      status: 'failed',
      reason: result.code,
      kind: result.kind || null,
      missing: failure.missing || [],
    })
    throw new HttpError(failure.status, failure.message, { missing: failure.missing || [] })
  }

  const names = result.requirements.filter(
    (name) => name && !name.includes('/') && !name.includes('\\') && name !== '..',
  )
  const resolved = resolveProducts({
    account: customer,
    software: result.software || '',
    requirements: names,
    now,
  })
  if (!resolved.products) {
    await writeJsonAtomic(join(dir, 'meta.json'), {
      ...meta,
      status: 'failed',
      reason: resolved.reason,
      missing: resolved.missing,
      ...(resolved.reason === 'multiple_new_requirements'
        ? {
            operator_alert: {
              reason: resolved.reason,
              message: resolved.message,
              at: now,
            },
          }
        : {}),
    })
    throw new HttpError(resolved.status, resolved.message, { missing: resolved.missing })
  }

  const blocked = await checkUploadWindow({
    config,
    account: customer,
    products: resolved.products,
    uploadDir: dir,
    now,
  })
  if (blocked) {
    await writeJsonAtomic(join(dir, 'meta.json'), {
      ...meta,
      status: 'failed',
      reason: blocked.reason,
      missing: blocked.missing,
    })
    throw new HttpError(blocked.status, blocked.message, { missing: blocked.missing })
  }

  const requirements = []
  const orders = []
  for (const { requirement: name, product } of resolved.products) {
    const validation = await validateRequirement(join(dir, 'work', 'scratch', name), { finished })
    const { order } = await recordUpload(config, customer, {
      requirement: name,
      product,
      title: name,
      filename,
      size: file.data.length,
      sha256,
      validation,
      now: new Date().toISOString(),
    })
    requirements.push({ name, passed: validation.passed, missing: validation.missing })
    orders.push(publicOrder(order))
  }

  await writeJsonAtomic(join(dir, 'meta.json'), {
    ...meta,
    status: 'ready',
    requirements,
    orders: orders.map((order) => order.id),
    missing: requirements.flatMap((item) => item.missing),
  })

  return { status: 200, payload: { orders } }
}

export async function cleanupExpired(config, now = Date.now()) {
  let names = []
  try {
    names = await readdir(config.uploadDir)
  } catch {
    return 0
  }

  const removable = new Set(FAILED_UPLOAD_STATUSES)
  let removed = 0
  for (const name of names) {
    if (!name.startsWith('upload-')) continue
    const dir = join(config.uploadDir, name)
    const meta = await readJson(join(dir, 'meta.json'), null)
    if (!meta || !removable.has(meta.status)) continue
    const at = Date.parse(meta.at || '')
    if (!Number.isFinite(at) || now - at < config.retentionMs) continue
    await rm(dir, { recursive: true, force: true }).catch(() => {})
    removed += 1
  }
  return removed
}
