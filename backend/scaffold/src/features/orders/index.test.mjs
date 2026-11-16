import assert from 'node:assert/strict'
import test from 'node:test'
import { createCatalog } from '../catalog/index.mjs'
import { createOrderBook, OrderError } from './index.mjs'

function book() {
  const catalog = createCatalog({
    items: [],
    slots: [
      { id: 's1', label: '今天 16:00-17:00', capacity: 2 },
      { id: 's2', label: '今天 17:00-18:00', capacity: 0 },
    ],
  })
  return { catalog, orders: createOrderBook({ catalog, now: () => new Date('2026-11-17T08:00:00Z') }) }
}

test('填手机号下单，拿到单号和取货时间', () => {
  const { orders } = book()
  const order = orders.placeOrder({ phone: '13800138000', slotId: 's1' })
  assert.equal(order.id, '0001')
  assert.equal(order.slotLabel, '今天 16:00-17:00')
  assert.equal(order.createdAt, '2026-11-17T08:00:00.000Z')
  assert.deepEqual(orders.getOrder('0001'), order)
})

test('时段满了不能下单', () => {
  const { orders } = book()
  orders.placeOrder({ phone: '13800138000', slotId: 's1' })
  orders.placeOrder({ phone: '13800138001', slotId: 's1' })
  assert.throws(
    () => orders.placeOrder({ phone: '13800138002', slotId: 's1' }),
    (error) => error instanceof OrderError && error.code === 'slot-full',
  )
  assert.equal(orders.listSlots()[0].remaining, 0)
  assert.equal(orders.listSlots()[0].full, true)
})

test('手机号不是 11 位不能下单', () => {
  const { orders } = book()
  assert.throws(
    () => orders.placeOrder({ phone: '123', slotId: 's1' }),
    (error) => error instanceof OrderError && error.code === 'phone-invalid',
  )
})

test('时段不存在不能下单', () => {
  const { orders } = book()
  assert.throws(
    () => orders.placeOrder({ phone: '13800138000', slotId: 'nope' }),
    (error) => error instanceof OrderError && error.code === 'slot-missing',
  )
})

test('容量为 0 的时段一开始就是满的', () => {
  const { orders } = book()
  const slot = orders.listSlots().find((row) => row.id === 's2')
  assert.equal(slot.full, true)
  assert.equal(slot.remaining, 0)
})
