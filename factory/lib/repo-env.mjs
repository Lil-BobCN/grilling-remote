/**
 * 客户仓的 `.sandcastle/.env`：生成、补键、换短效 token、点火前检查。
 *
 * 凭证只写这个文件，权限 600。GH_TOKEN 是 GitHub App 按当前仓换的
 * installation token，1 小时过期；`GH_TOKEN_EXPIRES_AT` 记到期时间（毫秒）。
 * 缺 App 配置或私钥时报可执行的错，不回落到宿主 `GH_TOKEN`。
 */
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parseEnvFile, readEnvValues } from './config.mjs'
import { githubAppFromEnv } from './github-app.mjs'

export const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: 'AFK Factory',
  GIT_AUTHOR_EMAIL: 'factory@afkfactory.dev',
  GIT_COMMITTER_NAME: 'AFK Factory',
  GIT_COMMITTER_EMAIL: 'factory@afkfactory.dev',
}

export const REQUIRED_KEYS = [
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'CLAUDE_CODE_EFFORT_LEVEL',
  'GIT_AUTHOR_NAME',
  'GIT_AUTHOR_EMAIL',
  'GIT_COMMITTER_NAME',
  'GIT_COMMITTER_EMAIL',
  'SANDCASTLE_IMAGE',
  'GH_TOKEN',
]

const TOKEN_REFRESH_MS = 10 * 60 * 1000

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

/**
 * 客户仓的 `.env` 会被容器里的 agent 读取。宿主的 127.0.0.1 在容器里指容器自己，
 * 换成容器可达的 host.docker.internal；协议、端口和路径保持不变。
 */
function containerBaseUrl(value) {
  const text = String(value ?? '').trim()
  if (!text) return text
  let url
  try {
    url = new URL(text)
  } catch {
    return text
  }
  if (!LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) return text
  url.hostname = 'host.docker.internal'
  const rendered = url.toString()
  return rendered.endsWith('/') && !text.endsWith('/') ? rendered.slice(0, -1) : rendered
}

export function repoEnvPath(repoDir) {
  return join(repoDir, '.sandcastle', '.env')
}

export async function readRepoEnv(repoDir) {
  const text = await readFile(repoEnvPath(repoDir), 'utf8')
  return parseEnvFile(text, { file: repoEnvPath(repoDir) })
}

export function missingRepoEnvKeys(values = {}) {
  return REQUIRED_KEYS.filter((key) => !String(values[key] ?? '').trim())
}

/** 点火前检查：文件不在或键不全都抛错，错误里列清楚缺什么。 */
export async function checkRepoEnv({ repoDir }) {
  let values
  try {
    values = await readRepoEnv(repoDir)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(
        `缺 ${repoEnvPath(repoDir)}。先跑 onboarding：node factory/bin/repo-env.mjs ensure --repo-dir <客户仓> --owner <owner> --repo <repo>`,
      )
    }
    throw error
  }
  const missing = missingRepoEnvKeys(values)
  if (missing.length) {
    throw new Error(
      `客户仓 .sandcastle/.env 缺键：${missing.join('、')}。先跑 onboarding：node factory/bin/repo-env.mjs ensure --repo-dir <客户仓> --owner <owner> --repo <repo>`,
    )
  }
  return values
}

function hostValues({ env, model, image, repo }) {
  const modelName = String(model?.name || env.ANTHROPIC_MODEL || '').trim()
  const sameModel = (key) => String(env[key] || env.ANTHROPIC_MODEL || modelName).trim()
  return {
    ANTHROPIC_AUTH_TOKEN: String(env.ANTHROPIC_AUTH_TOKEN || '').trim(),
    ANTHROPIC_BASE_URL: containerBaseUrl(env.ANTHROPIC_BASE_URL),
    ANTHROPIC_MODEL: modelName,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: sameModel('ANTHROPIC_DEFAULT_HAIKU_MODEL'),
    ANTHROPIC_DEFAULT_SONNET_MODEL: sameModel('ANTHROPIC_DEFAULT_SONNET_MODEL'),
    ANTHROPIC_DEFAULT_OPUS_MODEL: sameModel('ANTHROPIC_DEFAULT_OPUS_MODEL'),
    CLAUDE_CODE_EFFORT_LEVEL: String(env.CLAUDE_CODE_EFFORT_LEVEL || 'max').trim(),
    ...GIT_IDENTITY,
    SANDCASTLE_IMAGE: String(image || env.AFK_SANDCASTLE_IMAGE || `sandcastle:${repo}`).trim(),
  }
}

