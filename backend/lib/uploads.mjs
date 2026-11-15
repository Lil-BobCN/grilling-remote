import { createHash, randomUUID } from 'node:crypto'
import { readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { HttpError } from './errors.mjs'
import { readBody } from './http.mjs'
import { parseMultipart } from './multipart.mjs'
import { publicOrder, recordUpload } from './orders.mjs'
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

export async function handleUpload({ req, config, session, limiters, ip }) {
  if (!limiters.uploadsIp.allow(ip)) {
    throw new HttpError(429, '上传太频繁，过几分钟再试')
  }
  if (!limiters.uploadsUser.allow(session.account.id)) {
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
    user: { id: session.account.id, short_name: session.account.short_name || '' },
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

  const requirements = []
  const orders = []
  for (const name of result.requirements) {
    if (!name || name.includes('/') || name.includes('\\') || name === '..') continue
    const validation = await validateRequirement(join(dir, 'work', 'scratch', name), { finished })
    const { order } = await recordUpload(config, session.account, {
      requirement: name,
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

  let removed = 0
  for (const name of names) {
    if (!name.startsWith('upload-')) continue
    const dir = join(config.uploadDir, name)
    const meta = await readJson(join(dir, 'meta.json'), null)
    if (!meta || meta.status !== 'failed') continue
    const at = Date.parse(meta.at || '')
    if (!Number.isFinite(at) || now - at < config.retentionMs) continue
    await rm(dir, { recursive: true, force: true }).catch(() => {})
    removed += 1
  }
  return removed
}
