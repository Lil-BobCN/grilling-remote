import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import {
  createDefaultBuildImage,
  previewAddress,
  previewNeeded,
  startPreview,
  stopPreview,
  sweepPreviews,
} from '../lib/preview.mjs'

const execFileAsync = promisify(execFile)

test('地址按客户简称、软件简称和 PR 号拼出来', () => {
  assert.equal(
    previewAddress({ customer: 'Acme', product: 'Shop', pr: 42 }),
    'acme-shop-pr42.afkfactory.space',
  )
  assert.equal(
    previewAddress({ customer: 'acme', product: 'shop', pr: '42' }),
    'acme-shop-pr42.afkfactory.space',
  )
  assert.equal(
    previewAddress({ customer: 'acme tools', product: 'shop_web', pr: 7 }),
    'acme-tools-shop-web-pr7.afkfactory.space',
  )
})

test('缺参数拼不出地址就报错', () => {
  assert.throws(() => previewAddress({ customer: '', product: 'shop', pr: 1 }), /客户简称/)
  assert.throws(() => previewAddress({ customer: 'acme', product: '', pr: 1 }), /软件简称/)
  assert.throws(() => previewAddress({ customer: 'acme', product: 'shop', pr: '' }), /PR/)
  assert.throws(() => previewAddress({ customer: 'acme', product: 'shop', pr: 'x' }), /PR/)
})

const HEADER = 'ts\tphase\tdecision\twhy\tevidence\tresult'

test('trail 里 phase=preview 且 result=required 才要预览', () => {
  assert.equal(
    previewNeeded({
      trail: [
        HEADER,
        '2026-11-17T10:00:00+08:00\tpreview\t有列表页和表单\t验收条件第 1 条\tPR #469\trequired',
      ].join('\n'),
    }),
    true,
  )
})

test('没有 preview 行或值为别的就不建预览', () => {
  assert.equal(previewNeeded({ trail: '' }), false)
  assert.equal(previewNeeded({ trail: HEADER }), false)
  assert.equal(
    previewNeeded({
      trail: [
        HEADER,
        '2026-11-17T10:00:00+08:00\tverify\t跑了测试\tnpm test\t通过',
      ].join('\n'),
    }),
    false,
  )
  assert.equal(
    previewNeeded({
      trail: [
        HEADER,
        '2026-11-17T10:00:00+08:00\tpreview\t没有界面\t验收条件第 1 条\tnot-required',
      ].join('\n'),
    }),
    false,
  )
})

test('没有表头或列不全时按不要预览处理', () => {
  assert.equal(
    previewNeeded({ trail: '2026-11-17T10:00:00+08:00\tpreview\tx\ty\tz\trequired' }),
    false,
  )
  assert.equal(previewNeeded({ trail: 'ts\tphase\n1\tpreview' }), false)
})

const PREVIEW_STDOUT = [
  '预览 acme-shop-pr42.afkfactory.space 起好了',
  'AFK_PREVIEW address=acme-shop-pr42.afkfactory.space',
  'AFK_PREVIEW user=u0a1b2c3d',
  'AFK_PREVIEW password=p4ssw0rd',
  'AFK_PREVIEW db=preview_acme_shop_pr42_afkfactory_space',
  'AFK_PREVIEW dir=/data/previews/acme-shop-pr42.afkfactory.space',
  'AFK_PREVIEW env=/data/previews/acme-shop-pr42.afkfactory.space/.env',
].join('\n')

function recorder(result) {
  const calls = []
  const fn = async (args) => {
    calls.push(args)
    if (typeof result === 'function') return result(args)
    return result
  }
  fn.calls = calls
  return fn
}

