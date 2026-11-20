import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, stat, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createDirRemote, importEvent, pullInbox } from '../lib/inbox.mjs'

async function makeRoots(t) {
  const remoteRoot = await mkdtemp(join(tmpdir(), 'afk-remote-'))
  const inboxDir = await mkdtemp(join(tmpdir(), 'afk-inbox-'))
  t.after(() => rm(remoteRoot, { recursive: true, force: true }))
  t.after(() => rm(inboxDir, { recursive: true, force: true }))
  return { remoteRoot, inboxDir }
}

function zipBytes(id) {
  return Buffer.from(`zip-${id}`)
}

async function seedUpload(remoteRoot, id, { status = 'ready', operator_alert, extra = {} } = {}) {
  const dir = join(remoteRoot, id)
  await mkdir(dir, { recursive: true })
  const bytes = zipBytes(id)
  await writeFile(join(dir, 'package.zip'), bytes)
  const meta = {
    id,
    status,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: bytes.length,
    user: { id: 'c-0001', short_name: 'acme' },
    requirements: [{ name: 'demo', passed: true }],
    orders: ['o-0001'],
    ...(operator_alert ? { operator_alert } : {}),
    ...extra,
  }
  await writeFile(join(dir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
  return meta
}

function countingRemote(root) {
  const base = createDirRemote(root)
  const calls = { list: 0, read: [], remove: [] }
  return {
    calls,
    async list() {
      calls.list += 1
      return base.list()
    },
    async read(id, name) {
      calls.read.push(`${id}/${name}`)
      return base.read(id, name)
    },
    async remove(id) {
      calls.remove.push(id)
      return base.remove(id)
    },
  }
}

test('ready 的上传只拷到本地，不删远端', async (t) => {
  const { remoteRoot, inboxDir } = await makeRoots(t)
  const meta = await seedUpload(remoteRoot, 'upload-ready', { status: 'ready' })
  const remote = createDirRemote(remoteRoot)

  const result = await pullInbox({ remote, inboxDir })
  assert.equal(result.pulled.length, 1)

  const local = join(inboxDir, 'upload-ready')
  assert.deepEqual(await readFile(join(local, 'package.zip')), zipBytes('upload-ready'))
  const savedMeta = JSON.parse(await readFile(join(local, 'meta.json'), 'utf8'))
  assert.equal(savedMeta.sha256, meta.sha256)
  const archive = JSON.parse(await readFile(join(local, 'archived.json'), 'utf8'))
  assert.equal(archive.status, 'ready')
  assert.equal(archive.sha256, meta.sha256)
  await stat(join(remoteRoot, 'upload-ready', 'package.zip'))
})

test('imported 的上传拷完删远端', async (t) => {
  const { remoteRoot, inboxDir } = await makeRoots(t)
  const imported = [
    {
      order_id: 'o-0001',
      requirement: 'demo',
      product: 'demo',
      owner: 'acme',
      repo: 'acme-demo',
      issue_url: 'https://github.com/acme/acme-demo/issues/1',
      branch: 'req/o-0001',
    },
  ]
  await seedUpload(remoteRoot, 'upload-done', { status: 'imported', extra: { imported } })

  const result = await pullInbox({ remote: createDirRemote(remoteRoot), inboxDir })
  assert.equal(result.removed.length, 1)

  const local = join(inboxDir, 'upload-done')
  await stat(join(local, 'package.zip'))
  const savedMeta = JSON.parse(await readFile(join(local, 'meta.json'), 'utf8'))
  assert.deepEqual(savedMeta.imported, imported)
  const archive = JSON.parse(await readFile(join(local, 'archived.json'), 'utf8'))
  assert.equal(archive.status, 'imported')
  assert.ok(archive.removed_remote_at)
  await assert.rejects(stat(join(remoteRoot, 'upload-done')))
})

test('重复跑不重复拷 package.zip，远端 meta 变了会更新本地 meta', async (t) => {
  const { remoteRoot, inboxDir } = await makeRoots(t)
  await seedUpload(remoteRoot, 'upload-ready', { status: 'ready' })
  const remote = countingRemote(remoteRoot)

  await pullInbox({ remote, inboxDir })
  assert.equal(remote.calls.read.filter((item) => item === 'upload-ready/package.zip').length, 1)

  await pullInbox({ remote, inboxDir })
  assert.equal(remote.calls.read.filter((item) => item === 'upload-ready/package.zip').length, 1)

  await seedUpload(remoteRoot, 'upload-ready', { status: 'imported' })
  const third = await pullInbox({ remote, inboxDir })
  assert.equal(remote.calls.read.filter((item) => item === 'upload-ready/package.zip').length, 1)
  assert.equal(third.removed[0], 'upload-ready')
  await assert.rejects(stat(join(remoteRoot, 'upload-ready')))
})

test('本地已有完整副本时，远端 imported 直接删', async (t) => {
  const { remoteRoot, inboxDir } = await makeRoots(t)
  await seedUpload(remoteRoot, 'upload-done', { status: 'ready' })
  const remote = countingRemote(remoteRoot)
  await pullInbox({ remote, inboxDir })

  await seedUpload(remoteRoot, 'upload-done', { status: 'imported' })
  const result = await pullInbox({ remote, inboxDir })
  assert.equal(result.removed[0], 'upload-done')
  assert.equal(remote.calls.read.filter((item) => item === 'upload-done/package.zip').length, 1)
  await assert.rejects(stat(join(remoteRoot, 'upload-done')))
})

test('本地副本损坏时不删远端，重新拷一份', async (t) => {
  const { remoteRoot, inboxDir } = await makeRoots(t)
  await seedUpload(remoteRoot, 'upload-done', { status: 'imported' })
  await mkdir(join(inboxDir, 'upload-done'), { recursive: true })
  await writeFile(join(inboxDir, 'upload-done', 'package.zip'), '坏文件')

  await pullInbox({ remote: createDirRemote(remoteRoot), inboxDir })
  const bytes = await readFile(join(inboxDir, 'upload-done', 'package.zip'))
  assert.deepEqual(bytes, zipBytes('upload-done'))
  await assert.rejects(stat(join(remoteRoot, 'upload-done')))
})

test('有 operator_alert 时转发给 notifier，重复跑不重复发', async (t) => {
  const { remoteRoot, inboxDir } = await makeRoots(t)
  await seedUpload(remoteRoot, 'upload-alert', {
    status: 'ready',
    operator_alert: { reason: 'import_failed', message: '建单炸了', at: '2026-11-16T12:00:00Z' },
  })
  const notified = []
  const notify = async (payload) => notified.push(payload)

  await pullInbox({ remote: createDirRemote(remoteRoot), inboxDir, notify })
  assert.equal(notified.length, 1)
  assert.equal(notified[0].alert.reason, 'import_failed')
  assert.equal(notified[0].meta.id, 'upload-alert')

  await pullInbox({ remote: createDirRemote(remoteRoot), inboxDir, notify })
  assert.equal(notified.length, 1)
})

test('failed 上传带 operator_alert 时只转发提醒，不拷包也不删远端', async (t) => {
  const { remoteRoot, inboxDir } = await makeRoots(t)
  await seedUpload(remoteRoot, 'upload-rejected', {
    status: 'failed',
    operator_alert: { reason: 'multiple_new_requirements', message: '第一次传了两个目录', at: '2026-11-16T12:00:00Z' },
  })
  const notified = []

  await pullInbox({
    remote: createDirRemote(remoteRoot),
    inboxDir,
    notify: async (payload) => notified.push(payload),
  })

  assert.equal(notified.length, 1)
  assert.equal(notified[0].alert.reason, 'multiple_new_requirements')
  await assert.rejects(stat(join(inboxDir, 'upload-rejected', 'package.zip')))
  await stat(join(remoteRoot, 'upload-rejected', 'package.zip'))
})

test('validation_failed 的上传照常存档，不删远端', async (t) => {
  const { remoteRoot, inboxDir } = await makeRoots(t)
  await seedUpload(remoteRoot, 'upload-invalid', { status: 'validation_failed' })

  await pullInbox({ remote: createDirRemote(remoteRoot), inboxDir })

  const local = join(inboxDir, 'upload-invalid')
  assert.deepEqual(await readFile(join(local, 'package.zip')), zipBytes('upload-invalid'))
  const archive = JSON.parse(await readFile(join(local, 'archived.json'), 'utf8'))
  assert.equal(archive.status, 'validation_failed')
  await stat(join(remoteRoot, 'upload-invalid', 'package.zip'))
})

test('每轮把 customers.json 同步到本机数据目录，数组和 customers 对象都认', async (t) => {
  const { remoteRoot, inboxDir } = await makeRoots(t)
  const customersFile = join(remoteRoot, 'customers.json')
  const rows = [{ id: 'c-0001', short_name: 'acme', repos: { demo: 'acme-demo' } }]
  await writeFile(customersFile, `${JSON.stringify(rows, null, 2)}\n`, 'utf8')
  const customersPath = join(inboxDir, 'data', 'customers.json')
  const remote = createDirRemote(remoteRoot, { customersFile })

  const result = await pullInbox({ remote, inboxDir, customersPath })
  assert.equal(result.customers.path, customersPath)
  assert.deepEqual(JSON.parse(await readFile(customersPath, 'utf8')), rows)

  const subset = { customers: rows }
  await writeFile(customersFile, `${JSON.stringify(subset, null, 2)}\n`, 'utf8')
  const second = await pullInbox({ remote, inboxDir, customersPath })
  assert.equal(second.customers.error, undefined)
  assert.deepEqual(JSON.parse(await readFile(customersPath, 'utf8')), subset)
})

test('customers.json 拉取失败时保留上一份并记 warning', async (t) => {
  const { remoteRoot, inboxDir } = await makeRoots(t)
  const customersPath = join(inboxDir, 'data', 'customers.json')
  await mkdir(join(inboxDir, 'data'), { recursive: true })
  await writeFile(customersPath, '[{"id":"old"}]\n', 'utf8')

  const missing = await pullInbox({
    remote: createDirRemote(remoteRoot, { customersFile: join(remoteRoot, 'missing.json') }),
    inboxDir,
    customersPath,
  })
  assert.match(missing.customers.error, /ENOENT/)
  assert.equal(await readFile(customersPath, 'utf8'), '[{"id":"old"}]\n')

  const badFile = join(remoteRoot, 'bad-customers.json')
  await writeFile(badFile, '不是 JSON\n', 'utf8')
  const badJson = await pullInbox({
    remote: createDirRemote(remoteRoot, { customersFile: badFile }),
    inboxDir,
    customersPath,
  })
  assert.ok(badJson.customers.error)
  assert.equal(await readFile(customersPath, 'utf8'), '[{"id":"old"}]\n')
})

test('通知失败时保留远端目录，下次重试', async (t) => {
  const { remoteRoot, inboxDir } = await makeRoots(t)
  await seedUpload(remoteRoot, 'upload-alert', {
    status: 'imported',
    operator_alert: { reason: 'needs_operator', message: '地图是旧格式', at: '2026-11-16T12:00:00Z' },
  })
  let attempts = 0
  const notify = async () => {
    attempts += 1
    if (attempts === 1) throw new Error('通知命令没装')
  }

  await pullInbox({ remote: createDirRemote(remoteRoot), inboxDir, notify })
  await stat(join(remoteRoot, 'upload-alert', 'package.zip'))
  const archive = JSON.parse(await readFile(join(inboxDir, 'upload-alert', 'archived.json'), 'utf8'))
  assert.match(archive.notify_error, /通知命令没装/)

  await pullInbox({ remote: createDirRemote(remoteRoot), inboxDir, notify })
  assert.equal(attempts, 2)
  await assert.rejects(stat(join(remoteRoot, 'upload-alert')))
})

test('import_failed 的上传转发通知，重复跑不重复发', async (t) => {
  const { remoteRoot, inboxDir } = await makeRoots(t)
  await seedUpload(remoteRoot, 'upload-import-failed', {
    status: 'import_failed',
    operator_alert: {
      reason: 'import_failed',
      message: 'customers.json 里找不到客户 a-0001',
      at: '2026-11-20T10:21:04Z',
    },
  })
  const notified = []
  const notify = async (payload) => notified.push(payload)

  await pullInbox({ remote: createDirRemote(remoteRoot), inboxDir, notify })
  assert.equal(notified.length, 1, '导入失败要发通知')
  assert.equal(notified[0].meta.status, 'import_failed')

  await pullInbox({ remote: createDirRemote(remoteRoot), inboxDir, notify })
  assert.equal(notified.length, 1, '同一上传只发一次')
})

test('needs_operator 的上传带 operator_alert 时也转发通知', async (t) => {
  const { remoteRoot, inboxDir } = await makeRoots(t)
  await seedUpload(remoteRoot, 'upload-locked', {
    status: 'needs_operator',
    operator_alert: { reason: 'requirement_locked', message: '需求已锁单', at: '2026-11-20T10:21:04Z' },
  })
  const notified = []
  await pullInbox({
    remote: createDirRemote(remoteRoot),
    inboxDir,
    notify: async (payload) => notified.push(payload),
  })
  assert.equal(notified.length, 1)
})

test('import_partial 的上传存档，并把部分失败发给运营者', async (t) => {
  const { remoteRoot, inboxDir } = await makeRoots(t)
  await seedUpload(remoteRoot, 'upload-partial', {
    status: 'import_partial',
    operator_alert: {
      reason: 'import_partial',
      message: '订单 o-0001「demo」：建单炸了',
      at: '2026-11-20T10:21:04Z',
    },
  })
  const notified = []

  const result = await pullInbox({
    remote: createDirRemote(remoteRoot),
    inboxDir,
    notify: async (payload) => notified.push(payload),
  })

  assert.deepEqual(result.pulled, ['upload-partial'])
  assert.equal(notified.length, 1)
  assert.equal(notified[0].meta.status, 'import_partial')
  assert.equal(notified[0].alert.reason, 'import_partial')
  const archive = JSON.parse(
    await readFile(join(inboxDir, 'upload-partial', 'archived.json'), 'utf8'),
  )
  assert.equal(archive.status, 'import_partial')
  assert.ok(archive.notified_at)
  await stat(join(remoteRoot, 'upload-partial', 'package.zip'))
})

test('importEvent 事件名是 import_failed，key 带上传号，occurred_at 用告警时间', () => {
  const event = importEvent({
    meta: {
      id: 'upload-import-failed',
      status: 'import_failed',
      user: { short_name: 'acme' },
      requirements: [{ name: 'demo' }],
    },
    alert: {
      reason: 'import_failed',
      message: 'customers.json 里找不到客户 a-0001',
      at: '2026-11-20T10:21:04Z',
    },
    link: 'https://afkfactory.space/app/admin',
  })
  assert.equal(event.event, 'import_failed')
  assert.equal(event.key, 'inbox:upload-import-failed:import_failed')
  assert.equal(event.occurred_at, '2026-11-20T10:21:04.000Z')
  assert.equal(event.data.customer, 'acme')
  assert.equal(event.data.requirement, 'demo')
  assert.equal(event.data.reason, 'import_failed')
  assert.match(event.data.tried, /找不到客户/)
  assert.equal(event.link, 'https://afkfactory.space/app/admin')
})

test('其他带 operator_alert 的状态仍按出事事件通知', () => {
  const event = importEvent({
    meta: { id: 'upload-locked', status: 'needs_operator', requirements: [] },
    alert: { reason: 'requirement_locked', message: '需求已锁单', at: '2026-11-20T10:21:04Z' },
  })
  assert.equal(event.event, '出事')
  assert.equal(event.key, 'inbox:upload-locked:出事:requirement_locked')
  assert.equal(event.data.reason, 'requirement_locked')
})
