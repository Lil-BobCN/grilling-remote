import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createAgentRunner } from '../lib/agent-runner.mjs'

test('默认 command 是 claude，跑 -p --restricted，brief 同时留文件', async () => {
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
  assert.equal(calls[0].args[0], '-p')
  assert.equal(calls[0].args[1], '--restricted')
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
