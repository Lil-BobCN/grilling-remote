import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { SYNC_ALERT_MS, retryPendingSync } from '../lib/orders.mjs'
import {
  login,
  makeConfig,
  makeWorkspace,
  readZip,
  seedCustomer,
  startServer,
  upload,
} from './helpers.mjs'

const execFileAsync = promisify(execFile)

function git(config, ...args) {
  return execFileAsync('git', ['-C', config.dataDir, ...args])
}

async function setupRepo(config, root) {
  const bare = join(root, 'private.git')
  const offline = join(root, 'offline.git')
  await execFileAsync('git', ['init', '--bare', '-b', 'main', bare])
  await seedCustomer(config)
  await git(config, 'init', '-b', 'main')
  await git(config, 'config', 'user.email', 'test@example.com')
  await git(config, 'config', 'user.name', 'test')
  await git(config, 'add', '-A')
  await git(config, 'commit', '-m', '初始化')
  await git(config, 'remote', 'add', 'origin', offline)
  await git(config, 'config', 'branch.main.remote', 'origin')
  await git(config, 'config', 'branch.main.merge', 'refs/heads/main')
  return { bare, offline }
}

function pendingFile(config, id) {
  return join(config.dataDir, 'orders', `${id}.sync-pending`)
}

function loggedLines(consoleMock) {
  return consoleMock.mock.calls
    .map((call) => {
      try {
        return JSON.parse(call.arguments[0])
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

test('推送失败写待办，上传仍 200，日志记一次失败；远端恢复后补寄成功', async (t) => {
  const { config, root } = await makeConfig({ AFK_GIT_SYNC: '1' })
  const { bare } = await setupRepo(config, root)
  const server = await startServer(config)
  const consoleMock = t.mock.method(console, 'log')
  try {
    const { cookie } = await login(server.base)
    const workspace = await makeWorkspace()

    const response = await upload(server.base, cookie, await readZip(workspace.zipPath))
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.orders[0].id, 'o-0001')

    const record = JSON.parse(await readFile(pendingFile(config, 'o-0001'), 'utf8'))
    assert.equal(record.order_id, 'o-0001')
    assert.equal(record.requirement, 'demo')
    assert.ok(record.failed_at)
    assert.ok(record.last_error.length > 0)

    const warnings = loggedLines(consoleMock).filter(
      (line) => line.level === 'warning' && line.msg === '订单推送私有仓失败，已记待办',
    )
    assert.equal(warnings.length, 1)
    assert.equal(warnings[0].order_id, 'o-0001')

    await git(config, 'remote', 'set-url', 'origin', bare)
    const result = await retryPendingSync(config)
    assert.equal(result.remaining, 0)
    await assert.rejects(stat(pendingFile(config, 'o-0001')))

    const log = await execFileAsync('git', ['-C', bare, 'log', '--oneline', 'main'])
    assert.match(log.stdout, /订单：o-0001/)
    const tree = await execFileAsync('git', ['-C', bare, 'ls-tree', '-r', '--name-only', 'main'])
    assert.match(tree.stdout, /orders\/o-0001\.json/)
    assert.doesNotMatch(tree.stdout, /sync-pending/)
  } finally {
    await server.close()
  }
})

test('重启后待办还在，后台定时补寄成功', async () => {
  const { config, root } = await makeConfig({ AFK_GIT_SYNC: '1', AFK_SYNC_RETRY_MS: '100' })
  const { bare } = await setupRepo(config, root)

  const first = await startServer(config)
  try {
    const { cookie } = await login(first.base)
    const workspace = await makeWorkspace()
    const response = await upload(first.base, cookie, await readZip(workspace.zipPath))
    assert.equal(response.status, 200)
    await stat(pendingFile(config, 'o-0001'))
  } finally {
    await first.close()
  }

  const second = await startServer(config)
  try {
    await stat(pendingFile(config, 'o-0001'))

    await git(config, 'remote', 'set-url', 'origin', bare)
    const deadline = Date.now() + 3000
    let exists = true
    while (Date.now() < deadline && exists) {
      try {
        await stat(pendingFile(config, 'o-0001'))
      } catch {
        exists = false
      }
      if (exists) await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.equal(exists, false)

    const tree = await execFileAsync('git', ['-C', bare, 'ls-tree', '-r', '--name-only', 'main'])
    assert.match(tree.stdout, /orders\/o-0001\.json/)
  } finally {
    await second.close()
  }
})

test('待办超过 10 分钟记 error，恢复后不再报', async (t) => {
  const { config, root } = await makeConfig({ AFK_GIT_SYNC: '1', AFK_SYNC_RETRY_MS: '600000' })
  const { bare } = await setupRepo(config, root)
  const server = await startServer(config)
  const consoleMock = t.mock.method(console, 'log')
  try {
    const { cookie } = await login(server.base)
    const workspace = await makeWorkspace()
    const response = await upload(server.base, cookie, await readZip(workspace.zipPath))
    assert.equal(response.status, 200)

    const record = JSON.parse(await readFile(pendingFile(config, 'o-0001'), 'utf8'))
    const boosted = new Date(Date.parse(record.failed_at) + SYNC_ALERT_MS + 60 * 1000)
    const failed = await retryPendingSync(config, { now: boosted })
    assert.equal(failed.remaining, 1)

    const alerts = () =>
      loggedLines(consoleMock).filter((line) => line.msg === '订单推送私有仓超过 10 分钟未成功')
    assert.equal(alerts().length, 1)
    assert.equal(alerts()[0].level, 'error')
    assert.equal(alerts()[0].order_id, 'o-0001')
    assert.equal(alerts()[0].failed_at, record.failed_at)
    assert.ok(alerts()[0].error)

    await git(config, 'remote', 'set-url', 'origin', bare)
    const recovered = await retryPendingSync(config)
    assert.equal(recovered.remaining, 0)
    await retryPendingSync(config)
    assert.equal(alerts().length, 1)
  } finally {
    await server.close()
  }
})
