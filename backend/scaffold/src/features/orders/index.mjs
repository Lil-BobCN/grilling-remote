/**
 * 下单和取货名额。名额只存在内存里，重启清零。
 */
export class OrderError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'OrderError'
    this.code = code
  }
}

const PHONE = /^1\d{10}$/

export function createOrderBook({ catalog, now = () => new Date() }) {
  const orders = new Map()
  const taken = new Map()
  let nextNumber = 1

  function remaining(slot) {
    return slot.capacity - (taken.get(slot.id) || 0)
  }

  return {
    listSlots() {
      return catalog.listSlots().map((slot) => {
        const left = remaining(slot)
        return { ...slot, remaining: Math.max(left, 0), full: left <= 0 }
      })
    },
    placeOrder({ phone, slotId }) {
      const cleanPhone = String(phone || '').trim()
      if (!PHONE.test(cleanPhone)) throw new OrderError('phone-invalid', '手机号要填 11 位数字。')
      const slot = catalog.getSlot(slotId)
      if (!slot) throw new OrderError('slot-missing', '这个取货时段不存在。')
      if (remaining(slot) <= 0) throw new OrderError('slot-full', '这个时段满了，换一个时段。')

      const id = String(nextNumber).padStart(4, '0')
      nextNumber += 1
      const order = {
        id,
        phone: cleanPhone,
        slotId: slot.id,
        slotLabel: slot.label,
        createdAt: now().toISOString(),
      }
      orders.set(id, order)
      taken.set(slot.id, (taken.get(slot.id) || 0) + 1)
      return { ...order }
    },
    getOrder(id) {
      const found = orders.get(String(id))
      return found ? { ...found } : null
    },
  }
}
