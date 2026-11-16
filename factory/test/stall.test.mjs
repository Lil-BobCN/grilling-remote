import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { progressLine } from '../lib/progress.mjs'
import { repeatProblems, roundsWithoutProgress } from '../lib/stall.mjs'

function progress(tier, step, round) {
  return { body: progressLine({ path: '其余', tier, step, round, stuck: false }) }
}

test('同一张票三圈没进展：最近三轮客户档和细阶段都一样', () => {
  const comments = [
    progress('开发中', '开工', 1),
    progress('开发中', '开工', 2),
    progress('开发中', '开工', 3),
  ]
  const result = roundsWithoutProgress({ comments })
  assert.equal(result.stalled, true)
  assert.equal(result.rounds, 3)
  assert.match(result.reason, /连续 3 轮/)

  const moved = roundsWithoutProgress({
    comments: [progress('开发中', '开工', 1), progress('开发中', '开工', 2), progress('待客户验收', '已部署', 3)],
  })
  assert.equal(moved.stalled, false)

  const tooFew = roundsWithoutProgress({ comments: [progress('开发中', '开工', 1)] })
  assert.equal(tooFew.stalled, false)
  assert.match(tooFew.reason, /不够 3 轮/)
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
