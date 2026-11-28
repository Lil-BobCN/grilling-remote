import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { progressLine } from '../lib/progress.mjs'
import { repeatProblems, roundsWithoutProgress } from '../lib/stall.mjs'

function progress({ tier = '开发中', step = '评审修复', round = 1, ticket, stuck = false } = {}) {
  return { body: progressLine({ path: '其余', tier, step, ticket, round, stuck }) }
}

test('F11 三条旧收尾没有票号，不参与判断', () => {
  const comments = [
    progress({ step: '合分支', round: 5 }),
    progress({ step: '合分支', round: 6 }),
    progress({ step: '合分支', round: 7 }),
  ]
  const result = roundsWithoutProgress({ comments })
  assert.equal(result.stalled, false)
  assert.deepEqual(result.tickets, [])
})

test('三张不同票各一条合分支收尾，不判停滞', () => {
  const comments = [
    progress({ step: '合分支', round: 5, ticket: 9 }),
    progress({ step: '合分支', round: 6, ticket: 10 }),
    progress({ step: '合分支', round: 7, ticket: 11 }),
  ]
  const result = roundsWithoutProgress({ comments })
  assert.equal(result.stalled, false)
})

test('同一张票连续三条评审修复，同一次运行里也算', () => {
  const comments = [
    progress({ ticket: 12, round: 1 }),
    progress({ ticket: 12, round: 1 }),
    progress({ ticket: 12, round: 1 }),
  ]
  const result = roundsWithoutProgress({ comments })
  assert.equal(result.stalled, true)
  assert.equal(result.ticket, 12)
  assert.deepEqual(result.tickets, [12])
  assert.match(result.reason, /票 #12/)
})

test('同一张票两条评审修复后合分支，不判停滞', () => {
  const comments = [
    progress({ ticket: 12 }),
    progress({ ticket: 12 }),
    progress({ ticket: 12, step: '合分支' }),
  ]
  assert.equal(roundsWithoutProgress({ comments }).stalled, false)
})

test('卡住进度插在两条评审修复后面，三连断开', () => {
  const comments = [
    progress({ ticket: 12 }),
    progress({ ticket: 12 }),
    progress({ ticket: 12, step: '开工', stuck: true }),
  ]
  assert.equal(roundsWithoutProgress({ comments }).stalled, false)
})

test('已关闭的票跳过，不再判停滞', () => {
  const comments = [
    progress({ ticket: 8 }),
    progress({ ticket: 8 }),
    progress({ ticket: 8 }),
  ]
  const open = roundsWithoutProgress({ comments, openTickets: [8] })
  assert.equal(open.stalled, true)
  const closed = roundsWithoutProgress({ comments, openTickets: [9] })
  assert.equal(closed.stalled, false)
})

test('两张票各自三连，命中结果带两个票号', () => {
  const comments = [
    progress({ ticket: 9 }),
    progress({ ticket: 9 }),
    progress({ ticket: 9 }),
    progress({ ticket: 10 }),
    progress({ ticket: 10 }),
    progress({ ticket: 10 }),
  ]
  const result = roundsWithoutProgress({ comments })
  assert.equal(result.stalled, true)
  assert.deepEqual(result.tickets, [9, 10])
})

test('不够三条不判停滞', () => {
  const tooFew = roundsWithoutProgress({ comments: [progress({ ticket: 12 })] })
  assert.equal(tooFew.stalled, false)
  assert.match(tooFew.reason, /不够 3 条/)
})

test('同类问题跨票两次：失败的评审问题文字相同才算', () => {
  const result = repeatProblems({
    trails: [
      { ticket: 51, rows: [{ phase: 'review', decision: '标准', evidence: '漏了错误处理', result: 'fail' }] },
      { ticket: 52, rows: [{ phase: 'review', decision: 'spec', evidence: '漏了错误处理。', result: 'fail' }] },
      { ticket: 53, rows: [{ phase: 'review', decision: '标准', evidence: '命名不一致', result: 'fail' }] },
    ],
  })
  assert.equal(result.repeat, true)
  assert.deepEqual(result.repeats, [{ problem: '漏了错误处理', tickets: [51, 52] }])

  const passed = repeatProblems({
    trails: [
      { ticket: 51, rows: [{ phase: 'review', evidence: '漏了错误处理', result: 'pass' }] },
      { ticket: 52, rows: [{ phase: 'review', evidence: '漏了错误处理', result: 'fail' }] },
    ],
  })
  assert.equal(passed.repeat, false)
})

test('repeatProblems 也收 trail 文本', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'afk-stall-'))
  try {
    const file = join(dir, '51.tsv')
    await writeFile(
      file,
      [
        'ts\tphase\tdecision\twhy\tevidence\tresult',
        '2026-11-17T00:00:00Z\treview\t标准\t\t首页白屏\tfail',
      ].join('\n'),
    )
    const { readFile } = await import('node:fs/promises')
    const text = await readFile(file, 'utf8')
    const result = repeatProblems({
      trails: [
        { ticket: 51, trail: text },
        { ticket: 52, rows: [{ phase: 'review', decision: '标准', evidence: '首页白屏', result: 'fail' }] },
      ],
    })
    assert.equal(result.repeat, true)
    assert.deepEqual(result.repeats[0].tickets, [51, 52])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
