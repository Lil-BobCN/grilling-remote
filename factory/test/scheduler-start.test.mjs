import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { start } from '../bin/scheduler.mjs'
import { ConfigError } from '../lib/config.mjs'

const execFileAsync = promisify(execFile)
const CLI = fileURLToPath(new URL('../bin/scheduler.mjs', import.meta.url))

const CUSTOMERS = JSON.stringify(
  [{ id: 'c-0001', short_name: 'acme', status: 'active', repos: { demo: 'acme-demo' } }],
  null,
  2,
)

async function tempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'afk-scheduler-start-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

async function fixture(t, envLines, customers = CUSTOMERS) {
  const dir = await tempDir(t)
  const envFile = join(dir, 'env')
  const customersPath = join(dir, 'customers.json')
  await writeFile(envFile, `${envLines.join('\n')}\n`, 'utf8')
  await writeFile(customersPath, customers, 'utf8')
  return { dir, envFile, customersPath }
}

function goodEnv() {
  return [
    'GITHUB_TOKEN=ghp_file',
    'AFK_HELPER=/usr/local/sbin/afk-product',
    'ANTHROPIC_MODEL=test-model',
  ]
}

async function cli(t, { dir, envFile, customersPath }, extra = {}) {
  try {
    const result = await execFileAsync(
      process.execPath,
      [CLI, '--once', '--customers', customersPath, '--owner', 'acme'],
      {
        timeout: 10000,
        env: { PATH: process.env.PATH, HOME: dir, AFK_ENV_FILE: envFile, ...extra.env },
      },
    )
    return { code: 0, ...result }
  } catch (error) {
    return { code: error.code, stdout: String(error.stdout || ''), stderr: String(error.stderr || '') }
  }
}

test('start 读 env 文件，把 token、模型和 helper 交给调度器', async (t) => {
  const files = await fixture(t, goodEnv())
  const saved = {
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
  }
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  await start(['--once', '--customers', files.customersPath, '--owner', 'acme'], {
    env: { HOME: files.dir, AFK_ENV_FILE: files.envFile },
    probeModel: async () => ({ ok: true }),
    gh: {},
    checkToken: async () => {},
    notifier: { send: async () => ({ code: 0, stdout: '{}' }) },
    runOnceImpl: async () => ({ now: '2026-11-20T00:00:00.000Z', repos: [], errors: [] }),
    out: () => {},
  })

  assert.equal(process.env.GITHUB_TOKEN, 'ghp_file')
  assert.equal(process.env.ANTHROPIC_MODEL, 'test-model')
})

function restoreEnvAfter(t) {
  const saved = {
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
  }
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
}

