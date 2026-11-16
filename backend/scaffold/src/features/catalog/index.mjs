/**
 * 今日货品和取货时段。当前是模板数据，接真实数据时改这里。
 */
const DEFAULT_ITEMS = [
  { id: 'apple', name: '苹果', price: 12, unit: '斤', soldOut: false },
  { id: 'orange', name: '橘子', price: 8, unit: '斤', soldOut: true },
  { id: 'banana', name: '香蕉', price: 6, unit: '斤', soldOut: false },
]

const DEFAULT_SLOTS = [
  { id: 's1', label: '今天 16:00-17:00', capacity: 10 },
  { id: 's2', label: '今天 17:00-18:00', capacity: 10 },
  { id: 's3', label: '明天 09:00-10:00', capacity: 5 },
]

export function createCatalog({ items = DEFAULT_ITEMS, slots = DEFAULT_SLOTS } = {}) {
  const goods = items.map((row) => ({ ...row }))
  const pickupSlots = slots.map((row) => ({ ...row }))

  return {
    listItems() {
      return goods.map((row) => ({ ...row }))
    },
    listSlots() {
      return pickupSlots.map((row) => ({ ...row }))
    },
    getSlot(id) {
      const found = pickupSlots.find((row) => row.id === id)
      return found ? { ...found } : null
    },
  }
}
