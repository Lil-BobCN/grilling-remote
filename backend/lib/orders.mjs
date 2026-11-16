import { readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { logLine } from './log.mjs'
import { gitSync, readJson, withFileLock, writeJsonAtomic } from './store.mjs'

export const SYNC_ALERT_MS = 10 * 60 * 1000
export const PENDING_PATHSPEC = 'orders/*.sync-pending'
export const MESSAGE_TYPES = ['校验未通过', '待客户验收', '满 24 小时']
const PENDING_SUFFIX = '.sync-pending'

export function ordersDir(config) {
  return join(config.dataDir, 'orders')
}

function pendingPath(config, orderId) {
  return join(ordersDir(config), `${orderId}${PENDING_SUFFIX}`)
}

async function readPending(config) {
  let names
  try {
    names = await readdir(ordersDir(config))
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }

  const records = []
  for (const name of names.sort()) {
    if (!name.endsWith(PENDING_SUFFIX)) continue
    const record = await readJson(join(ordersDir(config), name))
    if (record && typeof record.order_id === 'string') records.push(record)
  }
  return records
}

async function writePending(config, orderId, requirement, error, now = new Date()) {
  const file = pendingPath(config, orderId)
  const previous = await readJson(file, null)
  const record = {
    order_id: orderId,
    requirement,
    failed_at: previous?.failed_at || now.toISOString(),
    last_attempt_at: now.toISOString(),
    attempts: (previous?.attempts || 0) + 1,
    last_error: error,
  }
  await writeJsonAtomic(file, record)
  return record
}

async function noteSyncFailure(config, order, error) {
  const now = new Date()
  try {
    const record = await writePending(config, order.id, order.requirement, error, now)
    logLine({
      ts: now.toISOString(),
      level: 'warning',
      msg: '订单推送私有仓失败，已记待办',
      order_id: order.id,
      failed_at: record.failed_at,
      error,
    })
  } catch (writeError) {
    logLine({
      ts: now.toISOString(),
      level: 'error',
      msg: '订单推送私有仓失败，待办也没写成',
      order_id: order.id,
      error,
      write_error: String(writeError && writeError.message ? writeError.message : writeError),
    })
  }
}

let retrying = false

export async function retryPendingSync(config, { now = new Date() } = {}) {
  if (retrying) return { skipped: 'in progress', attempted: 0, remaining: null }
  retrying = true
  try {
    const pending = await readPending(config)
    if (pending.length === 0) return { attempted: 0, remaining: 0 }

    const ids = pending.map((record) => record.order_id)
    const sync = await gitSync(config.dataDir, `补寄：订单同步 ${ids.join('、')}`, {
      enabled: config.gitSync,
      timeoutMs: config.gitTimeoutMs,
      exclude: [PENDING_PATHSPEC],
    })

    if (sync.ok) {
      for (const id of ids) await unlink(pendingPath(config, id)).catch(() => {})
      logLine({ ts: now.toISOString(), level: 'info', msg: '订单推送私有仓补寄成功', orders: ids })
      return { attempted: ids.length, remaining: 0 }
    }

    if (sync.skipped) return { attempted: 0, remaining: ids.length, skipped: sync.skipped }

    const records = []
    for (const record of pending) {
      records.push(await writePending(config, record.order_id, record.requirement, sync.error, now))
    }
    for (const record of records) {
      const age = now.getTime() - Date.parse(record.failed_at)
      if (age < SYNC_ALERT_MS) continue
      logLine({
        ts: now.toISOString(),
        level: 'error',
        msg: '订单推送私有仓超过 10 分钟未成功',
        order_id: record.order_id,
        failed_at: record.failed_at,
        error: record.last_error,
      })
    }
    return { attempted: ids.length, remaining: ids.length, error: sync.error }
  } finally {
    retrying = false
  }
}

export async function readOrders(config) {
  let names
  try {
    names = await readdir(ordersDir(config))
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }

  const orders = []
  for (const name of names.sort()) {
    if (!name.endsWith('.json')) continue
    const order = await readJson(join(ordersDir(config), name))
    if (order && typeof order.id === 'string') orders.push(order)
  }
  return orders.sort((left, right) => left.id.localeCompare(right.id))
}

export function nextOrderId(orders) {
  let max = 0
  for (const order of orders) {
    const match = /^o-(\d+)$/.exec(order.id || '')
    if (match) max = Math.max(max, Number(match[1]))
  }
  return `o-${String(max + 1).padStart(4, '0')}`
}

export function progressLine({ tier, step, round, stuck = false, note = '' }) {
  const parts = [
    '进度 v1',
    `客户档：${tier}`,
    `细阶段：${step}`,
    `轮次：${round}`,
    `卡住：${stuck ? '是' : '否'}`,
  ]
  if (note) parts.push(`备注：${note}`)
  return parts.join('｜')
}

export function tierOf(line) {
  const match = /客户档：([^｜]+)/.exec(line || '')
  return match ? match[1].trim() : ''
}

function roundOf(line) {
  const match = /轮次：(\d+)/.exec(line || '')
  return match ? Number(match[1]) : 1
}

export function publicOrder(order) {
  return {
    id: order.id,
    number: order.number,
    title: order.title,
    product: order.product,
    requirement: order.requirement,
    uploaded_at: order.uploaded_at,
    last_upload_at: order.uploads?.at(-1)?.at || null,
    delivery: order.delivery,
    delivery_url: order.delivery_url,
    missing: order.missing,
    trial: order.trial,
    feedback: order.feedback,
    transitions: order.transitions,
  }
}

export async function recordUpload(config, account, upload) {
  const now = upload.now || new Date().toISOString()
  const lockPath = join(config.dataDir, '.orders.lock')

  const order = await withFileLock(lockPath, async () => {
    const orders = await readOrders(config)
    const existing = orders.find(
      (item) =>
        item.customer_id === account.id &&
        (item.product || '') === (upload.product || '') &&
        item.requirement === upload.requirement,
    )

    const last = existing?.transitions?.[existing.transitions.length - 1]
    const lastTier = last ? tierOf(last.line) : ''
    const round = existing ? (lastTier === '校验未通过' ? roundOf(last.line) : roundOf(last.line) + 1) : 1

    const previous = existing || {
      id: nextOrderId(orders),
      number: '',
      customer_id: account.id,
      customer_snapshot: {},
      requirement: upload.requirement,
      title: upload.title,
      product: '',
      created_at: now,
      updated_at: now,
      uploads: [],
      validation: {},
      transitions: [],
      issue: null,
      delivery: '',
      delivery_url: '',
      trial: [],
      feedback: '',
      missing: [],
      messages: [],
      closed_at: null,
      uploaded_at: null,
    }

    const transitions = [...(previous.transitions || [])]
    transitions.push({ at: now, line: progressLine({ tier: '已收到', step: '收包', round }) })
    if (upload.validation.passed) {
      transitions.push({ at: now, line: progressLine({ tier: '已收到', step: '校验', round }) })
    } else {
      transitions.push({ at: now, line: progressLine({ tier: '校验未通过', step: '等补传', round }) })
    }

    const next = {
      ...previous,
      number: previous.number || previous.id,
      title: upload.title || previous.title,
      product: previous.product || upload.product || '',
      customer_snapshot: {
        id: account.id,
        short_name: account.short_name || '',
        display_name: account.display_name || '',
        email: account.email || '',
      },
      updated_at: now,
      uploads: [
        ...(previous.uploads || []),
        {
          at: now,
          filename: upload.filename,
          size: upload.size,
          sha256: upload.sha256,
          passed: upload.validation.passed,
        },
      ],
      validation: {
        passed: upload.validation.passed,
        finished: upload.validation.finished,
        missing: upload.validation.missing,
        checks: upload.validation.checks,
        checked_at: now,
      },
      transitions,
      missing: upload.validation.missing,
      uploaded_at: upload.validation.passed ? now : previous.uploaded_at ?? null,
    }

    await writeJsonAtomic(join(ordersDir(config), `${next.id}.json`), next)
    return next
  })

  const sync = await gitSync(config.dataDir, `订单：${order.id} ${order.requirement} 上传`, {
    enabled: config.gitSync,
    timeoutMs: config.gitTimeoutMs,
    exclude: [PENDING_PATHSPEC],
  })
  if (sync.error) await noteSyncFailure(config, order, sync.error)
  return { order, sync }
}

export async function readOrder(config, orderId) {
  return readJson(join(ordersDir(config), `${orderId}.json`), null)
}

/**
 * 导入步骤回写订单：工单链接、软件简称、需求分支。
 * 和 `recordUpload` 一样先加锁再原子替换；不存在时返回 null。
 */
export async function updateOrder(config, orderId, patch) {
  const lockPath = join(config.dataDir, '.orders.lock')
  const now = new Date().toISOString()

  const order = await withFileLock(lockPath, async () => {
    const orders = await readOrders(config)
    const existing = orders.find((item) => item.id === orderId)
    if (!existing) return null

    const next = { ...existing, ...patch, id: existing.id, updated_at: now }
    await writeJsonAtomic(join(ordersDir(config), `${next.id}.json`), next)
    return next
  })

  if (!order) return null

  const sync = await gitSync(config.dataDir, `订单：${order.id} ${order.requirement} 导入回传`, {
    enabled: config.gitSync,
    timeoutMs: config.gitTimeoutMs,
    exclude: [PENDING_PATHSPEC],
  })
  if (sync.error) await noteSyncFailure(config, order, sync.error)
  return { order, sync }
}

/**
 * 管理视图的「标记已发」。同一类型、同一锚点只记一条。
 * 返回更新后的订单；订单不存在时返回 null。
 */
export async function markMessageSent(config, orderId, { type, anchor }) {
  const lockPath = join(config.dataDir, '.orders.lock')
  const now = new Date().toISOString()

  const order = await withFileLock(lockPath, async () => {
    const orders = await readOrders(config)
    const existing = orders.find((item) => item.id === orderId)
    if (!existing) return null

    const messages = Array.isArray(existing.messages) ? existing.messages : []
    if (messages.some((item) => item.type === type && item.anchor === anchor)) {
      return existing
    }

    const next = {
      ...existing,
      messages: [...messages, { type, anchor, at: now }],
      updated_at: now,
    }
    await writeJsonAtomic(join(ordersDir(config), `${next.id}.json`), next)
    return next
  })

  if (!order) return null

  const sync = await gitSync(config.dataDir, `订单：${order.id} ${order.requirement} 标记消息已发`, {
    enabled: config.gitSync,
    timeoutMs: config.gitTimeoutMs,
    exclude: [PENDING_PATHSPEC],
  })
  if (sync.error) await noteSyncFailure(config, order, sync.error)
  return { order, sync }
}
