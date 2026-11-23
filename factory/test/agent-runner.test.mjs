import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  AGENT_TOOLS,
  NO_WRITE_TOOLS,
  REVIEW_TOOLS,
  VERIFY_TOOLS,
  createAgentRunner,
  defaultExec,
} from '../lib/agent-runner.mjs'

test('默认 command 是 claude，提示词在前，跑 -p --restricted，brief 同时留文件', async () => {
  const calls = []
  const runner = createAgentRunner({
    model: 'test-model',
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
  assert.equal(calls[0].args[3], '--model')
  assert.equal(calls[0].args[4], 'test-model')
  assert.equal(calls[0].args[5], '--tools')
  assert.equal(calls[0].args[6], AGENT_TOOLS)
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

test('模型显式传给 claude --model；没有模型时构造就失败', async () => {
  const calls = []
  const runner = createAgentRunner({
    model: 'test-model',
    exec: async (command, args) => {
      calls.push(args)
      return { code: 0, stdout: '', stderr: '' }
    },
  })
  await runner.run({ brief: '验证这张票', tools: NO_WRITE_TOOLS })
  const index = calls[0].indexOf('--model')
  assert.ok(index > 1)
  assert.equal(calls[0][index + 1], 'test-model')

  assert.throws(() => createAgentRunner({ model: '' }), /缺模型/)
})

test('外部信号已取消时不再起子进程', async () => {
  let called = false
  const runner = createAgentRunner({
    model: 'test-model',
    exec: async () => {
      called = true
      return { code: 0, stdout: '', stderr: '' }
    },
  })
  const controller = new AbortController()
  controller.abort()
  const result = await runner.run({ brief: '验证', signal: controller.signal })
  assert.equal(result.ok, false)
  assert.equal(result.aborted, true)
  assert.equal(called, false)
})

test('取消时杀整个进程组，父进程和孙进程都退出', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'afk-kill-group-'))
  const pidFile = join(dir, 'pids.json')
  const script = [
    "const { spawn } = require('node:child_process')",
    "const { writeFileSync } = require('node:fs')",
    "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })",
    'writeFileSync(process.argv[1], JSON.stringify({ parent: process.pid, child: child.pid }))',
    'setInterval(() => {}, 1000)',
  ].join('\n')

  const controller = new AbortController()
  const running = defaultExec(process.execPath, ['-e', script, pidFile], {
    signal: controller.signal,
  })
  let pids = null
  for (let i = 0; i < 100 && !pids; i += 1) {
    try {
      pids = JSON.parse(await readFile(pidFile, 'utf8'))
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }
  assert.ok(pids, '子进程应写出自己的 pid')

  controller.abort()
  const result = await running
  assert.equal(result.aborted, true)

  const alive = (pid) => {
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      return error.code !== 'ESRCH'
    }
  }
  for (let i = 0; i < 100 && (alive(pids.parent) || alive(pids.child)); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert.equal(alive(pids.parent), false, '父进程应退出')
  assert.equal(alive(pids.child), false, '孙进程应退出')
  await rm(dir, { recursive: true, force: true })
})

test('agent 自身超时按失败返回，不标成管道取消', async () => {
  const runner = createAgentRunner({
    model: 'test-model',
    timeoutMs: 30,
    exec: (command, args, { signal }) =>
      new Promise((resolve) => {
        signal.addEventListener(
          'abort',
          () => resolve({ code: 1, stdout: '', stderr: '', aborted: true }),
          { once: true },
        )
      }),
  })
  const result = await runner.run({ brief: '验证这张票' })
  assert.equal(result.ok, false)
  assert.equal(result.timedOut, true)
  assert.equal(result.aborted, undefined, '超时不算管道取消，要写失败行')
})
