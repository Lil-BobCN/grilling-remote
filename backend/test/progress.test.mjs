import assert from 'node:assert/strict'
import test from 'node:test'
import { clearIssueCache, parseIssueRef, readIssueProgress } from '../lib/github.mjs'
import { mergeTransitions, parseProgressEntry } from '../lib/progress.mjs'
import { makeConfig, startFakeGithub } from './helpers.mjs'

const LINE = (fields) =>
  `进度 v1｜路径：其余｜客户档：${fields.tier}｜细阶段：${fields.sub}｜轮次：${fields.round}｜卡住：${
    fields.stuck ? '是' : '否'
  }${fields.note ? `｜备注：${fields.note}` : ''}`

const preTicket = [
  { at: '2026-11-15T09:00:00Z', line: LINE({ tier: '已收到', sub: '收包', round: 1 }) },
  { at: '2026-11-15T09:00:01Z', line: LINE({ tier: '已收到', sub: '校验', round: 1 }) },
]

function order(overrides = {}) {
  return {
    id: 'o-0001',
    transitions: preTicket,
    issue: { owner: 'acme', repo: 'demo', number: 7 },
    ...overrides,
  }
}

test('转档行解析出档、细阶段、轮次、卡住和备注', () => {
  const parsed = parseProgressEntry({
    at: '2026-11-15T10:00:00Z',
    line: LINE({ tier: '开发中', sub: '子票开发 2/4', round: 2, stuck: true, note: '等接口' }),
  })
  assert.equal(parsed.tier, '开发中')
  assert.equal(parsed.sub, '子票开发')
  assert.equal(parsed.progress, '2/4')
  assert.equal(parsed.round, 2)
  assert.equal(parsed.stuck, true)
  assert.equal(parsed.note, '等接口')
})

test('订单记录和工单评论按时间拼起来，重复行只留一条', () => {
  const merged = mergeTransitions(order(), {
    state: 'open',
    closedAt: null,
    transitions: [
      { at: '2026-11-15T10:00:00Z', line: LINE({ tier: '安排中', sub: '建单', round: 1 }) },
      { at: '2026-11-15T09:00:01Z', line: preTicket[1].line },
    ],
  })
  assert.equal(merged.length, 3)
  assert.equal(parseProgressEntry(merged.at(-1)).tier, '安排中')
})

test('父工单关闭且停在待客户验收，补一条已完成，时间取关闭时间', () => {
  const merged = mergeTransitions(order(), {
    state: 'closed',
    closedAt: '2026-11-16T10:00:00Z',
    transitions: [
      { at: '2026-11-15T10:00:00Z', line: LINE({ tier: '安排中', sub: '建单', round: 1 }) },
      { at: '2026-11-16T08:00:00Z', line: LINE({ tier: '待客户验收', sub: '等试用', round: 1 }) },
    ],
  })
  const last = parseProgressEntry(merged.at(-1))
  assert.equal(last.tier, '已完成')
  assert.equal(merged.at(-1).at, '2026-11-16T10:00:00Z')
})

test('关票前没到过待客户验收，不补已完成', () => {
  const merged = mergeTransitions(order(), {
    state: 'closed',
    closedAt: '2026-11-16T10:00:00Z',
    transitions: [
      { at: '2026-11-15T10:00:00Z', line: LINE({ tier: '开发中', sub: '子票开发', round: 1 }) },
    ],
  })
  assert.equal(parseProgressEntry(merged.at(-1)).tier, '开发中')
})

test('没有工单链接或没有 token 时不请求 GitHub', async () => {
  const { config } = await makeConfig()
  const noIssue = await readIssueProgress(config, order({ issue: null }))
  assert.equal(noIssue.skipped, 'no issue')
  assert.deepEqual(noIssue.transitions, [])

  const noToken = await readIssueProgress(config, order())
  assert.equal(noToken.skipped, 'no token')
  assert.equal(noToken.issueUrl, 'https://github.com/acme/demo/issues/7')
})

test('读评论、缓存 60 秒，失败用最近一次缓存', async (t) => {
  const fake = await startFakeGithub({
    issue: { state: 'open', closed_at: null },
    comments: [
      {
        created_at: '2026-11-15T10:00:00Z',
        body: LINE({ tier: '安排中', sub: '建单', round: 1 }),
      },
      {
        created_at: '2026-11-15T11:00:00Z',
        body: `先说明一句。\n${LINE({ tier: '开发中', sub: '子票开发 2/4', round: 1, stuck: true, note: '卡住原因' })}`,
      },
    ],
  })
  t.after(() => fake.close())
  clearIssueCache()

  const { config } = await makeConfig({
    GITHUB_TOKEN: 'test-token',
    GITHUB_API: fake.base,
    PROGRESS_CACHE_MS: '60000',
  })

  const first = await readIssueProgress(config, order(), Date.parse('2026-11-15T12:00:00Z'))
  assert.equal(first.transitions.length, 2)
  assert.equal(fake.state.calls.length, 2)
  assert.equal(parseProgressEntry(first.transitions[1]).stuck, true)

  const second = await readIssueProgress(config, order(), Date.parse('2026-11-15T12:00:30Z'))
  assert.equal(second.transitions.length, 2)
  assert.equal(fake.state.calls.length, 2, '缓存内不再请求')

  fake.state.fail = true
  const stale = await readIssueProgress(config, order(), Date.parse('2026-11-15T12:02:00Z'))
  assert.equal(stale.transitions.length, 2)
  assert.equal(stale.stale, true)
  assert.ok(stale.error)
})

test('工单链接支持完整 URL、字符串和对象', () => {
  assert.deepEqual(parseIssueRef({ issue: 'https://github.com/acme/demo/issues/7' }), {
    owner: 'acme',
    repo: 'demo',
    number: 7,
    url: 'https://github.com/acme/demo/issues/7',
  })
  assert.equal(parseIssueRef({ issue: { owner: 'acme', repo: 'demo', number: 7 } }).url, 'https://github.com/acme/demo/issues/7')
  assert.equal(parseIssueRef({ issue_url: 'https://github.com/acme/demo/issues/7' }).number, 7)
  assert.equal(parseIssueRef({ issue: 'acme/demo#7' }), null)
})
