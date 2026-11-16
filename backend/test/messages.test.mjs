import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { publicOrder } from '../lib/orders.mjs'
import { writeJsonAtomic } from '../lib/store.mjs'
import {
  login,
  PASSWORD,
  makeConfig,
  seedAdmin,
  seedCustomer,
  startFakeGithub,
  startServer,
} from './helpers.mjs'

const LINE = (tier, sub) =>
  `进度 v1｜路径：其余｜客户档：${tier}｜细阶段：${sub}｜轮次：1｜卡住：否`

async function seedOrder(config, overrides = {}) {
  const order = {
    id: 'o-0001',
    number: 'o-0001',
    customer_id: 'c-0001',
    customer_snapshot: {
      id: 'c-0001',
      short_name: 'acme',
      display_name: 'Acme 老板',
      email: 'boss@example.com',
    },
    requirement: '预约取货',
    title: '预约取货',
    product: 'shuiguo',
    created_at: '2026-11-15T08:00:00Z',
    updated_at: '2026-11-15T09:00:00Z',
    uploads: [{ at: '2026-11-15T09:00:00Z', passed: true }],
    validation: { passed: true },
    transitions: [
      { at: '2026-11-15T09:00:00Z', line: LINE('已收到', '收包') },
      { at: '2026-11-15T09:00:01Z', line: LINE('已收到', '校验') },
    ],
    issue: null,
    delivery: '',
    delivery_url: '',
    trial: [],
    feedback: '',
    missing: [],
    messages: [],
    closed_at: null,
    uploaded_at: '2026-11-15T09:00:00Z',
    ...overrides,
  }
  await writeJsonAtomic(join(config.dataDir, 'orders', 'o-0001.json'), order)
  return order
}

function mark(base, cookie, body) {
  return fetch(`${base}/app/api/admin/orders/o-0001/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: base,
      Cookie: cookie,
    },
    body: JSON.stringify(body),
  })
}

test('标记已发只记一条，客户不能标，类型和锚点要校验', async () => {
  const { config } = await makeConfig()
  await seedCustomer(config)
  await seedAdmin(config)
  await seedOrder(config)
  const server = await startServer(config)
  try {
    const customer = await login(server.base)
    const denied = await mark(server.base, customer.cookie, {
      type: '校验未通过',
      anchor: '2026-11-15T09:00:00Z',
    })
    assert.equal(denied.status, 403)

    const admin = await login(server.base, 'admin@example.com', PASSWORD)
    const first = await mark(server.base, admin.cookie, {
      type: '校验未通过',
      anchor: '2026-11-15T09:00:00Z',
    })
    assert.equal(first.status, 200)
    assert.equal((await first.json()).messages.length, 1)

    const duplicate = await mark(server.base, admin.cookie, {
      type: '校验未通过',
      anchor: '2026-11-15T09:00:00Z',
    })
    assert.equal((await duplicate.json()).messages.length, 1)

    const second = await mark(server.base, admin.cookie, {
      type: '待客户验收',
      anchor: '1',
    })
    assert.equal((await second.json()).messages.length, 2)

    const badType = await mark(server.base, admin.cookie, {
      type: '随便',
      anchor: '1',
    })
    assert.equal(badType.status, 400)

    const badAnchor = await mark(server.base, admin.cookie, { type: '待客户验收', anchor: '' })
    assert.equal(badAnchor.status, 400)

    const saved = JSON.parse(
      await readFile(join(config.dataDir, 'orders', 'o-0001.json'), 'utf8'),
    )
    assert.equal(saved.messages.length, 2)
    assert.equal(saved.messages[0].type, '校验未通过')
    assert.ok(saved.messages[0].at)

    const list = await fetch(`${server.base}/app/api/admin/orders`, {
      headers: { Cookie: admin.cookie },
    })
    const body = await list.json()
    assert.equal(body.orders[0].messages.length, 2)
    assert.equal(body.orders[0].last_upload_at, '2026-11-15T09:00:00Z')
  } finally {
    await server.close()
  }
})

test('管理员列表把工单评论和订单记录拼起来，关票后推成已完成', async (t) => {
  const fake = await startFakeGithub({
    issue: { state: 'closed', closed_at: '2026-11-16T10:00:00Z' },
    comments: [
      {
        created_at: '2026-11-15T10:00:00Z',
        body: LINE('待客户验收', '等试用'),
      },
    ],
  })
  t.after(() => fake.close())

  const { config } = await makeConfig({
    GITHUB_TOKEN: 'test-token',
    GITHUB_API: fake.base,
  })
  const customer = await seedCustomer(config)
  await seedAdmin(config)
  await seedOrder(config, {
    issue: { owner: 'acme', repo: 'demo', number: 7 },
    customer_id: customer.id,
  })
  const server = await startServer(config)
  try {
    const admin = await login(server.base, 'admin@example.com', PASSWORD)
    const response = await fetch(`${server.base}/app/api/admin/orders`, {
      headers: { Cookie: admin.cookie },
    })
    const body = await response.json()
    const last = body.orders[0].transitions.at(-1)
    assert.ok(last.line.includes('客户档：已完成'))
    assert.equal(last.at, '2026-11-16T10:00:00Z')
    assert.equal(body.orders[0].issue_url, 'https://github.com/acme/demo/issues/7')
  } finally {
    await server.close()
  }
})

test('客户订单接口不返回管理用的 messages', async () => {
  const { config } = await makeConfig()
  const customer = await seedCustomer(config)
  await seedOrder(config)
  const server = await startServer(config)
  try {
    const session = await login(server.base)
    const response = await fetch(`${server.base}/app/api/orders`, {
      headers: { Cookie: session.cookie },
    })
    const body = await response.json()
    assert.equal(body.orders[0].id, 'o-0001')
    assert.equal(Object.hasOwn(body.orders[0], 'messages'), false)
    assert.equal(publicOrder(body.orders[0]).id, 'o-0001')
    assert.equal(customer.id, 'c-0001')
  } finally {
    await server.close()
  }
})
