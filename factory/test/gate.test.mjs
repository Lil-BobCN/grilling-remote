import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { run as runGateCli } from '../bin/gate.mjs'
import { gateKind, latestGate } from '../lib/gate.mjs'
import { parseGateRows } from '../lib/scheduler-jobs.mjs'

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

const HEADER = 'ts\tphase\tdecision\twhy\tevidence\tresult'

async function gateFixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'afk-gate-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

test('gate answer 追加答行，parseGateRows 不再返回该题', async (t) => {
  const dir = await gateFixture(t)
  await mkdir(join(dir, '.audit'), { recursive: true })
  await writeFile(
    join(dir, '.audit', '51.tsv'),
    [
      HEADER,
      '2026-11-17T02:00:00.000Z\tgate\t问：服务器放哪 推荐：香港\t\t\topen',
    ].join('\n') + '\n',
    'utf8',
  )

  await runGateCli(
    ['answer', '--repo-dir', dir, '--ticket', '51', '--question', '服务器放哪'],
    { out: () => {}, now: '2026-11-17T03:00:00Z' },
  )

  const text = await readFile(join(dir, '.audit', '51.tsv'), 'utf8')
  assert.equal(text.split('\n')[0], HEADER)
  assert.match(text, /\tgate\t答：服务器放哪\t/)
  assert.match(text, /\tanswered\n?$/)
  assert.deepEqual(parseGateRows(text), [])
})

test('gate answer --result parked 也写进同一列，非法 result 拒绝', async (t) => {
  const dir = await gateFixture(t)
  const row = await runGateCli(
    ['answer', '--repo-dir', dir, '--ticket', '52', '--question', '要不要备案', '--result', 'parked'],
    { out: () => {} },
  )
  assert.equal(row.phase, 'gate')
  assert.equal(row.result, 'parked')

  await assert.rejects(
    runGateCli(
      ['answer', '--repo-dir', dir, '--ticket', '52', '--question', 'x', '--result', 'done'],
      { out: () => {} },
    ),
    /answered 或 parked/,
  )
})
