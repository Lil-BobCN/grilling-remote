import assert from 'node:assert/strict'
import test from 'node:test'
import {
  encodeAcceptance,
  encodeTicketsPayload,
  eventKey,
  parseAcceptance,
  parseCustomerQuote,
  parseProgress,
  parseTicketsPayload,
  progressLine,
  PROGRESS_PREFIX,
} from '../lib/protocol.mjs'

// 以下样例原样抄自仓库现有文件，不改格式迁就新代码。

// docs/回传样例/父工单.md
const PARENT_ISSUE_SAMPLE = `## 客户原话

> 「顾客想在我的微信小程序里看今天有什么水果，下单，选到店取还是送货。我在后台改价格和库存。」

日期：2026-11-08

## 客户确认的结论

- 店里贴二维码，扫进小程序看当天清单。
- 到店取的不先付，取货时付；送货的微信转账。
- 后台首页先看卖完的，改一个价格点两下。
- 取好货后在后台点一下，顾客收到微信通知。
- 推荐微信云开发，等运营者确认

## 验收条件

- [ ] 顾客扫码进小程序，看到当天水果的名单。
- [ ] 卖完的水果标灰，不能下单。
- [ ] 老板在后台改一个价格，点两下改完，顾客那边马上看到。
- [ ] 顾客下单时能选到店取或送货，送货加收 5 元。（人工判断）
- [ ] 老板点「已取货」，顾客收到微信通知。（人工判断）

## 不做清单

- 会员积分
`

// docs/回传样例/工作区/.scratch/xianguopu/问答记录.md 的开头一节
const QUESTIONS_SAMPLE = `# 问答记录

## 客户原话

> 「顾客想在我的微信小程序里看今天有什么水果，下单，选到店取还是送货。我在后台改价格和库存。」

日期：2026-11-08

## 第1轮

Q1：顾客从哪进来？

客户：「店里贴个二维码，扫一下就能看。」
`

// backend/test/parent-issue.test.mjs 里的小需求需求草稿
const DRAFT_SAMPLE = `# 预约取货需求草稿

Status: 已问完

## 1. 客户原话

- 我想要一个预约取货的小程序。

日期：2026-11-15

## 2. 问答记录

Q1：怎么取？

## 3. 已经定下的

- 到店取
- 送货加收 5 元
`

// factory/test/tickets.test.mjs 的三张票
const TICKETS_SAMPLE = [
  {
    title: '顾客打开链接能看到当天水果和卖完的',
    verticalSlice: '顾客打开链接，看到今天的水果、价格和卖完的。',
    acceptance: ['打开链接，看到当天水果的名单。', '卖完的水果标出来，不能下单。'],
    blockedBy: [],
  },
  {
    title: '顾客下单时能选到店取',
    verticalSlice: '顾客下单时能选到店取，挑一个取货时间。',
    acceptance: ['下单时选到店取，挑一个取货时间。'],
    blockedBy: [0],
  },
  {
    title: '下单成功看到订单号和取货地址',
    verticalSlice: '顾客下单成功，看到订单号和取货地址。',
    acceptance: ['下单成功后看到订单号和取货地址。'],
    blockedBy: ['顾客下单时能选到店取'],
  },
]

// 旧实现 factory/lib/tickets.mjs 对 TICKETS_SAMPLE 的输出
const TICKETS_MARKER_SAMPLE =
  '<!-- factory:tickets W3sidGl0bGUiOiLpob7lrqLmiZPlvIDpk77mjqXog73nnIvliLDlvZPlpKnmsLTmnpzlkozljZblroznmoQiLCJ2ZXJ0aWNhbFNsaWNlIjoi6aG-5a6i5omT5byA6ZO-5o6l77yM55yL5Yiw5LuK5aSp55qE5rC05p6c44CB5Lu35qC85ZKM5Y2W5a6M55qE44CCIiwiYWNjZXB0YW5jZSI6WyLmiZPlvIDpk77mjqXvvIznnIvliLDlvZPlpKnmsLTmnpznmoTlkI3ljZXjgIIiLCLljZblroznmoTmsLTmnpzmoIflh7rmnaXvvIzkuI3og73kuIvljZXjgIIiXSwiYmxvY2tlZEJ5IjpbXX0seyJ0aXRsZSI6IumhvuWuouS4i-WNleaXtuiDvemAieWIsOW6l-WPliIsInZlcnRpY2FsU2xpY2UiOiLpob7lrqLkuIvljZXml7bog73pgInliLDlupflj5bvvIzmjJHkuIDkuKrlj5botKfml7bpl7TjgIIiLCJhY2NlcHRhbmNlIjpbIuS4i-WNleaXtumAieWIsOW6l-WPlu-8jOaMkeS4gOS4quWPlui0p-aXtumXtOOAgiJdLCJibG9ja2VkQnkiOlswXX0seyJ0aXRsZSI6IuS4i-WNleaIkOWKn-eci-WIsOiuouWNleWPt-WSjOWPlui0p-WcsOWdgCIsInZlcnRpY2FsU2xpY2UiOiLpob7lrqLkuIvljZXmiJDlip_vvIznnIvliLDorqLljZXlj7flkozlj5botKflnLDlnYDjgIIiLCJhY2NlcHRhbmNlIjpbIuS4i-WNleaIkOWKn-WQjueci-WIsOiuouWNleWPt-WSjOWPlui0p-WcsOWdgOOAgiJdLCJibG9ja2VkQnkiOlsi6aG-5a6i5LiL5Y2V5pe26IO96YCJ5Yiw5bqX5Y-WIl19XQ -->'

