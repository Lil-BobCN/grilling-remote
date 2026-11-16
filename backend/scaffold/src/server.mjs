import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { createCatalog } from './features/catalog/index.mjs'
import { createOrderBook } from './features/orders/index.mjs'
import { renderError, renderHome, renderOrder } from './features/pages/index.mjs'

const MAX_BODY = 10 * 1024

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw new Error('请求太大。')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function sendHtml(res, status, html) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(html)
}

export function createApp({ product = '预约取货' } = {}) {
  const catalog = createCatalog()
  const orders = createOrderBook({ catalog })

  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
        return
      }

      if (req.method === 'GET' && url.pathname === '/') {
        sendHtml(res, 200, renderHome({ product, items: catalog.listItems(), slots: orders.listSlots() }))
        return
      }

      if (req.method === 'POST' && url.pathname === '/orders') {
        const form = new URLSearchParams(await readBody(req))
        const order = orders.placeOrder({ phone: form.get('phone'), slotId: form.get('slotId') })
        res.writeHead(303, { Location: `/orders/${order.id}` })
        res.end()
        return
      }

      const match = url.pathname.match(/^\/orders\/(\d+)$/)
      if (req.method === 'GET' && match) {
        const order = orders.getOrder(match[1])
        if (!order) {
          sendHtml(res, 404, renderError('没有这张单', '检查链接，或者重新下单。'))
          return
        }
        sendHtml(res, 200, renderOrder(order))
        return
      }

      sendHtml(res, 404, renderError('页面不存在', '回首页重新开始。'))
    } catch (error) {
      sendHtml(res, 400, renderError('没有下单成功', error.message))
    }
  })
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const port = Number(process.env.PORT || 4317)
  // 本地直接跑默认只听回环；容器里 Dockerfile 设 HOST=0.0.0.0，端口映射才进得来。
  const host = process.env.HOST || '127.0.0.1'
  createApp({ product: process.env.APP_NAME || '预约取货' }).listen(port, host, () => {
    console.log(`应用已启动：http://${host}:${port}`)
  })
}
