import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
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

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'afk-uploads-helper-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const uploads = join(root, 'uploads')
  const customers = join(root, 'customers.json')
  await mkdir(join(uploads, 'upload-abc'), { recursive: true })
  await writeFile(join(uploads, 'upload-abc', 'meta.json'), '{"status":"ready"}\n')
  await writeFile(join(uploads, 'upload-abc', 'package.zip'), 'zip-bytes')
  await mkdir(join(uploads, 'not-an-upload'), { recursive: true })
  await writeFile(customers, '[{"id":"c-0001"}]\n')
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

test('helper 能读客户表、删上传目录', async (t) => {
  const { uploads, env } = await setup(t)

  const customers = await runHelper(['cat-customers'], env)
  assert.equal(customers.code, 0)
  assert.deepEqual(JSON.parse(customers.stdout), [{ id: 'c-0001' }])

  const removed = await runHelper(['rm', 'upload-abc'], env)
  assert.equal(removed.code, 0)
  await assert.rejects(stat(join(uploads, 'upload-abc')))

  const badRm = await runHelper(['rm', '../data'], env)
  assert.equal(badRm.code, 2)
})

test('helper 没有上传目录时 list 回空，不报错', async (t) => {
  const { env } = await setup(t)
  await rm(env.AFK_UPLOAD_DIR, { recursive: true, force: true })
  const list = await runHelper(['list'], env)
  assert.equal(list.code, 0)
  assert.equal(list.stdout.trim(), '')
})
