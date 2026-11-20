/**
 * 导入失败后的重试入口：把上传记录改回 `ready`，让下一轮扫描重新处理。
 *
 * 只改上传状态和审计，不碰导入业务。订单级失败原因保留到下一轮导入成功时清掉。
 */
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { logLine } from './log.mjs'
import { readOrder } from './orders.mjs'
import { readJson, writeJsonAtomic } from './store.mjs'

export const RETRYABLE_UPLOAD_STATUSES = ['import_partial', 'import_failed']

const ORDER_RE = /^o-[A-Za-z0-9._-]+$/
const UPLOAD_RE = /^upload-[A-Za-z0-9._-]+$/

function usageError(message) {
  const error = new Error(message)
  error.exitCode = 2
  return error
}

async function findUploadByOrder(config, orderId) {
  let names = []
  try {
    names = await readdir(config.uploadDir)
  } catch {
    return null
  }
  const matches = []
  for (const name of names.filter((item) => item.startsWith('upload-')).sort()) {
    const dir = join(config.uploadDir, name)
    const meta = await readJson(join(dir, 'meta.json'), null)
    if (!meta || !Array.isArray(meta.orders) || !meta.orders.includes(orderId)) continue
    matches.push({ dir, meta })
  }
  matches.sort((left, right) => String(right.meta.at || '').localeCompare(String(left.meta.at || '')))
  return matches[0] || null
}

async function findUpload(config, uploadId) {
  const dir = join(config.uploadDir, uploadId)
  const meta = await readJson(join(dir, 'meta.json'), null)
  return meta ? { dir, meta } : null
}

/**
 * 按订单或上传把一次导入失败改回 `ready`。
 *
 * `orderId` 和 `uploadId` 只能给一个。写一条 `retries` 审计到上传 meta，
 * 同时写 journal 日志；操作者、时间、重试前状态都留在记录里。
 */
export async function retryImport({
  config,
  orderId = '',
  uploadId = '',
  operator = '',
  reason = '',
  now = new Date(),
} = {}) {
  if (orderId && uploadId) throw usageError('--order 和 --upload 只能给一个')
  if (!orderId && !uploadId) throw usageError('要给 --order 或 --upload')
  if (orderId && !ORDER_RE.test(orderId)) throw usageError(`订单号不对：${orderId}`)
  if (uploadId && !UPLOAD_RE.test(uploadId)) throw usageError(`上传编号不对：${uploadId}`)

  let order = null
  let found
  if (orderId) {
    order = await readOrder(config, orderId)
    if (!order) throw new Error(`找不到订单 ${orderId}`)
    found = await findUploadByOrder(config, orderId)
    if (!found) {
      throw new Error(`找不到包含订单 ${orderId} 的上传记录，快照可能已过保留期清掉`)
    }
  } else {
    found = await findUpload(config, uploadId)
    if (!found) throw new Error(`找不到上传记录 ${uploadId}`)
  }

  const { dir, meta } = found
  const id = meta.id || uploadId || orderId
  if (!RETRYABLE_UPLOAD_STATUSES.includes(meta.status)) {
    throw new Error(
      `上传 ${id} 当前状态是 ${meta.status || '未知'}，不能重试。` +
        `只有 ${RETRYABLE_UPLOAD_STATUSES.join('、')} 能改回 ready。`,
    )
  }

  if (order) {
    if (order.import_status === 'imported') {
      throw new Error(`订单 ${orderId} 当前状态是 imported，已经导入成功，不能重试。`)
    }
    if (order.validation?.passed === false) {
      throw new Error(`订单 ${orderId} 内容校验未通过，重试不会改变结果；让客户重传。`)
    }
    if (order.import_status === 'needs_operator') {
      const detail = order.import_failure?.reason || order.import_failure?.message || '需要人工处理'
      throw new Error(`订单 ${orderId} 当前状态是 needs_operator（${detail}），不能直接重试。`)
    }
    if (order.import_status !== 'import_failed') {
      throw new Error(
        `订单 ${orderId} 当前状态是 ${order.import_status || '未导入'}，没有可重试的导入失败。`,
      )
    }
  }

  const stamp = now.toISOString()
  const entry = {
    at: stamp,
    operator: String(operator || '').trim() || 'unknown',
    reason: String(reason || '').trim(),
    from_status: meta.status,
    target: orderId ? `order:${orderId}` : `upload:${id}`,
  }
  const next = {
    ...meta,
    status: 'ready',
    operator_alert: null,
    retries: [...(Array.isArray(meta.retries) ? meta.retries : []), entry],
  }
  await writeJsonAtomic(join(dir, 'meta.json'), next)
  logLine({
    ts: stamp,
    level: 'info',
    msg: '导入重试已排队',
    upload: id,
    ...(orderId ? { order_id: orderId } : {}),
    operator: entry.operator,
    reason: entry.reason,
    from_status: entry.from_status,
  })

  return { upload: id, order: orderId || null, status: 'ready', retry: entry }
}
