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
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const UPLOAD_ID = /^upload-[A-Za-z0-9._-]+$/
const ALLOWED_FILES = new Set(['meta.json', 'package.zip'])

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
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, bytes)
  await rename(tmp, path)
}

async function readJsonOrNull(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return null
    throw error
  }
}

/** 把远端当成一个本地目录，测试和小范围演练用。 */
export function createDirRemote(root) {
  return {
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
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

/**
 * 默认远端：ssh 到服务器，用 `sudo -n` 读 `/data/uploads`。
 * `server` 形如 `dev@1.2.3.4`；`key` 可选，对应 `ssh -i`。
 * 服务器上的 `dev` 在 sudo 组，上传目录 700 afkapp。
 */
export function createSshRemote({ server, uploadDir = '/data/uploads', key = '' }) {
  if (!server) throw new Error('缺少服务器地址（AFK_SERVER，例如 dev@1.2.3.4）')

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
      const output = await run(`sudo -n ls -1 ${shellQuote(uploadDir)}`)
      return String(output)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((name) => UPLOAD_ID.test(name))
        .sort()
    },
    read(id, name) {
      if (!UPLOAD_ID.test(id) || !ALLOWED_FILES.has(name)) throw new Error(`不读这个文件：${id}/${name}`)
      return run(`sudo -n cat ${shellQuote(join(uploadDir, id, name))}`, { binary: true })
    },
    async remove(id) {
      if (!UPLOAD_ID.test(id)) throw new Error(`不删这个目录：${id}`)
      await run(`sudo -n rm -rf ${shellQuote(join(uploadDir, id))}`)
    },
  }
}

/**
 * 拉一轮。
 * @param {object} options
 * @param {object} options.remote 远端适配器
 * @param {string} options.inboxDir 本地存档根目录
 * @param {(payload: {meta: object, alert: object, dir: string}) => Promise<void>} [options.notify]
 * @param {Date} [options.now]
 */
export async function pullInbox({ remote, inboxDir, notify = async () => {}, now = new Date() }) {
  const stamp = now.toISOString()
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
    const allowed =
      meta?.status === 'ready' ||
      meta?.status === 'imported' ||
      (meta?.status === 'failed' && meta.operator_alert)
    if (!allowed) continue

    const dir = join(inboxDir, id)
    await mkdir(dir, { recursive: true })
    const archivePath = join(dir, 'archived.json')
    const previous = (await readJsonOrNull(archivePath)) || {}

    const zipPath = join(dir, 'package.zip')
    const copyPackage = meta.status === 'ready' || meta.status === 'imported'
    let complete = copyPackage ? await fileComplete(zipPath, meta) : false
    if (copyPackage && !complete) {
      const bytes = await remote.read(id, 'package.zip')
      if (typeof meta.sha256 === 'string' && meta.sha256 && sha256(bytes) !== meta.sha256) {
        throw new Error(`${id} 的 package.zip 和 meta.json 里的 sha256 对不上，没有存档`)
      }
      await writeAtomic(zipPath, bytes)
      complete = true
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

  return { pulled, removed, notified }
}
