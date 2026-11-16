import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { inspectZip } from '../lib/zip.mjs'
import { makeConfig, makeWorkspace, makeZipFromEntries, readZip } from './helpers.mjs'

async function outDir() {
  return mkdtemp(join(tmpdir(), 'afkapp-out-'))
}

test('正常包认出 .scratch 和需求目录', async () => {
  const { config } = await makeConfig()
  const workspace = await makeWorkspace()
  const result = await inspectZip(config, workspace.zipPath, await outDir())
  assert.equal(result.ok, true)
  assert.equal(result.root, '')
  assert.deepEqual(result.requirements, ['demo'])
})

test('macOS 命令行 zip 打的中文包，文件名能认出来', async () => {
  const { config } = await makeConfig()
  const workspace = await makeWorkspace({ zipTool: 'zip' })
  const out = await outDir()
  const result = await inspectZip(config, workspace.zipPath, out)
  assert.equal(result.ok, true)
  assert.deepEqual(result.requirements, ['demo'])
  const acceptance = await readZip(join(out, 'scratch', 'demo', '验收场景.md'))
  assert.match(acceptance.toString('utf8'), /客户确认/)
})

test('Finder 同款 ditto 打的中文包，文件名能认出来', async (t) => {
  if (process.platform !== 'darwin') {
    t.skip('ditto 只在 macOS 上有')
    return
  }
  const { config } = await makeConfig()
  const workspace = await makeWorkspace({ zipTool: 'ditto' })
  const out = await outDir()
  const result = await inspectZip(config, workspace.zipPath, out)
  assert.equal(result.ok, true)
  assert.deepEqual(result.requirements, ['demo'])
  const acceptance = await readZip(join(out, 'scratch', 'demo', '验收场景.md'))
  assert.match(acceptance.toString('utf8'), /客户确认/)
})

test('工作区在单独一层子目录时认出来', async () => {
  const { config } = await makeConfig()
  const workspace = await makeWorkspace({ nested: true })
  const result = await inspectZip(config, workspace.zipPath, await outDir())
  assert.equal(result.ok, true)
  assert.equal(result.root, '工作区')
  assert.deepEqual(result.requirements, ['demo'])
})

test('原始工作区包给出对应提示类别', async () => {
  const { config } = await makeConfig()
  const { zipPath } = await makeZipFromEntries([
    { name: 'AGENTS.md', kind: 'file', payload: 'x' },
    { name: '.dsh/skills/a/SKILL.md', kind: 'file', payload: 'x' },
  ])
  const result = await inspectZip(config, zipPath, await outDir())
  assert.equal(result.ok, false)
  assert.equal(result.code, 'missing_scratch')
  assert.equal(result.kind, 'original-package')
})

test('只压了需求文件夹也给出对应提示类别', async () => {
  const { config } = await makeConfig()
  const { zipPath } = await makeZipFromEntries([
    { name: 'map.md', kind: 'file', payload: 'x' },
    { name: 'issues/01.md', kind: 'file', payload: 'x' },
  ])
  const result = await inspectZip(config, zipPath, await outDir())
  assert.equal(result.kind, 'requirement-only')
})

test('没解压的 zip 给出对应提示类别', async () => {
  const { config } = await makeConfig()
  const { zipPath } = await makeZipFromEntries([{ name: 'workspace.zip', kind: 'file', payload: 'x' }])
  const result = await inspectZip(config, zipPath, await outDir())
  assert.equal(result.kind, 'not-unzipped')
})

test('传错文件夹给出对应提示类别', async () => {
  const { config } = await makeConfig()
  const { zipPath } = await makeZipFromEntries([{ name: 'photo.jpg', kind: 'file', payload: 'x' }])
  const result = await inspectZip(config, zipPath, await outDir())
  assert.equal(result.kind, 'wrong-folder')
})

test('.scratch 下没有需求目录', async () => {
  const { config } = await makeConfig()
  const { zipPath } = await makeZipFromEntries([{ name: '.scratch/readme.txt', kind: 'file', payload: 'x' }])
  const result = await inspectZip(config, zipPath, await outDir())
  assert.equal(result.ok, false)
  assert.equal(result.code, 'no_requirements')
})

test('路径穿越和绝对路径被拒', async () => {
  const { config } = await makeConfig()
  for (const name of ['../evil.txt', '/etc/passwd', 'a/../../b.txt', 'C:/windows/x']) {
    const { zipPath } = await makeZipFromEntries([{ name, kind: 'file', payload: 'x' }])
    const result = await inspectZip(config, zipPath, await outDir())
    assert.equal(result.ok, false, name)
    assert.equal(result.code, 'unsafe', name)
  }
})

test('符号链接被拒', async () => {
  const { config } = await makeConfig()
  const { zipPath } = await makeZipFromEntries([{ name: 'link', kind: 'link', payload: '/etc/passwd' }])
  const result = await inspectZip(config, zipPath, await outDir())
  assert.equal(result.code, 'unsafe')
})

test('条目数超限被拒', async () => {
  const { config } = await makeConfig({ ZIP_MAX_ENTRIES: '2' })
  const { zipPath } = await makeZipFromEntries([
    { name: 'a.txt', kind: 'file', payload: '1' },
    { name: 'b.txt', kind: 'file', payload: '2' },
    { name: 'c.txt', kind: 'file', payload: '3' },
  ])
  const result = await inspectZip(config, zipPath, await outDir())
  assert.equal(result.code, 'too_large')
})

test('单文件超限被拒', async () => {
  const { config } = await makeConfig({ ZIP_MAX_FILE: '1024' })
  const { zipPath } = await makeZipFromEntries([
    { name: 'big.txt', kind: 'file', payload: 'x'.repeat(4096) },
  ])
  const result = await inspectZip(config, zipPath, await outDir())
  assert.equal(result.code, 'too_large')
})

test('不是 zip 被拒', async () => {
  const { config } = await makeConfig()
  const dir = await outDir()
  const file = join(dir, 'x.zip')
  const { writeFile } = await import('node:fs/promises')
  await writeFile(file, 'hello', 'utf8')
  const result = await inspectZip(config, file, await outDir())
  assert.equal(result.code, 'not_zip')
})

test('只解出 .scratch，其他文件不落盘', async () => {
  const { config } = await makeConfig()
  const workspace = await makeWorkspace()
  const out = await outDir()
  await inspectZip(config, workspace.zipPath, out)
  const { stat } = await import('node:fs/promises')
  await assert.rejects(stat(join(out, 'AGENTS.md')))
  const draft = await readZip(join(out, 'scratch', 'demo', '需求草稿.md'))
  assert.match(draft.toString('utf8'), /Status: 已问完/)
})
