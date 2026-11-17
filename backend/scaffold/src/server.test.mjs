import assert from 'node:assert/strict'
import test from 'node:test'
import { createApp } from './server.mjs'

async function start(t) {
  const server = createApp({ product: '预约取货' })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  t.after(() => new Promise((done) => server.close(done)))
  const { port } = server.address()
  return `http://127.0.0.1:${port}`
}

test('首页能打开，列出货品和表单', async (t) => {
  const base = await start(t)
  const response = await fetch(`${base}/`)
  assert.equal(response.status, 200)
  const html = await response.text()
  assert.match(html, /苹果/)
  assert.match(html, /action="\/orders"/)
})

test('下单后跳到确认页，确认页有订好了', async (t) => {
  const base = await start(t)
  const form = new URLSearchParams({ phone: '13800138000', slotId: 's1' })
  const response = await fetch(`${base}/orders`, { method: 'POST', body: form, redirect: 'manual' })
  assert.equal(response.status, 303)
  const location = response.headers.get('location')
  assert.match(location, /^\/orders\/\d{4}$/)

  const page = await fetch(`${base}${location}`)
  assert.equal(page.status, 200)
  const html = await page.text()
  assert.match(html, /订好了/)
  assert.match(html, /今天 16:00-17:00/)
})

test('手机号不对时回 400 并说明原因', async (t) => {
  const base = await start(t)
  const response = await fetch(`${base}/orders`, {
    method: 'POST',
    body: new URLSearchParams({ phone: '123', slotId: 's1' }),
    redirect: 'manual',
  })
  assert.equal(response.status, 400)
  assert.match(await response.text(), /手机号/)
})

test('健康检查返回 ok', async (t) => {
  const base = await start(t)
  const response = await fetch(`${base}/health`)
  assert.deepEqual(await response.json(), { ok: true })
})
