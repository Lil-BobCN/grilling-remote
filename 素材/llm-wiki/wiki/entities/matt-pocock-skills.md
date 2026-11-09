---
type: entity
title: Matt Pocock Skills
tags: [Matt Pocock, skill, grill, retro, Wayfinder, 软件工厂]
related: [技能与流程, 任务拆分与上下文, 评审与验收, pstack, 领域语言与决策记录, wayfinder-地图与决策票, 保真度与原型]
sources: ["口播提取/Software Factories for Real Engineers/00-系列索引.md"]
evidence_status: partial
created: 2026-11-03
updated: 2026-11-09
---
# Matt Pocock Skills

## 定义

Matt Pocock 公开的一套 agent skills，覆盖从需求澄清到复盘的整条链。仓库在 2026 年 10 月发布 v1.3。

## 链条

grill 或 grill-with-docs 问清决策 → to-spec 写目的地 → to-tickets 按上下文预算切片 → implement 或 implement-spec 执行 → pr 写四栏正文 → retro 回读会话。

## 课程里出现的技能（S9）

38 集课程里反复出现这些技能：

| 技能 | 作用 | 首次出现 |
| --- | --- | --- |
| `grill with docs` | grilling 加 domain modeling，边问边维护术语表和 ADR | 第 1 集 |
| `domain modeling` | 挑战术语、做场景测试、写术语表和 ADR | 第 1 集 |
| `wayfinder` | 地图加决策票，跨会话规划 | 第 12 集 |
| `prototype` | 做便宜、粗糙、可反应的产物 | 第 22 集 |
| `wizard` | 生成交互式 bash 向导，带人完成手动步骤 | 第 20 集 |
| `pr` | 写可视化摘要、证据和合并风险的 PR 正文 | 第 30 集 |
| `code-review` | 对标准和 spec 两轴评审，主动修问题 | 第 33 集 |
| `retro` | 回读会话，改进编码标准和仓库 | 第 36 集 |

课程可能比 S4、S5、S6 更晚，也可能只是展开讲法不同。版本关系没有核实。

## 来源观点

S4 说它的 GitHub stars 超过 React（自述）。S5 讲 v1.3 新增 implement-spec、pr、retro。S6 用中文演示了整条链。S9 把整条链展开成 38 集，补了领域语言、Wayfinder、保真度、三层刹车和 retro 的细节。

## 待核验

- stars 数、技能数量、token 占用都是口播自述。
- v1.3.0 未发布、直接发 1.3.1，只有讲者自述。

## Related
- [[entities/pstack]]
- [[concepts/领域语言与决策记录]]
- [[concepts/wayfinder-地图与决策票]]
- [[concepts/保真度与原型]]
- [[sources/software-factories-for-real-engineers]]
