import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { initBareRepo } from '../../factory/lib/git.mjs'
import { createGithub } from '../../factory/lib/github.mjs'
import { createDirRemote, pullInbox } from '../../factory/lib/inbox.mjs'
import { ensureMapIssues } from '../../factory/lib/map-issues.mjs'
import { startFakeGithub } from '../../factory/test/fake-github.mjs'
import { createGithubApi } from '../lib/github-api.mjs'
import { importOnce } from '../lib/import.mjs'
import { readOrders } from '../lib/orders.mjs'
import { login, isolateVerifyPort, makeConfig, seedCustomer, startServer, upload } from './helpers.mjs'

const execFileAsync = promisify(execFile)
const ZIP_SCRIPT = fileURLToPath(new URL('./make-zip.py', import.meta.url))
const SAMPLE_WORKSPACE = fileURLToPath(new URL('../../docs/回传样例/工作区', import.meta.url))
const OWNER = 'acme'
const REPO = 'acme-xianguopu'
const REQUIREMENT = 'xianguopu'

const V1_QUOTE =
  '顾客想在我的微信小程序里看今天有什么水果，下单，选到店取还是送货。我在后台改价格和库存。'
const V2_QUOTE = `${V1_QUOTE}门口也贴一张二维码。`

async function setup(t) {
  await isolateVerifyPort()
  const { config, root } = await makeConfig()
  await seedCustomer(config)
  const fake = await startFakeGithub({ repos: [] })
  t.after(() => fake.close())
  const gh = createGithubApi({ apiBase: fake.base, token: 'test' })
  config.githubOwner = OWNER
  config.githubAdminToken = 'test'
  config.githubApi = fake.base
  const bare = await initBareRepo(join(root, 'remote.git'))
  const server = await startServer(config)
  t.after(() => server.close())
  const { cookie } = await login(server.base)
  return { config, root, fake, gh, bare, server, cookie }
}

let workspaceSeq = 0

async function makeWorkspaceZip(root, mutate) {
  workspaceSeq += 1
  const workspace = join(root, `工作区-${workspaceSeq}`)
  await cp(SAMPLE_WORKSPACE, workspace, { recursive: true })
  const requirement = join(workspace, '.scratch', REQUIREMENT)
  if (mutate) await mutate(requirement)
  const zipPath = join(root, `workspace-${workspaceSeq}.zip`)
  await execFileAsync('python3', [ZIP_SCRIPT, workspace, zipPath])
  return { zipPath, requirement }
}

async function uploadWorkspace(env, mutate) {
  const { zipPath } = await makeWorkspaceZip(env.root, mutate)
  const response = await upload(env.server.base, env.cookie, await readFile(zipPath))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.orders.length, 1)
  return body.orders[0].id
}

async function runImport(env) {
  return importOnce({ config: env.config, gh: env.gh, remoteUrlFor: () => env.bare })
}

async function parentOf(env, orderId, repo = REPO) {
  const issues = await env.gh.listIssues({ owner: OWNER, repo, state: 'all' })
  return issues
    .filter((issue) => String(issue.body || '').includes(`<!-- factory:order=${orderId} -->`))
    .map((issue) => issue.number)
}

async function uploadDirs(config) {
  const names = (await readdir(config.uploadDir)).filter((name) => name.startsWith('upload-'))
  const rows = []
  for (const name of names) {
    const meta = JSON.parse(await readFile(join(config.uploadDir, name, 'meta.json'), 'utf8'))
    rows.push({ name, meta })
  }
  return rows.sort((left, right) => String(left.meta.at).localeCompare(String(right.meta.at)))
}

async function readTree(dir) {
  const tree = new Map()
  async function walk(current, prefix) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.name === 'README.md' && prefix === '') continue
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        await walk(join(current, entry.name), relative)
      } else {
        tree.set(relative, await readFile(join(current, entry.name), 'utf8'))
      }
    }
  }
  await walk(dir, '')
  return tree
}

async function editText(path, replace, replacement) {
  const text = await readFile(path, 'utf8')
  assert.ok(text.includes(replace), `${path} 里找不到要替换的原文：${replace}`)
  await writeFile(path, text.replace(replace, replacement))
}