// factory/test/scheduler.test.mjs 里的进度行
const PROGRESS_SAMPLE = '进度 v1｜路径：其余｜客户档：安排中｜细阶段：记驳回｜轮次：1｜卡住：否'
const PROGRESS_NOTE_SAMPLE =
  '进度 v1｜路径：其余｜客户档：安排中｜细阶段：技术闸门｜轮次：3｜卡住：是｜备注：等运营者答技术闸门'

test('parseCustomerQuote 认「」加日期：父工单样例', () => {
  const parsed = parseCustomerQuote(PARENT_ISSUE_SAMPLE)
  assert.equal(
    parsed.quote,
    '顾客想在我的微信小程序里看今天有什么水果，下单，选到店取还是送货。我在后台改价格和库存。',
  )
  assert.equal(parsed.date, '2026-11-08')
  assert.equal(parsed.format, 'quote-date')
})

test('parseCustomerQuote 认问答记录样例，只读客户原话一节', () => {
  const parsed = parseCustomerQuote(QUESTIONS_SAMPLE)
  assert.equal(
    parsed.quote,
    '顾客想在我的微信小程序里看今天有什么水果，下单，选到店取还是送货。我在后台改价格和库存。',
  )
  assert.equal(parsed.date, '2026-11-08')
  assert.equal(parsed.format, 'quote-date')
})

test('parseCustomerQuote 认 YYYY-MM-DD：前缀写法', () => {
  const parsed = parseCustomerQuote(
    '## 客户原话\n\n2026-11-08：顾客想在我的微信小程序里看今天有什么水果。\n',
  )
  assert.equal(parsed.quote, '顾客想在我的微信小程序里看今天有什么水果。')
  assert.equal(parsed.date, '2026-11-08')
  assert.equal(parsed.format, 'date-prefix')
})

test('parseCustomerQuote 认需求草稿第 1 段的普通条目加日期', () => {
  const parsed = parseCustomerQuote(DRAFT_SAMPLE)
  assert.equal(parsed.quote, '我想要一个预约取货的小程序。')
  assert.equal(parsed.date, '2026-11-15')
  assert.equal(parsed.format, 'plain-line')
})

test('parseCustomerQuote 缺原话返回 null，不和空引号混在一起', () => {
  assert.equal(parseCustomerQuote(''), null)
  assert.equal(parseCustomerQuote(null), null)
  assert.equal(parseCustomerQuote('## 客户确认的结论\n\n- 无'), null)
  assert.equal(parseCustomerQuote('## 客户原话\n\n> 「」\n\n日期：2026-11-08'), null)
  assert.equal(
    parseCustomerQuote('## 客户原话\n\n## 第1轮\n\n客户：「这句是后面轮次的，不是原话。」'),
    null,
  )
})

test('parseAcceptance 读父工单样例的验收条件', () => {
  assert.deepEqual(parseAcceptance(PARENT_ISSUE_SAMPLE), [
    { text: '顾客扫码进小程序，看到当天水果的名单。', checked: false },
    { text: '卖完的水果标灰，不能下单。', checked: false },
    { text: '老板在后台改一个价格，点两下改完，顾客那边马上看到。', checked: false },
    { text: '顾客下单时能选到店取或送货，送货加收 5 元。（人工判断）', checked: false },
    { text: '老板点「已取货」，顾客收到微信通知。（人工判断）', checked: false },
  ])
})

test('parseAcceptance 普通 - 按未勾选处理，只读验收条件一节', () => {
  const body = `## 验收条件

- 普通条目
* 星号条目
- [x] 已勾选
- [ ] 已勾选留空
- [X] 大写已勾选

## 不做清单

- 不做会员积分
`
  assert.deepEqual(parseAcceptance(body), [
    { text: '普通条目', checked: false },
    { text: '星号条目', checked: false },
    { text: '已勾选', checked: true },
    { text: '已勾选留空', checked: false },
    { text: '大写已勾选', checked: true },
  ])
})

test('encodeAcceptance 统一写 - [ ]，解析时再按未勾选读回', () => {
  const items = [
    { text: '顾客扫码进小程序。', checked: true },
    '卖完的水果标灰。',
  ]
  const text = encodeAcceptance(items)
  assert.equal(text, '- [ ] 顾客扫码进小程序。\n- [ ] 卖完的水果标灰。')
  assert.deepEqual(parseAcceptance(text), [
    { text: '顾客扫码进小程序。', checked: false },
    { text: '卖完的水果标灰。', checked: false },
  ])
})

