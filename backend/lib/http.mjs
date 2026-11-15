import { HttpError } from './errors.mjs'

export function sendJson(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload)
  if (status >= 400 && payload && typeof payload.message === 'string') {
    res.afkMessage = payload.message
  }
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    ...headers,
  })
  res.end(body)
}

export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] || 0)
    if (declared && declared > limit) {
      req.resume()
      reject(new HttpError(413, '文件太大，最大 50 MB'))
      return
    }

    const chunks = []
    let size = 0
    let settled = false

    const fail = (error) => {
      if (settled) return
      settled = true
      reject(error)
    }

    req.on('data', (chunk) => {
      if (settled) return
      size += chunk.length
      if (size > limit) {
        fail(new HttpError(413, '文件太大，最大 50 MB'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      resolve(Buffer.concat(chunks, size))
    })
    req.on('error', fail)
  })
}

export function clientIp(req) {
  const cf = req.headers['cf-connecting-ip']
  if (typeof cf === 'string' && cf.trim()) return cf.trim()
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim()
  return req.socket.remoteAddress || ''
}

export function parseCookies(header) {
  const out = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    const name = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    if (!name) continue
    try {
      out[name] = decodeURIComponent(value)
    } catch {
      out[name] = value
    }
  }
  return out
}

export function assertSameOrigin(req, config) {
  if (req.headers['sec-fetch-site'] === 'same-origin') return
  const origin = req.headers.origin
  if (typeof origin === 'string' && config.allowedOrigins.includes(origin)) return
  throw new HttpError(403, '请求来源不对，请刷新页面再试')
}
