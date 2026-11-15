import assert from 'node:assert/strict'
import { mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { writeJsonAtomic } from '../lib/store.mjs'
import { cleanupExpired } from '../lib/uploads.mjs'
import { makeConfig } from './helpers.mjs'

async function uploadDir(config, name, meta) {
  const dir = join(config.uploadDir, name)
  await mkdir(dir, { recursive: true })
  await writeJsonAtomic(join(dir, 'meta.json'), meta)
  return dir
}

test('失败包过 7 天清掉，成功的包不动，没到期的失败包留着', async () => {
  const { config } = await makeConfig()
  const now = Date.parse('2026-11-15T12:00:00Z')
  const old = '2026-11-01T12:00:00Z'
  const recent = '2026-11-14T12:00:00Z'

  const expired = await uploadDir(config, 'upload-old-failed', { status: 'failed', at: old })
  const fresh = await uploadDir(config, 'upload-recent-failed', { status: 'failed', at: recent })
  const ready = await uploadDir(config, 'upload-old-ready', { status: 'ready', at: old })

  const removed = await cleanupExpired(config, now)
  assert.equal(removed, 1)
  await assert.rejects(stat(expired))
  assert.ok(await stat(fresh))
  assert.ok(await stat(ready))
})

test('没有上传目录时不报错', async () => {
  const { config } = await makeConfig()
  const { rm } = await import('node:fs/promises')
  await rm(config.uploadDir, { recursive: true, force: true })
  assert.equal(await cleanupExpired(config, Date.now()), 0)
})