test('startPreview 从 PR head 构建、调 helper、写 Mac 侧凭据', async () => {
  const helper = recorder(PREVIEW_STDOUT)
  const buildImage = recorder('registry.local/acme-shop:pr42')
  const writeLocalEnv = recorder('/repo/private/预览/acme-shop-pr42.afkfactory.space.env')

  const result = await startPreview({
    ticket: 469,
    pr: { number: 42, headCommitAt: '2026-11-17T08:00:00Z' },
    customer: 'acme',
    product: 'shop',
    baseBranch: '需求/acme-shop',
    worktree: '/tmp/wt-42',
    helper,
    buildImage,
    writeLocalEnv,
    seed: 'npm run db:seed',
  })

  assert.equal(result.ok, true)
  assert.equal(result.address, 'acme-shop-pr42.afkfactory.space')
  assert.equal(result.url, 'https://acme-shop-pr42.afkfactory.space/')
  assert.equal(result.image, 'registry.local/acme-shop:pr42')
  assert.equal(result.user, 'u0a1b2c3d')
  assert.equal(result.password, 'p4ssw0rd')
  assert.equal(result.credentialsFile, '/repo/private/预览/acme-shop-pr42.afkfactory.space.env')
  assert.equal(result.serverEnv, '/data/previews/acme-shop-pr42.afkfactory.space/.env')

  assert.equal(buildImage.calls.length, 1)
  assert.equal(buildImage.calls[0].worktree, '/tmp/wt-42')
  assert.equal(buildImage.calls[0].baseBranch, '需求/acme-shop')
  assert.equal(buildImage.calls[0].address, 'acme-shop-pr42.afkfactory.space')

  assert.deepEqual(helper.calls[0], [
    'preview-start',
    'acme-shop-pr42.afkfactory.space',
    'registry.local/acme-shop:pr42',
    '--seed',
    'npm run db:seed',
    '--commit-at',
    '2026-11-17T08:00:00Z',
  ])

  assert.equal(writeLocalEnv.calls.length, 1)
  assert.equal(writeLocalEnv.calls[0].address, 'acme-shop-pr42.afkfactory.space')
  assert.equal(writeLocalEnv.calls[0].user, 'u0a1b2c3d')
  assert.equal(writeLocalEnv.calls[0].password, 'p4ssw0rd')
  assert.equal(writeLocalEnv.calls[0].serverEnv, '/data/previews/acme-shop-pr42.afkfactory.space/.env')
})

test('seed 可以给函数，按工作树生成命令', async () => {
  const helper = recorder(PREVIEW_STDOUT)
  const result = await startPreview({
    ticket: 469,
    pr: 42,
    customer: 'acme',
    product: 'shop',
    worktree: '/tmp/wt-42',
    helper,
    buildImage: async () => 'img:42',
    writeLocalEnv: async () => '/tmp/local.env',
    seed: async ({ worktree }) => `cd ${worktree} && npm run db:seed`,
  })
  assert.equal(result.ok, true)
  assert.deepEqual(helper.calls[0].slice(3), [
    '--seed',
    'cd /tmp/wt-42 && npm run db:seed',
  ])
})

test('构建失败只返回这张票的错误，不调 helper', async () => {
  const helper = recorder(PREVIEW_STDOUT)
  const result = await startPreview({
    ticket: 469,
    pr: 42,
    customer: 'acme',
    product: 'shop',
    helper,
    buildImage: async () => {
      throw new Error('docker build 退出 1')
    },
    writeLocalEnv: async () => '/tmp/local.env',
  })
  assert.equal(result.ok, false)
  assert.equal(result.stage, 'build')
  assert.match(result.error, /docker build 退出 1/)
  assert.equal(helper.calls.length, 0)
})

test('helper 起不来只返回这张票的错误', async () => {
  const result = await startPreview({
    ticket: 469,
    pr: 42,
    customer: 'acme',
    product: 'shop',
    helper: async () => {
      throw new Error('排队超时')
    },
    buildImage: async () => 'img:42',
    writeLocalEnv: async () => '/tmp/local.env',
  })
  assert.equal(result.ok, false)
  assert.equal(result.stage, 'start')
  assert.match(result.error, /排队超时/)
})

