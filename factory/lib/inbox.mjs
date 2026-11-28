/**
 * Mac 拉取桥：把服务器 `/data/uploads/upload-*` 里的回传件拷到 `inbox/<上传 id>/`。
 *
 * 远端适配器只做三件事：`list()`、`read(id, name)`、`remove(id)`。
 * 默认用 ssh 调服务器；测试和本机演练用 `createDirRemote` 指一个临时目录。
 *
 * 删远端只在本地副本完整并且 `meta.status === 'imported'` 时做；有没转发出去的
 * `operator_alert` 时先不删，等通知成功后再删。
 */
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { FAILED_UPLOAD_STATUSES } from '../../backend/lib/protocol.mjs'
import { logLine } from './log.mjs'
import { notificationEvent } from './notify.mjs'

const UPLOAD_ID = /^upload-[A-Za-z0-9._-]+$/
const ALLOWED_FILES = new Set(['meta.json', 'package.zip'])
const MAX_WORK_FILE_BYTES = 128 * 1024 * 1024
const MAX_WORK_TOTAL_BYTES = 512 * 1024 * 1024

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function fileComplete(path, meta) {
  try {
    const info = await stat(path)
    if (!info.isFile()) return false
    if (Number.isFinite(meta.size) && info.size !== meta.size) return false
    if (typeof meta.sha256 === 'string' && meta.sha256) {
      return sha256(await readFile(path)) === meta.sha256
    }
    return true
  } catch {
    return false
  }
}

async function writeAtomic(path, bytes) {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, bytes)
  await rename(tmp, path)
}

/** 客户表先校验再原子替换；坏 JSON 不覆盖上一份。 */
async function writeCustomers(path, bytes) {
  const parsed = JSON.parse(bytes.toString('utf8'))
  const rows = Array.isArray(parsed) ? parsed : parsed?.customers
  if (!Array.isArray(rows)) throw new Error('customers.json 不是数组')
  await writeAtomic(path, bytes)
}

async function readJsonOrNull(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return null
    throw error
  }
}

function unsafeEntryName(name) {
  const normalized = name.replace(/\\/g, '/')
  if (!normalized || normalized.includes('\0')) return true
  if (normalized.startsWith('/')) return true
  if (normalized.length >= 2 && normalized[1] === ':') return true
  return normalized.split('/').some((part) => part === '..')
}

function runBsdtar(args, timeout) {
  return new Promise((resolve, reject) => {
    execFile('bsdtar', args, { timeout, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(String(stderr || error.message || error).trim()))
        return
      }
      resolve(String(stdout))
    })
  })
}

/** 用 bsdtar 列条目，拿到权限、大小和名字；格式是 macOS 的 `bsdtar -tvf`。 */
async function listZipEntries(zipPath) {
  let listing
  try {
    listing = await runBsdtar(['-tvf', zipPath], 120000)
  } catch (error) {
    throw new Error(`读不出 package.zip 的条目：${error.message}`)
  }
  const entries = []
  for (const line of listing.split('\n')) {
    if (!line.trim()) continue
    const parsed = /^(\S{10})\s+\S+\s+\S+\s+\S+\s+(\d+)\s+\S+\s+\S+\s+\S+\s+(.*)$/.exec(line)
    if (!parsed) throw new Error(`package.zip 的条目列表看不懂：${line}`)
    entries.push({ mode: parsed[1], size: Number(parsed[2]), name: parsed[3] })
  }
  return entries
}

/**
 * 安全解压：先查条目，再解到临时目录，成功后才换到 work 目录。
 * 拒绝绝对路径、`..`、符号链接，限制单文件和总大小；失败清临时目录，已有 work 不动。
 */
