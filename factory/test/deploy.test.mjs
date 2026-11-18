import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { runDeploy, publishZipWithDefaults } from '../bin/deploy.mjs'
import { productFromRepo, runFinish } from '../bin/finish.mjs'
import {
  DEFAULT_DELIVERY_TRIES,
  buildCodeZip,
  deliveryAddress,
  deployProduct,
  publishCodeZip,
  rollbackProduct,
} from '../lib/deploy.mjs'
import { appendTrail } from '../lib/evidence.mjs'
import { git } from '../lib/git.mjs'
import { createGithub } from '../lib/github.mjs'
import { startFakeGithub } from './fake-github.mjs'

const execFileAsync = promisify(execFile)

function recorder(result) {
  const calls = []
  const fn = async (args) => {
    calls.push(args)
    if (typeof result === 'function') return result(args, calls.length)
    return result
  }
  fn.calls = calls
  return fn
}

function deployDeps(overrides = {}) {
  const sent = []
  const built = recorder({ tar: '/tmp/afk-image.tar', image: 'acme-shop.afkfactory.space:v1' })
  const transferred = recorder(({ remote }) => remote)
  const loaded = recorder('Loaded image: acme-shop.afkfactory.space:v1')
  const helper = recorder('ok')
  const health = recorder(true)
  const mail = recorder(undefined)
  const notifier = { send: async (event) => sent.push(event) }
  return {
    sent,
    buildImage: built,
    transfer: transferred,
    loadImage: loaded,
    helper,
    healthCheck: health,
    sendDeliveryMail: mail,
    notifier,
    ...overrides,
  }
}

test('交付地址按客户简称和软件简称拼，同一软件地址不变，第二个软件另给', () => {
  assert.equal(
    deliveryAddress({ customer: 'acme', product: 'shop' }),
    'acme-shop.afkfactory.space',
  )
  assert.equal(
    deliveryAddress({ customer: 'Acme Tools', product: 'Shop_Web' }),
    'acme-tools-shop-web.afkfactory.space',
  )
  assert.equal(
    deliveryAddress({ customer: 'acme', product: 'shop', orderId: 'o-0002' }),
    'acme-shop.afkfactory.space',
  )
  assert.notEqual(
    deliveryAddress({ customer: 'acme', product: 'shop' }),
    deliveryAddress({ customer: 'acme', product: 'crm' }),
  )
})

test('拼不出合法地址就报错，不猜', () => {
  assert.throws(() => deliveryAddress({ customer: '', product: 'shop' }), /客户简称/)
  assert.throws(() => deliveryAddress({ customer: 'acme', product: '' }), /软件简称/)
  assert.throws(() => deliveryAddress({ customer: 'B 店', product: 'shop' }), /客户简称/)
  assert.throws(() => deliveryAddress({ customer: 'acme', product: '预约送货' }), /软件简称/)
  assert.throws(() => deliveryAddress({ customer: 'acme', product: 'a'.repeat(70) }), /软件简称/)
})

