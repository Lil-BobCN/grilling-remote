/**
 * 账号区的接口调用。
 *
 * 登录、订单、上传接收的服务端不在本图里，经 `/app/api/*` 反代到独立服务。
 * 下面的路径和字段是前端按 prototype/issue-109 的样品先定的最小形状；
 * 正式契约（字段、错误码、会话）归 I-0035。换契约时只改这个文件。
 */

import { en } from '../content/en.js'
import { zh } from '../content/zh.js'
import { getLang } from '../i18n/index.jsx'

const API_COPY = { zh: zh.account.api, en: en.account.api }
const SIGNED_IN_KEY = 'afk-signed-in'

/**
 * 顶栏在绘制前读这个标记，登录后收起「登录」入口。
 * 标记不是安全凭证，只影响导航显示；服务端仍然每次查会话。
 */
export function setSignedInHint(value) {
  if (typeof document === 'undefined') return
  try {
    if (value) window.localStorage.setItem(SIGNED_IN_KEY, '1')
    else window.localStorage.removeItem(SIGNED_IN_KEY)
  } catch {
    // 存不了就只改当前页面的标记
  }
  if (value) document.documentElement.setAttribute('data-signed-in', '1')
  else document.documentElement.removeAttribute('data-signed-in')
}

function messages() {
  return API_COPY[getLang()] || API_COPY.zh
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message = messages()[401]) {
    super(401, message)
    this.name = 'UnauthorizedError'
  }
}

async function request(path, options = {}) {
  const { body, headers, ...rest } = options
  const response = await fetch(path, {
    credentials: 'include',
    ...rest,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : null),
      ...headers,
    },
    body,
  })

  if (response.status === 401) {
    setSignedInHint(false)
    throw new UnauthorizedError()
  }

  if (!response.ok) {
    const copy = messages()
    let message = copy[response.status] || copy.noResponse
    try {
      const payload = await response.json()
      if (typeof payload?.message === 'string') message = payload.message
    } catch {
      // 错误响应不是 JSON 时用状态码的说法
    }
    throw new ApiError(response.status, message)
  }

  if (response.status === 204) return null
  return response.json()
}

export async function getSession() {
  const payload = await request('/app/api/session')
  setSignedInHint(true)
  return payload
}

export async function login(email, password) {
  const payload = await request('/app/api/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  setSignedInHint(true)
  return payload
}

export async function logout() {
  const result = await request('/app/api/logout', { method: 'POST' })
  setSignedInHint(false)
  return result
}

export function listOrders() {
  return request('/app/api/orders')
}

export function getOrder(id) {
  return request(`/app/api/orders/${encodeURIComponent(id)}`)
}

export function listAdminOrders() {
  return request('/app/api/admin/orders')
}

export function markMessageSent(id, { type, anchor }) {
  return request(`/app/api/admin/orders/${encodeURIComponent(id)}/messages`, {
    method: 'POST',
    body: JSON.stringify({ type, anchor }),
  })
}

export function readSession(payload) {
  const user = payload?.user ?? payload ?? {}
  return {
    displayName: user.display_name ?? user.displayName ?? user.email ?? '',
    shortName: user.short_name ?? user.shortName ?? '',
    email: user.email ?? '',
    role: user.role ?? '',
    isAdmin: user.role === 'admin',
  }
}

function normalizeTransition(entry) {
  if (typeof entry === 'string') return { at: '', line: entry }
  return {
    at: entry?.at ?? entry?.created_at ?? entry?.createdAt ?? '',
    line: entry?.line ?? entry?.body ?? '',
  }
}

export function normalizeOrder(raw) {
  const rows = raw?.transitions ?? raw?.progress ?? []
  return {
    id: raw?.id ?? raw?.order_id ?? raw?.orderId ?? '',
    number: raw?.no ?? raw?.number ?? '',
    title: raw?.title ?? raw?.name ?? '未命名需求',
    product: raw?.product ?? raw?.workspace ?? '',
    requirement: raw?.requirement ?? '',
    customer: raw?.customer ?? null,
    issueUrl: raw?.issue_url ?? '',
    delivery: raw?.delivery ?? raw?.delivery_address ?? '',
    deliveryUrl: raw?.delivery_url ?? raw?.deliveryUrl ?? '',
    uploadedAt: raw?.uploaded_at ?? '',
    lastUploadAt: raw?.last_upload_at ?? '',
    missing: Array.isArray(raw?.missing) ? raw.missing.filter(Boolean) : [],
    trial: Array.isArray(raw?.trial) ? raw.trial.filter(Boolean) : [],
    feedback: raw?.feedback ?? raw?.rejection?.feedback ?? '',
    importStatus: raw?.import_status ?? raw?.importStatus ?? '',
    importFailure: raw?.import_failure ?? raw?.importFailure ?? null,
    messages: Array.isArray(raw?.messages) ? raw.messages : [],
    transitions: Array.isArray(rows)
      ? rows.map(normalizeTransition).filter((entry) => entry.line)
      : [],
  }
}

export function readOrders(payload) {
  const rows = Array.isArray(payload) ? payload : payload?.orders
  return Array.isArray(rows) ? rows.map(normalizeOrder) : []
}

export function readOrder(payload) {
  const raw = payload?.order ?? payload
  return raw ? normalizeOrder(raw) : null
}
