import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { hashPassword } from '../lib/auth.mjs'
import { writeJsonAtomic } from '../lib/store.mjs'
import {
  PASSWORD,
  login,
  makeBigWorkspace,
  makeConfig,
  makeWorkspace,
  makeZipFromEntries,
  readZip,
  seedCustomer,
  startServer,
  upload,
} from './helpers.mjs'

async function orderFile(config, id) {
  return JSON.parse(await readFile(join(config.dataDir, 'orders', `${id}.json`), 'utf8'))
}

test('小需求完整包上传成功，写订单；重传沿用同一张单', async () => {
  const { config } = await makeConfig()
  await seedCustomer(config)
  const server = await startServer(config)
  try {
    const { cookie } = await login(server.base)
    const workspace = await makeWorkspace()

    const first = await upload(server.base, cookie, await readZip(workspace.zipPath))
    assert.equal(first.status, 200)
    const firstBody = await first.json()
    assert.equal(firstBody.orders.length, 1)
    assert.equal(firstBody.orders[0].id, 'o-0001')
    assert.equal(firstBody.orders[0].missing.length, 0)
    assert.equal(firstBody.orders[0].transitions.length, 2)
    assert.match(firstBody.orders[0].transitions[0].line, /客户档：已收到｜细阶段：收包｜轮次：1/)
    assert.ok(firstBody.orders[0].uploaded_at)

    const stored = await orderFile(config, 'o-0001')
    assert.equal(stored.customer_id, 'c-0001')
    assert.equal(stored.requirement, 'demo')
    assert.equal(stored.product, 'demo')
    assert.equal(stored.uploads.length, 1)

    const second = await upload(server.base, cookie, await readZip(workspace.zipPath))
    assert.equal(second.status, 200)
    const secondBody = await second.json()
    assert.equal(secondBody.orders.length, 1)
    assert.equal(secondBody.orders[0].id, 'o-0001')
    assert.equal(secondBody.orders[0].transitions.length, 4)
    assert.match(secondBody.orders[0].transitions[2].line, /轮次：2/)

    const again = await orderFile(config, 'o-0001')
    assert.equal(again.uploads.length, 2)
  } finally {
    await server.close()
  }
})

test('带 软件.md 时订单 product 记软件简称', async () => {
  const { config } = await makeConfig()
  await seedCustomer(config)
  const server = await startServer(config)
  try {
    const { cookie } = await login(server.base)
    const workspace = await makeWorkspace({ software: 'shuiguo\n第二行不读\n' })
    const response = await upload(server.base, cookie, await readZip(workspace.zipPath))
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.orders[0].product, 'shuiguo')
    assert.equal(body.orders[0].requirement, 'demo')
    const stored = await orderFile(config, 'o-0001')
    assert.equal(stored.product, 'shuiguo')
  } finally {
    await server.close()
  }
})

test('空的 软件.md 按没有处理，product 用需求目录名', async () => {
  const { config } = await makeConfig()
  await seedCustomer(config)
  const server = await startServer(config)
  try {
    const { cookie } = await login(server.base)
    const workspace = await makeWorkspace({ software: '' })
    const response = await upload(server.base, cookie, await readZip(workspace.zipPath))
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.orders[0].product, 'demo')
  } finally {
    await server.close()
  }
})

test('没有 软件.md 时按 repos 已知键回退', async () => {
  const { config } = await makeConfig()
  await seedCustomer(config, { repos: { shuiguo: 'acme-shuiguo' } })
  const server = await startServer(config)
  try {
    const { cookie } = await login(server.base)
    const workspace = await makeWorkspace({ name: 'shuiguo-app' })
    const response = await upload(server.base, cookie, await readZip(workspace.zipPath))
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.orders[0].product, 'shuiguo')
    assert.equal(body.orders[0].requirement, 'shuiguo-app')
  } finally {
    await server.close()
  }
})

test('同一客户两个软件可以有相同需求目录名，建两条单', async () => {
  const { config } = await makeConfig()
  await seedCustomer(config)
  const server = await startServer(config)
  try {
    const { cookie } = await login(server.base)
    const first = await makeWorkspace({ software: 'shuiguo\n', name: 'demo' })
    const second = await makeWorkspace({ software: 'kucun\n', name: 'demo' })

    const firstResponse = await upload(server.base, cookie, await readZip(first.zipPath))
    assert.equal(firstResponse.status, 200)
    const secondResponse = await upload(server.base, cookie, await readZip(second.zipPath))
    assert.equal(secondResponse.status, 200)

    const secondBody = await secondResponse.json()
    assert.equal(secondBody.orders[0].id, 'o-0002')
    assert.equal((await orderFile(config, 'o-0001')).product, 'shuiguo')
    assert.equal((await orderFile(config, 'o-0002')).product, 'kucun')
  } finally {
    await server.close()
  }
})

