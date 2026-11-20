import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { addRemote, commitAll, initBareRepo, initRepo, push } from '../../factory/lib/git.mjs'
import { startFakeGithub } from '../../factory/test/fake-github.mjs'
import { createGithubApi } from '../lib/github-api.mjs'
import { importOnce } from '../lib/import.mjs'
import { recordUpload } from '../lib/orders.mjs'
import { writeJsonAtomic } from '../lib/store.mjs'
import { login, isolateVerifyPort, makeConfig, seedCustomer, startServer } from './helpers.mjs'

const execFileAsync = promisify(execFile)
const SAMPLE = fileURLToPath(new URL('../../docs/回传样例/工作区/.scratch/xianguopu/', import.meta.url))
const STATUS_LABELS = [
  'needs-triage',
  'needs-info',
  'ready-for-agent',
  'ready-for-human',
  'wontfix',
  '状态:已提交',
  '状态:排队中',
  '状态:开发中',
  '状态:待验收',
]

async function makeOrder(config, customer, { requirement, product = requirement, passed = true, missing = [] }) {
  const { order } = await recordUpload(config, customer, {
    requirement,
    product,
    title: requirement,
    filename: 'workspace.zip',
    size: 3,
    sha256: `sha-${requirement}`,
    validation: { passed, finished: true, missing, checks: {} },
    now: new Date().toISOString(),
  })
  return order
}

async function makeScratch(dir, { name, decisions = '- [01 怎么取](issues/01.md)：到店取', quote = '想要预约取货。' }) {
  const requirement = name
  const target = join(dir, requirement)
  await mkdir(target, { recursive: true })
  await writeFile(
    join(target, 'map.md'),
    `# ${requirement} 地图

## 接下来

## Decisions so far

${decisions}

## Not yet specified

## Out of scope

- 会员积分
`,
    'utf8',
  )
  await writeFile(
    join(target, '问答记录.md'),
    `# 问答记录

## 客户原话

> 「${quote}」

日期：2026-11-15
`,
    'utf8',
  )
  await writeFile(
    join(target, '验收场景.md'),
    '# 验收场景\n\n客户确认：2026-11-15\n\n- [ ] 能预约。\n',
    'utf8',
  )
  return target
}

async function makeUpload(config, { id, orders, requirements }) {
  const dir = join(config.uploadDir, id)
  const scratchRoot = join(dir, 'work', 'scratch')
  await mkdir(scratchRoot, { recursive: true })
  for (const requirement of requirements) {
    if (requirement.copySample) {
      await cp(SAMPLE, join(scratchRoot, requirement.name), { recursive: true })
    } else {
      await makeScratch(scratchRoot, requirement)
    }
  }
  await writeFile(join(dir, 'package.zip'), 'zip', 'utf8')
  const meta = {
    id,
    at: new Date().toISOString(),
    filename: 'workspace.zip',
    size: 3,
    sha256: `sha-${id}`,
    user: { id: 'c-0001', short_name: 'acme' },
    status: 'ready',
    requirements: requirements.map((item) => ({ name: item.name, passed: item.passed !== false })),
    orders: orders.map((order) => order.id),
    missing: [],
  }
  await writeJsonAtomic(join(dir, 'meta.json'), meta)
  return { dir, meta }
}

async function setup(t, { customerExtras = {}, fakeRepos = [] } = {}) {
  await isolateVerifyPort()
  const { config, root } = await makeConfig()
  const customer = await seedCustomer(config, customerExtras)
  const fake = await startFakeGithub({ repos: fakeRepos })
  t.after(() => fake.close())
  const gh = createGithubApi({ apiBase: fake.base, token: 'test' })
  config.githubOwner = 'acme'
  config.githubAdminToken = 'test'
  config.githubApi = fake.base
  const bare = await initBareRepo(join(root, 'remote.git'))
  return { config, root, customer, fake, gh, bare }
}

