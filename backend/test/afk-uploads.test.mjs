import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const HELPER = fileURLToPath(new URL('../../deploy/backend/afk-uploads', import.meta.url))

async function runHelper(args, env) {
  try {
    const { stdout } = await execFileAsync('bash', [HELPER, ...args], {
      env: { ...process.env, ...env },
    })
    return { code: 0, stdout }
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr }
  }
}

async function setup(t, { status = 'ready' } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'afk-uploads-helper-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const uploads = join(root, 'uploads')
  const customers = join(root, 'customers.json')
  await mkdir(join(uploads, 'upload-abc'), { recursive: true })
  await writeFile(join(uploads, 'upload-abc', 'meta.json'), `${JSON.stringify({ status })}\n`)
  await writeFile(join(uploads, 'upload-abc', 'package.zip'), 'zip-bytes')
  await mkdir(join(uploads, 'not-an-upload'), { recursive: true })
  await writeFile(
    customers,
    `${JSON.stringify([
      {
        id: 'c-0001',
        short_name: 'acme',
        display_name: 'Acme 老板',
        email: 'boss@example.com',
        status: 'active',
        repos: { demo: 'acme-demo' },
        password_hash: '$argon2id$secret',
        note: '',
      },
    ])}\n`,
  )
  return {
    uploads,
    customers,
    env: { AFK_UPLOAD_DIR: uploads, AFK_CUSTOMERS_FILE: customers },
  }
}

test('helper 只列 upload-*、只读两种文件', async (t) => {
  const { env } = await setup(t)

  const list = await runHelper(['list'], env)
  assert.equal(list.code, 0)
  assert.equal(list.stdout.trim(), 'upload-abc')

  const meta = await runHelper(['cat', 'upload-abc', 'meta.json'], env)
  assert.equal(meta.code, 0)
  assert.equal(meta.stdout, '{"status":"ready"}\n')

  const zip = await runHelper(['cat', 'upload-abc', 'package.zip'], env)
  assert.equal(zip.code, 0)
  assert.equal(zip.stdout, 'zip-bytes')

  const badId = await runHelper(['cat', '../etc', 'meta.json'], env)
  assert.equal(badId.code, 2)
  const badFile = await runHelper(['cat', 'upload-abc', 'secret.txt'], env)
  assert.equal(badFile.code, 2)
})

test('cat-customers 去掉 password_hash 和 email，其他字段保留', async (t) => {
  const { env } = await setup(t)

  const customers = await runHelper(['cat-customers'], env)
  assert.equal(customers.code, 0)
  const parsed = JSON.parse(customers.stdout)
  assert.equal(parsed.customers.length, 1)
  const row = parsed.customers[0]
  assert.equal(row.id, 'c-0001')
  assert.equal(row.short_name, 'acme')
  assert.equal(row.status, 'active')
  assert.deepEqual(row.repos, { demo: 'acme-demo' })
  assert.equal(row.display_name, 'Acme 老板')
  assert.equal('password_hash' in row, false)
  assert.equal('email' in row, false)
  assert.ok(!customers.stdout.includes('boss@example.com'))
  assert.ok(!customers.stdout.includes('argon2'))
})

test('rm 只删已导入的包，ready 一律拒绝', async (t) => {
  const { uploads, env } = await setup(t, { status: 'ready' })

  const refused = await runHelper(['rm', 'upload-abc'], env)
  assert.notEqual(refused.code, 0)
  assert.match(refused.stderr, /只删已导入的包/)
  await stat(join(uploads, 'upload-abc', 'package.zip'))

  const badRm = await runHelper(['rm', '../data'], env)
  assert.equal(badRm.code, 2)

  await writeFile(join(uploads, 'upload-abc', 'meta.json'), '{"status":"imported"}\n')
  const removed = await runHelper(['rm', 'upload-abc'], env)
  assert.equal(removed.code, 0)
  await assert.rejects(stat(join(uploads, 'upload-abc')))
})