test('同一软件的不同需求目录建新单', async () => {
  const { config } = await makeConfig()
  await seedCustomer(config, { repos: { shuiguo: 'acme-shuiguo' } })
  const server = await startServer(config)
  try {
    const { cookie } = await login(server.base)
    const first = await makeWorkspace({ software: 'shuiguo\n', name: 'demo' })
    const second = await makeWorkspace({ software: 'shuiguo\n', name: 'kucun' })

    await upload(server.base, cookie, await readZip(first.zipPath))
    const order = await orderFile(config, 'o-0001')
    order.closed_at = new Date().toISOString()
    await writeJsonAtomic(join(config.dataDir, 'orders', 'o-0001.json'), order)

    const secondResponse = await upload(server.base, cookie, await readZip(second.zipPath))
    assert.equal(secondResponse.status, 200)
    const secondBody = await secondResponse.json()
    assert.equal(secondBody.orders[0].id, 'o-0002')
    assert.equal(secondBody.orders[0].product, 'shuiguo')
    assert.equal(secondBody.orders[0].requirement, 'kucun')
  } finally {
    await server.close()
  }
})

test('新软件第一次上传多个需求目录返回 422，不建单', async () => {
  const { config } = await makeConfig()
  await seedCustomer(config)
  const server = await startServer(config)
  try {
    const { cookie } = await login(server.base)
    const workspace = await makeWorkspace({ names: ['alpha', 'beta'] })
    const response = await upload(server.base, cookie, await readZip(workspace.zipPath))
    assert.equal(response.status, 422)
    const body = await response.json()
    assert.match(body.message, /第一次上传/)
    assert.match(body.message, /alpha、beta/)
    await assert.rejects(readFile(join(config.dataDir, 'orders', 'o-0001.json')))

    const uploads = (await readdir(config.uploadDir)).filter((name) => name.startsWith('upload-'))
    const metas = await Promise.all(
      uploads.map(async (name) =>
        JSON.parse(await readFile(join(config.uploadDir, name, 'meta.json'), 'utf8')),
      ),
    )
    const failed = metas.find((meta) => meta.status === 'failed')
    assert.equal(failed.operator_alert.reason, 'multiple_new_requirements')
  } finally {
    await server.close()
  }
})

test('软件简称对应的仓名已属于另一个软件时返回 422', async () => {
  const { config } = await makeConfig()
  await seedCustomer(config, { repos: { other: 'acme-shuiguo' } })
  const server = await startServer(config)
  try {
    const { cookie } = await login(server.base)
    const workspace = await makeWorkspace({ software: 'shuiguo\n' })
    const response = await upload(server.base, cookie, await readZip(workspace.zipPath))
    assert.equal(response.status, 422)
    const body = await response.json()
    assert.match(body.message, /acme-shuiguo/)
    await assert.rejects(readFile(join(config.dataDir, 'orders', 'o-0001.json')))
  } finally {
    await server.close()
  }
})

test('软件简称和已有软件只差大小写时返回 422', async () => {
  const { config } = await makeConfig()
  await seedCustomer(config, { repos: { shuiguo: 'acme-shuiguo' } })
  const server = await startServer(config)
  try {
    const { cookie } = await login(server.base)
    const workspace = await makeWorkspace({ software: 'Shuiguo\n' })
    const response = await upload(server.base, cookie, await readZip(workspace.zipPath))
    assert.equal(response.status, 422)
    const body = await response.json()
    assert.match(body.message, /shuiguo/)
    await assert.rejects(readFile(join(config.dataDir, 'orders', 'o-0001.json')))
  } finally {
    await server.close()
  }
})

