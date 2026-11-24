/**
 * 关口评论：第一行是固定词，同一关口只看最新一条。
 * 固定词和最新一条的解析在后端 `backend/lib/protocol.mjs`，两边共用一份。
 */

export { GATE_PREFIXES, gateKind, latestGate } from '../../backend/lib/protocol.mjs'

/** 两条关口评论是不是同一关口。补缺口和拆票分开算。 */
export function gateSlot(kind) {
  if (!kind) return null
  return kind.includes('补缺口') ? '补缺口' : '拆票'
}
