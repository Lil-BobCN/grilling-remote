import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { gitSync, readJson, withFileLock, writeJsonAtomic } from './store.mjs'

export function ordersDir(config) {
  return join(config.dataDir, 'orders')
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
  })
  return { order, sync }
}