test('helper 输出里缺凭据就报错并销毁刚起的预览', async () => {
  const helper = recorder((args) =>
    args[0] === 'preview-start' ? 'AFK_PREVIEW address=acme-shop-pr42.afkfactory.space' : '',
  )
  const result = await startPreview({
    ticket: 469,
    pr: 42,
    customer: 'acme',
    product: 'shop',
    helper,
    buildImage: async () => 'img:42',
    writeLocalEnv: async () => '/tmp/local.env',
  })
  assert.equal(result.ok, false)
  assert.equal(result.stage, 'credentials')
  assert.deepEqual(helper.calls[1], ['preview-stop', 'acme-shop-pr42.afkfactory.space'])
})

test('Mac 侧凭据写不进去时销毁预览，不留一套用不了的', async () => {
  const helper = recorder(PREVIEW_STDOUT)
  const result = await startPreview({
    ticket: 469,
    pr: 42,
    customer: 'acme',
    product: 'shop',
    helper,
    buildImage: async () => 'img:42',
    writeLocalEnv: async () => {
      throw new Error('磁盘满')
    },
  })
  assert.equal(result.ok, false)
  assert.equal(result.stage, 'credentials')
  assert.match(result.error, /磁盘满/)
  assert.deepEqual(helper.calls[1], ['preview-stop', 'acme-shop-pr42.afkfactory.space'])
})

test('stopPreview 调 helper 销毁并清掉 Mac 侧凭据', async () => {
  const helper = recorder('')
  const removeLocalEnv = recorder('')
  const result = await stopPreview({
    address: 'acme-shop-pr42.afkfactory.space',
    helper,
    removeLocalEnv,
  })
  assert.equal(result.ok, true)
  assert.deepEqual(helper.calls[0], ['preview-stop', 'acme-shop-pr42.afkfactory.space'])
  assert.equal(removeLocalEnv.calls.length, 1)
  assert.equal(removeLocalEnv.calls[0].address, 'acme-shop-pr42.afkfactory.space')
})

test('helper 销毁失败时保留 Mac 侧凭据并返回错误', async () => {
  const removeLocalEnv = recorder('')
  const result = await stopPreview({
    address: 'acme-shop-pr42.afkfactory.space',
    helper: async () => {
      throw new Error('共享 Postgres 没在跑')
    },
    removeLocalEnv,
  })
  assert.equal(result.ok, false)
  assert.match(result.error, /共享 Postgres 没在跑/)
  assert.equal(removeLocalEnv.calls.length, 0)
})

test('本机凭据文件删不掉不算销毁失败，带警告返回', async () => {
  const result = await stopPreview({
    address: 'acme-shop-pr42.afkfactory.space',
    helper: async () => '',
    removeLocalEnv: async () => {
      throw new Error('文件不存在')
    },
  })
  assert.equal(result.ok, true)
  assert.match(result.warning, /文件不存在/)
})

const NOW = '2026-11-17T12:00:00Z'
const HOUR = 60 * 60 * 1000

function ago(ms) {
  return new Date(Date.parse(NOW) - ms).toISOString()
}

test('24 小时没提交也没访问就销毁', async () => {
  const helper = recorder('')
  const result = await sweepPreviews({
    now: NOW,
    previews: [
      {
        address: 'acme-shop-pr42.afkfactory.space',
        createdAt: ago(3 * 24 * HOUR),
        lastCommitAt: ago(25 * HOUR),
        lastAccessAt: ago(26 * HOUR),
      },
    ],
    helper,
  })
  assert.deepEqual(result.stopped.map((row) => row.address), ['acme-shop-pr42.afkfactory.space'])
  assert.match(result.stopped[0].reason, /24 小时/)
  assert.deepEqual(helper.calls[0], ['preview-stop', 'acme-shop-pr42.afkfactory.space'])
})

test('满 7 天无条件销毁，哪怕刚有提交和访问', async () => {
  const helper = recorder('')
  const result = await sweepPreviews({
    now: NOW,
    previews: [
      {
        address: 'acme-shop-pr42.afkfactory.space',
        createdAt: ago(7 * 24 * HOUR),
        lastCommitAt: ago(HOUR),
        lastAccessAt: ago(HOUR),
      },
    ],
    helper,
  })
  assert.equal(result.stopped.length, 1)
  assert.match(result.stopped[0].reason, /7 天/)
})

