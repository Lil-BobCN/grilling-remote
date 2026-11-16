/**
 * 关口评论：第一行是固定词，同一关口只看最新一条。
 * 固定词见 docs/工单模型.md 的「人工关口的信号」。
 */

export const GATE_PREFIXES = [
  '提案：补缺口',
  '点头：补缺口',
  '驳回：补缺口',
  '提案：拆票',
  '点头：拆票',
  '驳回：拆票',
  '改口：',
]

export function gateKind(body) {
  const first = String(body || '')
    .replace(/^﻿/, '')
    .trimStart()
    .split(/\r?\n/)[0]
    .trim()
  for (const prefix of GATE_PREFIXES) {
    if (first.startsWith(prefix)) return prefix
  }
  return null
}

/**
 * 返回最新一条关口评论。
 * @param {Array<{body?: string}>} comments GitHub 按时间升序返回的评论
 */
export function latestGate(comments = []) {
  for (let index = comments.length - 1; index >= 0; index -= 1) {
    const kind = gateKind(comments[index]?.body)
    if (kind) {
      return { kind, body: String(comments[index].body), comment: comments[index], index }
    }
  }
  return null
}

/** 两条关口评论是不是同一关口。补缺口和拆票分开算。 */
export function gateSlot(kind) {
  if (!kind) return null
  return kind.includes('补缺口') ? '补缺口' : '拆票'
}
