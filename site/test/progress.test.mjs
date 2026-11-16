import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOrderView, messagesDue, stayDays } from '../src/progress.js'

const line = (tier, sub, round = 1, stuck = false, note = '') =>
  `进度 v1｜路径：其余｜客户档：${tier}｜细阶段：${sub}｜轮次：${round}｜卡住：${
    stuck ? '是' : '否'
  }${note ? `｜备注：${note}` : ''}`

function order(transitions, extra = {}) {
  return {
    title: '预约取货',
    transitions,
    messages: [],
    ...extra,
  }
}

const NOW = Date.parse('2026-11-16T12:00:00Z')

test('校验未通过：锚点是本次上传，标过就不再提示', () => {
  const data = order(
    [
      { at: '2026-11-16T10:00:00Z', line: line('已收到', '收包') },
      { at: '2026-11-16T10:00:01Z', line: line('校验未通过', '等补传') },
    ],
    { lastUploadAt: '2026-11-16T10:00:00Z', uploadedAt: '2026-11-15T08:00:00Z' },
  )
  const view = buildOrderView(data, 'zh')
  const due = messagesDue(data, view, NOW)
  assert.deepEqual(due, { type: '校验未通过', anchor: '2026-11-16T10:00:00Z' })

  data.messages = [{ type: '校验未通过', anchor: '2026-11-16T10:00:00Z' }]
  assert.equal(messagesDue(data, view, NOW), null)
})

test('待客户验收：锚点是轮次，第 2 轮再提示一次', () => {
  const data = order(
    [
      { at: '2026-11-16T10:00:00Z', line: line('已收到', '收包') },
      { at: '2026-11-16T10:00:01Z', line: line('已收到', '校验') },
      { at: '2026-11-16T10:10:00Z', line: line('待客户验收', '等试用', 1) },
    ],
    { messages: [{ type: '待客户验收', anchor: '1' }] },
  )
  const view = buildOrderView(data, 'zh')
  assert.equal(messagesDue(data, view, NOW), null)

  data.messages = []
  assert.deepEqual(messagesDue(data, view, NOW), { type: '待客户验收', anchor: '1' })
})

test('满 24 小时：从最近一次通过校验的上传算，待验收和校验未通过不提醒', () => {
  const base = [
    { at: '2026-11-15T09:00:00Z', line: line('已收到', '收包') },
    { at: '2026-11-15T09:00:01Z', line: line('已收到', '校验') },
    { at: '2026-11-15T10:00:00Z', line: line('安排中', '建单') },
  ]
  const data = order(base, { uploadedAt: '2026-11-15T09:00:01Z' })
  const view = buildOrderView(data, 'zh')
  assert.deepEqual(messagesDue(data, view, NOW), {
    type: '满 24 小时',
    anchor: '2026-11-15T09:00:01Z',
  })

  assert.equal(
    messagesDue(data, view, Date.parse('2026-11-16T08:00:00Z')),
    null,
    '不满 24 小时',
  )
  data.messages = [{ type: '满 24 小时', anchor: '2026-11-15T09:00:01Z' }]
  assert.equal(messagesDue(data, view, NOW), null)

  const awaitingData = order(
    [...base, { at: '2026-11-16T10:00:00Z', line: line('待客户验收', '等试用') }],
    { uploadedAt: '2026-11-15T09:00:01Z' },
  )
  const awaiting = buildOrderView(awaitingData, 'zh')
  assert.deepEqual(messagesDue(awaitingData, awaiting, NOW), {
    type: '待客户验收',
    anchor: '1',
  })
})

test('已完成不提醒；关票推出来的已完成也能识别', () => {
  const data = order(
    [
      { at: '2026-11-16T09:00:00Z', line: line('待客户验收', '等试用') },
      { at: '2026-11-16T11:00:00Z', line: line('已完成', '关单') },
    ],
    { uploadedAt: '2026-11-15T09:00:00Z' },
  )
  const view = buildOrderView(data, 'zh')
  assert.equal(view.tierLabel, '已完成')
  assert.equal(messagesDue(data, view, NOW), null)
})

test('停留天数取当前档这一轮第一次到达', () => {
  const data = order([
    { at: '2026-11-14T10:00:00Z', line: line('已收到', '收包') },
    { at: '2026-11-14T10:00:01Z', line: line('已收到', '校验') },
    { at: '2026-11-14T11:00:00Z', line: line('开发中', '开工') },
  ])
  const view = buildOrderView(data, 'zh')
  assert.equal(stayDays(view, NOW), 2)

  const done = buildOrderView(
    order([
      { at: '2026-11-14T10:00:00Z', line: line('待客户验收', '等试用') },
      { at: '2026-11-15T10:00:00Z', line: line('已完成', '关单') },
    ]),
    'zh',
  )
  assert.equal(stayDays(done, NOW), null)
})
