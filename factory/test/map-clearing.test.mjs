import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MapClearingError,
  PROTOCOL_MARKER,
  addNextTicket,
  addProtocolMarker,
  appendDecision,
  appendOutOfScope,
  appendUnsettledNote,
  conclusionOf,
  hasProtocol,
  itemsOf,
  nextTicketNumber,
  removeFogItem,
  removeNextTicket,
  renderDecisionTicket,
  sectionText,
  strictGate,
} from '../lib/map-clearing.mjs'

const PARENT_URL = 'https://github.com/acme/acme-shuiguo/issues/1'
const FACTORY_COMMENT = `<!-- factory:parent=${PARENT_URL} -->`

function mapBody({
  fog = ['送货范围怎么定', '起送价多少（你答）'],
  next = '',
  decisions = '- 01 先做哪一版：先做取货',
  notes = `- 父工单：${PARENT_URL}\n- 老板一个人看店`,
} = {}) {
  const sections = {
    Destination: '卖水果',
    Notes: notes,
    接下来: next,
    'Decisions so far': decisions,
    'Not yet specified': fog.map((item) => `- ${item}`).join('\n'),
    'Out of scope': '- 会员积分',
  }
  const text = Object.entries(sections)
    .map(([heading, content]) => (content ? `## ${heading}\n\n${content}` : `## ${heading}`))
    .join('\n\n')
  return `${text}\n\n${FACTORY_COMMENT}\n`
}

const CLEAN_SUB_ISSUES = [{ number: 3, title: '01 先做哪一版', state: 'closed' }]
const CLEAN_COMMENTS = { 3: [{ body: '结论：先做取货' }] }

function cleanBody() {
  return mapBody({
    fog: [],
    next: '',
    decisions: '- 01 先做哪一版：先做取货',
    notes: `- 父工单：${PARENT_URL}\n- 未定：起送价（运营者回话，下周定）`,
  })
}

test('sectionText 读六段，最后一段不带工厂注释', () => {
  const body = mapBody()
  assert.equal(sectionText(body, 'Destination'), '卖水果')
  assert.equal(sectionText(body, 'Out of scope'), '- 会员积分')
  assert.equal(sectionText(body, '没有这段'), null)
  assert.deepEqual(itemsOf(sectionText(body, 'Not yet specified')), ['送货范围怎么定', '起送价多少（你答）'])
})

test('hasProtocol 只看 Notes 段；addProtocolMarker 只加一次', () => {
  const body = mapBody()
  assert.equal(hasProtocol(body), false)

  const added = addProtocolMarker(body)
  assert.equal(hasProtocol(added), true)
  assert.equal(added.split('\n').filter((line) => line.trim() === PROTOCOL_MARKER).length, 1)
  assert.match(sectionText(added, 'Notes'), new RegExp(`^- 父工单：${PARENT_URL}$`, 'm'))
  assert.match(sectionText(added, 'Notes'), /^- 老板一个人看店$/m)

  const again = addProtocolMarker(added)
  assert.equal(again.split('\n').filter((line) => line.trim() === PROTOCOL_MARKER).length, 1)
})