async function makeV2(scratch) {  await editText(
    join(scratch, '问答记录.md'),
    `> 「${V1_QUOTE}」`,
    `> 「${V2_QUOTE}」`,
  )
  await editText(
    join(scratch, '验收场景.md'),
    '- [ ] 老板点「已取货」，顾客收到微信通知。（人工判断）\n',
    '- [ ] 老板点「已取货」，顾客收到微信通知。（人工判断）\n- [ ] 门口也贴一张二维码。\n',
  )
  await editText(
    join(scratch, 'map.md'),
    '老板在后台改价格和库存。',
    '老板在后台改价格和库存，门口也贴二维码。',
  )
  await editText(
    join(scratch, 'map.md'),
    '：店里贴二维码，扫进小程序看当天清单',
    '：店里和门口都贴二维码，扫进小程序看当天清单',
  )
  await editText(
    join(scratch, 'map.md'),
    '- [05 小程序用哪家云](issues/05-小程序用哪家云.md)：推荐微信云开发，等运营者确认\n',
    '- [06 送货范围怎么定](issues/06-送货范围怎么定.md)：只送镇上，超区自取\n',
  )
  await editText(
    join(scratch, 'issues', '01-顾客怎么看到今天有什么.md'),
    '客户原话：「店里贴个二维码，扫一下就能看。」\n',
    '客户原话：「店里贴个二维码，扫一下就能看。」\n\n客户补充：「门口也贴一张。」\n',
  )
  await editText(
    join(scratch, 'issues', '01-顾客怎么看到今天有什么.md'),
    '## 结论\n\n店里贴二维码，顾客扫进小程序看当天清单。',
    '## 结论\n\n店里和门口都贴二维码，顾客扫进小程序看当天清单。',
  )
  await writeFile(
    join(scratch, 'issues', '06-送货范围怎么定.md'),
    '# 06 送货范围怎么定\n\nType: grilling\nStatus: resolved\n\n## Question\n\n送货送到哪？\n\n## 评论\n\n客户原话：「超出镇上就不送了，让顾客自己来取。」\n\n## 结论\n\n只送镇上，超区自取。\n\n产出文件：无\n',
    'utf8',
  )
  await execFileAsync('rm', [join(scratch, 'issues', '05-小程序用哪家云.md')])
}

async function makeSmallWorkspaceZip(root, quote) {
  workspaceSeq += 1
  const workspace = join(root, `小需求-${workspaceSeq}`)
  const requirement = join(workspace, '.scratch', 'demo')
  await mkdir(requirement, { recursive: true })
  await writeFile(
    join(requirement, '需求草稿.md'),
    `# demo 需求草稿

Status: 已问完

## 1. 客户原话

- ${quote}

## 3. 已经定下的

- 到店取

## 5. 以后再说

- 无

复核：查过
`,
    'utf8',
  )
  await writeFile(
    join(requirement, '验收场景.md'),
    '# 验收场景\n\n客户确认：2026-11-15\n\n- [ ] 能预约。\n',
    'utf8',
  )
  const zipPath = join(root, `small-workspace-${workspaceSeq}.zip`)
  await execFileAsync('python3', [ZIP_SCRIPT, workspace, zipPath])
  return zipPath
}

async function uploadSmall(env, quote) {
  const zipPath = await makeSmallWorkspaceZip(env.root, quote)
  const response = await upload(env.server.base, env.cookie, await readFile(zipPath))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.orders.length, 1)
  return body.orders[0].id
}

