import { authenticate, clearSession, issueSession, publicUser, readSession } from './auth.mjs'
import { HttpError } from './errors.mjs'
import { assertSameOrigin, clientIp, readBody, sendJson } from './http.mjs'
import { logLine } from './log.mjs'
import { publicOrder, readOrders } from './orders.mjs'
import { RateLimiter } from './rate-limit.mjs'
import { handleUpload, cleanupExpired } from './uploads.mjs'

const JSON_LIMIT = 16 * 1024

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

  handler.close = () => clearInterval(sweeper)
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
    sendJson(res, 200, { orders: mine.map(publicOrder) })
    return
  }

  if (method === 'GET' && path.startsWith('/app/api/orders/')) {
    const session = await requireSession(req, config)
    const id = decodeURIComponent(path.slice('/app/api/orders/'.length))
    const orders = await readOrders(config)
    const order = orders.find((item) => item.id === id)
    if (!order) throw new HttpError(404, '订单不存在')
    if (order.customer_id !== session.account.id) throw new HttpError(403, '不能看别人的订单')
    sendJson(res, 200, { order: publicOrder(order) })
    return
  }

  if (method === 'GET' && path === '/app/api/admin/orders') {
    const session = await requireSession(req, config)
    if (session.role !== 'admin') throw new HttpError(403, '只有管理员能看')
    const orders = await readOrders(config)
    sendJson(res, 200, {
      orders: orders.map((order) => ({
        ...publicOrder(order),
        customer: order.customer_snapshot || null,
        issue_url: order.issue_url || '',
      })),
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