test('removeFogItem 按整项文本删，忽略首尾空白，找不到抛 MapClearingError', () => {
  const body = mapBody()
  const removed = removeFogItem(body, '  送货范围怎么定  ')
  assert.deepEqual(itemsOf(sectionText(removed, 'Not yet specified')), ['起送价多少（你答）'])
  assert.match(removed, /- 会员积分/)
  assert.match(removed, new RegExp(FACTORY_COMMENT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

  assert.throws(() => removeFogItem(body, '送货范围'), MapClearingError)
  assert.throws(() => removeFogItem(body, '送货范围'), /Not yet specified 里找不到这一项/)
  // 找不到时整段不动
  assert.equal(body.includes('- 送货范围怎么定'), true)
})

test('addNextTicket 加「第 NN 张」行，重复跑不重复加，「无」被替换', () => {
  const body = mapBody()
  const added = addNextTicket(body, '6', '送货范围怎么定')
  assert.match(sectionText(added, '接下来'), /^- 第 06 张：送货范围怎么定$/m)
  const twice = addNextTicket(added, '06', '送货范围怎么定')
  assert.equal((twice.match(/第 06 张：送货范围怎么定/g) || []).length, 1)

  const placeholder = mapBody({ next: '- 无' })
  const replaced = addNextTicket(placeholder, '07', '起送价多少（你答）')
  assert.doesNotMatch(sectionText(replaced, '接下来'), /^- 无$/m)
  assert.match(sectionText(replaced, '接下来'), /^- 第 07 张：起送价多少（你答）$/m)
})

test('removeNextTicket 按 NN 匹配，标题改过也能删，不误删别的票', () => {
  const body = mapBody({ next: '- 第 06 张：旧标题\n- 第 10 张：另一张' })
  const removed = removeNextTicket(body, 6, '标题已经改过')
  assert.deepEqual(itemsOf(sectionText(removed, '接下来')), ['第 10 张：另一张'])

  const missing = removeNextTicket(body, '07', '别的票')
  assert.equal(missing, body)
})

test('addNextTicket 同一 NN 只留一行，标题变了就替换', () => {
  const body = mapBody({ next: '- 第 05 张：别的票\n- 第 06 张：旧标题' })
  const updated = addNextTicket(body, 6, '送货范围怎么定')
  assert.deepEqual(itemsOf(sectionText(updated, '接下来')), [
    '第 05 张：别的票',
    '第 06 张：送货范围怎么定',
  ])
  assert.equal(addNextTicket(updated, '06', '送货范围怎么定'), updated)
})

test('appendOutOfScope 追加一行并去重，保留最后的工厂注释', () => {
  const body = mapBody()
  const updated = appendOutOfScope(body, '会员积分', '本版不做')
  assert.match(sectionText(updated, 'Out of scope'), /^- 会员积分$/m)
  assert.match(sectionText(updated, 'Out of scope'), /^- 会员积分（本版不做：本版不做）$/m)
  assert.match(updated, new RegExp(`${FACTORY_COMMENT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))

  const twice = appendOutOfScope(updated, '会员积分', '本版不做')
  assert.equal((twice.match(/会员积分（本版不做：本版不做）/g) || []).length, 1)
})

test('appendUnsettledNote 按未定行格式写入 Notes', () => {
  const body = mapBody()
  const updated = appendUnsettledNote(body, '起送价多少（你答）', '运营者', '下周定')
  assert.match(sectionText(updated, 'Notes'), /^- 未定：起送价多少（你答）（运营者，下周定）$/m)
  const twice = appendUnsettledNote(updated, '起送价多少（你答）', '运营者', '下周定')
  assert.equal((twice.match(/未定：起送价多少（你答）/g) || []).length, 1)
})

test('appendDecision 没有旧行就追加，有旧行就替换，不留两行', () => {
  const empty = mapBody({ decisions: '' })
  const added = appendDecision(empty, '01 先做哪一版', '先做取货')
  assert.deepEqual(itemsOf(sectionText(added, 'Decisions so far')), ['01 先做哪一版：先做取货'])
  assert.equal(appendDecision(added, '01 先做哪一版', '先做取货'), added)

  const changed = appendDecision(added, '01 先做哪一版', '改成送货上门')
  assert.deepEqual(itemsOf(sectionText(changed, 'Decisions so far')), ['01 先做哪一版：改成送货上门'])

  const body = mapBody({
    decisions: '- 01 先做哪一版：旧结论\n- 02 下单要不要先付钱：先付',
  })
  const updated = appendDecision(body, '01 先做哪一版', '新结论')
  assert.deepEqual(itemsOf(sectionText(updated, 'Decisions so far')), [
    '01 先做哪一版：新结论',
    '02 下单要不要先付钱：先付',
  ])

  const duplicated = mapBody({
    decisions: '- 01 先做哪一版：旧结论\n- 01 先做哪一版：更旧',
  })
  const deduped = appendDecision(duplicated, '01 先做哪一版', '新结论')
  assert.deepEqual(itemsOf(sectionText(deduped, 'Decisions so far')), ['01 先做哪一版：新结论'])
})

test('nextTicketNumber 取最大编号加一，两位补零', () => {
  assert.equal(nextTicketNumber([]), '01')
  assert.equal(nextTicketNumber(['01 甲', '03 乙']), '04')
  assert.equal(nextTicketNumber(['09 甲']), '10')
  assert.equal(nextTicketNumber(['#7 甲', '没有编号的票']), '08')
})

test('renderDecisionTicket 标题带两位编号，正文三段且评论结论为空', () => {
  const { title, body } = renderDecisionTicket({ number: '6', title: '送货范围怎么定', question: '送货送到哪？' })
  assert.equal(title, '06 送货范围怎么定')
  assert.match(body, /^## Question\n\n送货送到哪？\n\n## 评论\n\n## 结论$/)
})

test('conclusionOf 取第一条第一行的「结论：」', () => {
  assert.equal(conclusionOf([{ body: '结论：先做取货\n\n细节' }]), '先做取货')
  assert.equal(conclusionOf(['客户原话：...', '结论：后面这条']), '后面这条')
  assert.equal(conclusionOf([{ body: '结论：' }]), '')
  assert.equal(conclusionOf([{ body: '客户原话' }]), '')
  assert.equal(conclusionOf([]), '')
})

test('strictGate：地图清完、票全关、结论和 Decisions 都在时通过', () => {
  const gate = strictGate({
    body: cleanBody(),
    subIssues: CLEAN_SUB_ISSUES,
    commentsByTicket: CLEAN_COMMENTS,
  })
  assert.deepEqual(gate, { ready: true, blockers: [] })
})

test('strictGate：雾没清、票没关时报 not-yet-specified 和 open-ticket', () => {
  const gate = strictGate({
    body: mapBody(),
    subIssues: [
      { number: 3, title: '01 先做哪一版', state: 'closed' },
      { number: 4, title: '02 下单要不要先付钱', state: 'open' },
    ],
    commentsByTicket: CLEAN_COMMENTS,
  })
  assert.equal(gate.ready, false)
  const kinds = gate.blockers.map((row) => row.kind)
  assert.equal(kinds.filter((kind) => kind === 'not-yet-specified').length, 2)
  assert.equal(kinds.filter((kind) => kind === 'open-ticket').length, 1)
  assert.deepEqual(
    gate.blockers.filter((row) => row.kind === 'open-ticket').map((row) => row.number),
    [4],
  )
})

test('strictGate：关闭的票缺结论时报 missing-conclusion，不报 decisions-missing', () => {
  const gate = strictGate({
    body: mapBody({ fog: [], next: '', decisions: '' }),
    subIssues: CLEAN_SUB_ISSUES,
    commentsByTicket: {},
  })
  assert.equal(gate.ready, false)
  assert.deepEqual(gate.blockers.map((row) => row.kind), ['missing-conclusion'])
})

test('strictGate：结论有了但 Decisions so far 缺行时报 decisions-missing', () => {
  const gate = strictGate({
    body: mapBody({ fog: [], next: '', decisions: '' }),
    subIssues: CLEAN_SUB_ISSUES,
    commentsByTicket: CLEAN_COMMENTS,
  })
  assert.equal(gate.ready, false)
  assert.deepEqual(gate.blockers.map((row) => row.kind), ['decisions-missing'])
  assert.match(gate.blockers[0].text, /01 先做哪一版：先做取货/)
})

test('strictGate：「接下来」有内容才报 next-not-empty，「无」算空', () => {
  const blocked = strictGate({
    body: mapBody({ next: '- 第 02 张：下单要不要先付钱' }),
    subIssues: CLEAN_SUB_ISSUES,
    commentsByTicket: CLEAN_COMMENTS,
  })
  assert.ok(blocked.blockers.some((row) => row.kind === 'next-not-empty'))

  const allowed = strictGate({
    body: mapBody({ fog: [], next: '- 无' }),
    subIssues: CLEAN_SUB_ISSUES,
    commentsByTicket: CLEAN_COMMENTS,
  })
  assert.deepEqual(allowed, { ready: true, blockers: [] })
})

test('strictGate：未定行没有非空括号时报 unsettled-without-next', () => {
  for (const notes of [
    `- 父工单：${PARENT_URL}\n- 未定：起送价`,
    `- 父工单：${PARENT_URL}\n- 未定：起送价（）`,
  ]) {
    const gate = strictGate({
      body: mapBody({ fog: [], next: '', notes }),
      subIssues: CLEAN_SUB_ISSUES,
      commentsByTicket: CLEAN_COMMENTS,
    })
    assert.equal(gate.ready, false, notes)
    assert.deepEqual(gate.blockers.map((row) => row.kind), ['unsettled-without-next'], notes)
  }
})
