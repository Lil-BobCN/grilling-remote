import { authenticate, clearSession, issueSession, publicUser, readSession } from './auth.mjs'
import { HttpError } from './errors.mjs'
import { readIssueProgress } from './github.mjs'
import { assertSameOrigin, clientIp, readBody, sendJson } from './http.mjs'
import { logLine } from './log.mjs'
import { markMessageSent, MESSAGE_TYPES, publicOrder, readOrders, retryPendingSync } from './orders.mjs'
import { mergeTransitions } from './progress.mjs'
import { RateLimiter } from './rate-limit.mjs'
import { handleUpload, cleanupExpired } from './uploads.mjs'

const JSON_LIMIT = 16 * 1024

async function withProgress(config, order) {
  const issue = await readIssueProgress(config, order)
  return { order: { ...order, transitions: mergeTransitions(order, issue) }, issue }
}

function orderedWithProgress(config, orders) {
  return Promise.all(orders.map((order) => withProgress(config, order)))
}

export function createHandler(config) {
  const limiters = {
    uploadsUser: new RateLimiter(config.uploadsPerUser, config.rateWindowMs),
    uploadsIp: new RateLimiter(config.uploadsPerIp, config.rateWindowMs),
    loginsIp: new RateLimiter(config.loginsPerIp, config.rateWindowMs),
  }

  const sweeper = setInterval(() => {
    for (const limiter of Object.values(limiters)) limiter.sweep()
    cleanupExpired(config).catch(() => {})
  }, 10 * 60 * 1000)
  sweeper.unref()

  const runPendingSync = () => {
    retryPendingSync(config).catch((error) => {
      logLine({
        ts: new Date().toISOString(),
        level: 'error',
        msg: '补寄订单同步时出错',
        error: String(error && error.message ? error.message : error),
      })
    })
  }
  runPendingSync()
  const syncRetry = setInterval(runPendingSync, config.syncRetryMs)
  syncRetry.unref()

  const handler = async function handle(req, res) {
    try {
      const url = new URL(req.url || '/', 'http://localhost')
      await route({ req, res, config, limiters, path: url.pathname })
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(res, error.status, { message: error.message, ...error.extra })
        return
      }
      logLine({
        ts: new Date().toISOString(),
        level: 'error',
        msg: String(error && error.message ? error.message : error),
        stack: error && error.stack ? String(error.stack).split('\n').slice(0, 4) : undefined,
      })
      sendJson(res, 500, { message: '服务器出错了，请稍后再试' })
    }
  }

  handler.close = () => {
    clearInterval(sweeper)
    clearInterval(syncRetry)
  }
  return handler
}

async function route({ req, res, config, limiters, path }) {
  const method = req.method || 'GET'

  if (method === 'GET' && path === '/app/api/health') {
    sendJson(res, 200, { ok: true, version: config.version })
    return
  }

  if (method === 'GET' && path === '/app/api/session') {
    const session = await readSession(req, config)
    if (!session) throw new HttpError(401, '未登录')
    sendJson(res, 200, { user: publicUser(session.account, session.role) })
    return
  }

  if (method === 'POST' && path === '/app/api/login') {
    assertSameOrigin(req, config)
    if (!limiters.loginsIp.allow(clientIp(req))) {
      throw new HttpError(429, '登录试得太频繁，过几分钟再试')
    }
    const payload = await readJsonBody(req)
    const email = typeof payload.email === 'string' ? payload.email : ''
    const password = typeof payload.password === 'string' ? payload.password : ''
    if (!email.trim() || !password) throw new HttpError(400, '请填写邮箱和密码')
    const session = await authenticate(config, email, password)
    issueSession(res, session.account, session.role, config)
    sendJson(res, 200, { user: publicUser(session.account, session.role) })
    return
  }

  if (method === 'POST' && path === '/app/api/logout') {
    assertSameOrigin(req, config)
    clearSession(res, config)
    res.writeHead(204, { 'Cache-Control': 'no-store' })
    res.end()
    return
  }

  if (method === 'GET' && path === '/app/api/orders') {
    const session = await requireSession(req, config)
    const orders = await readOrders(config)
    const mine = orders.filter((order) => order.customer_id === session.account.id)
    const enriched = await orderedWithProgress(config, mine)
    sendJson(res, 200, { orders: enriched.map(({ order }) => publicOrder(order)) })
    return
  }

  if (method === 'GET' && path.startsWith('/app/api/orders/')) {
    const session = await requireSession(req, config)
    const id = decodeURIComponent(path.slice('/app/api/orders/'.length))
    const orders = await readOrders(config)
    const order = orders.find((item) => item.id === id)
    if (!order) throw new HttpError(404, '订单不存在')
    if (order.customer_id !== session.account.id) throw new HttpError(403, '不能看别人的订单')
    const enriched = await withProgress(config, order)
    sendJson(res, 200, { order: publicOrder(enriched.order) })
    return
  }

  if (method === 'GET' && path === '/app/api/admin/orders') {
    const session = await requireSession(req, config)
    if (session.role !== 'admin') throw new HttpError(403, '只有管理员能看')
    const orders = await readOrders(config)
    const enriched = await orderedWithProgress(config, orders)
    sendJson(res, 200, {
      orders: enriched.map(({ order, issue }) => ({
        ...publicOrder(order),
        customer: order.customer_snapshot || null,
        issue_url: issue.issueUrl || '',
        messages: Array.isArray(order.messages) ? order.messages : [],
      })),
    })
    return
  }

  const messagePath = /^\/app\/api\/admin\/orders\/([^/]+)\/messages$/.exec(path)
  if (method === 'POST' && messagePath) {
    assertSameOrigin(req, config)
    const session = await requireSession(req, config)
    if (session.role !== 'admin') throw new HttpError(403, '只有管理员能标记')
    const id = decodeURIComponent(messagePath[1])
    const payload = await readJsonBody(req)
    const type = typeof payload.type === 'string' ? payload.type.trim() : ''
    const anchor = typeof payload.anchor === 'string' ? payload.anchor.trim() : ''
    if (!MESSAGE_TYPES.includes(type)) throw new HttpError(400, '消息类型不对')
    if (!anchor || anchor.length > 200) throw new HttpError(400, '消息锚点不对')
    const result = await markMessageSent(config, id, { type, anchor })
    if (!result) throw new HttpError(404, '订单不存在')
    sendJson(res, 200, {
      messages: Array.isArray(result.order.messages) ? result.order.messages : [],
    })
    return
  }

  if (method === 'POST' && path === '/app/api/uploads') {
    assertSameOrigin(req, config)
    const session = await requireSession(req, config)
    const result = await handleUpload({
      req,
      config,
      session,
      limiters,
      ip: clientIp(req),
    })
    sendJson(res, result.status, result.payload)
    return
  }

  throw new HttpError(404, '没有这个接口')
}

async function readJsonBody(req) {
  const body = await readBody(req, JSON_LIMIT)
  try {
    return JSON.parse(body.toString('utf8') || '{}')
  } catch {
    throw new HttpError(400, '请求格式不对')
  }
}

async function requireSession(req, config) {
  const session = await readSession(req, config)
  if (!session) throw new HttpError(401, '未登录')
  return session
}
