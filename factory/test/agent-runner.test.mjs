import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  AGENT_TOOLS,
  NO_WRITE_TOOLS,
  REVIEW_TOOLS,
  VERIFY_TOOLS,
  createAgentRunner,
} from '../lib/agent-runner.mjs'

test('默认 command 是 claude，提示词在前，跑 -p --restricted，brief 同时留文件', async () => {
  const calls = []
  const runner = createAgentRunner({
    exec: async (command, args, options) => {
      calls.push({ command, args, options })
      return { code: 0, stdout: '验证通过', stderr: '' }
    },
  })

  const result = await runner.run({
    brief: '按验收条件点一遍应用',
    cwd: '/tmp/example',
    name: 'verify',
  })

  assert.equal(result.ok, true)
  assert.equal(calls[0].command, 'claude')
  assert.equal(calls[0].args[0], '按验收条件点一遍应用')
  assert.equal(calls[0].args[1], '-p')
  assert.equal(calls[0].args[2], '--restricted')
  assert.equal(calls[0].args[3], '--tools')
  assert.equal(calls[0].args[4], AGENT_TOOLS)
  assert.equal(AGENT_TOOLS, 'Bash,Read,Write,Edit')
  assert.ok(calls[0].args.includes('按验收条件点一遍应用'))
  assert.equal(calls[0].options.cwd, '/tmp/example')
  assert.ok(result.briefPath.endsWith('.md'))
  assert.equal(await readFile(result.briefPath, 'utf8'), '按验收条件点一遍应用')
})

test('退出码非 0 返回 ok:false，保留 stderr', async () => {
  const runner = createAgentRunner({
    command: 'fake-claude',
    exec: async () => ({ code: 2, stdout: '', stderr: '没法启动' }),
  })
  const result = await runner.run({ brief: '评审这次改动' })
  assert.equal(result.ok, false)
  assert.equal(result.code, 2)
  assert.equal(result.stderr, '没法启动')
  assert.equal(result.command, 'fake-claude')
})

test('认证和额度失败带 authFailure 和原因，stdout、stderr 都认', async () => {
  const cases = [
    {
      name: '401',
      stdout: '',
      stderr: 'API Error: 401 {"error":{"type":"authentication_error"}}',
      expect: /API Error: 401/,
    },
    {
      name: '402',
      stdout: '',
      stderr: 'API Error: 402 {"error":{"type":"payment_required"}}',
      expect: /API Error: 402/,
    },
    {
      name: '403',
      stdout: 'API Error: 403 {"error":{"type":"permission_error"}}',
      stderr: '',
      expect: /API Error: 403/,
    },
    {
      name: '用户额度不足',
      stdout: '用户额度不足，请充值后重试',
      stderr: '',
      expect: /用户额度不足/,
    },
    {
      name: 'Insufficient Balance',
      stdout: '',
      stderr: 'API Error: 400 {"error":{"message":"Insufficient Balance"}}',
      expect: /Insufficient Balance/,
    },
  ]

  for (const item of cases) {
    const runner = createAgentRunner({
      exec: async () => ({ code: 1, stdout: item.stdout, stderr: item.stderr }),
    })
    const result = await runner.run({ brief: '验证这张票' })
    assert.equal(result.ok, false, item.name)
    assert.equal(result.authFailure, true, item.name)
    assert.match(result.authMessage, item.expect, item.name)
  }
})

test('只有 unrecognized_model 警告时不带 authFailure', async () => {
  const runner = createAgentRunner({
    exec: async () => ({
      code: 0,
      stdout: 'unrecognized_model: fake-model\n验证通过',
      stderr: '',
    }),
  })
  const result = await runner.run({ brief: '验证这张票' })
  assert.equal(result.ok, true)
  assert.equal(result.authFailure, undefined)
  assert.equal(result.authMessage, undefined)
})

test('空 brief 直接报错，不跑命令', async () => {
  let called = false
  const runner = createAgentRunner({
    exec: async () => {
      called = true
      return { code: 0, stdout: '', stderr: '' }
    },
  })
  await assert.rejects(() => runner.run({ brief: '   ' }))
  assert.equal(called, false)
})

test('allowedTools 透传成 --allowedTools，逗号分隔', async () => {
  const calls = []
  const runner = createAgentRunner({
    allowedTools: VERIFY_TOOLS,
    exec: async (command, args) => {
      calls.push(args)
      return { code: 0, stdout: '', stderr: '' }
    },
  })
  await runner.run({ brief: '验证这张票' })
  const index = calls[0].indexOf('--allowedTools')
  assert.ok(index > 1)
  assert.equal(calls[0][index + 1], VERIFY_TOOLS)
  assert.match(calls[0][index + 1], /Bash\(npm:\*\)/)
})

test('单次 run 的 allowedTools 覆盖默认值', async () => {
  const calls = []
  const runner = createAgentRunner({
    allowedTools: 'Read',
    exec: async (command, args) => {
      calls.push(args)
      return { code: 0, stdout: '', stderr: '' }
    },
  })
  await runner.run({ brief: '评审', allowedTools: 'Read,Write' })
  const index = calls[0].indexOf('--allowedTools')
  assert.equal(calls[0][index + 1], 'Read,Write')
})

test('tools 和 allowedTools 分开传，--tools 点名跑命令的工具', async () => {
  const calls = []
  const runner = createAgentRunner({
    exec: async (command, args) => {
      calls.push(args)
      return { code: 0, stdout: '', stderr: '' }
    },
  })
  await runner.run({ brief: '拆票', tools: 'Bash,Read', allowedTools: 'Read' })
  const toolsIndex = calls[0].indexOf('--tools')
  assert.equal(calls[0][toolsIndex + 1], 'Bash,Read')
  const allowedIndex = calls[0].indexOf('--allowedTools')
  assert.equal(calls[0][allowedIndex + 1], 'Read')
})

test('验证和评审的 args 里没有 Write/Edit，--tools 也只给 Bash,Read', async () => {
  const calls = []
  const runner = createAgentRunner({
    exec: async (command, args) => {
      calls.push(args.join(' '))
      return { code: 0, stdout: '', stderr: '' }
    },
  })
  await runner.run({
    brief: '验证这张票',
    tools: NO_WRITE_TOOLS,
    allowedTools: VERIFY_TOOLS,
  })
  await runner.run({
    brief: '评审这次改动',
    tools: NO_WRITE_TOOLS,
    allowedTools: REVIEW_TOOLS,
  })

  assert.equal(NO_WRITE_TOOLS, 'Bash,Read')
  assert.equal(calls.length, 2)
  for (const args of calls) {
    assert.doesNotMatch(args, /Write|Edit/, args)
    assert.match(args, /--tools Bash,Read/)
  }
  assert.match(calls[0], /--allowedTools Read,Bash\(bash:\*\)/)
  assert.match(calls[1], /--allowedTools Read,Bash\(gh:\*\)/)
})
