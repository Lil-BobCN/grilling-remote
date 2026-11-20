import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  checkRepoEnv,
  ensureRepoEnv,
  readRepoEnv,
  repoEnvPath,
} from '../lib/repo-env.mjs'

const HOST_ENV = {
  ANTHROPIC_AUTH_TOKEN: 'proxy-token',
  ANTHROPIC_BASE_URL: 'http://127.0.0.1:15721',
  ANTHROPIC_MODEL: 'ccs-claude-deepseek--deepseek-v4-flash[1m]',
  ANTHROPIC_DEFAULT_HAIKU_MODEL: 'ccs-claude-deepseek--deepseek-v4-flash[1m]',
  ANTHROPIC_DEFAULT_SONNET_MODEL: 'ccs-claude-deepseek--deepseek-v4-flash[1m]',
  ANTHROPIC_DEFAULT_OPUS_MODEL: 'ccs-claude-deepseek--deepseek-v4-flash[1m]',
  CLAUDE_CODE_EFFORT_LEVEL: 'max',
}

const NOW = Date.parse('2026-11-21T04:00:00Z')

async function repoFixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'afk-repo-env-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

function fakeMinter(token = 'ghs_repo_token', expiresAt = '2026-11-21T05:00:00Z') {
  const calls = []
  return {
    calls,
    async mintRepoToken(args) {
      calls.push(args)
      return { token, expiresAt }
    },
  }
}

test('ensureRepoEnv 生成完整的 .sandcastle/.env，权限 600', async (t) => {
  const dir = await repoFixture(t)
  const minter = fakeMinter()
  const result = await ensureRepoEnv({
    repoDir: dir,
    owner: 'Lil-BobCN',
    repo: 'demo-shop',
    env: HOST_ENV,
    minter,
    now: NOW,
  })
  assert.equal(result.minted, true)
  assert.deepEqual(minter.calls, [{ owner: 'Lil-BobCN', repo: 'demo-shop' }])
  const values = await readRepoEnv(dir)
  assert.equal(values.GH_TOKEN, 'ghs_repo_token')
  assert.equal(values.GH_TOKEN_EXPIRES_AT, String(Date.parse('2026-11-21T05:00:00Z')))
  assert.equal(values.SANDCASTLE_IMAGE, 'sandcastle:demo-shop')
  assert.equal(values.GIT_AUTHOR_EMAIL, 'factory@afkfactory.dev')
  assert.equal(values.ANTHROPIC_MODEL, HOST_ENV.ANTHROPIC_MODEL)
  const mode = (await stat(repoEnvPath(dir))).mode & 0o777
  assert.equal(mode, 0o600)
})

test('已有值和额外键保留，token 没过期不重签', async (t) => {
  const dir = await repoFixture(t)
  await mkdir(join(dir, '.sandcastle'), { recursive: true })
  await writeFile(
    repoEnvPath(dir),
    [
      'GH_TOKEN=ghs_existing',
      `GH_TOKEN_EXPIRES_AT=${NOW + 30 * 60 * 1000}`,
      'SANDCASTLE_IMAGE=my-image',
      'CUSTOM_KEY=keep-me',
      ...Object.entries(HOST_ENV).map(([key, value]) => `${key}=${value}`),
    ].join('\n') + '\n',
  )
  const minter = fakeMinter()
  const result = await ensureRepoEnv({
    repoDir: dir,
    owner: 'Lil-BobCN',
    repo: 'demo-shop',
    env: HOST_ENV,
    minter,
    now: NOW,
  })
  assert.equal(result.minted, false)
  assert.equal(minter.calls.length, 0)
  const values = await readRepoEnv(dir)
  assert.equal(values.GH_TOKEN, 'ghs_existing')
  assert.equal(values.SANDCASTLE_IMAGE, 'my-image')
  assert.equal(values.CUSTOM_KEY, 'keep-me')
})

test('token 快过期时按仓重签', async (t) => {
  const dir = await repoFixture(t)
  await mkdir(join(dir, '.sandcastle'), { recursive: true })
  await writeFile(
    repoEnvPath(dir),
    [
      'GH_TOKEN=ghs_old',
      `GH_TOKEN_EXPIRES_AT=${NOW + 60 * 1000}`,
      ...Object.entries(HOST_ENV).map(([key, value]) => `${key}=${value}`),
      'SANDCASTLE_IMAGE=sandcastle:demo-shop',
    ].join('\n') + '\n',
  )
  const minter = fakeMinter('ghs_new')
  const result = await ensureRepoEnv({
    repoDir: dir,
    owner: 'Lil-BobCN',
    repo: 'demo-shop',
    env: HOST_ENV,
    minter,
    now: NOW,
  })
  assert.equal(result.minted, true)
  assert.equal((await readRepoEnv(dir)).GH_TOKEN, 'ghs_new')
})

test('缺 App 配置时给可执行的错，不回落到宿主 token', async (t) => {
  const dir = await repoFixture(t)
  await assert.rejects(
    () =>
      ensureRepoEnv({
        repoDir: dir,
        owner: 'Lil-BobCN',
        repo: 'demo-shop',
        env: HOST_ENV,
        minter: null,
        now: NOW,
      }),
    /GITHUB_APP_ID/,
  )
})

test('宿主模型键不全时列出缺的键', async (t) => {
  const dir = await repoFixture(t)
  const env = { ...HOST_ENV }
  delete env.ANTHROPIC_BASE_URL
  await assert.rejects(
    () =>
      ensureRepoEnv({
        repoDir: dir,
        owner: 'Lil-BobCN',
        repo: 'demo-shop',
        env,
        minter: fakeMinter(),
        now: NOW,
      }),
    /ANTHROPIC_BASE_URL/,
  )
})

test('checkRepoEnv 缺文件时报 onboarding 命令', async (t) => {
  const dir = await repoFixture(t)
  await assert.rejects(
    () => checkRepoEnv({ repoDir: dir }),
    /缺 .*\.sandcastle\/\.env.*repo-env\.mjs ensure/,
  )
})

test('checkRepoEnv 缺键时列出键名', async (t) => {
  const dir = await repoFixture(t)
  await mkdir(join(dir, '.sandcastle'), { recursive: true })
  await writeFile(repoEnvPath(dir), 'GH_TOKEN=ghs_only\n')
  await assert.rejects(
    () => checkRepoEnv({ repoDir: dir }),
    /缺键：ANTHROPIC_AUTH_TOKEN/,
  )
})

test('checkRepoEnv 键齐时通过', async (t) => {
  const dir = await repoFixture(t)
  await ensureRepoEnv({
    repoDir: dir,
    owner: 'Lil-BobCN',
    repo: 'demo-shop',
    env: HOST_ENV,
    minter: fakeMinter(),
    now: NOW,
  })
  const values = await checkRepoEnv({ repoDir: dir })
  assert.equal(values.GH_TOKEN, 'ghs_repo_token')
})

test('文件内容没有宿主宽权限 token', async (t) => {
  const dir = await repoFixture(t)
  const env = { ...HOST_ENV, GH_TOKEN: 'gho_host_wide_token' }
  await ensureRepoEnv({
    repoDir: dir,
    owner: 'Lil-BobCN',
    repo: 'demo-shop',
    env,
    minter: fakeMinter(),
    now: NOW,
  })
  const text = await readFile(repoEnvPath(dir), 'utf8')
  assert.doesNotMatch(text, /gho_host_wide_token/)
})
