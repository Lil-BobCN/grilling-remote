import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  ConfigError,
  createCustomersReader,
  loadConfig,
  parseEnvFile,
  probeClaudeModel,
  readCustomersFile,
  resolveHelperCommand,
} from '../lib/config.mjs'

async function tempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'afk-config-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

function baseEnv(overrides = {}) {
  return {
    GITHUB_TOKEN: 'ghp_process',
    AFK_HELPER: '/usr/local/sbin/afk-product',
    ANTHROPIC_MODEL: 'test-model',
    ...overrides,
  }
}

const quietProbe = async () => ({ ok: true })

test('parseEnvFile 读注释、export、引号和行尾注释', () => {
  const values = parseEnvFile(
    [
      '# 模型和仓库',
      'export GITHUB_TOKEN=ghp_file',
      'ANTHROPIC_MODEL="ccs-claude-deepseek--deepseek-v4-flash[1m]"',
      "AFK_HELPER='/usr/local/sbin/afk-product'",
      'AFK_SERVER=dev@example.invalid # 服务器',
      'EMPTY=',
      '',
    ].join('\n'),
  )

  assert.deepEqual(values, {
    GITHUB_TOKEN: 'ghp_file',
    ANTHROPIC_MODEL: 'ccs-claude-deepseek--deepseek-v4-flash[1m]',
    AFK_HELPER: '/usr/local/sbin/afk-product',
    AFK_SERVER: 'dev@example.invalid',
    EMPTY: '',
  })
})

test('parseEnvFile 遇到没有等号的行时报错并给出行号', () => {
  assert.throws(
    () => parseEnvFile('GITHUB_TOKEN=ok\n这一行读不懂\n', { file: '/tmp/env' }),
    (error) => {
      assert.ok(error instanceof ConfigError)
      assert.match(error.message, /\/tmp\/env/)
      assert.match(error.message, /第 2 行/)
      return true
    },
  )
})

test('loadConfig 进程环境的非空值优先于 env 文件', async (t) => {
  const dir = await tempDir(t)
  const envFile = join(dir, 'env')
  await writeFile(envFile, 'GITHUB_TOKEN=ghp_file\nANTHROPIC_MODEL=file-model\n', 'utf8')

  const loaded = await loadConfig({
    env: baseEnv({ GITHUB_TOKEN: 'ghp_process', AFK_ENV_FILE: envFile, ANTHROPIC_MODEL: '' }),
    probeModel: quietProbe,
  })

  assert.equal(loaded.githubToken, 'ghp_process')
  assert.equal(loaded.model.name, 'file-model')
  assert.equal(loaded.values.ANTHROPIC_MODEL, 'file-model')
  assert.equal(loaded.envFile, envFile)
})

test('loadConfig 用 env.AFK_ENV_FILE 覆盖默认的 ~/.afkfactory/env', async (t) => {
  const dir = await tempDir(t)
  const home = join(dir, 'home')
  const envFile = join(dir, 'custom.env')
  await mkdir(join(home, '.afkfactory'), { recursive: true })
  await writeFile(join(home, '.afkfactory', 'env'), 'GITHUB_TOKEN=ghp_default\n', 'utf8')
  await writeFile(envFile, 'GITHUB_TOKEN=ghp_custom\nANTHROPIC_MODEL=custom-model\nAFK_HELPER=/bin/helper\n', 'utf8')

  const loaded = await loadConfig({
    env: { HOME: home, AFK_ENV_FILE: envFile },
    probeModel: quietProbe,
  })

  assert.equal(loaded.githubToken, 'ghp_custom')
  assert.equal(loaded.envFile, envFile)
})

