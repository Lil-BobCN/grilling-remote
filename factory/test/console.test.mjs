import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  answerWaiting,
  entryFromIssue,
  gateWaiting,
  listWaiting,
  openWaiting,
  pickWaiting,
  proposalKind,
} from '../lib/console.mjs'
import { run as runConsoleCli } from '../bin/console.mjs'

const HEADER = 'ts\tphase\tdecision\twhy\tevidence\tresult'

test('提案评论判断待办类型，点头后不再算待办', () => {
  assert.equal(proposalKind([{ body: '提案：补缺口\n\n1. 题：要不要' }]), 'gap')
  assert.equal(proposalKind([{ body: '提案：拆票\n\n## 票单' }]), 'split')
  assert.equal(
    proposalKind([{ body: '提案：补缺口' }, { body: '点头：补缺口\n\n## 最终答案' }]),
    null,
  )
  assert.equal(proposalKind([{ body: '普通评论' }]), null)
})

test('listWaiting 找 GitHub 上的补缺口和拆票提案', async () => {
  const comments = {
    1: [{ body: '提案：补缺口\n\n1. 题：要不要' }],
    2: [{ body: '提案：拆票\n\n## 票单' }],
    3: [{ body: '点头：补缺口' }],
  }
  const gh = {
    listIssues: async () => [
      { number: 1, title: '地图', html_url: 'https://github.com/o/r/issues/1' },
      { number: 2, title: '父工单', html_url: 'https://github.com/o/r/issues/2' },
      { number: 3, title: '已点头', html_url: 'https://github.com/o/r/issues/3' },
    ],
    listComments: async ({ number }) => comments[number] || [],
  }
  const rows = await listWaiting({ gh, owner: 'o', repo: 'r' })
  assert.deepEqual(rows.map((row) => [row.kind, row.ticket]), [['gap', 1], ['split', 2]])
})

test('entryFromIssue 带 GitHub 链接', () => {
  const entry = entryFromIssue({
    owner: 'o',
    repo: 'r',
    issue: { number: 7, title: '父工单', html_url: 'https://github.com/o/r/issues/7' },
    comments: [{ body: '提案：拆票' }],
  })
  assert.equal(entry.kind, 'split')
  assert.equal(entry.url, 'https://github.com/o/r/issues/7')
})

async function gateFixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'afk-console-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await mkdir(join(dir, '.audit'), { recursive: true })
  await writeFile(
    join(dir, '.audit', '51.tsv'),
    [
      HEADER,
      '2026-11-17T02:00:00.000Z\tgate\t问：服务器放哪 推荐：香港\t\t\topen',
      '2026-11-17T02:30:00.000Z\tgate\t问：谁验收\t\t\topen',
      '2026-11-17T03:00:00.000Z\tgate\t答：服务器放哪\t香港\t\tanswered',
    ].join('\n') + '\n',
    'utf8',
  )
  return dir
}

test('gateWaiting 只留下还没答的 gate 题', async (t) => {
  const dir = await gateFixture(t)
  const rows = await gateWaiting({ repoDir: dir })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].kind, 'gate')
  assert.equal(rows[0].ticket, 51)
  assert.equal(rows[0].question, '谁验收')
})

test('openWaiting 通过 Orca 打开终端并跑 show', async () => {
  const calls = []
  const run = async (command, args) => {
    calls.push([command, args])
    if (command === 'orca' && args[0] === 'status') return JSON.stringify({ running: true })
    if (command === 'orca' && args[0] === 'terminal') return 'terminal-1'
    return ''
  }
  const entry = {
    kind: 'gap',
    owner: 'o',
    repo: 'r',
    ticket: 1,
    url: 'https://github.com/o/r/issues/1',
  }
  const result = await openWaiting({
    entry,
    run,
    consolePath: '/repo/factory/bin/console.mjs',
    worktree: 'id:wt1',
  })
  assert.equal(result.selector, 'id:wt1')
  assert.match(result.command, /console\.mjs show/)
  assert.match(result.command, /--kind gap/)
  const terminal = calls.find(([, args]) => args[0] === 'terminal')
  assert.ok(terminal, '应该调用 terminal create')
  assert.equal(terminal[1][terminal[1].indexOf('--command') + 1], result.command)
})

test('openWaiting 在 Orca 没开时给明确错误', async () => {
  const run = async (command, args) => {
    if (command === 'orca' && args[0] === 'status') return JSON.stringify({ running: false })
    return ''
  }
  await assert.rejects(
    () => openWaiting({ entry: { kind: 'gap', owner: 'o', repo: 'r', ticket: 1 }, run }),
    /orca open/,
  )
})

