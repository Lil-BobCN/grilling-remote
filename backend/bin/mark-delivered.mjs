#!/usr/bin/env node
/**
 * 把交付地址写进订单。只写两个键：`delivery` 是地址字符串，`delivery_url` 是完整 URL。
 * 走 `orders.mjs` 的 `updateOrder`：加 `.orders.lock`、原子替换、提交推送私有仓。
 *
 * 用 afkapp 用户跑：
 *   sudo -u afkapp node /data/app/current/bin/mark-delivered.mjs o-0001 acme-shop.afkfactory.space
 *
 * 输出一行 JSON。订单不存在退出 1，参数不对退出 2。
 */
import { loadConfig } from '../lib/config.mjs'
import { updateOrder } from '../lib/orders.mjs'

const ADDRESS_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/
const ORDER_RE = /^o-[A-Za-z0-9._-]+$/

function usage() {
  console.error('用法：mark-delivered.mjs <订单号> <交付地址>')
}

async function main() {
  const [orderId, address] = process.argv.slice(2)
  if (!orderId || !address) {
    usage()
    process.exitCode = 2
    return
  }
  if (!ORDER_RE.test(orderId)) {
    console.error(`订单号不对：${orderId}`)
    process.exitCode = 2
    return
  }
  if (!ADDRESS_RE.test(address)) {
    console.error(`交付地址不对：${address}`)
    process.exitCode = 2
    return
  }

  const config = loadConfig()
  const result = await updateOrder(config, orderId, {
    delivery: address,
    delivery_url: `https://${address}/`,
  })
  if (!result) {
    console.error(`没这个订单：${orderId}`)
    process.exitCode = 1
    return
  }
  console.log(
    JSON.stringify({
      ok: true,
      order: orderId,
      delivery: result.order.delivery,
      delivery_url: result.order.delivery_url,
    }),
  )
}

main().catch((error) => {
  console.error(String(error && error.message ? error.message : error))
  process.exitCode = 1
})