test('to-spec 前整包重传：沿用父工单，五段、快照、标签和分支换成新包', async (t) => {
  const env = await setup(t)
  const orderId = await uploadWorkspace(env)
  const first = await runImport(env)
  assert.equal(first.uploads[0].status, 'imported')

  const before = await parentOf(env, orderId)
  assert.deepEqual(before.length, 1)
  const parentNumber = before[0]
  const orderBefore = (await readOrders(env.config)).find((order) => order.id === orderId)
  assert.ok(orderBefore.issue)

  // 模拟 to-spec 前已经排过队、点过火：重传要把这些标签摘掉。
  await env.gh.createLabel({ owner: OWNER, repo: REPO, name: 'Sandcastle', color: 'ededed' })
  await env.gh.removeLabel({ owner: OWNER, repo: REPO, number: parentNumber, name: '状态:已提交' })
  await env.gh.addLabels({
    owner: OWNER,
    repo: REPO,
    number: parentNumber,
    labels: ['状态:排队中', '状态:开发中', 'Sandcastle'],
  })

  const v1Dir = (await uploadDirs(env.config)).find((row) => row.meta.status === 'imported')
  const v1Scratch = join(env.config.uploadDir, v1Dir.name, 'work', 'scratch', REQUIREMENT)
  const v1MapBefore = await readFile(join(v1Scratch, 'map.md'), 'utf8')

  await uploadWorkspace(env, makeV2)
  const second = await runImport(env)
  assert.equal(second.uploads[0].status, 'imported')

  const orders = await readOrders(env.config)
  assert.equal(orders.length, 1)
  assert.equal(orders[0].id, orderId)
  assert.equal(orders[0].uploads.length, 2)
  assert.match(orders[0].transitions.at(-1).line, /轮次：2/)
  assert.equal(orders[0].issue, orderBefore.issue)

  const after = await parentOf(env, orderId)
  assert.deepEqual(after, [parentNumber])

  const parent = await env.gh.getIssue({ owner: OWNER, repo: REPO, number: parentNumber })
  assert.equal(parent.title, V2_QUOTE)
  assert.match(parent.body, /门口也贴一张二维码/)
  assert.match(parent.body, /店里和门口都贴二维码/)
  assert.doesNotMatch(parent.body, /推荐微信云开发/)
  assert.match(parent.body, new RegExp(`<!-- factory:order=${orderId} -->`))
  assert.deepEqual(parent.labels.map((label) => label.name), ['状态:已提交'])

  const comments = await env.gh.listComments({ owner: OWNER, repo: REPO, number: parentNumber })
  const latest = comments.at(-1)
  assert.match(latest.body, /^改口：重传 \d{4}-\d{2}-\d{2}T[\d:.]+Z，旧的提案和点头作废。$/)
  assert.match(latest.body, /旧的提案和点头作废/)

  // 需求目录快照等于新包，README 首行仍是快照说明。
  const secondUpload = (await uploadDirs(env.config)).find((row) => row.meta.status === 'imported' && row.name !== v1Dir.name)
  const v2Scratch = join(env.config.uploadDir, secondUpload.name, 'work', 'scratch', REQUIREMENT)
  const clone = join(env.root, 'clone-after-reupload')
  await execFileAsync('git', ['clone', env.bare, clone])
  const snapshot = join(clone, 'docs', 'requirements', REQUIREMENT)
  assert.deepEqual(await readTree(snapshot), await readTree(v2Scratch))
  const readme = await readFile(join(snapshot, 'README.md'), 'utf8')
  assert.equal(readme.split('\n')[0], '回传快照，以父工单和 spec 为准，不作为决策来源。')
  await assert.rejects(stat(join(snapshot, 'issues', '05-小程序用哪家云.md')))

  // req/<订单号> 指向新的 main。
  const hashes = await execFileAsync('git', [
    '-C',
    env.bare,
    'rev-parse',
    'main',
    `req/${orderId}`,
  ])
  const [mainSha, branchSha] = hashes.stdout.trim().split('\n')
  assert.equal(branchSha, mainSha)

  // 给补缺口 Agent 的导入记录仍指向同一张父工单。
  assert.equal(secondUpload.meta.status, 'imported')
  assert.deepEqual(secondUpload.meta.imported, [
    {
      order_id: orderId,
      requirement: REQUIREMENT,
      product: REQUIREMENT,
      owner: OWNER,
      repo: REPO,
      issue_url: orderBefore.issue,
      branch: `req/${orderId}`,
    },
  ])

  // 回传件原件不改写。
  assert.equal(await readFile(join(v1Scratch, 'map.md'), 'utf8'), v1MapBefore)
})

