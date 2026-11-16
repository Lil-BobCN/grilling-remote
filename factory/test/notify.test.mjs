import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createNotifier } from '../lib/notify.mjs'

const EVENT = {
  v: 1,
  key: '#42:该跑 to-spec:0',
  event: '该跑 to-spec',
  occurred_at: '2026-11-17T10:00:00+08:00',
  link: 'https://github.com/acme/demo/issues/42',
  data: { customer: 'acme', requirement: 'yuyue-quhuo' },
}

test('把事件写到临时文件，跑 python3 -m notifier send --event-file，返回退出码和 stdout', async () => {
  const calls = []
  let seen = null
  const notifier = createNotifier({
    home: '/tmp/notifier-home',
    cwd: '/tmp/repo-root',
    runner: async (command, args, options) => {
      calls.push({ command, args, options })
      const file = args.at(-1)
      seen = JSON.parse(await readFile(file, 'utf8'))
      await access(file)
      return { code: 0, stdout: '{"skipped":false}\n' }
    },
  })

  const result = await notifier.send(EVENT)

  assert.deepEqual(result, { code: 0, stdout: '{"skipped":false}\n' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].command, 'python3')
  assert.deepEqual(calls[0].args.slice(0, 4), ['-m', 'notifier', 'send', '--event-file'])
  assert.equal(calls[0].options.cwd, '/tmp/repo-root')
  assert.equal(calls[0].options.env.NOTIFIER_HOME, '/tmp/notifier-home')
  assert.deepEqual(seen, EVENT)
})

test('跑完删掉临时目录', async () => {
  let file = null
  const notifier = createNotifier({
    runner: async (command, args) => {
      file = args.at(-1)
      assert.equal(command, 'python3')
      return { code: 0, stdout: '' }
    },
  })
  await notifier.send(EVENT)
  await assert.rejects(access(file))
})

test('命令失败也返回退出码，不抛', async () => {
  const notifier = createNotifier({
    runner: async () => ({ code: 1, stdout: '{"skipped":false,"results":[]}\n' }),
  })
  const result = await notifier.send(EVENT)
  assert.equal(result.code, 1)
  assert.match(result.stdout, /skipped/)
})

test('默认命令是 python3，命令不在仓根跑时也能 import notifier', async () => {
  let command = null
  let cwd = null
  const notifier = createNotifier({
    runner: async (name, args, options) => {
      command = name
      cwd = options.cwd
      return { code: 0, stdout: '' }
    },
  })
  await notifier.send(EVENT)
  assert.equal(command, 'python3')
  assert.equal(cwd, fileURLToPath(new URL('../../', import.meta.url)))
})
