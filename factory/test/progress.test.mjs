import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clientRound,
  NOTE_LIMIT,
  parseProgress,
  progressComment,
  progressLine,
  reasonDetails,
  visibleNote,
} from '../lib/progress.mjs'

test('进度行逐字段：路径、客户视角、细阶段、票、轮次、卡住', () => {
  const line = progressLine({
    path: '其余',
    tier: '安排中',
    step: '写规格',
    ticket: 12,
    round: 1,
    stuck: false,
  })
  assert.equal(
    line,
    '进度｜路径：其余｜客户视角：安排中｜细阶段：写规格｜票：12｜轮次：1｜卡住：否',
  )

  const parsed = parseProgress(line)
  assert.equal(parsed.path, '其余')
  assert.equal(parsed.tier, '安排中')
  assert.equal(parsed.sub, '写规格')
  assert.equal(parsed.progress, '')
  assert.equal(parsed.ticket, 12)
  assert.equal(parsed.round, 1)
  assert.equal(parsed.stuck, false)
  assert.equal(parsed.note, '')
})

test('默认路径是其余，卡住默认否，不传票号不写票', () => {
  const line = progressLine({ tier: '开发中', step: '开工', round: 2 })
  assert.equal(line, '进度｜路径：其余｜客户视角：开发中｜细阶段：开工｜轮次：2｜卡住：否')
  assert.equal(parseProgress(line).ticket, undefined)
})

test('小需求路径写小需求', () => {
  const line = progressLine({
    path: '小需求',
    tier: '开发中',
    step: '开工',
    ticket: 3,
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
    '进度｜路径：其余｜客户视角：安排中｜细阶段：技术闸门｜轮次：3｜卡住：是｜备注：等运营者答技术闸门',
  )
  const parsed = parseProgress(line)
  assert.equal(parsed.stuck, true)
  assert.equal(parsed.note, '等运营者答技术闸门')
})

test('细阶段后面的进度数单独解析', () => {
  const parsed = parseProgress(
    '进度｜路径：其余｜客户视角：开发中｜细阶段：子票开发 2/4｜票：12｜轮次：2｜卡住：否',
  )
  assert.equal(parsed.sub, '子票开发')
  assert.equal(parsed.progress, '2/4')
  assert.equal(parsed.ticket, 12)
  assert.equal(parsed.round, 2)
})

test('旧写法仍能解析，票号是 undefined', () => {
  const parsed = parseProgress(
    '进度 v1｜路径：其余｜客户档：开发中｜细阶段：合分支｜轮次：5｜卡住：否',
  )
  assert.equal(parsed.tier, '开发中')
  assert.equal(parsed.sub, '合分支')
  assert.equal(parsed.round, 5)
  assert.equal(parsed.ticket, undefined)
})

test('新旧前缀和字段混写也能解析', () => {
  const a = parseProgress('进度｜路径：其余｜客户档：开发中｜细阶段：开工｜轮次：1｜卡住：否')
  assert.equal(a.tier, '开发中')
  const b = parseProgress('进度 v1｜路径：其余｜客户视角：开发中｜细阶段：开工｜轮次：1｜卡住：否')
  assert.equal(b.tier, '开发中')
})

test('不是进度行返回 null', () => {
  assert.equal(parseProgress('普通评论'), null)
  assert.equal(parseProgress('进度｜客户视角：安排中'), null)
  assert.equal(parseProgress('进度 v1｜客户档：安排中'), null)
  assert.equal(parseProgress(''), null)
  assert.equal(parseProgress(null), null)
})

test('客户轮次只数不带票号的进度，已驳回加一', () => {
  const comments = (lines) => lines.map((line) => ({ body: line }))
  assert.equal(clientRound([]), 1)
  assert.equal(
    clientRound(
      comments([
        progressLine({ tier: '开发中', step: '开工', ticket: 9, round: 1 }),
        progressLine({ tier: '开发中', step: '评审修复', ticket: 9, round: 1 }),
      ]),
    ),
    1,
    '只有票级进度时按 1',
  )
  assert.equal(
    clientRound(
      comments([
        progressLine({ tier: '安排中', step: '写规格', round: 2 }),
        progressLine({ tier: '开发中', step: '开工', ticket: 9, round: 2 }),
        progressLine({ tier: '已驳回', step: '记驳回', round: 2 }),
      ]),
    ),
    3,
  )
  assert.equal(
    clientRound(
      comments([
        progressLine({ tier: '安排中', step: '写规格', round: 1 }),
        progressLine({ tier: '开发中', step: '开工', ticket: 9, round: 1 }),
      ]),
    ),
    1,
  )
})


test('可见备注按标点截断，总长含省略号不超过 160', () => {
  const long = `${'甲'.repeat(80)}。${'乙'.repeat(80)}`
  assert.ok(long.length > NOTE_LIMIT)
  const note = visibleNote(long)
  assert.ok(note.length <= NOTE_LIMIT)
  assert.ok(note.endsWith('…'))
  assert.ok(note.includes('。'), '切在句号处')

  const semicolon = `${'甲'.repeat(100)}；${'乙'.repeat(100)}`
  assert.ok(visibleNote(semicolon).includes('；'))

  const comma = `${'甲'.repeat(100)}，${'乙'.repeat(100)}`
  assert.ok(visibleNote(comma).includes('，'))
})

test('刚好 160 字不截断', () => {
  const text = '甲'.repeat(NOTE_LIMIT)
  assert.equal(visibleNote(text), text)
  assert.equal(visibleNote(text).endsWith('…'), false)
})

test('没有标点的长备注硬切，末尾也带省略号', () => {
  const note = visibleNote('甲'.repeat(300))
  assert.equal(note.length, NOTE_LIMIT)
  assert.equal(note.slice(0, -1), '甲'.repeat(NOTE_LIMIT - 1))
  assert.ok(note.endsWith('…'))
})

test('折叠区放全部原因，进度行只放可见备注', () => {
  const problems = ['第一条原因'.repeat(30), '第二条原因'.repeat(30), '第三条原因'.repeat(30)]
  const full = problems.join('；')
  const line = progressLine({ tier: '开发中', step: '评审修复', ticket: 12, note: visibleNote(full) })
  const body = progressComment(line, full)
  assert.ok(body.startsWith(line))
  assert.ok(body.includes('<details><summary>完整原因</summary>'))
  for (const problem of problems) assert.ok(body.includes(problem), '折叠区不能只留前两条')
  assert.ok(reasonDetails(full).includes(full))
})
