import assert from 'node:assert/strict'
import { generateKeyPairSync, verify } from 'node:crypto'
import test from 'node:test'
import { createAppJwt, createGithubApp } from '../lib/github-app.mjs'

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

function decode(part) {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
}

test('App JWT 用 RS256 签名，iss 是 App ID，有效期不超过 10 分钟', () => {
  const jwt = createAppJwt({ appId: '5853766', privateKey, now: 1700000000000 })
  const [header, payload, signature] = jwt.split('.')
  assert.equal(decode(header).alg, 'RS256')
  const body = decode(payload)
  assert.equal(body.iss, '5853766')
  assert.ok(body.exp - body.iat <= 600)
  assert.ok(body.iat < Math.floor(1700000000000 / 1000))
  const ok = verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, 'base64url'))
  assert.equal(ok, true)
})

test('mintRepoToken 按仓请求 installation token，权限和仓库都写清', async () => {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, options })
    if (url.endsWith('/app/installations')) {
      return new Response(JSON.stringify([{ id: 42, account: { login: 'Lil-BobCN' } }]), { status: 200 })
    }
    if (url.endsWith('/app/installations/42/access_tokens')) {
      return new Response(JSON.stringify({ token: 'ghs_test', expires_at: '2026-11-21T05:00:00Z' }), { status: 200 })
    }
    return new Response('not found', { status: 404 })
  }
  const app = createGithubApp({ appId: '5853766', privateKey, fetchImpl, now: () => 1700000000000 })
  const result = await app.mintRepoToken({ owner: 'Lil-BobCN', repo: 'grilling-remote' })
  assert.equal(result.token, 'ghs_test')
  assert.equal(result.installationId, '42')
  const mint = calls.find((call) => call.url.endsWith('/access_tokens'))
  const body = JSON.parse(mint.options.body)
  assert.deepEqual(body.repositories, ['grilling-remote'])
  assert.equal(body.permissions.contents, 'write')
  assert.equal(body.permissions.issues, 'write')
  assert.equal(body.permissions.pull_requests, 'write')
  assert.equal(body.permissions.workflows, 'write')
})

test('指定 installation ID 时不再查 installations', async () => {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    return new Response(JSON.stringify({ token: 'ghs_test', expires_at: '2026-11-21T05:00:00Z' }), { status: 200 })
  }
  const app = createGithubApp({
    appId: '5853766',
    installationId: '184149687',
    privateKey,
    fetchImpl,
  })
  await app.mintRepoToken({ owner: 'Lil-BobCN', repo: 'grilling-remote' })
  assert.equal(calls.length, 1)
  assert.ok(calls[0].endsWith('/app/installations/184149687/access_tokens'))
})

test('App 没装到账号时报清楚错误', async () => {
  const fetchImpl = async () => new Response(JSON.stringify([]), { status: 200 })
  const app = createGithubApp({ appId: '5853766', privateKey, fetchImpl })
  await assert.rejects(
    () => app.mintRepoToken({ owner: 'Lil-BobCN', repo: 'grilling-remote' }),
    /没有安装到账号 Lil-BobCN/,
  )
})

test('GitHub 返回非 2xx 时带状态和消息', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 })
  const app = createGithubApp({ appId: '5853766', installationId: '1', privateKey, fetchImpl })
  await assert.rejects(
    () => app.mintRepoToken({ owner: 'Lil-BobCN', repo: 'grilling-remote' }),
    /退出码 401：Bad credentials/,
  )
})
