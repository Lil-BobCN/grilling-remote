import assert from 'node:assert/strict'
import test from 'node:test'
import { createCatalog } from './index.mjs'

test('默认有今天的货品，卖完的也在名单里', () => {
  const catalog = createCatalog()
  const items = catalog.listItems()
  assert.equal(items.length, 3)
  assert.deepEqual(
    items.map((row) => [row.name, row.soldOut]),
    [
      ['苹果', false],
      ['橘子', true],
      ['香蕉', false],
    ],
  )
})

test('默认有三个取货时段', () => {
  const catalog = createCatalog()
  assert.deepEqual(
    catalog.listSlots().map((row) => row.id),
    ['s1', 's2', 's3'],
  )
})

test('拿到的货品是副本，改它不影响下一次读', () => {
  const catalog = createCatalog()
  const first = catalog.listItems()
  first[0].name = '改过的'
  assert.equal(catalog.listItems()[0].name, '苹果')
})

test('按时段编号取时段，取不到返回 null', () => {
  const catalog = createCatalog()
  assert.equal(catalog.getSlot('s2').label, '今天 17:00-18:00')
  assert.equal(catalog.getSlot('nope'), null)
})