test('新软件第一次上传多个需求目录，即使有 软件.md 也返回 422', async () => {
  const { config } = await makeConfig()
  await seedCustomer(config)
  const server = await startServer(config)
  try {
    const { cookie } = await login(server.base)
    const workspace = await makeWorkspace({ names: ['alpha', 'beta'], software: 'shuiguo\n' })
    const response = await upload(server.base, cookie, await readZip(workspace.zipPath))
    assert.equal(response.status, 422)
    const body = await response.json()
    assert.match(body.message, /第一次上传/)
    assert.match(body.message, /alpha、beta/)
    assert.match(body.message, /新软件「shuiguo」/)
    await assert.rejects(readFile(join(config.dataDir, 'orders', 'o-0001.json')))
  } finally {
    await server.close()
  }
})

test('当前单未交付时上传里出现新需求目录，整次 422，不建第二单', async () => {
  const { config } = await makeConfig()
  await seedCustomer(config, { repos: { shuiguo: 'acme-shuiguo' } })
  const server = await startServer(config)
  try {
    const { cookie } = await login(server.base)
    const first = await makeWorkspace({ software: 'shuiguo\n', name: 'demo' })
    const created = await upload(server.base, cookie, await readZip(first.zipPath))
    assert.equal(created.status, 200)

    const second = await makeWorkspace({ software: 'shuiguo\n', names: ['demo', 'extra'] })
    const response = await upload(server.base, cookie, await readZip(second.zipPath))
    assert.equal(response.status, 422)
    const body = await response.json()
    assert.match(body.message, /extra/)
    assert.match(body.message, /不能加新的需求目录/)

    await assert.rejects(readFile(join(config.dataDir, 'orders', 'o-0002.json')))
    const stored = await orderFile(config, 'o-0001')
    assert.equal(stored.uploads.length, 1)
  } finally {
    await server.close()
  }
})

test('当前单已关闭后，没有订单的新需求目录建新单', async () => {
  const { config } = await makeConfig()
  await seedCustomer(config, { repos: { shuiguo: 'acme-shuiguo' } })
  const server = await startServer(config)
  try {
    const { cookie } = await login(server.base)
    const first = await makeWorkspace({ software: 'shuiguo\n', name: 'demo' })
    await upload(server.base, cookie, await readZip(first.zipPath))

    const order = await orderFile(config, 'o-0001')
    order.closed_at = new Date().toISOString()
    await writeJsonAtomic(join(config.dataDir, 'orders', 'o-0001.json'), order)

    const second = await makeWorkspace({ software: 'shuiguo\n', name: 'kucun' })
    const response = await upload(server.base, cookie, await readZip(second.zipPath))
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.orders[0].id, 'o-0002')
  } finally {
    await server.close()
  }
})

test('同一需求目录已锁单，重传 422 并提示新建需求目录', async () => {
  const { config } = await makeConfig()
  await seedCustomer(config, { repos: { shuiguo: 'acme-shuiguo' } })
  const server = await startServer(config)
  try {
    const { cookie } = await login(server.base)
    const workspace = await makeWorkspace({ software: 'shuiguo\n', name: 'demo' })
    const bytes = await readZip(workspace.zipPath)
    assert.equal((await upload(server.base, cookie, bytes)).status, 200)

    config.specLock = async ({ requirement }) => requirement === 'demo'
    const response = await upload(server.base, cookie, bytes)
    assert.equal(response.status, 422)
    const body = await response.json()
    assert.match(body.message, /新建需求目录/)

    const stored = await orderFile(config, 'o-0001')
    assert.equal(stored.uploads.length, 1)
  } finally {
    await server.close()
  }
})

test('锁单检查读不到时放行，重传按新一轮记', async () => {
  const { config } = await makeConfig()
  await seedCustomer(config, { repos: { shuiguo: 'acme-shuiguo' } })
  const server = await startServer(config)
  try {
    const { cookie } = await login(server.base)
    const workspace = await makeWorkspace({ software: 'shuiguo\n', name: 'demo' })
    const bytes = await readZip(workspace.zipPath)
    assert.equal((await upload(server.base, cookie, bytes)).status, 200)

    config.specLock = async () => {
      throw new Error('GitHub 读不到')
    }
    const response = await upload(server.base, cookie, bytes)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.match(body.orders[0].transitions[2].line, /轮次：2/)
  } finally {
    await server.close()
  }
})