test('新软件校验通过后建仓、拷快照、建父工单并回写订单和仓指针', async (t) => {
  const { config, root, customer, fake, gh, bare } = await setup(t)
  const order = await makeOrder(config, customer, { requirement: 'xianguopu', product: 'xianguopu' })
  const { dir } = await makeUpload(config, {
    id: 'upload-1',
    orders: [order],
    requirements: [{ name: 'xianguopu', copySample: true }],
  })

  const result = await importOnce({ config, gh, remoteUrlFor: () => bare })
  assert.deepEqual(result.uploads, [{ id: 'upload-1', status: 'imported' }])

  const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8'))
  assert.equal(meta.status, 'imported')
  assert.ok(meta.imported_at)
  assert.deepEqual(meta.orders, [order.id])
  assert.deepEqual(meta.imported, [
    {
      order_id: order.id,
      requirement: 'xianguopu',
      product: 'xianguopu',
      owner: 'acme',
      repo: 'acme-xianguopu',
      issue_url: 'https://github.com/acme/acme-xianguopu/issues/1',
      branch: `req/${order.id}`,
    },
  ])
  await stat(dir)

  const savedOrder = JSON.parse(await readFile(join(config.dataDir, 'orders', `${order.id}.json`), 'utf8'))
  assert.equal(savedOrder.issue, 'https://github.com/acme/acme-xianguopu/issues/1')
  assert.equal(savedOrder.product, 'xianguopu')
  assert.equal(savedOrder.branch, `req/${order.id}`)
  assert.equal(savedOrder.transitions.length, order.transitions.length)

  const rows = JSON.parse(await readFile(join(config.dataDir, 'customers.json'), 'utf8'))
  assert.deepEqual(rows[0].repos, { xianguopu: 'acme-xianguopu' })
  assert.equal(rows[0].password_hash, customer.password_hash)
  assert.equal(rows[0].updated_at, customer.updated_at)

  const issues = await gh.listIssues({ owner: 'acme', repo: 'acme-xianguopu', state: 'all' })
  assert.equal(issues.length, 1)
  assert.equal(
    issues[0].title,
    '顾客想在我的微信小程序里看今天有什么水果，下单，选到店取还是送货。我在后台改价格和库存。',
  )
  assert.deepEqual(issues[0].labels.map((label) => label.name), ['状态:已提交'])
  assert.match(issues[0].body, /<!-- factory:order=o-0001 -->/)

  const clone = join(root, 'clone')
  await execFileAsync('git', ['clone', bare, clone])
  const readme = await readFile(join(clone, 'docs/requirements/xianguopu/README.md'), 'utf8')
  assert.equal(readme.split('\n')[0], '回传快照，以父工单和 spec 为准，不作为决策来源。')
  await stat(join(clone, 'docs/requirements/xianguopu/决策记录.md'))
  const branches = await execFileAsync('git', ['-C', clone, 'branch', '-r'])
  assert.match(branches.stdout, new RegExp(`origin/req/${order.id}`))
  const tree = await execFileAsync('git', [
    '-c',
    'core.quotepath=false',
    '-C',
    clone,
    'ls-tree',
    '-r',
    '--name-only',
    `origin/req/${order.id}`,
  ])
  assert.match(tree.stdout, /docs\/requirements\/xianguopu\/问答记录\.md/)
})

