import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { renderParentIssue } from '../lib/parent-issue.mjs'

const SAMPLE_ROOT = fileURLToPath(new URL('../../docs/回传样例/', import.meta.url))

async function makeScratch(files) {
  const root = await mkdtemp(join(tmpdir(), 'afk-parent-'))
  const dir = join(root, 'demo')
  await mkdir(dir, { recursive: true })
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, name), content, 'utf8')
  }
  return dir
}

test('样例工作区渲染出的标题和五段与 父工单.md 一致', async () => {
  const sample = await readFile(join(SAMPLE_ROOT, '父工单.md'), 'utf8')
  const title = /^标题：(.*)$/m.exec(sample)[1]
  const expectedBody = sample
    .slice(sample.indexOf('## 客户原话'))
    .trimEnd()
    .replaceAll('<owner>', 'acme')
    .replaceAll('<repo>', 'acme-shuiguo')

  const result = await renderParentIssue({
    scratchDir: join(SAMPLE_ROOT, '工作区', '.scratch', 'xianguopu'),
    shortName: 'xianguopu',
    requirement: 'xianguopu',
    owner: 'acme',
    repo: 'acme-shuiguo',
  })

  assert.equal(result.title, title)
  assert.equal(result.body, expectedBody)
  assert.equal(result.small, false)
  assert.equal(result.deprecated, false)
})

test('小需求从需求草稿五段读标题、结论和不做清单', async () => {
  const dir = await makeScratch({
    '需求草稿.md': `# 预约取货需求草稿

Status: 已问完

## 1. 客户原话

- 我想要一个预约取货的小程序。

日期：2026-11-15

## 2. 问答记录

Q1：怎么取？

## 3. 已经定下的

- 到店取
- 送货加收 5 元

## 4. 还没定的

- 支付方式

## 5. 以后再说

- 会员积分

复核：查过
`,
    '验收场景.md': `# 验收场景

客户确认：2026-11-15

- [ ] 能选到店取或送货。
`,
  })

  const result = await renderParentIssue({
    scratchDir: dir,
    shortName: 'acme',
    requirement: 'demo',
    owner: 'acme',
    repo: 'acme-demo',
  })

  assert.equal(result.small, true)
  assert.equal(result.title, '我想要一个预约取货的小程序。')
  assert.match(result.body, /## 客户原话\n\n> 「我想要一个预约取货的小程序。」/)
  assert.match(result.body, /日期：2026-11-15/)
  assert.match(result.body, /## 客户确认的结论\n\n- 到店取\n- 送货加收 5 元/)
  assert.match(result.body, /## 不做清单\n\n- 会员积分/)
  assert.match(result.body, /- \[ \] 能选到店取或送货。/)
  assert.match(result.body, /- 全文：https:\/\/github\.com\/acme\/acme-demo\/tree\/main\/docs\/requirements\/demo\//)
})

test('地图 Decisions so far 行首出现「已废」或「已被取代」时标出来', async () => {
  const dir = await makeScratch({
    'map.md': `# demo 地图

## 接下来

## Decisions so far

- [01 怎么取](issues/01.md)：到店取
- 已废：送货

## Not yet specified

## Out of scope

无
`,
    '问答记录.md': `# 问答记录

## 客户原话

> 「想要预约取货。」

日期：2026-11-15
`,
    '验收场景.md': '# 验收场景\n\n客户确认：2026-11-15\n\n- [ ] 能预约。\n',
  })

  const result = await renderParentIssue({
    scratchDir: dir,
    shortName: 'acme',
    requirement: 'demo',
    owner: 'acme',
    repo: 'acme-demo',
  })

  assert.equal(result.deprecated, true)
  assert.equal(result.small, false)
})

test('没有 map 也没有需求草稿时报错，不硬凑正文', async () => {
  const dir = await makeScratch({
    '验收场景.md': '# 验收场景\n\n客户确认：2026-11-15\n\n- [ ] 能预约。\n',
  })

  await assert.rejects(
    renderParentIssue({
      scratchDir: dir,
      shortName: 'acme',
      requirement: 'demo',
      owner: 'acme',
      repo: 'acme-demo',
    }),
    /找不到/,
  )
})
