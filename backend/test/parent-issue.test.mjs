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

test('小需求用 YYYY-MM-DD：写法也能出父工单和日期', async () => {
  const dir = await makeScratch({
    '需求草稿.md': `# demo 需求草稿

Status: 已问完

## 1. 客户原话

2026-11-15：我想要一个预约取货的小程序。

## 3. 已经定下的

- 到店取

## 5. 以后再说

- 无
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

  assert.equal(result.title, '我想要一个预约取货的小程序。')
  assert.match(
    result.body,
    /## 客户原话\n\n> 「我想要一个预约取货的小程序。」\n\n日期：2026-11-15/,
  )
})

test('问答记录用 YYYY-MM-DD：写法也能出父工单和日期', async () => {
  const dir = await makeScratch({
    'map.md': `# demo 地图

## 接下来

## Decisions so far

- [01 怎么取](issues/01.md)：到店取

## Not yet specified

## Out of scope

无
`,
    '问答记录.md': `# 问答记录

## 客户原话

2026-11-15：想要预约取货。

## 第1轮

Q1：怎么取？

客户：「到店取。」
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

  assert.equal(result.title, '想要预约取货。')
  assert.match(result.body, /## 客户原话\n\n> 「想要预约取货。」\n\n日期：2026-11-15/)
})

test('客户原话一节只有日期、没有原话时报错', async () => {
  const dir = await makeScratch({
    'map.md': '# demo 地图\n\n## 接下来\n\n## Decisions so far\n\n## Not yet specified\n\n## Out of scope\n\n无\n',
    '问答记录.md': '# 问答记录\n\n## 客户原话\n\n日期：2026-11-15\n',
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
    /读不到客户原话/,
  )
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

const SMALL_DRAFT = `# 预约取货需求草稿

Status: 已问完

## 1. 客户原话

- 我想要一个预约取货的小程序。

日期：2026-11-15

## 3. 已经定下的

- 到店取

## 5. 以后再说

- 无
`

function acceptanceSection(body) {
  return /## 验收条件\n\n([\s\S]*?)\n\n## 不做清单/.exec(body)?.[1]
}

test('编号列表的验收场景能进父工单，行末「按第 N 张改」不抄', async () => {
  const dir = await makeScratch({
    '需求草稿.md': SMALL_DRAFT,
    '验收场景.md': [
      '# 验收场景',
      '',
      '客户确认：2026-11-15',
      '',
      '1. 能选到店取或送货。（按第 2 张改）',
      '2. 老板能看到订单。',
      '3) 顾客收到通知。',
      '4) 顾客能取消。按第 4 张改',
      '',
    ].join('\n'),
  })

  const result = await renderParentIssue({
    scratchDir: dir,
    shortName: 'acme',
    requirement: 'demo',
    owner: 'acme',
    repo: 'acme-demo',
  })

  assert.equal(
    acceptanceSection(result.body),
    [
      '- [ ] 能选到店取或送货。',
      '- [ ] 老板能看到订单。',
      '- [ ] 顾客收到通知。',
      '- [ ] 顾客能取消。',
    ].join('\n'),
  )
})

test('减号、星号和编号三种验收写法渲染结果一致', async () => {
  const variants = {
    复选框: '- [ ] 能选到店取或送货。\n- [ ] 老板能看到订单。',
    减号: '- 能选到店取或送货。\n- 老板能看到订单。',
    星号: '* 能选到店取或送货。\n* 老板能看到订单。',
    编号: '1. 能选到店取或送货。\n2. 老板能看到订单。',
  }
  const sections = []
  for (const [name, items] of Object.entries(variants)) {
    const dir = await makeScratch({
      '需求草稿.md': SMALL_DRAFT,
      '验收场景.md': `# 验收场景\n\n客户确认：2026-11-15\n\n${items}\n`,
    })
    const result = await renderParentIssue({
      scratchDir: dir,
      shortName: 'acme',
      requirement: 'demo',
      owner: 'acme',
      repo: 'acme-demo',
    })
    sections.push({ name, section: acceptanceSection(result.body) })
  }
  for (const item of sections) {
    assert.equal(item.section, sections[0].section, item.name)
  }
  assert.equal(sections[0].section, '- [ ] 能选到店取或送货。\n- [ ] 老板能看到订单。')
})