test('建单成功但订单没回写时，重跑复用带标记的父工单并更新五段', async (t) => {
  const { config, customer, gh, bare } = await setup(t)
  const order = await makeOrder(config, customer, { requirement: 'xianguopu', product: 'xianguopu' })
  const { dir } = await makeUpload(config, {
    id: 'upload-reuse',
    orders: [order],
    requirements: [{ name: 'xianguopu', copySample: true }],
  })

  await importOnce({ config, gh, remoteUrlFor: () => bare })
  const issues = await gh.listIssues({ owner: 'acme', repo: 'acme-xianguopu', state: 'all' })
  assert.equal(issues.length, 1)
  const issueNumber = issues[0].number

  const orderPath = join(config.dataDir, 'orders', `${order.id}.json`)
  const savedOrder = JSON.parse(await readFile(orderPath, 'utf8'))
  await writeJsonAtomic(orderPath, { ...savedOrder, issue: null })
  await gh.updateIssue({
    owner: 'acme',
    repo: 'acme-xianguopu',
    number: issueNumber,
    title: '旧标题',
    body: '旧正文\n\n<!-- factory:order=o-0001 -->\n',
  })
  const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8'))
  await writeJsonAtomic(join(dir, 'meta.json'), { ...meta, status: 'ready' })

  const second = await importOnce({ config, gh, remoteUrlFor: () => bare })
  assert.equal(second.uploads[0].status, 'imported')

  const after = await gh.listIssues({ owner: 'acme', repo: 'acme-xianguopu', state: 'all' })
  assert.equal(after.length, 1)
  assert.notEqual(after[0].title, '旧标题')
  assert.match(after[0].body, /## 客户原话/)
  assert.match(after[0].body, /<!-- factory:order=o-0001 -->/)
  assert.deepEqual(after[0].labels.map((label) => label.name), ['状态:已提交'])

  const fixed = JSON.parse(await readFile(orderPath, 'utf8'))
  assert.equal(fixed.issue, after[0].html_url)
})

test('同一上传重跑不重复建单，订单已有工单就跳过', async (t) => {
  const { config, customer, fake, gh, bare } = await setup(t)
  const order = await makeOrder(config, customer, { requirement: 'xianguopu', product: 'xianguopu' })
  const { dir } = await makeUpload(config, {
    id: 'upload-1',
    orders: [order],
    requirements: [{ name: 'xianguopu', copySample: true }],
  })

  await importOnce({ config, gh, remoteUrlFor: () => bare })
  const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8'))
  await writeJsonAtomic(join(dir, 'meta.json'), { ...meta, status: 'ready' })
  const rowsBefore = JSON.parse(await readFile(join(config.dataDir, 'customers.json'), 'utf8'))
  await writeJsonAtomic(join(config.dataDir, 'customers.json'), [{ ...rowsBefore[0], repos: {} }])

  const second = await importOnce({ config, gh, remoteUrlFor: () => bare })
  assert.equal(second.uploads[0].status, 'imported')
  const issues = await gh.listIssues({ owner: 'acme', repo: 'acme-xianguopu', state: 'all' })
  assert.equal(issues.length, 1)
  assert.equal(fake.state.repos.size, 1)
  const rows = JSON.parse(await readFile(join(config.dataDir, 'customers.json'), 'utf8'))
  assert.deepEqual(rows[0].repos, { xianguopu: 'acme-xianguopu' })
})

test('同一软件的后继单复用已有仓，不新建仓', async (t) => {
  const { config, root, customer, fake, gh, bare } = await setup(t, {
    customerExtras: { repos: { shuiguo: 'acme-shuiguo' } },
    fakeRepos: [{ owner: 'acme', name: 'acme-shuiguo' }],
  })
  const seed = join(root, 'seed')
  await initRepo(seed)
  await writeFile(join(seed, 'README.md'), '# 已有仓\n', 'utf8')
  await commitAll(seed, 'seed: 已有仓')
  await addRemote(seed, 'origin', bare)
  await push(seed)
  const labels = await gh.listLabels({ owner: 'acme', repo: 'acme-shuiguo' })
  const present = new Set((labels || []).map((row) => row.name))
  for (const name of STATUS_LABELS) {
    if (!present.has(name)) {
      await gh.createLabel({ owner: 'acme', repo: 'acme-shuiguo', name, color: 'ededed' })
    }
  }

  const order = await makeOrder(config, customer, { requirement: 'kucun', product: 'shuiguo' })
  const { dir } = await makeUpload(config, {
    id: 'upload-2',
    orders: [order],
    requirements: [{ name: 'kucun' }],
  })

  await importOnce({ config, gh, remoteUrlFor: () => bare })

  assert.equal(fake.state.repos.size, 1)
  const issues = await gh.listIssues({ owner: 'acme', repo: 'acme-shuiguo', state: 'all' })
  assert.equal(issues.length, 1)
  const rows = JSON.parse(await readFile(join(config.dataDir, 'customers.json'), 'utf8'))
  assert.deepEqual(rows[0].repos, { shuiguo: 'acme-shuiguo' })

  const clone = join(root, 'clone')
  await execFileAsync('git', ['clone', bare, clone])
  await stat(join(clone, 'docs/requirements/kucun/README.md'))
  const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8'))
  assert.equal(meta.status, 'imported')
})

test('第二个软件建新仓并写新键，保留已有键', async (t) => {
  const { config, customer, fake, gh, bare } = await setup(t, {
    customerExtras: { repos: { shuiguo: 'acme-shuiguo' } },
  })
  const order = await makeOrder(config, customer, { requirement: 'kucun', product: 'kucun' })
  await makeUpload(config, { id: 'upload-3', orders: [order], requirements: [{ name: 'kucun' }] })

  await importOnce({ config, gh, remoteUrlFor: () => bare })

  assert.ok(fake.state.repos.has('acme/acme-kucun'))
  const rows = JSON.parse(await readFile(join(config.dataDir, 'customers.json'), 'utf8'))
  assert.deepEqual(rows[0].repos, { shuiguo: 'acme-shuiguo', kucun: 'acme-kucun' })
})

test('地图 Decisions 行首出现已废时不建仓不建单，转运营者', async (t) => {
  const { config, customer, fake, gh, bare } = await setup(t)
  const order = await makeOrder(config, customer, { requirement: 'demo', product: 'demo' })
  const { dir } = await makeUpload(config, {
    id: 'upload-4',
    orders: [order],
    requirements: [{ name: 'demo', decisions: '- 已废：旧的送货方案' }],
  })

  const result = await importOnce({ config, gh, remoteUrlFor: () => bare })
  assert.equal(result.uploads[0].status, 'needs_operator')
  assert.equal(fake.state.repos.size, 0)
  const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8'))
  assert.equal(meta.status, 'needs_operator')
  assert.equal(meta.operator_alert.reason, 'deprecated_map_decisions')
  assert.match(meta.operator_alert.message, /已废/)
  await stat(dir)
  const savedOrder = JSON.parse(await readFile(join(config.dataDir, 'orders', `${order.id}.json`), 'utf8'))
  assert.equal(savedOrder.issue, null)
})

test('导入失败保留快照、写失败原因和运营者提醒', async (t) => {
  const { config, customer, gh, bare } = await setup(t)
  const order = await makeOrder(config, customer, { requirement: 'demo', product: 'demo' })
  const { dir } = await makeUpload(config, { id: 'upload-5', orders: [order], requirements: [{ name: 'demo' }] })
  const failing = {
    ...gh,
    createIssue: async () => {
      throw new Error('建单炸了')
    },
  }

  const result = await importOnce({ config, gh: failing, remoteUrlFor: () => bare })
  assert.equal(result.uploads[0].status, 'import_failed')
  const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8'))
  assert.equal(meta.status, 'import_failed')
  assert.equal(meta.operator_alert.reason, 'import_failed')
  assert.match(meta.operator_alert.message, /建单炸了/)
  await stat(dir)
  const savedOrder = JSON.parse(await readFile(join(config.dataDir, 'orders', `${order.id}.json`), 'utf8'))
  assert.equal(savedOrder.issue, null)
})

test('小需求的父工单额外打 大小:小需求，标签不存在时先建', async (t) => {
  const { config, customer, fake, gh, bare } = await setup(t)
  const order = await makeOrder(config, customer, { requirement: 'demo', product: 'demo' })
  const { dir } = await makeUpload(config, { id: 'upload-6', orders: [order], requirements: [{ name: 'demo' }] })
  const draft = join(dir, 'work', 'scratch', 'demo')
  await rm(join(draft, 'map.md'))
  await writeFile(
    join(draft, '需求草稿.md'),
    `# demo 需求草稿

Status: 已问完

## 1. 客户原话

- 想要预约取货。

## 3. 已经定下的

- 到店取

## 5. 以后再说

- 无

复核：查过
`,
    'utf8',
  )

  await importOnce({ config, gh, remoteUrlFor: () => bare })

  const issues = await gh.listIssues({ owner: 'acme', repo: 'acme-demo', state: 'all' })
  assert.equal(issues.length, 1)
  assert.deepEqual(issues[0].labels.map((label) => label.name).sort(), ['大小:小需求', '状态:已提交'].sort())
  const labels = await gh.listLabels({ owner: 'acme', repo: 'acme-demo' })
  assert.ok(labels.some((label) => label.name === '大小:小需求'))
})

test('校验未通过只发一次邮件，不建仓不建单；重跑不重发', async (t) => {
  const { config, customer, fake, gh, bare } = await setup(t)
  const missing = ['缺验收场景。让 agent 按已经定下的内容起草验收场景。', '还有票没做完：01.md。']
  const order = await makeOrder(config, customer, {
    requirement: 'demo',
    product: 'demo',
    passed: false,
    missing,
  })
  const { dir } = await makeUpload(config, {
    id: 'upload-7',
    orders: [order],
    requirements: [{ name: 'demo', passed: false }],
  })
  const sent = []

  const first = await importOnce({
    config,
    gh,
    remoteUrlFor: () => bare,
    mailSender: async (mail) => sent.push(mail),
  })
  assert.equal(first.uploads[0].status, 'validation_failed')
  assert.equal(sent.length, 1)
  assert.match(sent[0].body, /缺验收场景/)
  assert.match(sent[0].body, /还有票没做完/)
  assert.match(sent[0].body, /\/app\/orders\/o-0001/)
  assert.equal(fake.state.repos.size, 0)

  const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8'))
  assert.equal(meta.status, 'validation_failed')
  assert.equal(meta.mail.sha256, meta.sha256)

  await importOnce({ config, gh, remoteUrlFor: () => bare, mailSender: async (mail) => sent.push(mail) })
  assert.equal(sent.length, 1)
})

test('发过邮件后导入失败，重跑不重发', async (t) => {
  const { config, customer, gh, bare } = await setup(t)
  const failedOrder = await makeOrder(config, customer, {
    requirement: 'demo',
    product: 'demo',
    passed: false,
    missing: ['缺验收场景。'],
  })
  const passedOrder = await makeOrder(config, customer, { requirement: 'kucun', product: 'demo' })
  const { dir } = await makeUpload(config, {
    id: 'upload-9',
    orders: [failedOrder, passedOrder],
    requirements: [{ name: 'demo', passed: false }, { name: 'kucun' }],
  })
  const sent = []
  const failing = {
    ...gh,
    createIssue: async () => {
      throw new Error('建单炸了')
    },
  }

  await importOnce({
    config,
    gh: failing,
    remoteUrlFor: () => bare,
    mailSender: async (mail) => sent.push(mail),
  })
  assert.equal(sent.length, 1)
  const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8'))
  assert.equal(meta.status, 'import_failed')
  assert.equal(meta.mail.sha256, meta.sha256)
  await writeJsonAtomic(join(dir, 'meta.json'), { ...meta, status: 'ready' })

  await importOnce({
    config,
    gh: failing,
    remoteUrlFor: () => bare,
    mailSender: async (mail) => sent.push(mail),
  })
  assert.equal(sent.length, 1)
})

test('导入失败把订单写成 import_failed 终态，订单接口给出原因和下一步', async (t) => {
  const { config, customer, gh, bare } = await setup(t)
  const order = await makeOrder(config, customer, { requirement: 'demo', product: 'demo' })
  await makeUpload(config, { id: 'upload-order-failed', orders: [order], requirements: [{ name: 'demo' }] })
  const failing = {
    ...gh,
    createIssue: async () => {
      throw new Error('建单炸了')
    },
  }

  await importOnce({ config, gh: failing, remoteUrlFor: () => bare })

  const savedOrder = JSON.parse(
    await readFile(join(config.dataDir, 'orders', `${order.id}.json`), 'utf8'),
  )
  assert.equal(savedOrder.import_status, 'import_failed')
  assert.equal(savedOrder.import_failure.status, 'import_failed')
  assert.match(savedOrder.import_failure.message, /建单炸了/)
  assert.ok(savedOrder.import_failure.next_step)
  assert.ok(savedOrder.import_failure.at)

  const server = await startServer(config)
  try {
    const { cookie } = await login(server.base)
    const response = await fetch(`${server.base}/app/api/orders/${order.id}`, {
      headers: { Cookie: cookie },
    })
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.order.import_status, 'import_failed')
    assert.equal(body.order.import_failure.status, 'import_failed')
    assert.match(body.order.import_failure.message, /建单炸了/)
    assert.match(body.order.import_failure.next_step, /运营者/)
  } finally {
    await server.close()
  }
})

