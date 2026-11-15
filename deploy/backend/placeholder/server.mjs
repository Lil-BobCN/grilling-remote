/**
 * 后端占位服务。只用来把部署路径跑通，不实现登录、订单、上传。
 *
 * 监听 127.0.0.1:PORT，由 Caddy 把 /app/api/* 反代进来。
 * GET /app/api/health 回 200，GET /app/api/session 回 401。
 * 每个请求写一行 JSON 到 stdout，由 journald 收走。
 */

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const port = Number(process.env.PORT || 8787)
const host = process.env.HOST || '127.0.0.1'

function send(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

const server = createServer((req, res) => {
  const started = performance.now()
  const requestId = randomUUID()
  const path = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname

  res.on('finish', () => {
    const line = {
      ts: new Date().toISOString(),
      request_id: requestId,
      method: req.method,
      path,
      status: res.statusCode,
      ms: Math.round(performance.now() - started),
    }
    if (res.statusCode === 401) line.msg = 'unauthorized'
    if (res.statusCode === 404) line.msg = 'no route'
    console.log(JSON.stringify(line))
  })

  if (req.method === 'GET' && path === '/app/api/health') {
    return send(res, 200, { ok: true, version: pkg.version })
  }

  if (req.method === 'GET' && path === '/app/api/session') {
    return send(res, 401, { message: '未登录' })
  }

  if (path.startsWith('/app/api/')) {
    return send(res, 404, { message: '占位服务没有这个接口' })
  }

  return send(res, 404, { message: 'not found' })
})

server.listen(port, host, () => {
  console.log(JSON.stringify({ ts: new Date().toISOString(), msg: 'listening', host, port, version: pkg.version }))
})

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 5000).unref()
  })
}