test('验收条件 round-trip：样例生成后再解析内容不变', () => {
  const items = parseAcceptance(PARENT_ISSUE_SAMPLE)
  assert.deepEqual(parseAcceptance(encodeAcceptance(items)), items)
})

test('parseTicketsPayload 读回旧实现写出的票单', () => {
  assert.deepEqual(parseTicketsPayload(`提案：拆票\n\n${TICKETS_MARKER_SAMPLE}`), TICKETS_SAMPLE)
})

test('encodeTicketsPayload 和旧实现逐字节一致', () => {
  assert.equal(encodeTicketsPayload(TICKETS_SAMPLE), TICKETS_MARKER_SAMPLE)
})

test('票单 round-trip，缺 marker 或坏 JSON 返回 null', () => {
  assert.deepEqual(parseTicketsPayload(encodeTicketsPayload(TICKETS_SAMPLE)), TICKETS_SAMPLE)
  assert.equal(parseTicketsPayload('提案：拆票\n\n没有票单'), null)
  assert.equal(parseTicketsPayload('<!-- factory:tickets 不是JSON -->'), null)
  assert.equal(
    parseTicketsPayload(`<!-- factory:tickets ${Buffer.from('{"a":1}', 'utf8').toString('base64url')} -->`),
    null,
  )
})

test('progressLine 生成调度器样例里的进度行', () => {
  assert.equal(
    progressLine({ path: '其余', tier: '安排中', step: '记驳回', round: 1, stuck: false }),
    PROGRESS_SAMPLE,
  )
  assert.equal(PROGRESS_PREFIX, '进度 v1｜')
  assert.equal(
    progressLine({
      path: '其余',
      tier: '安排中',
      step: '技术闸门',
      round: 3,
      stuck: true,
      note: '等运营者答技术闸门',
    }),
    PROGRESS_NOTE_SAMPLE,
  )
})

test('parseProgress 解析调度器样例进度行', () => {
  const parsed = parseProgress(PROGRESS_SAMPLE)
  assert.equal(parsed.line, PROGRESS_SAMPLE)
  assert.equal(parsed.path, '其余')
  assert.equal(parsed.tier, '安排中')
  assert.equal(parsed.sub, '记驳回')
  assert.equal(parsed.progress, '')
  assert.equal(parsed.round, 1)
  assert.equal(parsed.stuck, false)
  assert.equal(parsed.note, '')
})

test('进度行 round-trip：备注和子票进度数', () => {
  const parsed = parseProgress(PROGRESS_NOTE_SAMPLE)
  assert.equal(
    progressLine({
      path: parsed.path,
      tier: parsed.tier,
      step: parsed.sub,
      round: parsed.round,
      stuck: parsed.stuck,
      note: parsed.note,
    }),
    PROGRESS_NOTE_SAMPLE,
  )
  const numbered = parseProgress('进度 v1｜路径：其余｜客户档：开发中｜细阶段：子票开发 2/4｜轮次：2｜卡住：否')
  assert.equal(numbered.sub, '子票开发')
  assert.equal(numbered.progress, '2/4')
})

test('parseProgress 不是进度行返回 null', () => {
  assert.equal(parseProgress('普通评论'), null)
  assert.equal(parseProgress('进度 v1｜客户档：安排中'), null)
  assert.equal(parseProgress(''), null)
  assert.equal(parseProgress(null), null)
})

test('eventKey 带仓库，两个仓同号不撞', () => {
  const left = eventKey({ owner: 'acme', repo: 'shop', subject: '#1', event: '该跑 to-spec', scope: '0' })
  const right = eventKey({ owner: 'other', repo: 'shop', subject: '#1', event: '该跑 to-spec', scope: '0' })
  assert.equal(left, 'acme/shop:#1:该跑 to-spec:0')
  assert.notEqual(left, right)
  assert.equal(eventKey({ owner: 'Acme', repo: 'Shop', subject: '#1', event: '该跑 to-spec', scope: '0' }), left)
})

test('eventKey 兼容通知文档里的 key 样例', () => {
  assert.equal(
    eventKey({ subject: 'I-0111', event: '需要你答', scope: 'PR-123:2026-11-16' }),
    'I-0111:需要你答:PR-123:2026-11-16',
  )
  assert.equal(eventKey({ event: '每日抽样', scope: '2026-11-15' }), '每日抽样:2026-11-15')
})

test('eventKey 缺 event 或仓库只给一半时报错', () => {
  assert.throws(() => eventKey({ owner: 'acme', repo: 'shop', subject: '#1' }), TypeError)
  assert.throws(() => eventKey({ owner: 'acme', subject: '#1', event: '出事' }), TypeError)
  assert.throws(() => eventKey({ repo: 'shop', subject: '#1', event: '出事' }), TypeError)
})