test('部署成功：linux/amd64 构建、传输、load、init 后 deploy、健康检查、通知、邮件', async () => {
  const deps = deployDeps()
  const result = await deployProduct({
    repoDir: '/repo',
    customer: 'acme',
    product: 'shop',
    orderId: 'o-0001',
    version: 'abc1234',
    ...deps,
  })

  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.address, 'acme-shop.afkfactory.space')
  assert.equal(result.version, 'abc1234')

  assert.equal(deps.buildImage.calls.length, 1)
  assert.equal(deps.buildImage.calls[0].platform, 'linux/amd64')
  assert.equal(deps.buildImage.calls[0].repoDir, '/repo')
  assert.equal(deps.buildImage.calls[0].version, 'abc1234')

  assert.equal(deps.transfer.calls.length, 1)
  assert.equal(deps.transfer.calls[0].tar, '/tmp/afk-image.tar')
  assert.equal(
    deps.transfer.calls[0].remote,
    '/tmp/afk-deploy-acme-shop.afkfactory.space-abc1234.tar',
  )

  assert.equal(deps.loadImage.calls.length, 1)
  assert.equal(
    deps.loadImage.calls[0].tar,
    '/tmp/afk-deploy-acme-shop.afkfactory.space-abc1234.tar',
  )
  assert.equal(deps.loadImage.calls[0].image, 'acme-shop.afkfactory.space:v1')

  assert.deepEqual(deps.helper.calls, [
    ['product-init', 'acme-shop.afkfactory.space', '--image', 'acme-shop.afkfactory.space:v1'],
    ['product-deploy', 'acme-shop.afkfactory.space', '--image', 'acme-shop.afkfactory.space:v1'],
  ])
  assert.deepEqual(deps.healthCheck.calls, [{ address: 'acme-shop.afkfactory.space' }])

  const done = deps.sent.find((event) => event.event === '部署完成')
  assert.ok(done, '没有发部署完成')
  assert.equal(done.data.address, 'acme-shop.afkfactory.space')
  assert.equal(done.data.customer, 'acme')
  assert.ok(done.data.version)

  assert.equal(deps.sendDeliveryMail.calls.length, 1)
  assert.equal(deps.sendDeliveryMail.calls[0].orderId, 'o-0001')
  assert.equal(deps.sendDeliveryMail.calls[0].address, 'acme-shop.afkfactory.space')
  assert.equal(deps.sendDeliveryMail.calls[0].tries.length, 3)
})

test('第一次失败第二次成功：整套重跑一次，不发出事通知', async () => {
  let healthCalls = 0
  const deps = deployDeps({
    healthCheck: async ({ address }) => {
      healthCalls += 1
      if (healthCalls === 1) throw new Error('502')
      assert.equal(address, 'acme-shop.afkfactory.space')
      return true
    },
  })
  const result = await deployProduct({
    repoDir: '/repo',
    customer: 'acme',
    product: 'shop',
    orderId: 'o-0001',
    version: 'abc1234',
    ...deps,
  })

  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(healthCalls, 2)
  assert.equal(deps.buildImage.calls.length, 2)
  assert.equal(deps.helper.calls.length, 4)
  assert.equal(deps.sendDeliveryMail.calls.length, 1)
  assert.equal(deps.sent.some((event) => event.event === '出事'), false)
})

test('两次都失败：保留上一版不动、发出事通知、不标已交付、不发邮件', async () => {
  const deps = deployDeps({
    healthCheck: async () => {
      throw new Error('502')
    },
  })
  const result = await deployProduct({
    repoDir: '/repo',
    customer: 'acme',
    product: 'shop',
    orderId: 'o-0001',
    version: 'abc1234',
    ...deps,
  })

  assert.equal(result.ok, false)
  assert.equal(result.reason, '部署失败')
  assert.match(result.tried, /第 1 次/)
  assert.match(result.tried, /第 2 次/)

  assert.equal(deps.helper.calls.filter((args) => args[0] === 'product-deploy').length, 2)
  assert.equal(deps.sendDeliveryMail.calls.length, 0)
  assert.equal(deps.sent.some((event) => event.event === '部署完成'), false)

  const incident = deps.sent.find((event) => event.event === '出事')
  assert.ok(incident, '没有发出事通知')
  assert.equal(incident.data.reason, '部署失败')
  assert.equal(incident.data.customer, 'acme')
})

test('回滚一条命令，跑同一组健康检查', async () => {
  const deps = deployDeps()
  const result = await rollbackProduct({
    address: 'acme-shop.afkfactory.space',
    helper: deps.helper,
    healthCheck: deps.healthCheck,
    notifier: deps.notifier,
  })

  assert.equal(result.ok, true)
  assert.deepEqual(deps.helper.calls, [['product-rollback', 'acme-shop.afkfactory.space']])
  assert.deepEqual(deps.healthCheck.calls, [{ address: 'acme-shop.afkfactory.space' }])
})

