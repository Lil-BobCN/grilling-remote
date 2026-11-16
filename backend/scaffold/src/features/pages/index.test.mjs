import assert from 'node:assert/strict'
import test from 'node:test'
import { escapeHtml, renderError, renderHome, renderOrder } from './index.mjs'

const items = [
  { id: 'apple', name: '苹果', price: 12, unit: '斤', soldOut: false },
  { id: 'orange', name: '橘子', price: 8, unit: '斤', soldOut: true },
]
const slots = [
  { id: 's1', label: '今天 16:00-17:00', remaining: 3, full: false },
  { id: 's2', label: '今天 17:00-18:00', remaining: 0, full: true },
]

test('首页有货品、价格、卖完标记和下单表单', () => {
  const html = renderHome({ product: '预约取货', items, slots })
  assert.match(html, /预约取货/)
  assert.match(html, /苹果/)
  assert.match(html, /¥12/)
  assert.match(html, /卖完了/)
  assert.match(html, /action="\/orders"/)
})

test('首页只列出没满的时段', () => {
  const html = renderHome({ product: '预约取货', items, slots })
  assert.match(html, /今天 16:00-17:00/)
  assert.doesNotMatch(html, /今天 17:00-18:00/)
})

test('确认页有订好了、单号和取货时间', () => {
  const html = renderOrder({ id: '0001', phone: '13800138000', slotLabel: '今天 16:00-17:00' })
  assert.match(html, /订好了/)
  assert.match(html, /0001/)
  assert.match(html, /今天 16:00-17:00/)
})

test('页面内容被转义', () => {
  assert.equal(escapeHtml('<script>"x"</script>'), '&lt;script&gt;&quot;x&quot;&lt;/script&gt;')
  const html = renderError('出错', '<b>坏</b>')
  assert.match(html, /&lt;b&gt;坏&lt;\/b&gt;/)
})