test('内容不全返回 200 和 missing，补好后同一轮重传', async () => {
  const { config } = await makeConfig()
  await seedCustomer(config)
  const server = await startServer(config)
  try {
    const { cookie } = await login(server.base)
    const incomplete = await makeWorkspace({ complete: false })

    const first = await upload(server.base, cookie, await readZip(incomplete.zipPath))
    assert.equal(first.status, 200)
    const body = await first.json()
    assert.equal(body.orders[0].id, 'o-0001')
    assert.ok(body.orders[0].missing.length > 0)
    assert.equal(body.orders[0].uploaded_at, null)
    assert.match(body.orders[0].transitions[1].line, /客户档：校验未通过/)

    const complete = await makeWorkspace({ complete: true })
    const second = await upload(server.base, cookie, await readZip(complete.zipPath))
    assert.equal(second.status, 200)
    const fixed = await second.json()
    assert.equal(fixed.orders[0].id, 'o-0001')
    assert.equal(fixed.orders[0].missing.length, 0)
    assert.match(fixed.orders[0].transitions[2].line, /轮次：1/)
    assert.ok(fixed.orders[0].uploaded_at)
  } finally {
    await server.close()
  }
})

test('地图型需求完整包通过', async () => {
  const { config } = await makeConfig()
  await seedCustomer(config)
  const server = await startServer(config)
  try {
    const { cookie } = await login(server.base)
    const workspace = await makeWorkspace({ small: false })
    const response = await upload(server.base, cookie, await readZip(workspace.zipPath))
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.orders[0].missing.length, 0)
  } finally {
    await server.close()
  }
})

test('工作区在子目录也能认出来', async () => {
  const { config } = await makeConfig()
  await seedCustomer(config)
  const server = await startServer(config)
  try {
    const { cookie } = await login(server.base)
    const workspace = await makeWorkspace({ nested: true })
    const response = await upload(server.base, cookie, await readZip(workspace.zipPath))
    assert.equal(response.status, 200)
  } finally {
    await server.close()
  }
})

test('没 .scratch 返回 422，不建订单', async () => {
  const { config } = await makeConfig()
  await seedCustomer(config)
  const server = await startServer(config)
  try {
    const { cookie } = await login(server.base)
    const { zipPath } = await makeZipFromEntries([
      { name: 'AGENTS.md', kind: 'file', payload: '# 原始包\n' },
      { name: '.dsh/skills/x/SKILL.md', kind: 'file', payload: 'x' },
    ])
    const response = await upload(server.base, cookie, await readZip(zipPath))
    assert.equal(response.status, 422)
    const body = await response.json()
    assert.ok(body.missing.length > 0)
    assert.match(body.message, /\.scratch/)
    await assert.rejects(readFile(join(config.dataDir, 'orders', 'o-0001.json')))
  } finally {
    await server.close()
  }
})

test('不是 zip 返回 415', async () => {
  const { config } = await makeConfig()
  await seedCustomer(config)
  const server = await startServer(config)
  try {
    const { cookie } = await login(server.base)
    const response = await upload(server.base, cookie, Buffer.from('not a zip'), { filename: 'x.zip' })
    assert.equal(response.status, 415)
  } finally {
    await server.close()
  }
})

test('路径穿越包返回 422', async () => {
  const { config } = await makeConfig()
  await seedCustomer(config)
  const server = await startServer(config)
  try {
    const { cookie } = await login(server.base)
    const { zipPath } = await makeZipFromEntries([
      { name: '../evil.txt', kind: 'file', payload: 'x' },
      { name: '.scratch/demo/需求草稿.md', kind: 'file', payload: 'Status: 已问完\n' },
    ])
    const response = await upload(server.base, cookie, await readZip(zipPath))
    assert.equal(response.status, 422)
    assert.match((await response.json()).message, /不安全/)
  } finally {
    await server.close()
  }
})

test('绝对路径包返回 422', async () => {
  const { config } = await makeConfig()
  await seedCustomer(config)
  const server = await startServer(config)
  try {
    const { cookie } = await login(server.base)
    const { zipPath } = await makeZipFromEntries([
      { name: '/etc/passwd', kind: 'file', payload: 'x' },
    ])
    const response = await upload(server.base, cookie, await readZip(zipPath))
    assert.equal(response.status, 422)
  } finally {
    await server.close()
  }
})

test('解压炸弹按大小上限拒绝', async () => {
  const { config } = await makeConfig({ ZIP_MAX_UNCOMPRESSED: String(1024 * 1024) })
  await seedCustomer(config)
  const server = await startServer(config)
  try {
    const { cookie } = await login(server.base)
    const big = await makeBigWorkspace(2 * 1024 * 1024)
    const response = await upload(server.base, cookie, await readZip(big.zipPath))
    assert.equal(response.status, 422)
    assert.match((await response.json()).message, /太大/)
  } finally {
    await server.close()
  }
})

