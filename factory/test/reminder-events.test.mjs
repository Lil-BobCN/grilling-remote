import assert from 'node:assert/strict'
import test from 'node:test'
import { pendingReminder, reminderEvent } from '../lib/scheduler.mjs'

const NOW = new Date('2026-11-24T10:00:00+08:00')

function parentBody() {
  return [
    '## 客户原话',
    '',
    '> 「要个预约取货」',
    '',
    '## 需求全文',
    '',
    '- 客户简称：acme',
    '- 需求名：yuyue-quhuo',
  ].join('\n')
}

function parent(overrides = {}) {
  return {
    number: 42,
    id: 4200,
    title: '要个预约取货',
    body: parentBody(),
    labels: [{ name: '状态:已提交' }],
    state: 'open',
    html_url: 'https://github.com/acme/demo/issues/42',
    comments: [],
    ...overrides,
  }
}

function gate(body, { id = 111, createdAt = '2026-11-24T08:00:00+08:00' } = {}) {
  return {
    id,
    body,
    created_at: createdAt,
    html_url: `https://github.com/acme/demo/issues/42#issuecomment-${id}`,
  }
}

function reminderFor(kind, comment, { owner = 'acme', repo = 'demo' } = {}) {
  const latestGate = { kind, comment }
  return pendingReminder({
    parent: parent(),
    latestGate,
    now: NOW,
    owner,
    repo,
  })
}

test('同一天第二次提案：关口评论不同，key 也不同', () => {
  const first = reminderFor('提案：补缺口', gate('提案：补缺口', { id: 111 }))
  const second = reminderFor('提案：补缺口', gate('提案：补缺口', { id: 222 }))

  assert.equal(first.event, '补缺口提案')
  assert.equal(second.event, '补缺口提案')
  assert.notEqual(first.key, second.key)
  assert.match(first.key, /#42:补缺口提案:111:0$/)
  assert.match(second.key, /#42:补缺口提案:222:0$/)
})

test('24 小时重复提醒仍产生新 key，关口评论不变', () => {
  const comment = gate('提案：拆票', { id: 333 })
  const first = reminderFor('提案：拆票', comment)
  const next = pendingReminder({
    parent: parent(),
    latestGate: { kind: '提案：拆票', comment },
    now: new Date('2026-11-25T10:00:00+08:00'),
    owner: 'acme',
    repo: 'demo',
  })

  assert.match(first.key, /#42:拆票提案:333:0$/)
  assert.match(next.key, /#42:拆票提案:333:1$/)
  assert.notEqual(first.key, next.key)
})

test('提案评论 id 缺失时用 created_at 区分', () => {
  const first = reminderFor('提案：补缺口', {
    body: '提案：补缺口',
    created_at: '2026-11-24T08:00:00+08:00',
  })
  const second = reminderFor('提案：补缺口', {
    body: '提案：补缺口',
    created_at: '2026-11-24T09:00:00+08:00',
  })

  assert.notEqual(first.key, second.key)
  assert.match(first.key, /#42:补缺口提案:2026-11-24T08:00:00\+08:00:0$/)
})

test('提案事件带 comment_url 和父工单身份', () => {
  for (const [kind, name, dataKind] of [
    ['提案：补缺口', '补缺口提案', 'gap'],
    ['提案：拆票', '拆票提案', 'split'],
  ]) {
    const reminder = reminderFor(kind, gate(kind, { id: 444 }))
    const event = reminderEvent({
      reminder,
      parent: parent(),
      owner: 'acme',
      repo: 'demo',
    })
    assert.equal(event.event, name)
    assert.equal(event.data.comment_url,
      'https://github.com/acme/demo/issues/42#issuecomment-444')
    assert.equal(event.data.owner, 'acme')
    assert.equal(event.data.repo, 'demo')
    assert.equal(event.data.ticket, 42)
    assert.equal(event.data.kind, dataKind)
  }
})

test('关口评论没有 html_url 时不带 comment_url', () => {
  const reminder = reminderFor('提案：补缺口', {
    id: 555,
    body: '提案：补缺口',
    created_at: '2026-11-24T08:00:00+08:00',
  })
  const event = reminderEvent({
    reminder,
    parent: parent(),
    owner: 'acme',
    repo: 'demo',
  })

  assert.equal('comment_url' in event.data, false)
})

test('需要你答不带 comment_url', () => {
  const reminder = pendingReminder({
    parent: parent({ labels: [{ name: '状态:开发中' }] }),
    latestGate: {
      kind: '点头：拆票',
      comment: gate('点头：拆票', { id: 666 }),
    },
    now: NOW,
    needsAnswer: [
      {
        key: 'PR-9:51',
        question: '闸门第三题选哪个方案',
        recommended: '方案 A',
        link: 'https://github.com/acme/demo/pull/9',
        opened_at: '2026-11-23T10:00:00+08:00',
      },
    ],
    owner: 'acme',
    repo: 'demo',
  })
  const event = reminderEvent({
    reminder,
    parent: parent(),
    owner: 'acme',
    repo: 'demo',
  })

  assert.equal(event.event, '需要你答')
  assert.equal('comment_url' in event.data, false)
})