test('多单里一单导入失败，其余继续，上传记 import_partial 和每单结果', async (t) => {
  const { config, root, customer, fake, gh, bare } = await setup(t)
  const secondBare = await initBareRepo(join(root, 'remote2.git'))
  const broken = await makeOrder(config, customer, { requirement: 'demo', product: 'demo' })
  const healthy = await makeOrder(config, customer, { requirement: 'kucun', product: 'kucun' })
  const { dir } = await makeUpload(config, {
    id: 'upload-partial',
    orders: [broken, healthy],
    requirements: [{ name: 'demo' }, { name: 'kucun' }],
  })
  const failing = {
    ...gh,
    createIssue: async (args) => {
      if (args.repo === 'acme-demo') throw new Error('demo 仓建单炸了')
      return gh.createIssue(args)
    },
  }

  const result = await importOnce({
    config,
    gh: failing,
    remoteUrlFor: ({ repo }) => (repo === 'acme-kucun' ? secondBare : bare),
  })

  assert.equal(result.uploads[0].status, 'import_partial')
  const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8'))
  assert.equal(meta.status, 'import_partial')
  assert.equal(meta.operator_alert.reason, 'import_partial')
  assert.match(meta.operator_alert.message, /demo 仓建单炸了/)
  const byOrder = new Map(meta.results.map((item) => [item.order_id, item]))
  assert.equal(byOrder.get(broken.id).status, 'import_failed')
  assert.equal(byOrder.get(healthy.id).status, 'imported')

  const brokenOrder = JSON.parse(
    await readFile(join(config.dataDir, 'orders', `${broken.id}.json`), 'utf8'),
  )
  assert.equal(brokenOrder.import_status, 'import_failed')
  const healthyOrder = JSON.parse(
    await readFile(join(config.dataDir, 'orders', `${healthy.id}.json`), 'utf8'),
  )
  assert.equal(healthyOrder.import_status, 'imported')
  assert.ok(healthyOrder.issue)
  assert.ok(fake.state.repos.has('acme/acme-kucun'))
  const brokenIssues = await gh.listIssues({ owner: 'acme', repo: 'acme-demo', state: 'all' })
  assert.equal(brokenIssues.length, 0)
  assert.deepEqual(
    meta.imported.map((item) => item.order_id),
    [healthy.id],
  )
})