function renderEnv(values) {
  return `${Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')}\n`
}

/**
 * 生成或补齐 `.sandcastle/.env`。
 * 已有值不覆盖；缺的模型和 git 键从宿主环境补；GH_TOKEN 过期或缺失时按仓重签。
 * 唯一例外：已有的 ANTHROPIC_BASE_URL 是宿主回环地址时，改写成容器可达的地址。
 * `minter.mintRepoToken({ owner, repo })` 返回 `{ token, expiresAt }`。
 */
export async function ensureRepoEnv({
  repoDir,
  owner,
  repo,
  env = process.env,
  model,
  image = '',
  minter,
  now = Date.now(),
}) {
  let existing = {}
  try {
    existing = await readRepoEnv(repoDir)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  const values = { ...existing }
  for (const [key, value] of Object.entries(hostValues({ env, model, image, repo }))) {
    if (!String(values[key] ?? '').trim() && String(value ?? '').trim()) values[key] = value
  }
  if (String(values.ANTHROPIC_BASE_URL ?? '').trim()) {
    values.ANTHROPIC_BASE_URL = containerBaseUrl(values.ANTHROPIC_BASE_URL)
  }

  const expiresAt = Number(values.GH_TOKEN_EXPIRES_AT || 0)
  const stale = !expiresAt || expiresAt - Number(now) < TOKEN_REFRESH_MS
  const needToken = !String(values.GH_TOKEN || '').trim() || stale
  if (needToken) {
    if (!minter || typeof minter.mintRepoToken !== 'function') {
      throw new Error(
        '缺 GitHub App 配置：GITHUB_APP_ID、GITHUB_APP_INSTALLATION_ID、GITHUB_APP_PRIVATE_KEY。' +
          '先把这三项写进 ~/.afkfactory/env，私钥放 ~/.afkfactory/github-app.pem',
      )
    }
    const minted = await minter.mintRepoToken({ owner, repo })
    values.GH_TOKEN = minted.token
    values.GH_TOKEN_EXPIRES_AT = String(
      Number.isFinite(Date.parse(minted.expiresAt))
        ? Date.parse(minted.expiresAt)
        : Number(now) + 60 * 60 * 1000,
    )
  }

  const missing = missingRepoEnvKeys(values)
  if (missing.length) {
    throw new Error(`客户仓 .sandcastle/.env 还缺键：${missing.join('、')}。检查宿主 ~/.afkfactory/env 的模型和凭证配置`)
  }

  const path = repoEnvPath(repoDir)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, renderEnv(values), { mode: 0o600 })
  await chmod(path, 0o600)
  return { path, values, minted: needToken }
}

/**
 * 生产用的 repoEnv：从 `~/.afkfactory/env` 读 App 配置，私钥按需读。
 * 返回 `{ ensure, check }`，给 ignition 注入。
 */
export function createRepoEnv({ env = process.env, fetchImpl, now = Date.now } = {}) {
  let appPromise = null
  const app = () => {
    appPromise ??= githubAppFromEnv(env, { fetchImpl, now })
    return appPromise
  }
  return {
    check: checkRepoEnv,
    async ensure(args) {
      return ensureRepoEnv({ ...args, env, minter: await app(), now: now() })
    },
  }
}

/**
 * 从 `~/.afkfactory/env` 和进程环境建 repoEnv；没有 App 配置时返回 null。
 * ignite 和 repo-env 两个 CLI 共用，避免各自判断 GITHUB_APP_ID 而漏读 env 文件。
 */
export async function repoEnvFromProcess({ env = process.env, envFile, readFile, ...options } = {}) {
  const loaded = await readEnvValues({ env, envFile, readFile })
  const values = { ...loaded.values }
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && String(value) !== '') values[key] = String(value)
  }
  if (!String(values.GITHUB_APP_ID || '').trim()) return null
  return createRepoEnv({ env: values, ...options })
}