async function extractPackage(zipPath, workDir) {
  const entries = await listZipEntries(zipPath)
  let total = 0
  for (const entry of entries) {
    const kind = entry.mode[0]
    if (kind === 'l' || kind === 'h') {
      throw new Error(`package.zip 里有符号链接，拒绝解压：${entry.name}`)
    }
    if (kind !== '-' && kind !== 'd') {
      throw new Error(`package.zip 里有不支持的条目，拒绝解压：${entry.name}`)
    }
    if (unsafeEntryName(entry.name)) {
      throw new Error(`package.zip 里有不安全的路径，拒绝解压：${entry.name}`)
    }
    if (kind === '-' && entry.size > MAX_WORK_FILE_BYTES) {
      throw new Error(`package.zip 里有文件超过 128 MB：${entry.name}`)
    }
    total += entry.size
    if (total > MAX_WORK_TOTAL_BYTES) {
      throw new Error('package.zip 解压后总大小超过 512 MB')
    }
  }

  const tmpDir = await mkdtemp(join(dirname(workDir), '.work-'))
  try {
    try {
      await runBsdtar(['-xf', zipPath, '-C', tmpDir], 300000)
    } catch (error) {
      throw new Error(`解压 package.zip 失败：${error.message}`)
    }
    await rm(workDir, { recursive: true, force: true })
    await rename(tmpDir, workDir)
  } catch (error) {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/** 把远端当成一个本地目录，测试和小范围演练用。 */
export function createDirRemote(root, { customersFile } = {}) {
  const remote = {
    async list() {
      let names = []
      try {
        names = await readdir(root)
      } catch {
        return []
      }
      return names.filter((name) => UPLOAD_ID.test(name)).sort()
    },
    read(id, name) {
      if (!UPLOAD_ID.test(id) || !ALLOWED_FILES.has(name)) throw new Error(`不读这个文件：${id}/${name}`)
      return readFile(join(root, id, name))
    },
    async remove(id) {
      if (!UPLOAD_ID.test(id)) throw new Error(`不删这个目录：${id}`)
      await rm(join(root, id), { recursive: true, force: true })
    },
  }

  if (customersFile) {
    remote.syncCustomers = async (destination) => {
      await writeCustomers(destination, await readFile(customersFile))
      return destination
    }
  }
  return remote
}

/**
 * 默认远端：ssh 到服务器，用 `sudo -n afk-uploads` 读写回传件和客户表。
 * `server` 形如 `dev@1.2.3.4`；`key` 可选，对应 `ssh -i`。
 * helper 由 deploy/backend/install.sh 装到 /usr/local/sbin，sudoers 给 dev 免密；
 * 它只管 list、cat、rm 和 cat-customers，不开放任意路径。
 */
export function createSshRemote({
  server,
  key = '',
  helper = '/usr/local/sbin/afk-uploads',
}) {
  if (!server) throw new Error('缺少服务器地址（AFK_SERVER，例如 dev@1.2.3.4）')
  if (!/^\/[A-Za-z0-9._/-]+$/.test(helper)) throw new Error(`helper 路径不对：${helper}`)

  function run(command, { binary = false } = {}) {
    const args = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15']
    if (key) args.push('-i', key)
    args.push(server, command)
    return new Promise((resolve, reject) => {
      execFile(
        'ssh',
        args,
        { timeout: 300000, maxBuffer: 64 * 1024 * 1024, encoding: binary ? 'buffer' : 'utf8' },
        (error, stdout, stderr) => {
          if (error) {
            const detail = String(stderr || error.message || error).trim()
            reject(new Error(`ssh ${server} 失败：${detail}`))
            return
          }
          resolve(stdout)
        },
      )
    })
  }

  return {
    async list() {
      const output = await run(`sudo -n ${helper} list`)
      return String(output)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((name) => UPLOAD_ID.test(name))
        .sort()
    },
    read(id, name) {
      if (!UPLOAD_ID.test(id) || !ALLOWED_FILES.has(name)) throw new Error(`不读这个文件：${id}/${name}`)
      return run(`sudo -n ${helper} cat ${id} ${name}`, { binary: true })
    },
    async remove(id) {
      if (!UPLOAD_ID.test(id)) throw new Error(`不删这个目录：${id}`)
      await run(`sudo -n ${helper} rm ${id}`)
    },
    async syncCustomers(destination) {
      const bytes = await run(`sudo -n ${helper} cat-customers`, { binary: true })
      await writeCustomers(destination, bytes)
      return destination
    },
  }
}

/**
 * 回传件的运营者通知。
 *
 * 导入失败用 `import_failed` 事件；其余带 `operator_alert` 的状态仍按「出事」发。
 * key 带上传号，同一上传的同一告警只发一次；时间用告警时间，不用拉取时间。
 *
 * @param {object} options
 * @param {object} options.meta 上传的 meta.json
 * @param {object} [options.alert] `meta.operator_alert`
 * @param {string} [options.link] 通知里的链接，默认管理页
 * @param {Date} [options.now]
 */
export function importEvent({ meta, alert = {}, link = '', now = new Date() }) {
  const status = String(meta?.status || '')
  const eventName = status === 'import_failed' ? 'import_failed' : '出事'
  const requirement =
    (Array.isArray(meta?.requirements)
      ? meta.requirements.map((item) => item?.name).filter(Boolean).join('、')
      : '') || meta?.id || ''
  const reason = String(alert?.reason || status || '导入失败')
  const at = alert?.at || now
  return notificationEvent({
    subject: `inbox:${meta?.id || 'upload'}`,
    event: eventName,
    scope: eventName === 'import_failed' ? '' : reason,
    now: at instanceof Date ? at : new Date(at),
    link,
    data: {
      customer: meta?.user?.short_name || '客户',
      requirement,
      reason,
      tried: alert?.message || '导入步骤报错，详情看服务器日志',
    },
  })
}

/**
 * 拉一轮。
 * @param {object} options
 * @param {object} options.remote 远端适配器
 * @param {string} options.inboxDir 本地存档根目录
 * @param {string} [options.customersPath] 本机 customers.json 路径，默认 inbox 的上一层
 * @param {(payload: {meta: object, alert: object, dir: string}) => Promise<void>} [options.notify]
 * @param {Date} [options.now]
 */
export async function pullInbox({
  remote,
  inboxDir,
  customersPath = join(dirname(inboxDir), 'customers.json'),
  notify = async () => {},
  now = new Date(),
}) {
  const stamp = now.toISOString()

  let customers = { path: customersPath, skipped: '远端没有 syncCustomers' }
  if (typeof remote.syncCustomers === 'function') {
    try {
      await remote.syncCustomers(customersPath)
      customers = { path: customersPath }
    } catch (error) {
      const message = String(error && error.message ? error.message : error)
      customers = { path: customersPath, error: message }
      logLine({
        level: 'warning',
        msg: 'customers.json 拉取失败，保留上一份',
        path: customersPath,
        error: message,
      })
    }
  }

  let ids = []
  try {
    ids = await remote.list()
  } catch (error) {
    throw new Error(`列不出服务器上的回传件：${error.message}`)
  }

  const pulled = []
  const removed = []
  const notified = []

  for (const id of ids) {
    let rawMeta
    try {
      rawMeta = await remote.read(id, 'meta.json')
    } catch {
      continue
    }
    let meta
    try {
      meta = JSON.parse(rawMeta.toString('utf8'))
    } catch {
      continue
    }
    const status = meta?.status
    const allowed =
      status === 'ready' ||
      status === 'imported' ||
      (FAILED_UPLOAD_STATUSES.includes(status) &&
        (status !== 'failed' || meta.operator_alert))
    if (!allowed) continue

    const dir = join(inboxDir, id)
    await mkdir(dir, { recursive: true })
    const archivePath = join(dir, 'archived.json')
    const previous = (await readJsonOrNull(archivePath)) || {}

    const zipPath = join(dir, 'package.zip')
    // 失败终态也要把包存档：服务器 7 天后会删原包，本地只剩 meta 就补不回来。
    // `failed` 故意不在内：那次没进导入，只转发提醒，不占本地存档。
    const copyPackage =
      status === 'ready' ||
      status === 'imported' ||
      status === 'validation_failed' ||
      status === 'import_failed' ||
      status === 'import_partial' ||
      status === 'needs_operator'
    let complete = copyPackage ? await fileComplete(zipPath, meta) : false
    if (copyPackage && !complete) {
      const bytes = await remote.read(id, 'package.zip')
      if (typeof meta.sha256 === 'string' && meta.sha256 && sha256(bytes) !== meta.sha256) {
        throw new Error(`${id} 的 package.zip 和 meta.json 里的 sha256 对不上，没有存档`)
      }
      await writeAtomic(zipPath, bytes)
      complete = true
    }

    const workDir = join(dir, 'work')
    let work = previous.work || null
    let workError = null
    if (complete) {
      const sha = typeof meta.sha256 === 'string' ? meta.sha256 : ''
      const alreadyExtracted =
        Boolean(work?.sha256) && work.sha256 === sha && (await isDirectory(workDir))
      if (!alreadyExtracted) {
        try {
          await extractPackage(zipPath, workDir)
          work = { sha256: sha, extracted_at: stamp }
        } catch (error) {
          work = null
          workError = String(error && error.message ? error.message : error)
          logLine({
            level: 'warning',
            msg: 'package.zip 解压失败，保留 zip，继续后面的包',
            id,
            error: workError,
          })
        }
      }
    }

    const metaPath = join(dir, 'meta.json')
    let localMeta = null
    try {
      localMeta = await readFile(metaPath)
    } catch {
      localMeta = null
    }
    if (!localMeta || !localMeta.equals(rawMeta)) await writeAtomic(metaPath, rawMeta)

    const archive = {
      id,
      sha256: meta.sha256 || '',
      size: meta.size ?? null,
      status: meta.status,
      archived_at: previous.archived_at || stamp,
      updated_at: stamp,
      ...(previous.notified_at ? { notified_at: previous.notified_at } : {}),
      ...(previous.removed_remote_at ? { removed_remote_at: previous.removed_remote_at } : {}),
      ...(work ? { work } : {}),
      ...(workError ? { work_error: workError } : {}),
    }

    if (meta.operator_alert && !archive.notified_at) {
      try {
        await notify({ meta, alert: meta.operator_alert, dir })
        archive.notified_at = stamp
        notified.push(id)
      } catch (error) {
        archive.notify_error = String(error && error.message ? error.message : error)
      }
    }

    await writeAtomic(archivePath, `${JSON.stringify(archive, null, 2)}\n`)
    pulled.push(id)

    const alertPending = Boolean(meta.operator_alert && !archive.notified_at)
    if (complete && meta.status === 'imported' && !alertPending) {
      await remote.remove(id)
      await writeAtomic(
        archivePath,
        `${JSON.stringify({ ...archive, removed_remote_at: stamp }, null, 2)}\n`,
      )
      removed.push(id)
    }
  }

  return { pulled, removed, notified, customers }
}
