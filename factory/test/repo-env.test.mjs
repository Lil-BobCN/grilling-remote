import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  checkRepoEnv,
  ensureRepoEnv,
  readRepoEnv,
  repoEnvFromProcess,
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

test('宿主回环地址写进客户仓时换成 host.docker.internal，端口和路径保留', async (t) => {
  const cases = [
    ['http://127.0.0.1:1234', 'http://host.docker.internal:1234'],
    ['http://localhost:1234', 'http://host.docker.internal:1234'],
    ['http://[::1]:1234', 'http://host.docker.internal:1234'],
    ['http://127.0.0.1:1234/v1', 'http://host.docker.internal:1234/v1'],
    ['https://api.example.com:8443/v1', 'https://api.example.com:8443/v1'],
  ]
  for (const [input, expected] of cases) {
    const dir = await repoFixture(t)
    await ensureRepoEnv({
      repoDir: dir,
      owner: 'Lil-BobCN',
      repo: 'demo-shop',
      env: { ...HOST_ENV, ANTHROPIC_BASE_URL: input },
      minter: fakeMinter(),
      now: NOW,
    })
    assert.equal((await readRepoEnv(dir)).ANTHROPIC_BASE_URL, expected, input)
  }
})

test('已存在的客户仓 env 里是回环地址时修正，其他已有值不覆盖', async (t) => {
  const dir = await repoFixture(t)
  await mkdir(join(dir, '.sandcastle'), { recursive: true })
  await writeFile(
    repoEnvPath(dir),
    [
      'GH_TOKEN=ghs_existing',
      `GH_TOKEN_EXPIRES_AT=${NOW + 30 * 60 * 1000}`,
      'SANDCASTLE_IMAGE=my-image',
      'CUSTOM_KEY=keep-me',
      'ANTHROPIC_BASE_URL=http://127.0.0.1:5678/custom',
      ...Object.entries(HOST_ENV)
        .filter(([key]) => key !== 'ANTHROPIC_BASE_URL')
        .map(([key, value]) => `${key}=${value}`),
    ].join('\n') + '\n',
  )
  const result = await ensureRepoEnv({
    repoDir: dir,
    owner: 'Lil-BobCN',
    repo: 'demo-shop',
    env: { ...HOST_ENV, ANTHROPIC_BASE_URL: 'http://localhost:9999' },
    minter: fakeMinter(),
    now: NOW,
  })
  assert.equal(result.minted, false)
  const values = await readRepoEnv(dir)
  assert.equal(values.ANTHROPIC_BASE_URL, 'http://host.docker.internal:5678/custom')
  assert.equal(values.GH_TOKEN, 'ghs_existing')
  assert.equal(values.SANDCASTLE_IMAGE, 'my-image')
  assert.equal(values.CUSTOM_KEY, 'keep-me')
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

test('repoEnvFromProcess 读 env 文件里的 App 配置，缺 App 时返回 null', async (t) => {
  const dir = await repoFixture(t)
  const file = join(dir, 'env')
  await writeFile(
    file,
    'GITHUB_APP_ID=123\nGITHUB_APP_INSTALLATION_ID=456\nGITHUB_APP_PRIVATE_KEY=/tmp/github-app.pem\n',
  )
  const repoEnv = await repoEnvFromProcess({ env: {}, envFile: file })
  assert.ok(repoEnv)
  assert.equal(typeof repoEnv.ensure, 'function')
  assert.equal(typeof repoEnv.check, 'function')

  const other = join(dir, 'no-app.env')
  await writeFile(other, 'GITHUB_OWNER=acme\n')
  assert.equal(await repoEnvFromProcess({ env: {}, envFile: other }), null)
})
