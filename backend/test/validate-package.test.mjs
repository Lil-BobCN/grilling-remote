import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { renderParentIssue } from '../lib/parent-issue.mjs'
import { validateRequirement } from '../lib/validate-package.mjs'

async function makeRequirement(files) {
  const dir = await mkdtemp(join(tmpdir(), 'afk-validate-'))
  for (const [name, content] of Object.entries(files)) {
    const path = join(dir, name)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content, 'utf8')
  }
  return dir
}

const ACCEPTANCE = '# 验收场景\n\n客户确认：2026-11-15\n\n- [ ] 能预约。\n'

const MAP = `# demo 地图

## 接下来

## Decisions so far

- [01](issues/01.md)：到店取

## Not yet specified

## Out of scope

无
`

test('小需求标准写法「」加日期：通过上传校验', async () => {
  const dir = await makeRequirement({
    '需求草稿.md': `# demo 需求草稿

Status: 已问完

## 1. 客户原话

> 「我想要一个预约取货的小程序。」

日期：2026-11-15
`,
    '验收场景.md': ACCEPTANCE,
  })

  const result = await validateRequirement(dir, { finished: true })
  assert.equal(result.passed, true)
  assert.deepEqual(result.missing, [])
})

test('按标准写法写的包上传通过，导入也能出父工单', async () => {
  const dir = await makeRequirement({
    '需求草稿.md': `# demo 需求草稿

Status: 已问完

## 1. 客户原话

> 「我想要一个预约取货的小程序。」

日期：2026-11-15
`,
    '验收场景.md': ACCEPTANCE,
  })

  const validation = await validateRequirement(dir, { finished: true })
  assert.equal(validation.passed, true)

  const rendered = await renderParentIssue({
    scratchDir: dir,
    shortName: 'acme',
    requirement: 'demo',
    owner: 'acme',
    repo: 'acme-demo',
  })
  assert.equal(rendered.title, '我想要一个预约取货的小程序。')
  assert.match(rendered.body, /## 客户原话\n\n> 「我想要一个预约取货的小程序。」\n\n日期：2026-11-15/)
})

test('小需求 YYYY-MM-DD：写法通过上传校验', async () => {
  const dir = await makeRequirement({
    '需求草稿.md': `# demo 需求草稿

Status: 已问完

## 1. 客户原话

2026-11-15：我想要一个预约取货的小程序。
`,
    '验收场景.md': ACCEPTANCE,
  })

  const result = await validateRequirement(dir, { finished: true })
  assert.equal(result.passed, true)
})

test('小需求缺原话不通过，提示补客户原话', async () => {
  const dir = await makeRequirement({
    '需求草稿.md': `# demo 需求草稿

Status: 已问完

## 1. 客户原话

## 3. 已经定下的

- 到店取
`,
    '验收场景.md': ACCEPTANCE,
  })

  const result = await validateRequirement(dir, { finished: true })
  assert.equal(result.passed, false)
  assert.match(result.missing.join('\n'), /客户原话/)
})

test('小需求草稿只有 Status 不算有原话', async () => {
  const dir = await makeRequirement({
    '需求草稿.md': 'Status: 已问完\n',
    '验收场景.md': ACCEPTANCE,
  })

  const result = await validateRequirement(dir, { finished: true })
  assert.equal(result.passed, false)
  assert.match(result.missing.join('\n'), /客户原话/)
})

test('地图需求标准写法「」加日期：通过上传校验', async () => {
  const dir = await makeRequirement({
    'map.md': MAP,
    'issues/01.md': '# 01\n\nStatus: resolved\n',
    '问答记录.md': `# 问答记录

## 客户原话

> 「想要预约取货。」

日期：2026-11-15
`,
    '验收场景.md': ACCEPTANCE,
  })

  const result = await validateRequirement(dir, { finished: true })
  assert.equal(result.passed, true)
  assert.deepEqual(result.missing, [])
})

test('地图需求缺问答记录不通过，提示补客户原话', async () => {
  const dir = await makeRequirement({
    'map.md': MAP,
    'issues/01.md': '# 01\n\nStatus: resolved\n',
    '验收场景.md': ACCEPTANCE,
  })

  const result = await validateRequirement(dir, { finished: true })
  assert.equal(result.passed, false)
  assert.match(result.missing.join('\n'), /客户原话/)
})

test('地图需求客户原话一节只有日期不通过', async () => {
  const dir = await makeRequirement({
    'map.md': MAP,
    'issues/01.md': '# 01\n\nStatus: resolved\n',
    '问答记录.md': '# 问答记录\n\n## 客户原话\n\n日期：2026-11-15\n',
    '验收场景.md': ACCEPTANCE,
  })

  const result = await validateRequirement(dir, { finished: true })
  assert.equal(result.passed, false)
  assert.match(result.missing.join('\n'), /客户原话/)
})

test('地图需求客户原话只写占位符不通过', async () => {
  const dir = await makeRequirement({
    'map.md': MAP,
    'issues/01.md': '# 01\n\nStatus: resolved\n',
    '问答记录.md': '# 问答记录\n\n## 客户原话\n\n（待补）\n',
    '验收场景.md': ACCEPTANCE,
  })

  const result = await validateRequirement(dir, { finished: true })
  assert.equal(result.passed, false)
  assert.match(result.missing.join('\n'), /客户原话/)
})
