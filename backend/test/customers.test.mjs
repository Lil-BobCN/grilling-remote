import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { setCustomerRepo } from '../lib/customers.mjs'
import { makeConfig } from './helpers.mjs'

const FIRST = {
  id: 'c-0001',
  short_name: 'acme',
  display_name: 'Acme 老板',
  email: 'boss@example.com',
  status: 'active',
  repos: {},
  wechat: '',
  note: '',
  password_hash: '$argon2id$example',
  created_at: '2026-11-13T12:00:00Z',
  updated_at: '2026-11-13T12:00:00Z',
  disabled_at: null,
  disabled_reason: null,
}

const SECOND = {
  ...FIRST,
  id: 'c-0002',
  short_name: 'bravo',
  email: 'boss@bravo.example',
  repos: { kucun: 'bravo-kucun' },
}

async function seed(config, rows = [FIRST, SECOND]) {
  const { writeJsonAtomic } = await import('../lib/store.mjs')
  await writeJsonAtomic(join(config.dataDir, 'customers.json'), rows)
}

test('只写 repos[软件简称]，其他字段和其他客户行不动', async () => {
  const { config } = await makeConfig()
  await seed(config)

  await setCustomerRepo(config, 'c-0001', 'shuiguo', 'acme-shuiguo')

  const rows = JSON.parse(await readFile(join(config.dataDir, 'customers.json'), 'utf8'))
  assert.deepEqual(rows[0].repos, { shuiguo: 'acme-shuiguo' })
  assert.equal(rows[0].updated_at, FIRST.updated_at)
  assert.equal(rows[0].password_hash, FIRST.password_hash)
  assert.deepEqual(rows[1], SECOND)
})

test('第二个软件写新键，保留已有键', async () => {
  const { config } = await makeConfig()
  await seed(config)

  await setCustomerRepo(config, 'c-0001', 'shuiguo', 'acme-shuiguo')
  await setCustomerRepo(config, 'c-0001', 'kucun', 'acme-kucun')

  const rows = JSON.parse(await readFile(join(config.dataDir, 'customers.json'), 'utf8'))
  assert.deepEqual(rows[0].repos, { shuiguo: 'acme-shuiguo', kucun: 'acme-kucun' })
})

test('客户不存在时报错，不改文件', async () => {
  const { config } = await makeConfig()
  await seed(config)

  await assert.rejects(setCustomerRepo(config, 'c-9999', 'shuiguo', 'x-y'), /找不到/)
  const rows = JSON.parse(await readFile(join(config.dataDir, 'customers.json'), 'utf8'))
  assert.deepEqual(rows[0].repos, {})
})
