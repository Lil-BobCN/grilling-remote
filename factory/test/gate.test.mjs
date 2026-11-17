import assert from 'node:assert/strict'
import test from 'node:test'
import { gateKind, latestGate } from '../lib/gate.mjs'

test('第一行固定词才算关口评论', () => {
  assert.equal(gateKind('提案：补缺口\n\n正文'), '提案：补缺口')
  assert.equal(gateKind('\n\n点头：拆票\n'), '点头：拆票')
  assert.equal(gateKind('改口：重传 2026-11-17\n'), '改口：')
  assert.equal(gateKind('这一条先说提案：补缺口'), null)
  assert.equal(gateKind(''), null)
})

test('同一关口只看最新一条，非关口评论不干扰', () => {
  const comments = [
    { body: '提案：补缺口\n\n第一版' },
    { body: '普通评论' },
    { body: '点头：补缺口\n\n## 最终答案' },
    { body: '进度 v1｜客户档：已收到' },
  ]
  const latest = latestGate(comments)
  assert.equal(latest.kind, '点头：补缺口')
  assert.equal(latest.index, 2)
  assert.equal(latestGate([{ body: '普通评论' }]), null)
  assert.equal(latestGate([]), null)
})

test('改口盖掉旧点头', () => {
  const latest = latestGate([
    { body: '点头：补缺口' },
    { body: '改口：重传 2026-11-17' },
  ])
  assert.equal(latest.kind, '改口：')
})
