import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { readVersion } from '../lib/version.mjs'

async function fixture(t, files) {
  const dir = await mkdtemp(join(tmpdir(), 'afk-version-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  for (const [name, body] of Object.entries(files)) {
    await writeFile(join(dir, name), body, 'utf8')
  }
  return dir
}

test('有 release.json 时健康检查的版本跟发布走', async (t) => {
  const dir = await fixture(t, {
    'release.json': JSON.stringify({ version: '1.3.0-rc.6', commit: 'abc' }),
    'package.json': JSON.stringify({ version: '1.2.0' }),
  })
  assert.equal(readVersion({ dir }), '1.3.0-rc.6')
})

test('旧发布包没有 release.json 时回退到 package.json', async (t) => {
  const dir = await fixture(t, {
    'package.json': JSON.stringify({ version: '1.2.0' }),
  })
  assert.equal(readVersion({ dir }), '1.2.0')
})

test('release.json 坏了或没有 version 时回退到 package.json', async (t) => {
  for (const release of ['{坏 JSON', JSON.stringify({ commit: 'abc' })]) {
    const dir = await fixture(t, {
      'release.json': release,
      'package.json': JSON.stringify({ version: '1.2.0' }),
    })
    assert.equal(readVersion({ dir }), '1.2.0', release)
  }
})