test('重传换图：地图正文换新包，票按编号配对，旧票作废，新票建出，运营者的票待复查', async (t) => {
  const env = await setup(t)
  const agentGh = createGithub({ apiBase: env.fake.base, token: 'test' })
  const orderId = await uploadWorkspace(env)
  await runImport(env)

  const [parentNumber] = await parentOf(env, orderId)
  const parent = await env.gh.getIssue({ owner: OWNER, repo: REPO, number: parentNumber })
  const v1Dir = (await uploadDirs(env.config)).find((row) => row.meta.status === 'imported')
  const v1Scratch = join(env.config.uploadDir, v1Dir.name, 'work', 'scratch', REQUIREMENT)

  // 补缺口 Agent 在 v1 建过图；运营者又在图上开了一张自己的票。
  const first = await ensureMapIssues({
    gh: agentGh,
    owner: OWNER,
    repo: REPO,
    requirement: REQUIREMENT,
    scratchDir: v1Scratch,
    parentIssueUrl: parent.html_url,
  })
  const operatorTicket = await env.gh.createIssue({
    owner: OWNER,
    repo: REPO,
    title: '送货要不要设起送价',
    body: '## Question\n\n要不要设起送价？',
  })
  await agentGh.addSubIssue({
    owner: OWNER,
    repo: REPO,
    number: first.mapIssue.number,
    subIssueId: operatorTicket.id,
  })

  await uploadWorkspace(env, makeV2)
  const second = await runImport(env)
  assert.equal(second.uploads[0].status, 'imported')

  // 服务器只换父工单、快照和分支；地图由补缺口 Agent 重跑时换。
  const v2Dir = (await uploadDirs(env.config)).find(
    (row) => row.meta.status === 'imported' && row.name !== v1Dir.name,
  )
  const v2Scratch = join(env.config.uploadDir, v2Dir.name, 'work', 'scratch', REQUIREMENT)
  await ensureMapIssues({
    gh: agentGh,
    owner: OWNER,
    repo: REPO,
    requirement: REQUIREMENT,
    scratchDir: v2Scratch,
    parentIssueUrl: parent.html_url,
    mode: 'replace',
  })

  const maps = await env.gh.listIssues({
    owner: OWNER,
    repo: REPO,
    state: 'all',
    labels: 'wayfinder:map',
  })
  assert.equal(maps.length, 1)
  const map = maps[0]
  assert.equal(map.number, first.mapIssue.number)
  assert.match(map.body, /门口也贴二维码/)
  assert.match(map.body, /06 送货范围怎么定/)
  assert.doesNotMatch(map.body, /05 小程序用哪家云/)
  const headings = [...map.body.matchAll(/^##\s+(.+)$/gm)].map((match) => match[1])
  assert.deepEqual(headings, [
    'Destination',
    'Notes',
    '接下来',
    'Decisions so far',
    'Not yet specified',
    'Out of scope',
  ])

  const children = await agentGh.listSubIssues({ owner: OWNER, repo: REPO, number: map.number })
  assert.deepEqual(children.map((row) => row.title).sort(), [
    '01 顾客怎么看到今天有什么',
    '02 下单要不要先付钱',
    '03 我在哪改价格和库存',
    '04 取货了怎么通知顾客',
    '05 小程序用哪家云',
    '06 送货范围怎么定',
    '送货要不要设起送价',
  ])
  assert.equal(children.find((row) => row.title.startsWith('05 ')).state, 'closed')

  const all = await env.gh.listIssues({ owner: OWNER, repo: REPO, state: 'all' })
  const ticket01 = all.filter((row) => row.title.startsWith('01 '))
  assert.equal(ticket01.length, 1)
  const comments01 = await env.gh.listComments({ owner: OWNER, repo: REPO, number: ticket01[0].number })
  assert.deepEqual(comments01.map((row) => row.body), [
    '客户原话：「店里贴个二维码，扫一下就能看。」',
    '客户补充：「门口也贴一张。」',
    '店里和门口都贴二维码，顾客扫进小程序看当天清单。',
  ])

  const obsolete = all.find((row) => row.title.startsWith('05 '))
  assert.equal(obsolete.state, 'closed')
  const obsoleteComments = await env.gh.listComments({
    owner: OWNER,
    repo: REPO,
    number: obsolete.number,
  })
  assert.ok(obsoleteComments.some((row) => row.body === '作废：重传'))

  const ticket06 = all.find((row) => row.title.startsWith('06 '))
  assert.equal(ticket06.state, 'open')
  assert.match(ticket06.body, /## Question/)

  const operator = all.find((row) => row.title === '送货要不要设起送价')
  assert.equal(operator.state, 'open')
  const operatorComments = await env.gh.listComments({
    owner: OWNER,
    repo: REPO,
    number: operator.number,
  })
  assert.deepEqual(operatorComments.map((row) => row.body), ['待复查：重传'])

  const mapComments = await env.gh.listComments({ owner: OWNER, repo: REPO, number: map.number })
  const retransmit = mapComments.find((row) => row.body.startsWith('重传：'))
  assert.ok(retransmit)
  assert.match(retransmit.body, /^重传：\d{4}-\d{2}-\d{2}/)
  assert.match(retransmit.body, /送货要不要设起送价/)
  assert.doesNotMatch(retransmit.body, /01 顾客怎么看到今天有什么/)
})

test('重传中途失败再重跑同一份包：不重复追加评论，不建第二套', async (t) => {
  const env = await setup(t)
  const agentGh = createGithub({ apiBase: env.fake.base, token: 'test' })
  const orderId = await uploadWorkspace(env)
  await runImport(env)

  const [parentNumber] = await parentOf(env, orderId)
  const parent = await env.gh.getIssue({ owner: OWNER, repo: REPO, number: parentNumber })
  const v1Dir = (await uploadDirs(env.config)).find((row) => row.meta.status === 'imported')
  await ensureMapIssues({
    gh: agentGh,
    owner: OWNER,
    repo: REPO,
    requirement: REQUIREMENT,
    scratchDir: join(env.config.uploadDir, v1Dir.name, 'work', 'scratch', REQUIREMENT),
    parentIssueUrl: parent.html_url,
  })

  await uploadWorkspace(env, makeV2)
  const v2Dir = (await uploadDirs(env.config)).at(-1)
  const v2Scratch = join(env.config.uploadDir, v2Dir.name, 'work', 'scratch', REQUIREMENT)

  // 第一次重传在写改口评论时失败：父工单和分支已经换完，订单还没记 import_sha256。
  let commentFailed = false
  const flaky = {
    ...env.gh,
    createComment: async (args) => {
      if (!commentFailed && String(args.body).startsWith('改口：')) {
        commentFailed = true
        throw new Error('写评论炸了')
      }
      return env.gh.createComment(args)
    },
  }
  const failed = await importOnce({
    config: env.config,
    gh: flaky,
    remoteUrlFor: () => env.bare,
  })
  assert.equal(failed.uploads[0].status, 'import_failed')
  const parentAfterFail = await env.gh.getIssue({
    owner: OWNER,
    repo: REPO,
    number: parentNumber,
  })
  assert.equal(parentAfterFail.title, V2_QUOTE)

  // 重跑同一份上传。
  const metaPath = join(env.config.uploadDir, v2Dir.name, 'meta.json')
  const failedMeta = JSON.parse(await readFile(metaPath, 'utf8'))
  await writeFile(
    metaPath,
    `${JSON.stringify({ ...failedMeta, status: 'ready' }, null, 2)}\n`,
    'utf8',
  )
  const retried = await runImport(env)
  assert.equal(retried.uploads[0].status, 'imported')

  // 补缺口 Agent 换图；同一份包重跑一次，也不重复追加。
  const agentArgs = {
    gh: agentGh,
    owner: OWNER,
    repo: REPO,
    requirement: REQUIREMENT,
    scratchDir: v2Scratch,
    parentIssueUrl: parent.html_url,
    mode: 'replace',
  }
  await ensureMapIssues(agentArgs)
  await ensureMapIssues(agentArgs)

  const parents = await parentOf(env, orderId)
  assert.deepEqual(parents, [parentNumber])
  const parentComments = await env.gh.listComments({
    owner: OWNER,
    repo: REPO,
    number: parentNumber,
  })
  assert.equal(parentComments.filter((row) => row.body.startsWith('改口：')).length, 1)

  const maps = await env.gh.listIssues({
    owner: OWNER,
    repo: REPO,
    state: 'all',
    labels: 'wayfinder:map',
  })
  assert.equal(maps.length, 1)
  const mapComments = await env.gh.listComments({
    owner: OWNER,
    repo: REPO,
    number: maps[0].number,
  })
  assert.equal(mapComments.filter((row) => row.body.startsWith('重传：')).length, 1)

  const all = await env.gh.listIssues({ owner: OWNER, repo: REPO, state: 'all' })
  assert.equal(all.length, 8) // 父工单 + 地图 + 6 张决定票（05 关掉但不删）
  const ticket01 = all.find((row) => row.title.startsWith('01 '))
  const comments01 = await env.gh.listComments({
    owner: OWNER,
    repo: REPO,
    number: ticket01.number,
  })
  assert.deepEqual(comments01.map((row) => row.body), [
    '客户原话：「店里贴个二维码，扫一下就能看。」',
    '客户补充：「门口也贴一张。」',
    '店里和门口都贴二维码，顾客扫进小程序看当天清单。',
  ])

  const order = (await readOrders(env.config)).find((item) => item.id === orderId)
  assert.equal(order.import_sha256, v2Dir.meta.sha256)
})

test('to-spec 锁单后，同一需求目录再上传返回 422', async (t) => {
  const env = await setup(t)
  const orderId = await uploadWorkspace(env)

  env.config.specLock = async ({ requirement }) => requirement === REQUIREMENT
  const { zipPath } = await makeWorkspaceZip(env.root, makeV2)
  const response = await upload(env.server.base, env.cookie, await readFile(zipPath))
  assert.equal(response.status, 422)
  const body = await response.json()
  assert.match(body.message, /新建需求目录/)

  const order = (await readOrders(env.config)).find((item) => item.id === orderId)
  assert.equal(order.uploads.length, 1)
})

test('导入兜底：同需求已有 ready-for-agent 的 spec 时转运营者，不覆盖', async (t) => {
  const env = await setup(t)
  const orderId = await uploadWorkspace(env)
  await runImport(env)

  const [parentNumber] = await parentOf(env, orderId)
  const parentBefore = await env.gh.getIssue({
    owner: OWNER,
    repo: REPO,
    number: parentNumber,
  })
  const v1Dir = (await uploadDirs(env.config)).find((row) => row.meta.status === 'imported')
  const v1Snapshot = await readFile(
    join(env.config.uploadDir, v1Dir.name, 'work', 'scratch', REQUIREMENT, 'map.md'),
    'utf8',
  )

  const orderBefore = (await readOrders(env.config)).find((item) => item.id === orderId)

  await uploadWorkspace(env, makeV2)
  const result = await importOnce({
    config: env.config,
    gh: env.gh,
    remoteUrlFor: () => env.bare,
    specLock: async ({ requirement }) => requirement === REQUIREMENT,
  })
  assert.equal(result.uploads[0].status, 'needs_operator')

  const v2Dir = (await uploadDirs(env.config)).at(-1)
  const meta = JSON.parse(
    await readFile(join(env.config.uploadDir, v2Dir.name, 'meta.json'), 'utf8'),
  )
  assert.equal(meta.status, 'needs_operator')
  assert.equal(meta.operator_alert.reason, 'requirement_locked')
  assert.match(meta.operator_alert.message, /已经锁单/)

  const parentAfter = await env.gh.getIssue({
    owner: OWNER,
    repo: REPO,
    number: parentNumber,
  })
  assert.equal(parentAfter.title, parentBefore.title)
  assert.equal(parentAfter.body, parentBefore.body)
  const comments = await env.gh.listComments({
    owner: OWNER,
    repo: REPO,
    number: parentNumber,
  })
  assert.equal(comments.filter((row) => row.body.startsWith('改口：')).length, 0)

  const order = (await readOrders(env.config)).find((item) => item.id === orderId)
  assert.equal(order.import_sha256, orderBefore.import_sha256)
  const clone = join(env.root, 'clone-locked')
  await execFileAsync('git', ['clone', env.bare, clone])
  assert.equal(
    await readFile(join(clone, 'docs', 'requirements', REQUIREMENT, 'map.md'), 'utf8'),
    v1Snapshot,
  )
})

test('需求分支上已有实现提交时不覆盖，导入停下报运营者', async (t) => {
  const env = await setup(t)
  const orderId = await uploadWorkspace(env)
  await runImport(env)

  const [parentNumber] = await parentOf(env, orderId)
  const fork = join(env.root, 'fork')
  await execFileAsync('git', ['clone', env.bare, fork])
  await execFileAsync('git', ['-C', fork, 'config', 'user.name', 'Tester'])
  await execFileAsync('git', ['-C', fork, 'config', 'user.email', 'tester@example.com'])
  await execFileAsync('git', ['-C', fork, 'checkout', `req/${orderId}`])
  await writeFile(join(fork, 'ticket.txt'), '实现票合入\n', 'utf8')
  await execFileAsync('git', ['-C', fork, 'add', '-A'])
  await execFileAsync('git', ['-C', fork, 'commit', '-m', '实现票合入'])
  await execFileAsync('git', ['-C', fork, 'push', 'origin', `req/${orderId}`])

  const branchBefore = (
    await execFileAsync('git', ['-C', env.bare, 'rev-parse', `req/${orderId}`])
  ).stdout.trim()
  const mainBefore = (await execFileAsync('git', ['-C', env.bare, 'rev-parse', 'main'])).stdout.trim()

  await uploadWorkspace(env, makeV2)
  const result = await runImport(env)
  assert.equal(result.uploads[0].status, 'import_failed')

  const v2Dir = (await uploadDirs(env.config)).at(-1)
  const meta = JSON.parse(
    await readFile(join(env.config.uploadDir, v2Dir.name, 'meta.json'), 'utf8'),
  )
  assert.equal(meta.status, 'import_failed')
  assert.match(meta.operator_alert.message, /需求分支/)
  assert.match(meta.operator_alert.message, /实现票合入/)

  const branchAfter = (
    await execFileAsync('git', ['-C', env.bare, 'rev-parse', `req/${orderId}`])
  ).stdout.trim()
  assert.equal(branchAfter, branchBefore)
  const mainAfter = (await execFileAsync('git', ['-C', env.bare, 'rev-parse', 'main'])).stdout.trim()
  assert.equal(mainAfter, mainBefore)

  const parent = await env.gh.getIssue({ owner: OWNER, repo: REPO, number: parentNumber })
  assert.equal(parent.title, V1_QUOTE)
  const comments = await env.gh.listComments({
    owner: OWNER,
    repo: REPO,
    number: parentNumber,
  })
  assert.equal(comments.filter((row) => row.body.startsWith('改口：')).length, 0)
})

test('小需求建单即锁，同一目录再上传 422', async (t) => {
  const env = await setup(t)
  const orderId = await uploadSmall(env, '想要预约取货。')
  const first = await runImport(env)
  assert.equal(first.uploads[0].status, 'imported')

  const [parentNumber] = await parentOf(env, orderId, 'acme-demo')
  const before = await env.gh.getIssue({ owner: OWNER, repo: 'acme-demo', number: parentNumber })
  assert.deepEqual(before.labels.map((label) => label.name).sort(), ['大小:小需求', '状态:已提交'].sort())

  const zipPath = await makeSmallWorkspaceZip(env.root, '想要预约取货，最好能选时间。')
  const response = await upload(env.server.base, env.cookie, await readFile(zipPath))
  assert.equal(response.status, 422)
  const body = await response.json()
  assert.match(body.message, /小需求建单即锁，改主意请等这一版交付后开新单/)

  const order = (await readOrders(env.config)).find((item) => item.id === orderId)
  assert.equal(order.uploads.length, 1)
  const parent = await env.gh.getIssue({ owner: OWNER, repo: 'acme-demo', number: parentNumber })
  assert.equal(parent.title, before.title)
  const comments = await env.gh.listComments({ owner: OWNER, repo: 'acme-demo', number: parentNumber })
  assert.equal(comments.length, 0)
  const maps = await env.gh.listIssues({
    owner: OWNER,
    repo: 'acme-demo',
    state: 'all',
    labels: 'wayfinder:map',
  })
  assert.equal(maps.length, 0)
})

test('重传后 Mac 存档多一份新上传，指向同一张父工单', async (t) => {
  const env = await setup(t)
  const orderId = await uploadWorkspace(env)
  await runImport(env)
  const [parentNumber] = await parentOf(env, orderId)
  const parentUrl = `https://github.com/${OWNER}/${REPO}/issues/${parentNumber}`

  await uploadWorkspace(env, makeV2)
  await runImport(env)

  const inbox = join(env.root, 'inbox')
  const pulled = await pullInbox({
    remote: createDirRemote(env.config.uploadDir),
    inboxDir: inbox,
    customersPath: join(env.root, 'customers.json'),
  })
  assert.equal(pulled.pulled.length, 2)
  assert.equal(pulled.removed.length, 2)

  const archived = await readdir(inbox)
  assert.equal(archived.length, 2)
  const metas = []
  for (const name of archived) {
    metas.push(JSON.parse(await readFile(join(inbox, name, 'meta.json'), 'utf8')))
  }
  metas.sort((left, right) => String(left.at).localeCompare(String(right.at)))
  assert.notEqual(metas[0].sha256, metas[1].sha256)
  for (const meta of metas) {
    assert.equal(meta.status, 'imported')
    assert.deepEqual(meta.imported.map((row) => row.issue_url), [parentUrl])
  }
})