test('启动时 token 被 401 拒绝就退出，写清键名和 env 文件', async (t) => {
  const files = await fixture(t, goodEnv())
  restoreEnvAfter(t)
  const gh = {
    request: async () => {
      throw Object.assign(new Error('Bad credentials'), { status: 401 })
    },
  }

  await assert.rejects(
    start(['--once', '--customers', files.customersPath, '--owner', 'acme'], {
      env: { HOME: files.dir, AFK_ENV_FILE: files.envFile },
      probeModel: async () => ({ ok: true }),
      gh,
    }),
    (error) => {
      assert.ok(error instanceof ConfigError)
      assert.equal(error.key, 'GITHUB_TOKEN')
      assert.match(error.message, /401/)
      assert.match(error.message, new RegExp(files.envFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      return true
    },
  )
})

test('启动时 token 检查遇到网络错误只警告，不退出', async (t) => {
  const files = await fixture(t, goodEnv())
  restoreEnvAfter(t)
  const warnings = []
  const gh = {
    request: async () => {
      throw Object.assign(new Error('socket hang up'), { status: 0 })
    },
  }

  await start(['--once', '--customers', files.customersPath, '--owner', 'acme'], {
    env: { HOME: files.dir, AFK_ENV_FILE: files.envFile },
    probeModel: async () => ({ ok: true }),
    gh,
    log: (line) => warnings.push(String(line)),
    notifier: { send: async () => ({ code: 0, stdout: '{}' }) },
    runOnceImpl: async () => ({ now: '2026-11-20T00:00:00.000Z', repos: [], errors: [] }),
    out: () => {},
  })

  assert.match(warnings.join('\n'), /继续启动/)
})

test('缺 GITHUB_TOKEN 时 CLI 退出码非 0，错误写清键名', async (t) => {
  const files = await fixture(t, [
    'AFK_HELPER=/usr/local/sbin/afk-product',
    'ANTHROPIC_MODEL=test-model',
  ])

  const result = await cli(t, files)

  assert.notEqual(result.code, 0)
  assert.match(result.stderr, /GITHUB_TOKEN/)
  assert.match(result.stderr, new RegExp(files.envFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
})

test('AFK_HELPER=ssh 时 CLI 退出码非 0，且不执行 ssh preview-sweep', async (t) => {
  const files = await fixture(t, [
    'GITHUB_TOKEN=ghp_file',
    'AFK_HELPER=ssh',
    'ANTHROPIC_MODEL=test-model',
  ])
  const bin = join(files.dir, 'bin')
  const marker = join(files.dir, 'ssh-called')
  await mkdir(bin, { recursive: true })
  await writeFile(
    join(bin, 'ssh'),
    ['#!/bin/sh', `printf '%s\\n' "$@" >> '${marker}'`, 'exit 0', ''].join('\n'),
    { mode: 0o755 },
  )
  await chmod(join(bin, 'ssh'), 0o755)

  const result = await cli(t, files, { env: { PATH: `${bin}:${process.env.PATH}` } })

  assert.notEqual(result.code, 0)
  assert.match(result.stderr, /preview-sweep/)
  assert.match(result.stderr, /AFK_SERVER/)
  await assert.rejects(stat(marker), 'ssh 一次都不该跑')
})

test('缺模型时 CLI 退出码非 0，错误写清键名', async (t) => {
  const files = await fixture(t, [
    'GITHUB_TOKEN=ghp_file',
    'AFK_HELPER=/usr/local/sbin/afk-product',
  ])

  const result = await cli(t, files)

  assert.notEqual(result.code, 0)
  assert.match(result.stderr, /ANTHROPIC_MODEL/)
  assert.match(result.stderr, /AFK_AGENT_MODEL/)
})

test('模型探测失败时 CLI 退出码非 0，带出模型和 stderr', async (t) => {
  const files = await fixture(t, goodEnv())
  const bin = join(files.dir, 'bin')
  await mkdir(bin, { recursive: true })
  await writeFile(
    join(bin, 'claude'),
    ['#!/bin/sh', "printf 'API Error: 403 用户额度不足\\n' >&2", 'exit 1', ''].join('\n'),
    { mode: 0o755 },
  )

  const result = await cli(t, files, { env: { PATH: `${bin}:${process.env.PATH}` } })

  assert.notEqual(result.code, 0)
  assert.match(result.stderr, /模型探测失败/)
  assert.match(result.stderr, /test-model/)
  assert.match(result.stderr, /403/)
})

test('customers 形状错时 start 直接报错，指出文件和行', async (t) => {
  const files = await fixture(
    t,
    goodEnv(),
    ['[', '  { "id": "c-0001", "status": "active", "repos": {} },', '  42', ']'].join('\n'),
  )

  await assert.rejects(
    start(['--once', '--customers', files.customersPath, '--owner', 'acme'], {
      env: { HOME: files.dir, AFK_ENV_FILE: files.envFile },
      probeModel: async () => ({ ok: true }),
      checkToken: async () => {},
    }),
    (error) => {
      assert.ok(error instanceof ConfigError)
      assert.match(error.message, /第 3 行/)
      assert.match(error.message, /不是对象/)
      return true
    },
  )
})

test('直接调 run 时 customers 形状错也报错，不静默零仓', async (t) => {
  const files = await fixture(
    t,
    goodEnv(),
    ['[', '  { "id": "c-0001", "status": "active", "repos": [] }', ']'].join('\n'),
  )
  const { run } = await import('../bin/scheduler.mjs')

  await assert.rejects(
    run(['--once', '--customers', files.customersPath, '--owner', 'acme'], {
      gh: {},
      notifier: { send: async () => ({ code: 0, stdout: '{}' }) },
      out: () => {},
    }),
    /repos 必须是对象/,
  )
})

test('缺 GITHUB_OWNER 时 start 报错，写清键名和环境文件', async (t) => {
  const files = await fixture(t, goodEnv())
  const saved = {
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
  }
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  await assert.rejects(
    start(['--once', '--customers', files.customersPath], {
      env: { HOME: files.dir, AFK_ENV_FILE: files.envFile },
      probeModel: async () => ({ ok: true }),
    }),
    (error) => {
      assert.ok(error instanceof ConfigError)
      assert.equal(error.key, 'GITHUB_OWNER')
      assert.match(error.message, /GITHUB_OWNER/)
      assert.match(error.message, new RegExp(files.envFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      return true
    },
  )
})
