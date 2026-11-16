import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { withFileLock } from '../lib/store.mjs'

const execFileAsync = promisify(execFile)
const SCRIPT = fileURLToPath(new URL('../bin/mark-delivered.mjs', import.meta.url))
const ADDRESS = 'acme-shop.afkfactory.space'

async function run(args, env) {
  try {
    const { stdout } = await execFileAsync(process.execPath, [SCRIPT, ...args], {
      env: { ...process.env, ...env },
    })
    return { code: 0, stdout }
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr }
  }
}

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'afk-mark-delivered-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const orders = join(root, 'orders')
  await mkdir(orders, { recursive: true })
  const orderFile = join(orders, 'o-0001.json')
  await writeFile(
    orderFile,
    `${JSON.stringify(
      {
        id: 'o-0001',
        customer_id: 'c-0001',
        customer_snapshot: { short_name: 'acme' },
        product: 'shop',
        requirement: 'yuyue',
        issue: null,
        transitions: [{ tier: '已收到', step: '收包', at: '2026-11-17T00:00:00.000Z' }],
        messages: [],
        created_at: '2026-11-17T00:00:00.000Z',
        updated_at: '2026-11-17T00:00:00.000Z',
      },
      null,
      2,
    )}\n`,
  )
  return { root, orders, orderFile, env: { DATA_DIR: root, AFK_GIT_SYNC: '0' } }
}

test('delivery 和 delivery_url 都写成字符串，其他字段不动', async (t) => {
  const { orderFile, env } = await setup(t)
  const before = JSON.parse(await readFile(orderFile, 'utf8'))
  const result = await run(['o-0001', ADDRESS], env)
  assert.equal(result.code, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.equal(output.delivery, ADDRESS)
  assert.equal(output.delivery_url, `https://${ADDRESS}/`)

  const after = JSON.parse(await readFile(orderFile, 'utf8'))
  assert.equal(after.delivery, ADDRESS)
  assert.equal(after.delivery_url, `https://${ADDRESS}/`)
  assert.equal(typeof after.delivery, 'string')
  assert.equal(typeof after.delivery_url, 'string')
  assert.equal(after.customer_id, before.customer_id)
  assert.equal(after.product, before.product)
  assert.equal(after.requirement, before.requirement)
  assert.deepEqual(after.transitions, before.transitions)
  assert.deepEqual(after.messages, before.messages)
  assert.notEqual(after.updated_at, before.updated_at)
  assert.deepEqual(
    Object.keys(after).sort(),
    [...Object.keys(before), 'delivery', 'delivery_url'].sort(),
  )
})

test('写订单时先拿 .orders.lock，锁没放开就不改文件', async (t) => {
  const { root, orderFile, env } = await setup(t)
  let releaseLock
  const held = new Promise((resolve) => {
    releaseLock = resolve
  })
  const lockRun = withFileLock(join(root, '.orders.lock'), () => held)
  await new Promise((resolve) => setTimeout(resolve, 50))

  const child = run(['o-0001', ADDRESS], env)
  await new Promise((resolve) => setTimeout(resolve, 200))
  const during = JSON.parse(await readFile(orderFile, 'utf8'))
  assert.equal(during.delivery, undefined, '锁还在时不该写文件')

  releaseLock()
  await lockRun
  const result = await child
  assert.equal(result.code, 0, result.stderr)
  const after = JSON.parse(await readFile(orderFile, 'utf8'))
  assert.equal(after.delivery, ADDRESS)
})

test('订单不存在退出 1，订单号或地址不对退出 2', async (t) => {
  const { env } = await setup(t)
  const missing = await run(['o-9999', ADDRESS], env)
  assert.equal(missing.code, 1)
  assert.match(missing.stderr, /没这个订单/)

  const badOrder = await run(['../etc', ADDRESS], env)
  assert.equal(badOrder.code, 2)
  assert.match(badOrder.stderr, /订单号不对/)

  const badAddress = await run(['o-0001', '不是地址'], env)
  assert.equal(badAddress.code, 2)
  assert.match(badAddress.stderr, /交付地址不对/)
})
