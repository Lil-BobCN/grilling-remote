import assert from 'node:assert/strict'
import test from 'node:test'
import { join } from 'node:path'
import { hashPassword, sessionVersion, verifyPassword } from '../lib/auth.mjs'
import { writeJsonAtomic } from '../lib/store.mjs'
import { EMAIL, PASSWORD, login, makeConfig, seedCustomer, startServer } from './helpers.mjs'

test('argon2 哈希能验证，错的密码不通过', async () => {
  const hash = await hashPassword('abc12345')
  assert.equal(await verifyPassword('abc12345', hash), true)
  assert.equal(await verifyPassword('wrong-password', hash), false)
  assert.equal(await verifyPassword('', ''), false)
})

test('登录、会话、退出', async () => {
  const { config } = await makeConfig()
  await seedCustomer(config)
  const server = await startServer(config)
  try {
    const bad = await login(server.base, EMAIL, 'wrong-password')
    assert.equal(bad.response.status, 401)

    const good = await login(server.base)
    assert.equal(good.response.status, 200)
    const body = await good.response.json()
    assert.equal(body.user.short_name, 'acme')
    assert.equal(body.user.role, 'customer')

    const session = await fetch(`${server.base}/app/api/session`, { headers: { Cookie: good.cookie } })
    assert.equal(session.status, 200)

    const logout = await fetch(`${server.base}/app/api/logout`, {
      method: 'POST',
      headers: { Cookie: good.cookie, Origin: server.base },
    })
    assert.equal(logout.status, 204)
  } finally {
    await server.close()
  }
})

test('停用账号不能登录', async () => {
  const { config } = await makeConfig()
  await seedCustomer(config, { status: 'disabled', disabled_at: new Date().toISOString(), disabled_reason: '测试' })
  const server = await startServer(config)
  try {
    const result = await login(server.base)
    assert.equal(result.response.status, 403)
  } finally {
    await server.close()
  }
})

test('改密码后旧会话失效', async () => {
  const { config } = await makeConfig()
  const row = await seedCustomer(config)
  const server = await startServer(config)
  try {
    const good = await login(server.base)
    assert.equal(good.response.status, 200)

    const nextHash = await hashPassword('another password')
    assert.notEqual(sessionVersion(nextHash), sessionVersion(row.password_hash))
    await writeJsonAtomic(join(config.dataDir, 'customers.json'), [{ ...row, password_hash: nextHash }])

    const session = await fetch(`${server.base}/app/api/session`, { headers: { Cookie: good.cookie } })
    assert.equal(session.status, 401)
  } finally {
    await server.close()
  }
})

test('停用后旧会话返回 403', async () => {
  const { config } = await makeConfig()
  const row = await seedCustomer(config)
  const server = await startServer(config)
  try {
    const good = await login(server.base)
    assert.equal(good.response.status, 200)

    await writeJsonAtomic(join(config.dataDir, 'customers.json'), [
      { ...row, status: 'disabled', disabled_at: new Date().toISOString(), disabled_reason: '测试' },
    ])

    const session = await fetch(`${server.base}/app/api/session`, { headers: { Cookie: good.cookie } })
    assert.equal(session.status, 403)
  } finally {
    await server.close()
  }
})

test('篡改的 Cookie 不认', async () => {
  const { config } = await makeConfig()
  await seedCustomer(config)
  const server = await startServer(config)
  try {
    const session = await fetch(`${server.base}/app/api/session`, {
      headers: { Cookie: 'afk_session=abc.def' },
    })
    assert.equal(session.status, 401)
  } finally {
    await server.close()
  }
})

test('登录页缺字段返回 400', async () => {
  const { config } = await makeConfig()
  await seedCustomer(config)
  const server = await startServer(config)
  try {
    const response = await fetch(`${server.base}/app/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: server.base },
      body: JSON.stringify({ email: '' }),
    })
    assert.equal(response.status, 400)
  } finally {
    await server.close()
  }
})

test('跨站发起的登录被拒', async () => {
  const { config } = await makeConfig()
  await seedCustomer(config)
  const server = await startServer(config)
  try {
    const response = await fetch(`${server.base}/app/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    })
    assert.equal(response.status, 403)
  } finally {
    await server.close()
  }
})
