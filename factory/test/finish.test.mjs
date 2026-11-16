import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { appendTrail } from '../lib/evidence.mjs'
import { runFinish } from '../bin/finish.mjs'
import { collectRequirementState, finishRequirement, mergeRisk, prBody } from '../lib/finish.mjs'
import { git } from '../lib/git.mjs'
import { createGithub } from '../lib/github.mjs'
import { ensureLabel } from '../lib/issues.mjs'
import { startFakeGithub } from './fake-github.mjs'

const OWNER = 'acme'
const REPO = 'demo'

function parentBody() {
  return [
    '## 客户原话',
    '',
    '> 「要个预约取货」',
    '',
    '## 客户确认的结论',
    '',
    '- 取货时间按小时选。',
    '',
    '## 验收条件',
    '',
    '- [ ] 打开首页能看到预约入口。',
    '',
    '## 不做清单',
    '',
    '- 不做导出。',
    '',
    '## 需求全文',
    '',
    '- 客户简称：B 店',
    '- 需求名：预约取货',
  ].join('\n')
}

async function makeRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'afk-finish-'))
  await git(dir, ['init', '-b', 'main'])
  await git(dir, ['config', 'user.name', 'AFK Test'])
  await git(dir, ['config', 'user.email', 'test@afkfactory.space'])
  await writeFile(join(dir, 'README.md'), 'base\n')
  await git(dir, ['add', '-A'])
  await git(dir, ['commit', '-m', 'base'])
  return dir
}

async function commitAll(dir, message) {
  await git(dir, ['add', '-A'])
  await git(dir, ['commit', '-m', message])
  return git(dir, ['rev-parse', 'HEAD'])
}

function trailRows({ merge = true } = {}) {
  return [
    { phase: 'verify', decision: '改前截图', why: '验证前', evidence: '.audit/before.png', result: 'pass' },
    { phase: 'verify', decision: '改后截图', why: '验证后', evidence: '.audit/after.png', result: 'pass' },
    { phase: 'test', decision: '全量测试通过', why: 'npm test', result: 'pass' },
    { phase: 'review', decision: '标准：通过', why: '标准轴', result: 'pass' },
    { phase: 'review', decision: 'spec：符合验收条件', why: 'spec 轴', result: 'pass' },
    ...(merge
      ? [{ phase: 'merge', decision: '四样证据齐，已合进需求分支', why: '合并 head', result: 'pass' }]
      : []),
  ]
}

async function setupGithub({ children = [], parentLabels = [] } = {}) {
  const fake = await startFakeGithub({ repos: [{ owner: OWNER, name: REPO }] })
  const gh = createGithub({ apiBase: fake.base, token: 'test' })
  for (const name of ['状态:开发中', '状态:待验收', '大小:小需求']) {
    await ensureLabel(gh, { owner: OWNER, repo: REPO, name })
  }
  const parent = await gh.createIssue({
    owner: OWNER,
    repo: REPO,
    title: '要个预约取货',
    body: parentBody(),
    labels: parentLabels,
  })
  const created = []
  for (const child of children) {
    const issue = await gh.createIssue({
      owner: OWNER,
      repo: REPO,
      title: child.title || `子票 ${created.length + 1}`,
      body: '## 垂直切片\n\n做一块',
    })
    if (child.state === 'closed') {
      await gh.closeIssue({ owner: OWNER, repo: REPO, number: issue.number })
    }
    await gh.addSubIssue({
      owner: OWNER,
      repo: REPO,
      number: parent.number,
      subIssueId: issue.id,
    })
    created.push(issue)
  }
  return { fake, gh, parent, children: created }
}

async function writeTicketTrail(dir, ticket, rows = trailRows()) {
  for (const row of rows) {
    await appendTrail({ repoDir: dir, ticket, ...row })
  }
}