test('24 小时内有过提交或访问就留着', async () => {
  const helper = recorder('')
  const result = await sweepPreviews({
    now: NOW,
    previews: [
      {
        address: 'recent-commit.afkfactory.space',
        createdAt: ago(2 * 24 * HOUR),
        lastCommitAt: ago(HOUR),
        lastAccessAt: ago(30 * HOUR),
      },
      {
        address: 'recent-visit.afkfactory.space',
        createdAt: ago(2 * 24 * HOUR),
        lastCommitAt: ago(30 * HOUR),
        lastAccessAt: ago(HOUR),
      },
      {
        address: 'exactly-24h.afkfactory.space',
        createdAt: ago(2 * 24 * HOUR),
        lastCommitAt: ago(24 * HOUR),
        lastAccessAt: ago(24 * HOUR),
      },
    ],
    helper,
  })
  assert.deepEqual(result.kept.map((row) => row.address), [
    'recent-commit.afkfactory.space',
    'recent-visit.afkfactory.space',
  ])
  assert.deepEqual(result.stopped.map((row) => row.address), ['exactly-24h.afkfactory.space'])
})

test('没记录提交和访问时间时从创建时间算', async () => {
  const helper = recorder('')
  const result = await sweepPreviews({
    now: NOW,
    previews: [
      { address: 'old.afkfactory.space', createdAt: ago(25 * HOUR) },
      { address: 'fresh.afkfactory.space', createdAt: ago(23 * HOUR) },
    ],
    helper,
  })
  assert.deepEqual(result.stopped.map((row) => row.address), ['old.afkfactory.space'])
  assert.deepEqual(result.kept.map((row) => row.address), ['fresh.afkfactory.space'])
})

test('一条时间都没记的预览不猜，留着', async () => {
  const helper = recorder('')
  const result = await sweepPreviews({
    now: NOW,
    previews: [{ address: 'unknown.afkfactory.space' }],
    helper,
  })
  assert.equal(result.stopped.length, 0)
  assert.deepEqual(result.kept.map((row) => row.address), ['unknown.afkfactory.space'])
})

test('一套销毁失败不影响另一套', async () => {
  const helper = async (args) => {
    if (args[1] === 'broken.afkfactory.space') throw new Error('容器删不掉')
    return ''
  }
  const result = await sweepPreviews({
    now: NOW,
    previews: [
      { address: 'broken.afkfactory.space', createdAt: ago(8 * 24 * HOUR) },
      { address: 'fine.afkfactory.space', createdAt: ago(8 * 24 * HOUR) },
    ],
    helper,
  })
  assert.deepEqual(result.failed.map((row) => row.address), ['broken.afkfactory.space'])
  assert.match(result.failed[0].error, /容器删不掉/)
  assert.deepEqual(result.stopped.map((row) => row.address), ['fine.afkfactory.space'])
})

async function fakeHelper(t) {
  const dir = await mkdtemp(join(tmpdir(), 'afk-preview-cli-'))
  const path = join(dir, 'afk-product')
  const log = join(dir, 'args.log')
  await writeFile(
    path,
    [
      '#!/bin/sh',
      `printf '%s\\n' "$@" > '${log}'`,
      "printf '预览 %s 起好了\\n' \"$2\"",
      "printf 'AFK_PREVIEW address=%s\\n' \"$2\"",
      "printf 'AFK_PREVIEW user=u12345678\\n'",
      "printf 'AFK_PREVIEW password=secret-pass\\n'",
      "printf 'AFK_PREVIEW db=preview_db\\n'",
      "printf 'AFK_PREVIEW dir=/data/previews/%s\\n' \"$2\"",
      "printf 'AFK_PREVIEW env=/data/previews/%s/.env\\n' \"$2\"",
      '',
    ].join('\n'),
    { mode: 0o755 },
  )
  return { dir, path, log }
}