test('loadConfig 明确指定的 env 文件不存在时报错', async (t) => {
  const dir = await tempDir(t)
  const missing = join(dir, 'nope.env')
  await assert.rejects(
    loadConfig({ env: { AFK_ENV_FILE: missing }, probeModel: quietProbe }),
    (error) => {
      assert.ok(error instanceof ConfigError)
      assert.match(error.message, /AFK_ENV_FILE/)
      assert.match(error.message, new RegExp(missing.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      return true
    },
  )
})

test('缺 GITHUB_TOKEN 时报错，写清键名和查过的环境文件', async (t) => {
  const dir = await tempDir(t)
  const envFile = join(dir, 'env')
  await writeFile(envFile, 'ANTHROPIC_MODEL=test-model\nAFK_HELPER=/bin/helper\n', 'utf8')

  await assert.rejects(
    loadConfig({ env: { AFK_ENV_FILE: envFile }, probeModel: quietProbe }),
    (error) => {
      assert.ok(error instanceof ConfigError)
      assert.equal(error.key, 'GITHUB_TOKEN')
      assert.match(error.message, /GITHUB_TOKEN/)
      assert.match(error.message, new RegExp(envFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      return true
    },
  )
})

test('AFK_HELPER 只写 ssh 时报错，给出可执行的修法', async () => {
  await assert.rejects(
    loadConfig({ env: baseEnv({ AFK_HELPER: 'ssh' }), probeModel: quietProbe }),
    (error) => {
      assert.ok(error instanceof ConfigError)
      assert.equal(error.key, 'AFK_HELPER')
      assert.match(error.message, /preview-sweep/)
      assert.match(error.message, /AFK_SERVER/)
      assert.match(error.message, /完整命令/)
      return true
    },
  )
})

test('helper 解析认完整命令、AFK_SERVER/AFK_SSH_KEY 和旧的 AFK_SSH_TARGET', () => {
  assert.deepEqual(resolveHelperCommand({ AFK_HELPER: '/opt/helper --flag' }), {
    command: ['/opt/helper', '--flag'],
    source: 'AFK_HELPER',
  })
  assert.deepEqual(resolveHelperCommand({ AFK_SERVER: 'dev@host', AFK_SSH_KEY: '/tmp/key' }), {
    command: ['ssh', '-i', '/tmp/key', 'dev@host', 'sudo', '-n', '/usr/local/sbin/afk-product'],
    source: 'AFK_SERVER',
  })
  assert.deepEqual(resolveHelperCommand({ AFK_SSH_TARGET: 'dev@host' }), {
    command: ['ssh', 'dev@host', 'sudo', '/usr/local/sbin/afk-product'],
    source: 'AFK_SSH_TARGET',
  })
  assert.equal(resolveHelperCommand({}), null)
})

test('缺 helper 配置时报错，写清两条可选修法', async (t) => {
  const dir = await tempDir(t)
  const envFile = join(dir, 'env')
  await writeFile(envFile, 'GITHUB_TOKEN=ghp_file\nANTHROPIC_MODEL=test-model\n', 'utf8')

  await assert.rejects(
    loadConfig({ env: { AFK_ENV_FILE: envFile }, probeModel: quietProbe }),
    (error) => {
      assert.ok(error instanceof ConfigError)
      assert.equal(error.key, 'AFK_HELPER')
      assert.match(error.message, /AFK_HELPER/)
      assert.match(error.message, /AFK_SERVER/)
      assert.match(error.message, /AFK_SSH_KEY/)
      return true
    },
  )
})

test('缺模型时报错，写清键名和查过的环境文件', async (t) => {
  const dir = await tempDir(t)
  const envFile = join(dir, 'env')
  await writeFile(envFile, 'GITHUB_TOKEN=ghp_file\nAFK_HELPER=/bin/helper\n', 'utf8')

  await assert.rejects(
    loadConfig({ env: { AFK_ENV_FILE: envFile }, probeModel: quietProbe }),
    (error) => {
      assert.ok(error instanceof ConfigError)
      assert.equal(error.key, 'ANTHROPIC_MODEL')
      assert.match(error.message, /ANTHROPIC_MODEL/)
      assert.match(error.message, /AFK_AGENT_MODEL/)
      return true
    },
  )
})

test('AFK_AGENT_MODEL 优先于 ANTHROPIC_MODEL，传给探测的是解析后的模型', async () => {
  const probes = []
  const loaded = await loadConfig({
    env: baseEnv({ AFK_AGENT_MODEL: 'agent-model', ANTHROPIC_MODEL: 'env-model' }),
    probeModel: async ({ model, command, env }) => {
      probes.push({ model, command, env })
    },
  })

  assert.equal(loaded.model.name, 'agent-model')
  assert.equal(probes.length, 1)
  assert.equal(probes[0].model, 'agent-model')
  assert.equal(probes[0].command, 'claude')
  assert.equal(probes[0].env.ANTHROPIC_MODEL, 'env-model')
})

test('probeClaudeModel 显式带 --model，非零退出时报出模型和 stderr', async () => {
  const calls = []
  const okExec = async (command, args, options) => {
    calls.push({ command, args, options })
    return { code: 0, stdout: 'OK', stderr: '' }
  }
  await probeClaudeModel({ model: 'test-model', command: 'claude', exec: okExec })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].command, 'claude')
  assert.equal(calls[0].args[calls[0].args.indexOf('--model') + 1], 'test-model')
  assert.equal(calls[0].options.env.ANTHROPIC_MODEL, 'test-model')

  await assert.rejects(
    probeClaudeModel({
      model: 'bad-model',
      command: 'claude',
      exec: async () => ({ code: 1, stdout: '', stderr: 'API Error: 403 用户额度不足' }),
    }),
    (error) => {
      assert.ok(error instanceof ConfigError)
      assert.match(error.message, /探测失败/)
      assert.match(error.message, /bad-model/)
      assert.match(error.message, /403/)
      return true
    },
  )
})

async function customersFile(t, lines) {
  const dir = await tempDir(t)
  const path = join(dir, 'customers.json')
  await writeFile(path, lines.join('\n'), 'utf8')
  return path
}

test('customers 文件是数组或 {customers: [...]} 都认', async (t) => {
  const rows = [{ id: 'c-0001', short_name: 'acme', status: 'active', repos: { demo: 'acme-demo' } }]
  const asArray = await customersFile(t, [JSON.stringify(rows, null, 2)])
  const asObject = await customersFile(t, [JSON.stringify({ customers: rows }, null, 2)])

  assert.deepEqual(await readCustomersFile(asArray), rows)
  assert.deepEqual(await readCustomersFile(asObject), rows)
})

test('customers 根不是数组也不是 {customers: [...]} 时报错', async (t) => {
  const path = await customersFile(t, ['{', '  "rows": []', '}'])

  await assert.rejects(
    readCustomersFile(path),
    (error) => {
      assert.ok(error instanceof ConfigError)
      assert.match(error.message, /customers/)
      assert.match(error.message, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      assert.match(error.message, /\{customers: \[\.\.\.\]\}/)
      return true
    },
  )
})

test('customers 行不是对象时报错并给出行号', async (t) => {
  const path = await customersFile(t, [
    '[',
    '  { "id": "c-0001", "status": "active", "repos": {} },',
    '  42',
    ']',
  ])

  await assert.rejects(
    readCustomersFile(path),
    (error) => {
      assert.ok(error instanceof ConfigError)
      assert.match(error.message, /第 3 行/)
      assert.match(error.message, /不是对象/)
      return true
    },
  )
})

test('repos 不是对象时报错并指出行，不静默零仓', async (t) => {
  const path = await customersFile(t, [
    '[',
    '  { "id": "c-0001", "status": "active", "repos": {} },',
    '  { "id": "c-0002", "status": "active", "repos": ["acme-demo"] }',
    ']',
  ])

  await assert.rejects(
    readCustomersFile(path),
    (error) => {
      assert.ok(error instanceof ConfigError)
      assert.match(error.message, /第 3 行/)
      assert.match(error.message, /repos/)
      assert.match(error.message, /数组/)
      return true
    },
  )
})

test('customers 文件不存在时报错，写清路径', async (t) => {
  const dir = await tempDir(t)
  const path = join(dir, 'nope.json')

  await assert.rejects(
    readCustomersFile(path),
    (error) => {
      assert.ok(error instanceof ConfigError)
      assert.match(error.message, /不存在/)
      assert.match(error.message, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      return true
    },
  )
})

test('customers 不是合法 JSON 时报错，写清文件和解析错误', async (t) => {
  const path = await customersFile(t, ['[', '  { "id": ', ']'])

  await assert.rejects(
    readCustomersFile(path),
    (error) => {
      assert.ok(error instanceof ConfigError)
      assert.match(error.message, /不是合法 JSON/)
      assert.match(error.message, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      return true
    },
  )
})

test('{customers: [...]} 里的坏行也能指出真实行号', async (t) => {
  const path = await customersFile(t, [
    '{',
    '  "customers": [',
    '    { "id": "c-0001", "status": "active", "repos": {} },',
    '    { "id": "c-0002", "status": "active", "repos": "acme-demo" }',
    '  ]',
    '}',
  ])

  await assert.rejects(
    readCustomersFile(path),
    (error) => {
      assert.ok(error instanceof ConfigError)
      assert.match(error.message, /第 4 行/)
      assert.match(error.message, /repos/)
      return true
    },
  )
})

test('AFK_SSH_KEY 指向的私钥不存在时启动报错，存在时放行', async (t) => {
  const dir = await tempDir(t)
  const key = join(dir, 'id_ed25519')
  const env = baseEnv({ AFK_HELPER: '', AFK_SERVER: 'dev@host', AFK_SSH_KEY: key })

  await assert.rejects(
    loadConfig({ env, probeModel: quietProbe }),
    (error) => {
      assert.ok(error instanceof ConfigError)
      assert.equal(error.key, 'AFK_SSH_KEY')
      assert.match(error.message, /私钥不存在/)
      assert.match(error.message, new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      return true
    },
  )

  await writeFile(key, 'test-key\n', 'utf8')
  const loaded = await loadConfig({ env, probeModel: quietProbe })
  assert.equal(loaded.helper.source, 'AFK_SERVER')
})

test('status 写错或缺失时报错，不静默跳过', async (t) => {
  const wrong = await customersFile(t, [
    '[',
    '  { "id": "c-0001", "status": "activ", "repos": { "demo": "acme-demo" } }',
    ']',
  ])
  await assert.rejects(
    readCustomersFile(wrong),
    (error) => {
      assert.ok(error instanceof ConfigError)
      assert.match(error.message, /第 2 行/)
      assert.match(error.message, /status/)
      assert.match(error.message, /activ/)
      return true
    },
  )

  const missing = await customersFile(t, ['[', '  { "id": "c-0001", "repos": {} }', ']'])
  await assert.rejects(readCustomersFile(missing), /status 必须是 active 或 disabled/)
})

test('repos 的值不是仓名字符串时报错，指出那个键', async (t) => {
  const path = await customersFile(t, [
    '[',
    '  { "id": "c-0001", "status": "active", "repos": { "demo": 123 } }',
    ']',
  ])

  await assert.rejects(
    readCustomersFile(path),
    (error) => {
      assert.ok(error instanceof ConfigError)
      assert.match(error.message, /第 2 行/)
      assert.match(error.message, /repos\["demo"\]/)
      assert.match(error.message, /数字/)
      return true
    },
  )
})

test('createCustomersReader 按 mtime 重读：文件改了以后下一轮看到新客户仓', async (t) => {
  const dir = await tempDir(t)
  const path = join(dir, 'customers.json')
  await writeFile(
    path,
    JSON.stringify([{ id: 'c-0001', short_name: 'acme', status: 'active', repos: { demo: 'repo-one' } }]),
    'utf8',
  )
  const reader = createCustomersReader(path)

  const first = await reader()
  const later = new Date(Date.now() + 5000)
  await writeFile(
    path,
    JSON.stringify([
      { id: 'c-0001', short_name: 'acme', status: 'active', repos: { demo: 'repo-one' } },
      { id: 'c-0002', short_name: 'tanxin', status: 'active', repos: { demo: 'repo-two' } },
    ]),
    'utf8',
  )
  await utimes(path, later, later)
  const second = await reader()

  assert.equal(first.length, 1)
  assert.equal(second.length, 2)
  assert.equal(second[1].repos.demo, 'repo-two')
})

test('createCustomersReader 文件形状变坏时报 ConfigError，不沿用旧表', async (t) => {
  const dir = await tempDir(t)
  const path = join(dir, 'customers.json')
  await writeFile(
    path,
    JSON.stringify([{ id: 'c-0001', short_name: 'acme', status: 'active', repos: { demo: 'repo-one' } }]),
    'utf8',
  )
  const reader = createCustomersReader(path)
  assert.equal((await reader()).length, 1)

  const later = new Date(Date.now() + 5000)
  await writeFile(path, JSON.stringify([{ id: 'c-0001', short_name: 'acme', status: 'broken' }]), 'utf8')
  await utimes(path, later, later)

  await assert.rejects(reader(), (error) => {
    assert.ok(error instanceof ConfigError)
    assert.match(error.message, /status 必须是 active 或 disabled/)
    return true
  })
})

test('createCustomersReader 文件不存在时报 ConfigError', async (t) => {
  const dir = await tempDir(t)
  const reader = createCustomersReader(join(dir, 'customers.json'))
  await assert.rejects(reader(), (error) => {
    assert.ok(error instanceof ConfigError)
    assert.match(error.message, /customers 文件不存在/)
    return true
  })
})