test('超过 50 MB 上限返回 413', async () => {
  const { config } = await makeConfig({ MAX_UPLOAD_BYTES: String(64 * 1024) })
  await seedCustomer(config)
  const server = await startServer(config)
  try {
    const { cookie } = await login(server.base)
    const bytes = Buffer.alloc(256 * 1024, 1)
    let status = 0
    try {
      const response = await upload(server.base, cookie, bytes)
      status = response.status
    } catch {
      status = 413
    }
    assert.equal(status, 413)
  } finally {
    await server.close()
  }
})

test('未登录上传返回 401', async () => {
  const { config } = await makeConfig()
  await seedCustomer(config)
  const server = await startServer(config)
  try {
    const workspace = await makeWorkspace()
    const response = await upload(server.base, '', await readZip(workspace.zipPath))
    assert.equal(response.status, 401)
  } finally {
    await server.close()
  }
})

test('不带 Origin 的写请求返回 403', async () => {
  const { config } = await makeConfig()
  await seedCustomer(config)
  const server = await startServer(config)
  try {
    const { cookie } = await login(server.base)
    const workspace = await makeWorkspace()
    const response = await upload(server.base, cookie, await readZip(workspace.zipPath), { origin: '' })
    assert.equal(response.status, 403)
  } finally {
    await server.close()
  }
})

test('同一账号上传限速返回 429', async () => {
  const { config } = await makeConfig({ UPLOADS_PER_USER: '2' })
  await seedCustomer(config)
  const server = await startServer(config)
  try {
    const { cookie } = await login(server.base)
    const workspace = await makeWorkspace()
    const bytes = await readZip(workspace.zipPath)
    assert.equal((await upload(server.base, cookie, bytes)).status, 200)
    assert.equal((await upload(server.base, cookie, bytes)).status, 200)
    const limited = await upload(server.base, cookie, bytes)
    assert.equal(limited.status, 429)
  } finally {
    await server.close()
  }
})

test('订单列表和详情只看自己的单', async () => {
  const { config } = await makeConfig()
  await seedCustomer(config)
  const server = await startServer(config)
  try {
    const { cookie } = await login(server.base)
    const workspace = await makeWorkspace()
    await upload(server.base, cookie, await readZip(workspace.zipPath))

    const list = await fetch(`${server.base}/app/api/orders`, { headers: { Cookie: cookie } })
    assert.equal(list.status, 200)
    const body = await list.json()
    assert.equal(body.orders.length, 1)
    assert.equal(body.orders[0].id, 'o-0001')

    const detail = await fetch(`${server.base}/app/api/orders/o-0001`, { headers: { Cookie: cookie } })
    assert.equal(detail.status, 200)

    const missing = await fetch(`${server.base}/app/api/orders/o-9999`, { headers: { Cookie: cookie } })
    assert.equal(missing.status, 404)
  } finally {
    await server.close()
  }
})

test('管理员能看全量订单，客户不能', async () => {
  const { config } = await makeConfig()
  await seedCustomer(config)
  await writeJsonAtomic(join(config.dataDir, 'admins.json'), [
    {
      id: 'a-0001',
      email: 'admin@example.com',
      display_name: '运营者',
      password_hash: await hashPassword(PASSWORD),
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      disabled_at: null,
      disabled_reason: null,
    },
  ])
  const server = await startServer(config)
  try {
    const customer = await login(server.base)
    const denied = await fetch(`${server.base}/app/api/admin/orders`, {
      headers: { Cookie: customer.cookie },
    })
    assert.equal(denied.status, 403)

    const admin = await login(server.base, 'admin@example.com', PASSWORD)
    const allowed = await fetch(`${server.base}/app/api/admin/orders`, {
      headers: { Cookie: admin.cookie },
    })
    assert.equal(allowed.status, 200)
  } finally {
    await server.close()
  }
})

test('未知接口返回 404', async () => {
  const { config } = await makeConfig()
  const server = await startServer(config)
  try {
    const response = await fetch(`${server.base}/app/api/nope`)
    assert.equal(response.status, 404)
  } finally {
    await server.close()
  }
})