test('answerWaiting 调 gap CLI 写回答案', async () => {
  const calls = []
  const run = async (command, args) => {
    calls.push([command, args])
    return '{"posted":true}'
  }
  await answerWaiting({
    entry: { kind: 'gap', owner: 'o', repo: 'r', ticket: 3 },
    answer: ['第 4 题：作废'],
    run,
    node: 'node',
    repoRoot: '/repo',
  })
  const [command, args] = calls[0]
  assert.equal(command, 'node')
  assert.ok(args[0].endsWith('factory/bin/gap.mjs'))
  assert.equal(args[1], 'point')
  assert.ok(args.includes('--answers'))
  assert.equal(args[args.indexOf('--number') + 1], '3')
  assert.deepEqual(JSON.parse(args[args.indexOf('--answers') + 1]), {
    answers: ['第 4 题：作废'],
    impacts: [],
  })
})

test('answerWaiting 调 tickets CLI 从提案建票并点头', async () => {
  const calls = []
  await answerWaiting({
    entry: { kind: 'split', owner: 'o', repo: 'r', ticket: 9 },
    run: async (command, args) => {
      calls.push([command, args])
      return '{}'
    },
    node: 'node',
    repoRoot: '/repo',
  })
  const args = calls[0][1]
  assert.ok(args[0].endsWith('factory/bin/tickets.mjs'))
  assert.equal(args[1], 'create')
  assert.ok(args.includes('--from-proposal'))
  assert.ok(args.includes('--point'))
})

test('answerWaiting 的 gate 写回带 repo-dir', async () => {
  const calls = []
  await answerWaiting({
    entry: { kind: 'gate', owner: 'o', repo: 'r', ticket: 51, question: '服务器放哪' },
    answer: '香港',
    repoDir: '/customers/b-shop',
    run: async (command, args) => {
      calls.push([command, args])
      return '{}'
    },
    node: 'node',
    repoRoot: '/repo',
  })
  const args = calls[0][1]
  assert.ok(args[0].endsWith('factory/bin/gate.mjs'))
  assert.equal(args[1], 'answer')
  assert.equal(args[args.indexOf('--repo-dir') + 1], '/customers/b-shop')
  assert.equal(args[args.indexOf('--answer') + 1], '香港')
})

test('pickWaiting 按票号和类型找待办', () => {
  const rows = [
    { kind: 'gap', ticket: 1, owner: 'o', repo: 'r' },
    { kind: 'gate', ticket: 51, owner: '', repo: '' },
  ]
  assert.equal(pickWaiting(rows, { owner: 'o', repo: 'r', ticket: 1, kind: 'gap' })?.kind, 'gap')
  assert.equal(pickWaiting(rows, { owner: 'o', repo: 'r', ticket: 51, kind: 'gate' })?.kind, 'gate')
  assert.equal(pickWaiting(rows, { owner: 'o', repo: 'r', ticket: 2, kind: 'gap' }), null)
})

function parentIssue({ number, requirement, label = '状态:排队中' }) {
  return {
    number,
    title: `父工单 ${number}`,
    body: `- 客户简称：acme\n- 需求名：${requirement}\n<!-- factory:order=o-000${number} -->`,
    labels: [{ name: label }],
    html_url: `https://github.com/o/r/issues/${number}`,
  }
}

test('listWaiting 列出点头后没 spec 的父工单，有 spec 或没点头不列', async () => {
  const issues = [
    parentIssue({ number: 1, requirement: 'demo' }),
    parentIssue({ number: 2, requirement: 'kucun' }),
    parentIssue({ number: 3, requirement: 'pingtai' }),
    {
      number: 9,
      title: 'spec demo',
      body: 'spec demo',
      labels: [{ name: 'ready-for-agent' }],
      html_url: 'https://github.com/o/r/issues/9',
    },
  ]
  const comments = {
    1: [{ body: '点头：补缺口\n\n## 最终答案' }],
    2: [{ body: '点头：补缺口' }],
    3: [{ body: '提案：补缺口' }],
  }
  const gh = {
    listIssues: async () => issues,
    listComments: async ({ number }) => comments[number] || [],
  }

  const rows = await listWaiting({ gh, owner: 'o', repo: 'r', kinds: ['spec'] })

  assert.deepEqual(rows.map((row) => [row.kind, row.ticket]), [['spec', 2]])
})

test('answerWaiting 对 spec 直接说没有写回命令', async () => {
  await assert.rejects(
    () => answerWaiting({ entry: { kind: 'spec', owner: 'o', repo: 'r', ticket: 2 } }),
    /手动步骤/,
  )
})

test('console show 对 spec 给出手动处理提示', async () => {
  const gh = {
    listIssues: async () => [parentIssue({ number: 2, requirement: 'kucun' })],
    listComments: async () => [{ body: '点头：补缺口' }],
  }
  const lines = []
  await runConsoleCli(['show', '--owner', 'o', '--repo', 'r', '--ticket', '2', '--kind', 'spec'], {
    gh,
    out: (line) => lines.push(line),
  })
  assert.ok(lines.some((line) => line.includes('手动跑 to-spec')))
})

test('console 拒绝未知类型，错误里列出四种可选类型', async () => {
  await assert.rejects(
    () =>
      runConsoleCli(
        ['show', '--owner', 'o', '--repo', 'r', '--ticket', '1', '--kind', 'nope'],
        { gh: {}, out: () => {} },
      ),
    /--kind 只能是 gap、split、gate、spec/,
  )
})
