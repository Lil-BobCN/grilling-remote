# Wiki Schema

## Page Types

| Type | Directory | Purpose |
|------|-----------|---------|
| source | wiki/sources/ | 一份口播稿的元数据、摘要、论点和待核验项 |
| concept | wiki/concepts/ | 方法、机制、术语等可复用的概念 |
| entity | wiki/entities/ | 产品、工具、项目等有名字的东西 |
| comparison | wiki/comparisons/ | 两套方法或工具的并列比较 |
| query | wiki/queries/ | 未解决、有冲突或待外部核验的问题 |
| synthesis | wiki/synthesis/ | 跨来源的阶段性分析 |
| decision | wiki/decisions/ | 已确认的项目决定和边界 |
| external-research | wiki/external-research/ | 联网研究证据包，必须有 URL、访问日期和来源类型 |

## Naming

- 文件名用短而稳定的中文或英文 slug，避免空格和标点。
- 一页只承担一个主题。跨主题用 `[[wikilinks]]` 连接。
- 不要用一个总结页替代多个来源页。来源页保留作者、出处和证据状态。

## Required Frontmatter

```yaml
---
type: source | concept | entity | comparison | query | synthesis | decision | external-research
title: Human-readable title
tags: []
related: []
sources: []
evidence_status: verified | partial | unknown | mixed
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

`related` 写目标页面的文件名，不带 `.md`。`sources` 写 `raw/sources/` 下的相对路径。

## Evidence Rules

- `verified` 只用于工具直接验证过的事实，比如文件哈希、URL、抓取时间。
- `partial` 用于本地 ASR 转写、字幕或不完整材料。
- `unknown` 用于讲者主张、案例数字、产品能力和未核验判断。
- `mixed` 用于一页里混有多种证据状态，正文要逐段说明。

引用口播时写「视频作者在该段提出……」，不要写成已证实事实。

## Page Content Rules

### Source pages

记录标题、作者、平台、URL、原始文件路径、提取方式、时长、证据状态、主要论点、关键数字和待核验项。

### Concept and entity pages

分开写：定义、来源观点、已核验事实、分析、反例或边界、关联页面、开放问题。

### Synthesis and decision pages

列出 contributing sources，分清哪些是当前分析，哪些已经确认，哪些仍然待确认。

### Query pages

写清问题、当前已知、冲突来源、缺口、建议的核验动作。

## Contradictions

来源冲突时不静默选边。在相关页面描述冲突，在 `wiki/queries/` 建或更新问题页，保留双方来源和证据状态。只有完成独立核验或人工判断后，才改结论。

## Source-of-Truth Boundary

- `raw/sources/` 是转写稿副本，只读。
- `wiki/` 是可编辑的知识层，推断内容不得反向覆盖 `raw/`。
- 应用维护的 `wiki/overview.md`、`index.md`、`log.md` 可以重新生成，正文结论以本目录页面为准。