test('CLI start 调 helper，并写 private/预览/<地址>.env', async (t) => {
  const fake = await fakeHelper(t)
  const localDir = join(fake.dir, 'private', '预览')
  const cli = fileURLToPath(new URL('../bin/preview.mjs', import.meta.url))

  const { stdout } = await execFileAsync(
    process.execPath,
    [cli, 'start', '--address', 'acme-shop-pr42.afkfactory.space', '--image', 'img:42', '--seed', 'npm run seed'],
    { env: { ...process.env, AFK_HELPER: fake.path, AFK_LOCAL_PREVIEW_DIR: localDir } },
  )

  const result = JSON.parse(stdout)
  assert.equal(result.ok, true)
  assert.equal(result.address, 'acme-shop-pr42.afkfactory.space')
  assert.equal(result.user, 'u12345678')
  assert.equal(result.credentialsFile, join(localDir, 'acme-shop-pr42.afkfactory.space.env'))

  const args = (await readFile(fake.log, 'utf8')).trim().split('\n')
  assert.deepEqual(args, [
    'preview-start',
    'acme-shop-pr42.afkfactory.space',
    'img:42',
    '--seed',
    'npm run seed',
  ])

  const env = await readFile(result.credentialsFile, 'utf8')
  assert.match(env, /^BASIC_AUTH_USER=u12345678$/m)
  assert.match(env, /^BASIC_AUTH_PASSWORD=secret-pass$/m)
  assert.match(env, /^SERVER_ENV=\/data\/previews\/acme-shop-pr42\.afkfactory\.space\/\.env$/m)
})

test('CLI stop 调 helper 并删掉本机凭据', async (t) => {
  const fake = await fakeHelper(t)
  const localDir = join(fake.dir, 'private', '预览')
  const cli = fileURLToPath(new URL('../bin/preview.mjs', import.meta.url))
  const { mkdir } = await import('node:fs/promises')
  await mkdir(localDir, { recursive: true })
  const credentials = join(localDir, 'acme-shop-pr42.afkfactory.space.env')
  await writeFile(credentials, 'BASIC_AUTH_USER=u1\nBASIC_AUTH_PASSWORD=p1\n')

  const { stdout } = await execFileAsync(
    process.execPath,
    [cli, 'stop', '--address', 'acme-shop-pr42.afkfactory.space'],
    { env: { ...process.env, AFK_HELPER: fake.path, AFK_LOCAL_PREVIEW_DIR: localDir } },
  )
  const result = JSON.parse(stdout)
  assert.equal(result.ok, true)
  await assert.rejects(access(credentials))
  const args = (await readFile(fake.log, 'utf8')).trim().split('\n')
  assert.deepEqual(args, ['preview-stop', 'acme-shop-pr42.afkfactory.space'])
})

test('默认构建从 PR head 的临时 worktree 构建，用完删掉', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'afk-preview-build-'))
  try {
    const git = (...args) =>
      execFileAsync('git', ['-C', dir, ...args], { maxBuffer: 8 * 1024 * 1024 })
    await git('init', '-b', 'main')
    await git('config', 'user.name', 'AFK Test')
    await git('config', 'user.email', 'test@afkfactory.space')
    await writeFile(join(dir, 'README.md'), 'base\n')
    await git('add', '-A')
    await git('commit', '-m', 'base')
    const head = (await git('rev-parse', 'HEAD')).stdout.trim()

    const calls = []
    const buildImage = createDefaultBuildImage({
      run: async (command, args) => {
        calls.push({ command, args })
        await access(args.at(-1))
      },
    })
    const image = await buildImage({
      pr: { number: 77, headRefOid: head },
      repoDir: dir,
      address: 'acme-shop-pr77.afkfactory.space',
    })

    assert.equal(image, 'acme-shop-pr77.afkfactory.space:pr77')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].command, 'docker')
    assert.deepEqual(calls[0].args.slice(0, 5), ['build', '--platform', 'linux/amd64', '-t', image])
    assert.notEqual(calls[0].args.at(-1), dir)
    await assert.rejects(access(calls[0].args.at(-1)), '临时 worktree 没删掉')
  } finally {
    await execFileAsync('git', ['-C', dir, 'worktree', 'prune']).catch(() => {})
    await execFileAsync('rm', ['-rf', dir]).catch(() => {})
  }
})
