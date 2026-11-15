import { argon2, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { HttpError } from './errors.mjs'
import { parseCookies } from './http.mjs'
import { readJson } from './store.mjs'

const argon2Async = promisify(argon2)

export const COOKIE_NAME = 'afk_session'
const CUSTOMER_MAX_AGE = 30 * 86400
const ADMIN_MAX_AGE = 7 * 86400
const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

export async function hashPassword(password) {
  const salt = randomBytes(16)
  const digest = await argon2Async('argon2id', {
    message: Buffer.from(password, 'utf8'),
    nonce: salt,
    parallelism: 1,
    tagLength: 32,
    memory: 65536,
    passes: 3,
    type: 2,
  })
  return `$argon2id$v=19$m=65536,t=3,p=1$${salt.toString('base64url')}$${Buffer.from(digest).toString('base64url')}`
}

export async function verifyPassword(password, stored) {
  const match = PHC.exec(stored || '')
  if (!match) return false
  const [, memory, passes, parallelism, saltText, hashText] = match
  const salt = Buffer.from(saltText, 'base64url')
  const expected = Buffer.from(hashText, 'base64url')
  const digest = Buffer.from(
    await argon2Async('argon2id', {
      message: Buffer.from(password, 'utf8'),
      nonce: salt,
      parallelism: Number(parallelism),
      tagLength: expected.length,
      memory: Number(memory),
      passes: Number(passes),
      type: 2,
    }),
  )
  return digest.length === expected.length && timingSafeEqual(digest, expected)
}

export function sessionVersion(passwordHash) {
  const last = (passwordHash || '').split('$').pop() || ''
  return last.slice(0, 16)
}

function asRows(value) {
  if (Array.isArray(value)) return value
  if (value && Array.isArray(value.customers)) return value.customers
  if (value && Array.isArray(value.admins)) return value.admins
  return []
}

export async function loadAccounts(config) {
  return {
    customers: asRows(await readJson(join(config.dataDir, 'customers.json'), [])),
    admins: asRows(await readJson(join(config.dataDir, 'admins.json'), [])),
  }
}

function findRow(accounts, role, id) {
  const rows = role === 'admin' ? accounts.admins : accounts.customers
  return rows.find((row) => row.id === id) || null
}

function findEmail(accounts, email) {
  const target = String(email || '').trim().toLowerCase()
  if (!target) return null
  const customer = accounts.customers.find((row) => String(row.email || '').toLowerCase() === target)
  if (customer) return { account: customer, role: 'customer' }
  const admin = accounts.admins.find((row) => String(row.email || '').toLowerCase() === target)
  if (admin) return { account: admin, role: 'admin' }
  return null
}

export async function authenticate(config, email, password) {
  const accounts = await loadAccounts(config)
  const found = findEmail(accounts, email)
  if (!found) {
    await verifyPassword(password, DUMMY_HASH)
    throw new HttpError(401, '邮箱或密码不对')
  }
  const { account, role } = found
  if (account.status !== 'active') throw new HttpError(403, '账号已停用，请联系客服')
  const ok = await verifyPassword(password, account.password_hash)
  if (!ok) {
    if (account.status === 'disabled') throw new HttpError(403, '账号已停用，请联系客服')
    throw new HttpError(401, '邮箱或密码不对')
  }
  return { account, role }
}

export function publicUser(account, role) {
  return {
    id: account.id,
    role,
    email: account.email,
    short_name: account.short_name ?? null,
    display_name: account.display_name ?? account.email,
  }
}

function sign(payload, secret) {
  const data = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const signature = createHmac('sha256', secret).update(data).digest('base64url')
  return `${data}.${signature}`
}

function unsign(token, secret) {
  const index = token.lastIndexOf('.')
  if (index < 1) return null
  const data = token.slice(0, index)
  const signature = token.slice(index + 1)
  const expected = createHmac('sha256', secret).update(data).digest('base64url')
  const left = Buffer.from(signature)
  const right = Buffer.from(expected)
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null
  try {
    return JSON.parse(Buffer.from(data, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

export function issueSession(res, account, role, config) {
  const maxAge = role === 'admin' ? ADMIN_MAX_AGE : CUSTOMER_MAX_AGE
  const now = Math.floor(Date.now() / 1000)
  const token = sign(
    {
      sub: account.id,
      role,
      ver: sessionVersion(account.password_hash),
      iat: now,
      exp: now + maxAge,
    },
    config.sessionSecret,
  )
  res.setHeader('Set-Cookie', cookieHeader(token, maxAge, config.cookieSecure))
}

export function clearSession(res, config) {
  res.setHeader('Set-Cookie', cookieHeader('', 0, config.cookieSecure))
}

function cookieHeader(value, maxAge, secure) {
  const parts = [
    `${COOKIE_NAME}=${value}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${maxAge}`,
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

export async function readSession(req, config) {
  if (!config.sessionSecret) return null
  const cookies = parseCookies(req.headers.cookie)
  const token = cookies[COOKIE_NAME]
  if (!token) return null
  const payload = unsign(token, config.sessionSecret)
  if (!payload || typeof payload !== 'object') return null
  if (!Number.isFinite(payload.exp) || payload.exp * 1000 <= Date.now()) return null
  if (typeof payload.sub !== 'string' || !payload.role) return null

  const accounts = await loadAccounts(config)
  const account = findRow(accounts, payload.role, payload.sub)
  if (!account) return null
  if (account.status !== 'active') throw new HttpError(403, '账号已停用，请联系客服')
  if (sessionVersion(account.password_hash) !== payload.ver) return null
  return { account, role: payload.role }
}
