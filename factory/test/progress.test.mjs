import assert from 'node:assert/strict'
import test from 'node:test'
import { parseProgress, progressLine } from '../lib/progress.mjs'

test('进度行逐字段：路径、客户档、细阶段、轮次、卡住', () => {
  const line = progressLine({
    path: '其余',
    tier: '安排中',
    step: '写规格',
    round: 1,
    stuck: false,
  })
  assert.equal(line, '进度 v1｜路径：其余｜客户档：安排中｜细阶段：写规格｜轮次：1｜卡住：否')

  const parsed = parseProgress(line)
  assert.equal(parsed.path, '其余')
  assert.equal(parsed.tier, '安排中')
  assert.equal(parsed.sub, '写规格')
  assert.equal(parsed.progress, '')
  assert.equal(parsed.round, 1)
  assert.equal(parsed.stuck, false)
  assert.equal(parsed.note, '')
})

test('默认路径是其余，卡住默认否', () => {
  const line = progressLine({ tier: '开发中', step: '开工', round: 2 })
  assert.equal(line, '进度 v1｜路径：其余｜客户档：开发中｜细阶段：开工｜轮次：2｜卡住：否')
})

test('小需求路径写小需求', () => {
  const line = progressLine({
    path: '小需求',
    tier: '开发中',
    step: '开工',
    round: 1,
    stuck: false,
  })
  assert.equal(parseProgress(line).path, '小需求')
})

test('卡住和备注可写', () => {
  const line = progressLine({
    path: '其余',
    tier: '安排中',
    step: '技术闸门',
    round: 3,
    stuck: true,
    note: '等运营者答技术闸门',
  })
  assert.equal(
    line,
    '进度 v1｜路径：其余｜客户档：安排中｜细阶段：技术闸门｜轮次：3｜卡住：是｜备注：等运营者答技术闸门',
  )
  const parsed = parseProgress(line)
  assert.equal(parsed.stuck, true)
  assert.equal(parsed.note, '等运营者答技术闸门')
})

test('细阶段后面的进度数单独解析', () => {
  const parsed = parseProgress('进度 v1｜路径：其余｜客户档：开发中｜细阶段：子票开发 2/4｜轮次：2｜卡住：否')
  assert.equal(parsed.sub, '子票开发')
  assert.equal(parsed.progress, '2/4')
  assert.equal(parsed.round, 2)
})

test('不是进度行返回 null', () => {
  assert.equal(parseProgress('普通评论'), null)
  assert.equal(parseProgress('进度 v1｜客户档：安排中'), null)
  assert.equal(parseProgress(''), null)
  assert.equal(parseProgress(null), null)
})