test('回滚失败也发出事通知', async () => {
  const sent = []
  const result = await rollbackProduct({
    address: 'acme-shop.afkfactory.space',
    helper: async () => {
      throw new Error('没有上一版')
    },
    healthCheck: async () => true,
    notifier: { send: async (event) => sent.push(event) },
  })

  assert.equal(result.ok, false)
  assert.match(result.tried, /没有上一版/)
  const incident = sent.find((event) => event.event === '出事')
  assert.ok(incident)
  assert.equal(incident.data.reason, '回滚失败')
})

test('默认的试三件事是 2 到 3 件', () => {
  assert.ok(DEFAULT_DELIVERY_TRIES.length >= 2)
  assert.ok(DEFAULT_DELIVERY_TRIES.length <= 3)
})

test('代码 zip 从 git archive 生成，传到下载目录并给出 URL', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'afk-deploy-zip-'))
  try {
    await git(dir, ['init', '-b', 'main'])
    await git(dir, ['config', 'user.name', 'AFK Test'])
    await git(dir, ['config', 'user.email', 'test@afkfactory.space'])
    await writeFile(join(dir, 'README.md'), 'hello\n')
    await git(dir, ['add', '-A'])
    await git(dir, ['commit', '-m', 'base'])
    const sha = await git(dir, ['rev-parse', 'HEAD'])

    const outDir = await mkdtemp(join(tmpdir(), 'afk-deploy-zip-out-'))
    try {
      const zip = await buildCodeZip({ repoDir: dir, ref: sha, outDir })
      const bytes = await readFile(zip)
      assert.equal(bytes.subarray(0, 2).toString(), 'PK')

      const listed = await execFileAsync('python3', [
        '-c',
        'import sys, zipfile; print("\\n".join(zipfile.ZipFile(sys.argv[1]).namelist()))',
        zip,
      ])
      assert.match(listed.stdout, /README\.md/)

      const transfer = recorder(undefined)
      const url = await publishCodeZip({
        zip,
        address: 'acme-shop.afkfactory.space',
        version: 'abc1234',
        transfer,
      })
      assert.equal(url, 'https://afkfactory.space/downloads/acme-shop.afkfactory.space-abc1234.zip')
      assert.equal(transfer.calls.length, 1)
      assert.equal(
        transfer.calls[0].remote,
        '/data/www/downloads/acme-shop.afkfactory.space-abc1234.zip',
      )
    } finally {
      await rm(outDir, { recursive: true, force: true })
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

const OWNER = 'acme'
const REPO = 'demo'

function finishParentBody({ customer = 'acme', product = 'shop', order = 'o-0001' } = {}) {
  const lines = [
    '## 验收条件',
    '',
    '- [ ] 打开首页能看到入口。',
    '',
    '## 需求全文',
    '',
  ]
  if (customer) lines.push(`- 客户简称：${customer}`)
  if (product) lines.push(`- 需求名：${product}`)
  if (order) lines.push('', `<!-- factory:order=${order} -->`)
  return lines.join('\n')
}

async function setupFinishGithub(options = {}) {
  const fake = await startFakeGithub({ repos: [{ owner: OWNER, name: REPO }] })
  const gh = createGithub({ apiBase: fake.base, token: 'test' })
  const parent = await gh.createIssue({
    owner: OWNER,
    repo: REPO,
    title: '要个预约取货',
    body: finishParentBody(options),
  })
  const child = await gh.createIssue({
    owner: OWNER,
    repo: REPO,
    title: '第一块',
    body: '## 垂直切片\n\n做一块',
  })
  await gh.closeIssue({ owner: OWNER, repo: REPO, number: child.number })
  await gh.addSubIssue({
    owner: OWNER,
    repo: REPO,
    number: parent.number,
    subIssueId: child.id,
  })
  return { fake, gh, parent, child }
}

async function finishRepo(childNumber) {
  const dir = await mkdtemp(join(tmpdir(), 'afk-deploy-finish-'))
  await git(dir, ['init', '-b', 'main'])
  await git(dir, ['config', 'user.name', 'AFK Test'])
  await git(dir, ['config', 'user.email', 'test@afkfactory.space'])
  await writeFile(join(dir, 'README.md'), 'base\n')
  await git(dir, ['add', '-A'])
  await git(dir, ['commit', '-m', 'base'])
  await git(dir, ['checkout', '-b', 'req/order-1'])
  await writeFile(join(dir, 'app.txt'), 'feature\n')
  await appendTrail({
    repoDir: dir,
    ticket: childNumber,
    phase: 'merge',
    decision: '已合进需求分支',
    result: 'pass',
  })
  await git(dir, ['add', '-A'])
  await git(dir, ['commit', '-m', 'FACTORY: 子票证据'])
  return dir
}

function finishDeps(gh, sent, deployCalls, zipCalls, deployResult, deliveredCalls) {
  return {
    gh,
    runner: {
      run: async () => ({ ok: true, stdout: 'AFK_VERDICT: pass' }),
    },
    push: async () => {},
    notifier: { send: async (event) => sent.push(event) },
    deploy: async (args) => {
      deployCalls.push(args)
      if (typeof deployResult === 'function') return deployResult(args)
      return (
        deployResult || { ok: true, address: 'acme-shop.afkfactory.space', version: args.version }
      )
    },
    publishZip: async (args) => {
      zipCalls.push(args)
      return `https://afkfactory.space/downloads/${args.address}-${args.version}.zip`
    },
    markDelivered: async (args) => {
      deliveredCalls.push(args)
      return { ok: true }
    },
  }
}

async function runFinishFlow(options = {}, finishOptions = {}, deployResult = undefined) {
  const { fake, gh, parent, child } = await setupFinishGithub(options)
  const dir = await finishRepo(child.number)
  const sent = []
  const deployCalls = []
  const zipCalls = []
  const deliveredCalls = []
  try {
    const { output, exitCode } = await runFinish(
      {
        owner: OWNER,
        repo: REPO,
        parent: String(parent.number),
        'repo-dir': dir,
        'req-branch': 'req/order-1',
        main: 'main',
        product: 'shop',
        ...finishOptions,
      },
      finishDeps(gh, sent, deployCalls, zipCalls, deployResult, deliveredCalls),
    )
    return { output, exitCode, sent, deployCalls, zipCalls, deliveredCalls, parent, fake, dir }
  } catch (error) {
    await fake.close()
    await rm(dir, { recursive: true, force: true })
    throw error
  }
}

test('finish 合主干成功后默认调用部署和代码 zip，版本用 merge SHA 短号', async () => {
  const { output, exitCode, deployCalls, zipCalls, deliveredCalls, sent, parent, fake, dir } =
    await runFinishFlow()
  try {
    assert.equal(exitCode, 0, JSON.stringify(output))
    assert.equal(output.ok, true)
    assert.equal(deployCalls.length, 1, `deployCalls=${deployCalls.length} output=${JSON.stringify(output)}`)
    const args = deployCalls[0]
    assert.equal(args.customer, 'acme')
    assert.equal(args.product, 'shop')
    assert.equal(args.orderId, 'o-0001')
    assert.equal(args.version, 'merge-1')
    assert.equal(args.repoDir, dir)
    assert.equal(output.deploy.ok, true)
    assert.ok(sent.some((event) => event.event === '自己合并'))

    assert.equal(zipCalls.length, 1)
    assert.equal(zipCalls[0].repoDir, dir)
    assert.equal(zipCalls[0].ref, 'merge-1')
    assert.equal(zipCalls[0].address, 'acme-shop.afkfactory.space')
    assert.equal(zipCalls[0].version, 'merge-1')
    assert.equal(
      output.deploy.codeZipUrl,
      'https://afkfactory.space/downloads/acme-shop.afkfactory.space-merge-1.zip',
    )

    assert.equal(deliveredCalls.length, 1)
    assert.deepEqual(deliveredCalls[0], {
      orderId: 'o-0001',
      address: 'acme-shop.afkfactory.space',
      version: 'merge-1',
    })
    const issue = fake.state.issues
      .get(`${OWNER}/${REPO}`)
      .find((row) => row.number === parent.number)
    const progress = issue.comments.filter((row) => row.body.startsWith('进度 v1｜'))
    assert.ok(
      progress.some((row) =>
        /^进度 v1｜路径：其余｜客户档：待客户验收｜细阶段：已部署｜轮次：1｜卡住：否$/.test(row.body),
      ),
      `父工单没有部署进度评论：${JSON.stringify(progress.map((row) => row.body))}`,
    )
  } finally {
    await fake.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('软件简称取 --product 或仓名后缀，拼不出就拒绝部署', () => {
  assert.equal(productFromRepo({ repo: 'acme-shop', customer: 'acme' }), 'shop')
  assert.equal(productFromRepo({ repo: 'acme/acme-shop', customer: 'acme' }), 'shop')
  assert.equal(productFromRepo({ repo: 'demo', customer: 'acme' }), '')
  assert.equal(productFromRepo({ repo: 'acme-shop', customer: 'acme', explicit: 'crm' }), 'crm')
})

test('仓名拼不出软件简称时拒绝部署，发出事通知，CLI 退出非零', async () => {
  const { output, exitCode, deployCalls, zipCalls, sent, fake, dir } = await runFinishFlow(
    {},
    { product: '' },
  )
  try {
    assert.equal(deployCalls.length, 0)
    assert.equal(zipCalls.length, 0)
    assert.equal(exitCode, 1)
    assert.equal(output.deploy.ok, false)
    assert.equal(output.deploy.reason, 'bad_product')
    assert.match(output.deploy.error, /--product/)
    const incident = sent.find((event) => event.event === '出事')
    assert.ok(incident, '没有发出事通知')
    assert.match(incident.data.tried, /软件简称/)
  } finally {
    await fake.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('finish --no-deploy 不调用部署，也不发代码 zip', async () => {
  const { exitCode, deployCalls, zipCalls, fake, dir } = await runFinishFlow({}, { noDeploy: true })
  try {
    assert.equal(exitCode, 0)
    assert.equal(deployCalls.length, 0)
    assert.equal(zipCalls.length, 0)
  } finally {
    await fake.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('父工单缺客户简称或需求名时拒绝部署，发出事通知，CLI 退出非零', async () => {
  const { output, exitCode, deployCalls, zipCalls, sent, fake, dir } = await runFinishFlow({
    product: '',
  })
  try {
    assert.equal(deployCalls.length, 0)
    assert.equal(zipCalls.length, 0)
    assert.equal(exitCode, 1)
    assert.equal(output.deploy.ok, false)
    assert.equal(output.deploy.reason, 'bad_parent')
    const incident = sent.find((event) => event.event === '出事')
    assert.ok(incident, '没有发出事通知')
    assert.equal(incident.data.reason, '部署失败')
    assert.match(incident.data.tried, /需求名/)
  } finally {
    await fake.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('deploy CLI dry-run 只打印地址和镜像，不跑外部命令', async () => {
  let called = false
  const { output, exitCode } = await runDeploy(
    'deploy',
    {
      'repo-dir': '/repo',
      customer: 'acme',
      product: 'shop',
      order: 'o-0001',
      version: 'abc1234',
      dryRun: true,
    },
    {
      deploy: async () => {
        called = true
        return { ok: true }
      },
    },
  )
  assert.equal(exitCode, 0)
  assert.equal(called, false)
  assert.equal(output.address, 'acme-shop.afkfactory.space')
  assert.equal(output.image, 'acme-shop.afkfactory.space:abc1234')
})

test('deploy CLI 注入假部署，把订单号和版本传下去', async () => {
  const calls = []
  const { output, exitCode } = await runDeploy(
    'deploy',
    {
      'repo-dir': '/repo',
      customer: 'acme',
      product: 'shop',
      order: 'o-0001',
      version: 'abc1234',
    },
    {
      deploy: async (args) => {
        calls.push(args)
        return { ok: true, address: 'acme-shop.afkfactory.space', version: args.version }
      },
    },
  )
  assert.equal(exitCode, 0)
  assert.equal(output.ok, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].orderId, 'o-0001')
  assert.equal(calls[0].version, 'abc1234')
})

test('rollback CLI 一条命令调回滚', async () => {
  const calls = []
  const { output, exitCode } = await runDeploy(
    'rollback',
    { address: 'acme-shop.afkfactory.space' },
    {
      rollback: async (args) => {
        calls.push(args)
        return { ok: true, address: args.address }
      },
    },
  )
  assert.equal(exitCode, 0)
  assert.equal(output.ok, true)
  assert.deepEqual(calls, [{ address: 'acme-shop.afkfactory.space' }])
})

test('afk-product product-load 调 docker load，成功后打印镜像 tag，失败非零', async () => {
  const root = await mkdtemp(join(tmpdir(), 'afk-product-load-'))
  try {
    const tag = 'acme-shop.afkfactory.space:abc1234'
    const fakeDocker = join(root, 'docker')
    await writeFile(
      fakeDocker,
      `#!/usr/bin/env bash
if [[ \${1:-} == load ]]; then
  echo "Loaded image: ${tag}"
  exit 0
fi
exit 1
`,
    )
    await chmod(fakeDocker, 0o755)
    const tar = join(root, 'image.tar')
    await writeFile(tar, 'tar-bytes')
    const helper = fileURLToPath(new URL('../../deploy/products/afk-product', import.meta.url))
    const env = { ...process.env, AFK_DOCKER: fakeDocker }

    const ok = await execFileAsync('bash', [helper, 'product-load', tar], { env })
    assert.match(ok.stdout, /Loaded image: acme-shop\.afkfactory\.space:abc1234/)
    assert.match(ok.stdout, /镜像 tag：acme-shop\.afkfactory\.space:abc1234/)

    await assert.rejects(
      execFileAsync('bash', [helper, 'product-load', join(root, 'missing.tar')], { env }),
      /找不到镜像包/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('finish 部署失败时 CLI 退出非零，结果里带 deploy 失败，不发代码 zip', async () => {
  const { output, exitCode, deployCalls, zipCalls, fake, dir } = await runFinishFlow(
    {},
    {},
    { ok: false, reason: '部署失败', tried: '第 1 次：502；第 2 次：502' },
  )
  try {
    assert.equal(deployCalls.length, 1)
    assert.equal(zipCalls.length, 0)
    assert.equal(exitCode, 1)
    assert.equal(output.ok, true)
    assert.equal(output.deploy.ok, false)
    assert.equal(output.deploy.reason, '部署失败')
  } finally {
    await fake.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('代码 zip 的 ref 不在本地时退回需求分支', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'afk-deploy-zip-ref-'))
  try {
    await git(dir, ['init', '-b', 'main'])
    await git(dir, ['config', 'user.name', 'AFK Test'])
    await git(dir, ['config', 'user.email', 'test@afkfactory.space'])
    await writeFile(join(dir, 'README.md'), 'hello\n')
    await git(dir, ['add', '-A'])
    await git(dir, ['commit', '-m', 'base'])

    const transfer = recorder(undefined)
    const url = await publishZipWithDefaults({
      repoDir: dir,
      ref: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      fallbackRef: 'main',
      address: 'acme-shop.afkfactory.space',
      version: 'abc1234',
      transfer,
    })
    assert.equal(url, 'https://afkfactory.space/downloads/acme-shop.afkfactory.space-abc1234.zip')
    assert.equal(transfer.calls.length, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