test('collectRequirementState 读子票和 trail：开着的、闭票但没有合并行的都算未合', async () => {
  const { fake, gh, parent, children } = await setupGithub({
    children: [
      { title: '第一块', state: 'closed' },
      { title: '第二块', state: 'closed' },
      { title: '第三块', state: 'open' },
    ],
  })
  const dir = await makeRepo()
  try {
    await git(dir, ['checkout', '-b', 'req/order-1'])
    await writeTicketTrail(dir, children[0].number)
    await writeTicketTrail(dir, children[1].number, trailRows({ merge: false }))
    await git(dir, ['add', '-A'])
    await git(dir, ['commit', '-m', 'trail'])

    const state = await collectRequirementState({
      gh,
      owner: OWNER,
      repo: REPO,
      parent: parent.number,
      repoDir: dir,
    })

    assert.equal(state.parent.number, parent.number)
    assert.equal(state.subIssues.length, 3)
    assert.equal(state.allClosed, false)
    assert.deepEqual(
      [...state.unmerged].sort((a, b) => a - b),
      [children[1].number, children[2].number].sort((a, b) => a - b),
    )

    const first = state.evidence.find((item) => item.ticket === children[0].number)
    assert.equal(first.merged, true)
    assert.equal(first.verify.length, 2)
    assert.equal(first.test.length, 1)
    assert.equal(first.review.length, 2)
    assert.equal(first.merge.length, 1)
  } finally {
    await fake.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('collectRequirementState 全部闭票且有合并行时 allClosed 为 true、unmerged 为空', async () => {
  const { fake, gh, parent, children } = await setupGithub({
    children: [
      { title: '第一块', state: 'closed' },
      { title: '第二块', state: 'closed' },
    ],
  })
  const dir = await makeRepo()
  try {
    await git(dir, ['checkout', '-b', 'req/order-1'])
    for (const child of children) await writeTicketTrail(dir, child.number)
    await git(dir, ['add', '-A'])
    await git(dir, ['commit', '-m', 'trail'])

    const state = await collectRequirementState({
      gh,
      owner: OWNER,
      repo: REPO,
      parent,
      repoDir: dir,
    })

    assert.equal(state.allClosed, true)
    assert.deepEqual(state.unmerged, [])
    assert.ok(state.evidence.every((item) => item.merged))
  } finally {
    await fake.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('mergeRisk 方向由规则判定，只能往危险方向改', () => {
  const normal = mergeRisk({
    files: ['src/a.mjs'],
    diffStat: { additions: 10, deletions: 2, files: 1 },
  })
  assert.equal(normal.direction, 'two-way')
  assert.ok(normal.reasons.length > 0)

  const migration = mergeRisk({
    files: ['db/migrations/001_init.sql'],
    diffStat: { additions: 10, deletions: 2, files: 1 },
  })
  assert.equal(migration.direction, 'one-way')
  assert.ok(migration.reasons.some((text) => text.includes('迁移')))

  const escalated = mergeRisk({
    files: ['src/a.mjs'],
    diffStat: { additions: 10, deletions: 2, files: 1 },
    direction: 'one-way',
  })
  assert.equal(escalated.direction, 'one-way')

  assert.throws(
    () =>
      mergeRisk({
        files: ['db/migrations/001_init.sql'],
        diffStat: { additions: 10, deletions: 2, files: 1 },
        direction: 'two-way',
      }),
    /单向门/,
  )
  assert.throws(
    () => mergeRisk({ files: ['src/a.mjs'], diffStat: {}, direction: 'sometimes' }),
    /方向/,
  )
})

test('prBody 四栏标题固定，内容来自入参', () => {
  const body = prBody({
    summary: '需求：要个预约取货\n\n提交 1 个：\n- abc1234 FACTORY: 首页预约入口',
    evidence: ['- #2 第一块', '  - 改前：.audit/before.png', '  - 改后：.audit/after.png'],
    risk: { direction: 'two-way', reasons: ['没碰迁移、删除、凭证、大版本依赖，改动不大'] },
    impact: {
      files: ['app.txt'],
      directories: ['.'],
      behavior: ['FACTORY: 首页预约入口'],
    },
  })

  for (const heading of ['## 摘要', '## 证据', '## 合并危险', '## 影响范围']) {
    assert.ok(body.includes(heading), `缺 ${heading}`)
  }
  assert.ok(body.includes('双向门'))
  assert.ok(body.includes('abc1234 FACTORY: 首页预约入口'))
  assert.ok(body.includes('.audit/before.png'))
  assert.ok(body.includes('app.txt'))
  assert.ok(body.includes('FACTORY: 首页预约入口'))
})

async function requirementRepo(children) {
  const dir = await makeRepo()
  await git(dir, ['checkout', '-b', 'req/order-1'])
  await writeFile(join(dir, 'app.txt'), 'feature\n')
  await commitAll(dir, 'FACTORY: 首页预约入口')
  for (const child of children) await writeTicketTrail(dir, child.number)
  await commitAll(dir, 'FACTORY: 子票证据')
  return dir
}

function silentCalls() {
  const calls = []
  return {
    calls,
    review: async (ctx) => {
      calls.push(['review', ctx])
      return { ok: true }
    },
    verify: async (ctx) => {
      calls.push(['verify', ctx])
      return { ok: true }
    },
    openPr: null,
    mergePr: null,
    cleanup: async (ctx) => {
      calls.push(['cleanup', ctx])
    },
    notifier: {
      send: async (event) => {
        calls.push(['notify', event])
      },
    },
  }
}

test('有 open 子票时拒绝收尾，不评审、不建 PR、不合、不清理', async () => {
  const { fake, gh, parent, children } = await setupGithub({
    children: [
      { title: '第一块', state: 'closed' },
      { title: '第二块', state: 'open' },
    ],
  })
  const dir = await makeRepo()
  try {
    await git(dir, ['checkout', '-b', 'req/order-1'])
    await writeFile(join(dir, 'app.txt'), 'feature\n')
    await commitAll(dir, 'FACTORY: 首页预约入口')
    await writeTicketTrail(dir, children[0].number)
    await commitAll(dir, 'FACTORY: 子票证据')
    const state = await collectRequirementState({
      gh,
      owner: OWNER,
      repo: REPO,
      parent,
      repoDir: dir,
    })
    const headBefore = await git(dir, ['rev-parse', 'req/order-1'])
    const fakeCalls = silentCalls()

    const result = await finishRequirement({
      repoDir: dir,
      owner: OWNER,
      repo: REPO,
      parent: state,
      reqBranch: 'req/order-1',
      mainBranch: 'main',
      review: fakeCalls.review,
      verify: fakeCalls.verify,
      openPr: async () => {
        fakeCalls.calls.push(['openPr'])
        return {}
      },
      mergePr: async () => {
        fakeCalls.calls.push(['mergePr'])
        return {}
      },
      notifier: fakeCalls.notifier,
      cleanup: fakeCalls.cleanup,
    })

    assert.equal(result.ok, false)
    assert.equal(result.reason, 'open_sub_tickets')
    assert.deepEqual(result.open, [children[1].number])
    assert.deepEqual(fakeCalls.calls, [])
    assert.equal(await git(dir, ['rev-parse', 'req/order-1']), headBefore)
    assert.equal(fake.state.pulls.get(`${OWNER}/${REPO}`).length, 0)
  } finally {
    await fake.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('子票全合完、收尾评审和验证都过：建 PR、合主干、通知自己合并、清 worktree', async () => {
  const { fake, gh, parent, children } = await setupGithub({
    children: [
      { title: '第一块', state: 'closed' },
      { title: '第二块', state: 'closed' },
    ],
  })
  const dir = await requirementRepo(children)
  try {
    const state = await collectRequirementState({
      gh,
      owner: OWNER,
      repo: REPO,
      parent,
      repoDir: dir,
    })
    const calls = []
    const sent = []
    const result = await finishRequirement({
      repoDir: dir,
      owner: OWNER,
      repo: REPO,
      parent: state,
      reqBranch: 'req/order-1',
      mainBranch: 'main',
      review: async (ctx) => {
        calls.push(['review', ctx])
        return { ok: true, decision: '两轴都过' }
      },
      verify: async (ctx) => {
        calls.push(['verify', ctx])
        return { ok: true, evidence: '关键路径通过' }
      },
      openPr: async ({ owner, repo, base, head, title, body }) => {
        calls.push(['openPr', { owner, repo, base, head, title, body }])
        return gh.request('POST', `/repos/${owner}/${repo}/pulls`, { base, head, title, body })
      },
      mergePr: async ({ owner, repo, pr, method }) => {
        calls.push(['mergePr', { pr, method }])
        return gh.mergePull({ owner, repo, number: pr.number, mergeMethod: method })
      },
      notifier: { send: async (event) => sent.push(event) },
      cleanup: async (ctx) => calls.push(['cleanup', ctx]),
    })

    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(result.mergeSha, 'merge-1')

    const pulls = fake.state.pulls.get(`${OWNER}/${REPO}`)
    assert.equal(pulls.length, 1)
    assert.equal(pulls[0].merged, true)
    assert.equal(pulls[0].base.ref, 'main')
    assert.equal(pulls[0].head.ref, 'req/order-1')
    for (const heading of ['## 摘要', '## 证据', '## 合并危险', '## 影响范围']) {
      assert.ok(pulls[0].body.includes(heading), `PR 正文缺 ${heading}`)
    }
    assert.ok(pulls[0].body.includes('改前：.audit/before.png'), pulls[0].body)
    assert.ok(pulls[0].body.includes('改后：.audit/after.png'), pulls[0].body)
    assert.ok(pulls[0].body.includes('FACTORY: 首页预约入口'), pulls[0].body)
    assert.ok(pulls[0].body.includes('双向门'), pulls[0].body)
    assert.ok(pulls[0].body.includes('app.txt'), pulls[0].body)

    assert.ok(
      sent.some(
        (event) =>
          event.event === '自己合并' &&
          event.data.pr === 1 &&
          event.data.customer === 'B 店' &&
          event.data.requirement === '预约取货',
      ),
      JSON.stringify(sent),
    )
    assert.ok(calls.some(([kind, ctx]) => kind === 'review' && ctx.axis === 'final'))
    assert.ok(
      calls.some(
        ([kind, ctx]) => kind === 'verify' && ctx.branch === 'req/order-1' && ctx.parent.number === parent.number,
      ),
    )
    assert.ok(
      calls.some(
        ([kind, ctx]) => kind === 'cleanup' && ctx.reqBranch === 'req/order-1' && ctx.repoDir === dir,
      ),
    )
  } finally {
    await fake.close()
    await rm(dir, { recursive: true, force: true })
  }
})

function flowInjections(gh, calls = [], sent = []) {
  return {
    review: async (ctx) => {
      calls.push(['review', ctx])
      return { ok: true }
    },
    verify: async (ctx) => {
      calls.push(['verify', ctx])
      return { ok: true }
    },
    openPr: async (args) => {
      calls.push(['openPr', args])
      return gh.request('POST', `/repos/${args.owner}/${args.repo}/pulls`, args)
    },
    mergePr: async ({ owner, repo, pr, method }) => {
      calls.push(['mergePr', { pr, method }])
      return gh.mergePull({ owner, repo, number: pr.number, mergeMethod: method })
    },
    notifier: { send: async (event) => sent.push(event) },
    cleanup: async (ctx) => calls.push(['cleanup', ctx]),
  }
}

async function closedRequirement() {
  const { fake, gh, parent, children } = await setupGithub({
    children: [
      { title: '第一块', state: 'closed' },
      { title: '第二块', state: 'closed' },
    ],
  })
  const dir = await requirementRepo(children)
  const state = await collectRequirementState({
    gh,
    owner: OWNER,
    repo: REPO,
    parent,
    repoDir: dir,
  })
  return { fake, gh, parent, children, dir, state }
}

test('收尾评审有问题：fixer 统一修一次，复审通过后照常合', async () => {
  const { fake, gh, dir, state } = await closedRequirement()
  try {
    const calls = []
    const sent = []
    const fixCalls = []
    let reviewCount = 0
    const result = await finishRequirement({
      repoDir: dir,
      owner: OWNER,
      repo: REPO,
      parent: state,
      reqBranch: 'req/order-1',
      mainBranch: 'main',
      ...flowInjections(gh, calls, sent),
      review: async (ctx) => {
        reviewCount += 1
        calls.push(['review', ctx])
        if (reviewCount === 1) return { ok: false, findings: ['验收条件第 2 条没做'] }
        return { ok: true }
      },
      fixer: async (ctx) => {
        fixCalls.push(ctx)
        return { ok: true }
      },
    })

    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(reviewCount, 2)
    assert.equal(fixCalls.length, 1)
    assert.deepEqual(fixCalls[0].findings, ['验收条件第 2 条没做'])
    assert.equal(fake.state.pulls.get(`${OWNER}/${REPO}`)[0].merged, true)
    assert.ok(sent.some((event) => event.event === '自己合并'))
  } finally {
    await fake.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('fixer 修过仍不过：通知「出事」，不合主干，不放宽', async () => {
  const { fake, gh, dir, state } = await closedRequirement()
  try {
    const calls = []
    const sent = []
    const fixCalls = []
    let reviewCount = 0
    let opened = false
    const result = await finishRequirement({
      repoDir: dir,
      owner: OWNER,
      repo: REPO,
      parent: state,
      reqBranch: 'req/order-1',
      mainBranch: 'main',
      ...flowInjections(gh, calls, sent),
      openPr: async () => {
        opened = true
        return {}
      },
      review: async (ctx) => {
        reviewCount += 1
        calls.push(['review', ctx])
        return { ok: false, findings: ['验收条件第 2 条没做'] }
      },
      fixer: async (ctx) => {
        fixCalls.push(ctx)
        return { ok: true }
      },
    })

    assert.equal(result.ok, false)
    assert.equal(result.reason, 'review_failed')
    assert.ok(result.findings.includes('验收条件第 2 条没做'))
    assert.equal(reviewCount, 2)
    assert.equal(fixCalls.length, 1)
    assert.equal(opened, false)
    assert.equal(fake.state.pulls.get(`${OWNER}/${REPO}`).length, 0)
    assert.ok(!calls.some(([kind]) => kind === 'cleanup'))
    const incident = sent.find((event) => event.event === '出事')
    assert.ok(incident)
    assert.equal(incident.data.reason, '验证评审修不过')
    assert.ok(incident.data.tried.includes('两轮没过'), incident.data.tried)
    assert.ok(incident.data.tried.includes('验收条件第 2 条没做'), incident.data.tried)
  } finally {
    await fake.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('PR 上验证没过：通知「出事」，不合主干，不清理', async () => {
  const { fake, gh, dir, state } = await closedRequirement()
  try {
    const calls = []
    const sent = []
    let mergeCalls = 0
    const result = await finishRequirement({
      repoDir: dir,
      owner: OWNER,
      repo: REPO,
      parent: state,
      reqBranch: 'req/order-1',
      mainBranch: 'main',
      ...flowInjections(gh, calls, sent),
      mergePr: async () => {
        mergeCalls += 1
        return { merged: true }
      },
      verify: async (ctx) => {
        calls.push(['verify', ctx])
        return { ok: false, problems: ['预约入口 404'] }
      },
    })

    assert.equal(result.ok, false)
    assert.equal(result.reason, 'verify_failed')
    assert.equal(mergeCalls, 0)
    assert.ok(!calls.some(([kind]) => kind === 'cleanup'))
    const pulls = fake.state.pulls.get(`${OWNER}/${REPO}`)
    assert.equal(pulls.length, 1)
    assert.equal(pulls[0].merged, false)
    assert.equal(pulls[0].state, 'open')
    const incident = sent.find((event) => event.event === '出事')
    assert.ok(incident)
    assert.equal(incident.data.reason, '验证评审修不过')
    assert.ok(incident.data.tried.includes('PR #1 上验证没过'), incident.data.tried)
    assert.ok(incident.data.tried.includes('预约入口 404'), incident.data.tried)
  } finally {
    await fake.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('小需求的收尾评审：Spec 轴读父工单的结论、验收条件、不做清单', async () => {
  const { fake, gh, parent, children } = await setupGithub({
    children: [{ title: '整张小需求一次做完', state: 'closed' }],
    parentLabels: ['大小:小需求'],
  })
  const dir = await requirementRepo(children)
  try {
    const state = await collectRequirementState({
      gh,
      owner: OWNER,
      repo: REPO,
      parent,
      repoDir: dir,
    })
    let reviewCtx = null
    const result = await finishRequirement({
      repoDir: dir,
      owner: OWNER,
      repo: REPO,
      parent: state,
      reqBranch: 'req/order-1',
      mainBranch: 'main',
      ...flowInjections(gh),
      review: async (ctx) => {
        reviewCtx = ctx
        return { ok: true }
      },
    })

    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(reviewCtx.small, true)
    assert.equal(reviewCtx.axis, 'final')
    for (const heading of ['## 客户确认的结论', '## 验收条件', '## 不做清单']) {
      assert.ok(reviewCtx.parent.body.includes(heading), `父工单缺 ${heading}`)
    }
    assert.ok(reviewCtx.parent.body.includes('取货时间按小时选'))
    assert.ok(reviewCtx.parent.body.includes('不做导出'))
  } finally {
    await fake.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('子票都关了但 trail 里没有合并行：拒绝收尾，什么都不动', async () => {
  const { fake, gh, parent, children } = await setupGithub({
    children: [
      { title: '第一块', state: 'closed' },
      { title: '第二块', state: 'closed' },
    ],
  })
  const dir = await makeRepo()
  try {
    await git(dir, ['checkout', '-b', 'req/order-1'])
    await writeFile(join(dir, 'app.txt'), 'feature\n')
    await commitAll(dir, 'FACTORY: 首页预约入口')
    await writeTicketTrail(dir, children[0].number)
    await writeTicketTrail(dir, children[1].number, trailRows({ merge: false }))
    await commitAll(dir, 'FACTORY: 子票证据')
    const state = await collectRequirementState({
      gh,
      owner: OWNER,
      repo: REPO,
      parent,
      repoDir: dir,
    })
    const calls = []
    const result = await finishRequirement({
      repoDir: dir,
      owner: OWNER,
      repo: REPO,
      parent: state,
      reqBranch: 'req/order-1',
      mainBranch: 'main',
      ...flowInjections(gh, calls),
    })

    assert.equal(result.ok, false)
    assert.equal(result.reason, 'unmerged_sub_tickets')
    assert.deepEqual(result.unmerged, [children[1].number])
    assert.deepEqual(calls, [])
    assert.equal(fake.state.pulls.get(`${OWNER}/${REPO}`).length, 0)
  } finally {
    await fake.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('重跑已经合过主干的父工单：不重复建 PR、不重复合、不再通知', async () => {
  const { fake, gh, dir, state } = await closedRequirement()
  try {
    await git(dir, ['checkout', 'main'])
    await git(dir, ['merge', '--no-ff', '--no-edit', 'req/order-1'])
    await git(dir, ['checkout', 'req/order-1'])

    const calls = []
    const sent = []
    const result = await finishRequirement({
      repoDir: dir,
      owner: OWNER,
      repo: REPO,
      parent: state,
      reqBranch: 'req/order-1',
      mainBranch: 'main',
      ...flowInjections(gh, calls, sent),
    })

    assert.equal(result.ok, true)
    assert.equal(result.alreadyMerged, true)
    assert.deepEqual(calls, [])
    assert.deepEqual(sent, [])
    assert.equal(fake.state.pulls.get(`${OWNER}/${REPO}`).length, 0)
  } finally {
    await fake.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('规则判成单向门也照样自己合，PR 正文写明触发规则', async () => {
  const { fake, gh, parent, children } = await setupGithub({
    children: [{ title: '第一块', state: 'closed' }],
  })
  const dir = await makeRepo()
  try {
    await git(dir, ['checkout', '-b', 'req/order-1'])
    await writeFile(join(dir, 'app.txt'), 'feature\n')
    await mkdir(join(dir, 'db', 'migrations'), { recursive: true })
    await writeFile(join(dir, 'db', 'migrations', '001_init.sql'), 'create table t;\n')
    await commitAll(dir, 'FACTORY: 加迁移')
    await writeTicketTrail(dir, children[0].number)
    await commitAll(dir, 'FACTORY: 子票证据')
    const state = await collectRequirementState({
      gh,
      owner: OWNER,
      repo: REPO,
      parent,
      repoDir: dir,
    })
    const sent = []
    const result = await finishRequirement({
      repoDir: dir,
      owner: OWNER,
      repo: REPO,
      parent: state,
      reqBranch: 'req/order-1',
      mainBranch: 'main',
      ...flowInjections(gh, [], sent),
    })

    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(result.risk.direction, 'one-way')
    const pull = fake.state.pulls.get(`${OWNER}/${REPO}`)[0]
    assert.equal(pull.merged, true)
    assert.ok(pull.body.includes('单向门'), pull.body)
    assert.ok(pull.body.includes('碰迁移'), pull.body)
    assert.ok(sent.some((event) => event.event === '自己合并'))
  } finally {
    await fake.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('finish --dry-run 只打印四栏和检查结果，不建 PR', async () => {
  const { fake, gh, parent, children } = await setupGithub({
    children: [
      { title: '第一块', state: 'closed' },
      { title: '第二块', state: 'closed' },
    ],
  })
  const dir = await requirementRepo(children)
  try {
    const { output, exitCode } = await runFinish(
      {
        owner: OWNER,
        repo: REPO,
        parent: String(parent.number),
        'repo-dir': dir,
        'req-branch': 'req/order-1',
        main: 'main',
        dryRun: true,
      },
      { gh },
    )

    assert.equal(exitCode, 0, JSON.stringify(output))
    assert.equal(output.dryRun, true)
    assert.equal(output.ok, true)
    assert.equal(output.checks.allClosed, true)
    assert.deepEqual(output.checks.unmerged, [])
    for (const heading of ['## 摘要', '## 证据', '## 合并危险', '## 影响范围']) {
      assert.ok(output.pr.body.includes(heading), `dry-run 四栏缺 ${heading}`)
    }
    assert.equal(fake.state.pulls.get(`${OWNER}/${REPO}`).length, 0)
  } finally {
    await fake.close()
    await rm(dir, { recursive: true, force: true })
  }
})
