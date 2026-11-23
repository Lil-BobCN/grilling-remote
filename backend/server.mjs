import { randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { loadConfig } from './lib/config.mjs'
import { createHandler } from './lib/app.mjs'
import { logLine } from './lib/log.mjs'
import { cleanupExpired } from './lib/uploads.mjs'
import { readVersion } from './lib/version.mjs'

const config = loadConfig()
config.version = readVersion(fileURLToPath(new URL('.', import.meta.url)))

if (!config.sessionSecret) {
  config.sessionSecret = randomBytes(32).toString('base64url')
  logLine({
    ts: new Date().toISOString(),
    level: 'warning',
    msg: 'SESSION_SECRET 没设置，已用临时密钥；服务重启后所有人要重新登录',
  })
}

const handler = createHandler(config)

const server = createServer((req, res) => {
  const started = performance.now()
  const requestId = randomUUID()
  const path = (() => {
    try {
      return new URL(req.url || '/', 'http://localhost').pathname
    } catch {
      return req.url || '/'
    }
  })()

  res.on('finish', () => {
    const line = {
      ts: new Date().toISOString(),
      request_id: requestId,
      method: req.method,
      path,
      status: res.statusCode,
      ms: Math.round(performance.now() - started),
    }
    if (res.afkMessage) line.msg = res.afkMessage
    logLine(line)
  })

  handler(req, res)
})

server.requestTimeout = 120000
server.headersTimeout = 20000
server.keepAliveTimeout = 5000

server.listen(config.port, config.host, () => {
  logLine({
    ts: new Date().toISOString(),
    msg: 'listening',
    host: config.host,
    port: config.port,
    version: config.version,
  })
  cleanupExpired(config).then((removed) => {
    if (removed) logLine({ ts: new Date().toISOString(), msg: 'cleanup', removed })
  })
})

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(() => {
      handler.close()
      process.exit(0)
    })
    setTimeout(() => process.exit(0), 5000).unref()
  })
}
