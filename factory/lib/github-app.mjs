/**
 * GitHub App 凭证：用 App ID 和私钥签 JWT，再按仓换 1 小时 installation token。
 *
 * 凭证只从 `~/.afkfactory/env` 读：GITHUB_APP_ID、GITHUB_APP_INSTALLATION_ID、
 * GITHUB_APP_PRIVATE_KEY。私钥文件默认 `~/.afkfactory/github-app.pem`。
 * token 请求带 `repositories: [当前仓]`，换出来的 token 只能访问这一仓。
 */
import { createSign } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const DEFAULT_PRIVATE_KEY = join(homedir(), '.afkfactory', 'github-app.pem')
export const DEFAULT_API_BASE = 'https://api.github.com'
export const DEFAULT_PERMISSIONS = {
  contents: 'write',
  issues: 'write',
  pull_requests: 'write',
  workflows: 'write',
}

export function appConfigFromEnv(env = process.env) {
  return {
    appId: String(env.GITHUB_APP_ID || '').trim(),
    installationId: String(env.GITHUB_APP_INSTALLATION_ID || '').trim(),
    privateKeyPath: String(env.GITHUB_APP_PRIVATE_KEY || '').trim() || DEFAULT_PRIVATE_KEY,
  }
}

function base64url(value) {
  return Buffer.from(value).toString('base64url')
}

/** 签 App JWT。GitHub 要求 iat 不晚于现在，exp 不超过 10 分钟。 */
export function createAppJwt({ appId, privateKey, now = Date.now(), ttlSeconds = 540 }) {
  if (!appId) throw new Error('缺 App ID')
  if (!privateKey) throw new Error('缺 GitHub App 私钥')
  const iat = Math.floor(now / 1000) - 60
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = base64url(JSON.stringify({ iat, exp: iat + ttlSeconds, iss: String(appId) }))
  const signature = createSign('RSA-SHA256')
    .update(`${header}.${payload}`)
    .sign(privateKey)
    .toString('base64url')
  return `${header}.${payload}.${signature}`
}

/**
 * 建立 App 客户端。`fetchImpl` 和 `now` 可注入，测试不联网。
 * `installationId` 为空时按 owner 查一次 `/app/installations`。
 */
export function createGithubApp({
  appId,
  installationId = '',
  privateKey,
  apiBase = DEFAULT_API_BASE,
  fetchImpl = globalThis.fetch,
  now = Date.now,
} = {}) {
  if (!appId) throw new Error('缺 GITHUB_APP_ID')
  if (!privateKey) throw new Error('缺 GitHub App 私钥')
  if (typeof fetchImpl !== 'function') throw new Error('当前 Node 没有 fetch，传 fetchImpl')

  async function request(path, { method = 'GET', body, token } = {}) {
    const response = await fetchImpl(`${apiBase}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'afk-factory',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const text = await response.text()
    let data = {}
    try {
      data = text ? JSON.parse(text) : {}
    } catch {
      data = { message: text }
    }
    if (!response.ok) {
      throw new Error(`GitHub App 请求失败：${method} ${path} 退出码 ${response.status}：${data.message || text}`)
    }
    return data
  }

  async function findInstallation({ owner }) {
    const jwt = createAppJwt({ appId, privateKey, now: now() })
    const rows = await request('/app/installations', { token: jwt })
    const wanted = String(owner || '').toLowerCase()
    const found = (Array.isArray(rows) ? rows : []).find(
      (row) => String(row?.account?.login || '').toLowerCase() === wanted,
    )
    if (!found) {
      throw new Error(`GitHub App 没有安装到账号 ${owner}。先安装，或检查 GITHUB_APP_INSTALLATION_ID`)
    }
    return String(found.id)
  }

  async function mintRepoToken({ owner, repo, permissions = DEFAULT_PERMISSIONS } = {}) {
    if (!owner || !repo) throw new Error('mintRepoToken 需要 owner 和 repo')
    const id = String(installationId || '').trim() || (await findInstallation({ owner }))
    const jwt = createAppJwt({ appId, privateKey, now: now() })
    const data = await request(`/app/installations/${id}/access_tokens`, {
      method: 'POST',
      token: jwt,
      body: { repositories: [repo], permissions },
    })
    if (!data.token) throw new Error('GitHub 没有返回 installation token')
    return { token: data.token, expiresAt: data.expires_at, installationId: id }
  }

  return { mintRepoToken, findInstallation }
}

/** 从 env 配置和私钥文件建客户端。私钥读到内存，不写日志。 */
export async function githubAppFromEnv(env = process.env, options = {}) {
  const config = appConfigFromEnv(env)
  if (!config.appId) throw new Error('缺 GITHUB_APP_ID：~/.afkfactory/env 里没有')
  const privateKey = await readFile(config.privateKeyPath, 'utf8').catch((error) => {
    throw new Error(`读不了 GitHub App 私钥 ${config.privateKeyPath}：${error.message}`)
  })
  return createGithubApp({ ...config, privateKey, ...options })
}