test('helper 没有上传目录时 list 回空，不报错', async (t) => {
  const { env } = await setup(t)
  await rm(env.AFK_UPLOAD_DIR, { recursive: true, force: true })
  const list = await runHelper(['list'], env)
  assert.equal(list.code, 0)
  assert.equal(list.stdout.trim(), '')
})

async function setupDelivery(t) {
  const root = await mkdtemp(join(tmpdir(), 'afk-uploads-mail-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const orders = join(root, 'orders')
  await mkdir(orders, { recursive: true })
  const customers = join(root, 'customers.json')
  await writeFile(
    customers,
    `${JSON.stringify([
      {
        id: 'c-0001',
        short_name: 'acme',
        display_name: 'Acme 老板',
        email: 'boss@example.com',
        status: 'active',
        password_hash: '$argon2id$secret',
      },
    ])}\n`,
  )
  await writeFile(
    join(orders, 'o-0001.json'),
    `${JSON.stringify({
      id: 'o-0001',
      customer_id: 'c-0001',
      customer_snapshot: { short_name: 'acme', display_name: 'Acme 老板' },
      product: 'shop',
      requirement: 'shop',
    })}\n`,
  )
  await writeFile(
    join(orders, 'o-0002.json'),
    `${JSON.stringify({
      id: 'o-0002',
      customer_id: 'c-9999',
      customer_snapshot: {},
      product: 'shop',
      requirement: 'shop',
    })}\n`,
  )
  const appEnv = join(root, 'app.env')
  await writeFile(
    appEnv,
    [
      'SMTP_HOST=smtp.example.com',
      'SMTP_PORT=465',
      'SMTP_USER=notify@mail.example.com',
      'SMTP_PASSWORD=s3cret-pass',
      'SMTP_FROM=notify@mail.example.com',
      '',
    ].join('\n'),
  )
  const mailScript = join(root, 'customer-mail.py')
  await writeFile(
    mailScript,
    [
      'import json',
      'import os',
      'import sys',
      '',
      'record = {"argv": sys.argv[1:], "body": sys.stdin.read()}',
      'with open(os.environ["FAKE_MAIL_OUT"], "w", encoding="utf-8") as fh:',
      '    json.dump(record, fh, ensure_ascii=False)',
      'if os.environ.get("FAKE_MAIL_FAIL"):',
      '    raise SystemExit("SMTP 535 auth failed for boss@example.com password s3cret-pass")',
      '',
    ].join('\n'),
  )
  const outFile = join(root, 'mail.json')
  return {
    orders,
    customers,
    appEnv,
    mailScript,
    outFile,
    env: {
      AFK_ORDERS_DIR: orders,
      AFK_CUSTOMERS_FILE: customers,
      AFK_APP_ENV: appEnv,
      AFK_CUSTOMER_MAIL: mailScript,
      FAKE_MAIL_OUT: outFile,
    },
  }
}

test('send-delivery-mail 读订单和客户表，正文带地址和 2 到 3 件试的事', async (t) => {
  const { outFile, env } = await setupDelivery(t)
  const result = await runHelper(
    [
      'send-delivery-mail',
      'o-0001',
      'acme-shop.afkfactory.space',
      '--tries',
      '打开首页；填一条数据；刷新看还在不在',
    ],
    env,
  )
  assert.equal(result.code, 0, result.stderr)

  const record = JSON.parse(await readFile(outFile, 'utf8'))
  const toIndex = record.argv.indexOf('--to')
  assert.equal(record.argv[toIndex + 1], 'boss@example.com')
  const subject = record.argv[record.argv.indexOf('--subject') + 1]
  assert.match(subject, /Acme 老板 · shop：做好了，可以试了/)
  assert.ok(record.body.includes('https://acme-shop.afkfactory.space/'))
  assert.ok(record.body.includes('①打开首页'))
  assert.ok(record.body.includes('②填一条数据'))
  assert.ok(record.body.includes('③刷新看还在不在'))
  assert.ok(record.body.includes('①打开首页\n②填一条数据\n③刷新看还在不在'))
  assert.ok(record.body.includes('哪里不对，直接微信说'))

  assert.ok(!result.stdout.includes('boss@example.com'))
  assert.ok(!result.stdout.includes('s3cret-pass'))
})

test('不带 --tries 时用默认三件事', async (t) => {
  const { outFile, env } = await setupDelivery(t)
  const result = await runHelper(
    ['send-delivery-mail', 'o-0001', 'acme-shop.afkfactory.space'],
    env,
  )
  assert.equal(result.code, 0, result.stderr)
  const record = JSON.parse(await readFile(outFile, 'utf8'))
  assert.ok(record.body.includes('①'))
  assert.ok(record.body.includes('②'))
  assert.ok(record.body.includes('③'))
})

test('send-delivery-mail 失败时退出非零，不打印邮箱和密码', async (t) => {
  const { env } = await setupDelivery(t)
  const result = await runHelper(
    ['send-delivery-mail', 'o-0001', 'acme-shop.afkfactory.space', '--tries', '看首页；填数据'],
    { ...env, FAKE_MAIL_FAIL: '1' },
  )
  assert.notEqual(result.code, 0)
  assert.match(result.stderr, /客户邮件没发出去/)
  assert.ok(!result.stderr.includes('boss@example.com'))
  assert.ok(!result.stderr.includes('s3cret-pass'))
})

test('订单不存在或客户没有邮箱时不发信', async (t) => {
  const { outFile, env } = await setupDelivery(t)
  const missing = await runHelper(
    ['send-delivery-mail', 'o-0404', 'acme-shop.afkfactory.space'],
    env,
  )
  assert.notEqual(missing.code, 0)
  assert.match(missing.stderr, /没这个订单/)

  const noEmail = await runHelper(
    ['send-delivery-mail', 'o-0002', 'acme-shop.afkfactory.space'],
    env,
  )
  assert.notEqual(noEmail.code, 0)
  assert.match(noEmail.stderr, /没有邮箱/)
  await assert.rejects(stat(outFile))
})

test('--tries 只给一件或超过三件都拒绝', async (t) => {
  const { env } = await setupDelivery(t)
  const one = await runHelper(
    ['send-delivery-mail', 'o-0001', 'acme-shop.afkfactory.space', '--tries', '只有一件事'],
    env,
  )
  assert.equal(one.code, 2)
  const four = await runHelper(
    [
      'send-delivery-mail',
      'o-0001',
      'acme-shop.afkfactory.space',
      '--tries',
      '一；二；三；四',
    ],
    env,
  )
  assert.equal(four.code, 2)
})

test('mark-delivered 原子写订单 delivery 字段，其他字段不动', async (t) => {
  const { orders, env } = await setupDelivery(t)
  const result = await runHelper(['mark-delivered', 'o-0001', 'acme-shop.afkfactory.space'], env)
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stdout, /已记交付地址/)

  const order = JSON.parse(await readFile(join(orders, 'o-0001.json'), 'utf8'))
  assert.deepEqual(order.delivery, {
    address: 'acme-shop.afkfactory.space',
    url: 'https://acme-shop.afkfactory.space/',
  })
  assert.equal(order.customer_id, 'c-0001')
  assert.equal(order.product, 'shop')
  const info = await stat(join(orders, 'o-0001.json'))
  assert.equal(info.mode & 0o777, 0o600)

  const missing = await runHelper(['mark-delivered', 'o-9999', 'acme-shop.afkfactory.space'], env)
  assert.equal(missing.code, 1)
  assert.match(missing.stderr, /没这个订单/)

  const badAddress = await runHelper(['mark-delivered', 'o-0001', '不是地址'], env)
  assert.equal(badAddress.code, 2)
  assert.match(badAddress.stderr, /交付地址不对/)
})
