import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createNotifier, notificationEvent, sendEvent } from '../lib/notify.mjs'

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

test('统一入口用 eventKey 造 key：两个仓同号不撞，occurred_at 可注入', async () => {
  const calls = []
  const notifier = {
    async send(event) {
      calls.push(event)
      return { code: 0, stdout: '{}' }
    },
  }
  const at = new Date('2026-11-17T10:00:00+08:00')

  const left = await sendEvent(notifier, {
    owner: 'acme',
    repo: 'shop',
    subject: '#1',
    event: '该跑 to-spec',
    scope: '0',
    data: { customer: 'acme', requirement: 'yuyue-quhuo' },
    link: 'https://github.com/acme/shop/issues/1',
    now: at,
  })
  const right = await sendEvent(notifier, {
    owner: 'other',
    repo: 'shop',
    subject: '#1',
    event: '该跑 to-spec',
    scope: '0',
    data: { customer: 'other', requirement: 'yuyue-quhuo' },
    now: at,
  })

  assert.deepEqual(left, { code: 0, stdout: '{}' })
  assert.deepEqual(right, { code: 0, stdout: '{}' })
  assert.equal(calls[0].v, 1)
  assert.equal(calls[0].key, 'acme/shop:#1:该跑 to-spec:0')
  assert.equal(calls[1].key, 'other/shop:#1:该跑 to-spec:0')
  assert.equal(calls[0].occurred_at, '2026-11-17T02:00:00.000Z')
  assert.equal(calls[0].event, '该跑 to-spec')
  assert.deepEqual(calls[0].data, { customer: 'acme', requirement: 'yuyue-quhuo' })
})

test('没有仓库身份时 key 不带仓库段，符合文档样例', () => {
  const event = notificationEvent({
    event: '每日抽样',
    scope: '2026-11-15',
    data: { date: '2026-11-15', items: [] },
    now: new Date('2026-11-16T08:30:00+08:00'),
  })
  assert.equal(event.key, '每日抽样:2026-11-15')
  assert.equal(event.link, undefined)
})