test('多单都转运营者时，上传状态和告警原因一致', async (t) => {
  const { config, customer, fake, gh, bare } = await setup(t)
  const first = await makeOrder(config, customer, { requirement: 'demo', product: 'demo' })
  const second = await makeOrder(config, customer, { requirement: 'kucun', product: 'kucun' })
  const { dir } = await makeUpload(config, {
    id: 'upload-deprecated-two',
    orders: [first, second],
    requirements: [
      { name: 'demo', decisions: '- 已废：旧的送货方案' },
      { name: 'kucun', decisions: '- 已被取代：旧库存方案' },
    ],
  })

  const result = await importOnce({ config, gh, remoteUrlFor: () => bare })

  assert.equal(result.uploads[0].status, 'needs_operator')
  const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8'))
  assert.equal(meta.status, 'needs_operator')
  assert.equal(meta.operator_alert.reason, 'needs_operator')
  assert.deepEqual(
    meta.results.map((item) => item.status),
    ['needs_operator', 'needs_operator'],
  )
  assert.equal(fake.state.repos.size, 0)
})

test('整包导入失败时不覆盖校验未通过的单', async (t) => {
  const { config, customer, gh, bare } = await setup(t)
  config.githubOwner = ''
  const invalid = await makeOrder(config, customer, {
    requirement: 'demo',
    product: 'demo',
    passed: false,
    missing: ['缺验收场景。'],
  })
  const passed = await makeOrder(config, customer, { requirement: 'kucun', product: 'kucun' })
  await makeUpload(config, {
    id: 'upload-owner-missing',
    orders: [invalid, passed],
    requirements: [{ name: 'demo', passed: false }, { name: 'kucun' }],
  })

  await importOnce({ config, gh, remoteUrlFor: () => bare })

  const invalidOrder = JSON.parse(
    await readFile(join(config.dataDir, 'orders', `${invalid.id}.json`), 'utf8'),
  )
  assert.equal(invalidOrder.import_status, '')
  assert.equal(invalidOrder.import_failure, null)
  assert.equal(invalidOrder.validation.passed, false)
  const passedOrder = JSON.parse(
    await readFile(join(config.dataDir, 'orders', `${passed.id}.json`), 'utf8'),
  )
  assert.equal(passedOrder.import_status, 'import_failed')
})

test('导入时没配 GITHUB_OWNER 按失败报，不猜账号', async (t) => {
  const { config, customer, gh, bare } = await setup(t)
  config.githubOwner = ''
  const order = await makeOrder(config, customer, { requirement: 'demo', product: 'demo' })
  const { dir } = await makeUpload(config, { id: 'upload-8', orders: [order], requirements: [{ name: 'demo' }] })

  const result = await importOnce({ config, gh, remoteUrlFor: () => bare })
  assert.equal(result.uploads[0].status, 'import_failed')
  const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8'))
  assert.match(meta.operator_alert.message, /GITHUB_OWNER/)
})
