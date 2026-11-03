---
type: query
title: "Research: 为 queries/research-查清-pstack-与-matt-pocock-skills-如何把-specti-2026-11-02-172049-research-5.md 添加交叉引用"
created: 2026-11-03
origin: deep-research
tags: [research]
---

# Research: 为 queries/research-查清-pstack-与-matt-pocock-skills-如何把-specti-2026-11-02-172049-research-5.md 添加交叉引用

# mattpocock/skills：仓库形态、安装方式与 /setup 技能

本页汇总 [[matt-pocock-skills]] 的**仓库层面**信息（安装命令、仓库形态、传播规模），用于补足既有的流程/理念类页面（[[matt-pocock-grill-to-retro]]、[[matt-pocock-v1-3]]、[[matt-pocock-skills-实战]]）中缺失的“如何落地到某个具体 repo”的前置环节，并作为交叉引用节点连接 [[pstack]] 一侧的对比讨论。

## 概述

mattpocock/skills 是 TypeScript 社群开发者 Matt Pocock 开源的一套 **AI 工程化工作流**，定位为“给真实工程师用的 Skills”（Skills For Real Engineers）[1][4]。它的显著特征是**整个仓库几乎全由 Markdown 构成**——即用提示词/流程文档而非代码来约束 AI 编程行为，这也是它被讨论时反复强调的形态特点[3]。

按第三方整理的说法，该仓库已累积约 **16 万颗 Star、750 万次下载**，并且“直到现在才终于有完整教学”，作者本人亲自出镜演示如何用 **5 个 Skills** 把单个任务跑通[3]。这与本 wiki 中记录的 v1.3 三件套（implement-spec、pr、retro）在数量上并不一致，见下文“矛盾与空白”。

## 安装：30 秒上手

官方给出的安装路径走的是 **Copilot 插件市场**，只需两条命令[1]：

```
copilot plugin marketplace add mattpocock/skills
copilot plugin install mattpocock-skills@mattpocock
```

也就是说 Skills 被分发为可安装的插件单元（`mattpocock-skills@mattpocock`），而不是要求用户手动 clone 后复制文件[1]。对本 wiki 的 [[技能与流程]] 而言，这提供了一个重要细节：**技能的可分发性**（marketplace + plugin）是流程能被复用的前提之一，而不只是文档写得好。

## /setup-matt-pocock-skills：按仓库初始化

AI Hero 上专门有一页讲解 `/setup-matt-pocock-skills` 这个技能[2]。其核心语义是：**把与具体仓库绑定的那部分文件生成/配置出来**——原文的表述是“Those files are the only thing that varies between repos”（这些文件是仓库之间唯一不同的部分）[2]。

这解释了该体系的分层结构：

| 层次 | 是否随仓库变化 | 说明 |
|---|---|---|
| 技能本体（Markdown 流程） | 否 | 由插件市场统一分发[1] |
| 仓库适配文件（由 `/setup-matt-pocock-skills` 生成） | 是 | 唯一因 repo 而异的部分[2] |

这一点与 [[环境与约束]] 直接呼应：**约束不是靠人每次口头交代，而是靠一次性写入仓库的文件固化下来**，从而让后续每个技能调用都自动继承同一套规则。相比 [[pstack]] 一侧强调的“沙箱 + 自动接单”式环境搭建（[[沙箱与自动接单]]），这里走的是更轻的“文档即环境”路线，二者分工可参见 [[pstack-与-matt-pocock-技能的分工]]。

⚠️ 需要注意：[2] 的抓取内容以页面导航骨架为主，“Common questions”一节仅剩一个“No.”，**该技能的具体行为、生成哪些文件、是否需要交互式确认，目前均无可靠证据**，属于本页最大的信息缺口。

## 传播规模与定位

- Star 量级在 **16 万～16.6 万**之间浮动，被形容为“一个全是 Markdown 的仓库”却获得远超多数代码库的关注度[3][4]。
- 2026-07-12 的 GitHub API 快照显示约 **16.6 万 Star**，另有“1.43…”的第二项数字（原文被截断，无法确认是 fork 数、下载量还是贡献者数）[4]。
- 定位表述为“**不只 Vibe Coding**”——即把自己与随意的、无流程的 AI 聊天式编程区分开，主张建立**可靠的 AI 编程工作流**[4]。这与本 wiki 反复出现的 [[验证与自证]]、[[评审与验收]] 主题同源。

## 与其他页面的关系（交叉引用说明）

- 技能的具体内容与版本演进 → [[matt-pocock-v1-3]]、[[matt-pocock-skills]]
- 端到端流程演示 → [[matt-pocock-grill-to-retro]]、[[matt-pocock-skills-实战]]
- 自动化接单的另一种路线 → [[matt-pocock-sandcastle]]、[[Sandcastle]]、[[沙箱与自动接单]]
- 对照方（规模化 PR 流水线） → [[pstack]]、[[pstack-作者-每月2500个PR]]、[[一个月上线2000个PR]]
- 概念层沉淀 → [[技能与流程]]、[[环境与约束]]、[[任务拆分与上下文]]、[[信任阶梯]]
- 待澄清事项统一归档 → [[待确认与冲突]]

## 矛盾与空白

1. **技能数量不一致**：[3] 称“5 个 Skills”，而 [[matt-pocock-v1-3]] 记录的 v1.3 为 implement-spec / pr / retro 三件套。可能是版本差异（教学视频早于 v1.3），也可能是“5 个”把 `/setup` 之类的辅助技能一并计入——现有材料无法判定。
2. **下载量口径不明**：“750 万次下载”[3] 未说明是插件市场安装数、npm 包下载数还是仓库 clone 数。
3. **Star 数时间点不同**：16 万[3] 与 16.6 万[4] 并不构成矛盾，但**引用时必须标注日期**，否则会被误读为数据冲突。
4. **`/setup-matt-pocock-skills` 的实际产出缺失**：抓取内容几乎为空[2]，无法确认它是否会覆盖已有配置、是否幂等、生成文件的路径与命名。
5. **缺少一手材料**：本页四条来源中没有一条是仓库 README 原文或 CHANGELOG。

## 建议补充的来源

- GitHub 仓库 `mattpocock/skills` 的 **README 与 CHANGELOG**（确认 v1.3 与“5 个 Skills”的对应关系）
- AI Hero 上 `/setup-matt-pocock-skills` 页面的**完整正文**（当前仅抓到导航骨架）
- Matt Pocock 本人的教学视频/长文（[3] 提到的“完整教学”原始出处）
- `copilot plugin` 命令的官方文档（确认 marketplace / plugin 的实际语义与作用域）
- 仓库中与 `.github/`、`AGENTS.md`、`CLAUDE.md` 相关的适配文件示例（用于验证“仓库间唯一不同之处”这一说法[2]）

## References

1. [mattpocock/skills - GitHub](https://github.com/mattpocock/skills/tree/main) — github.com
2. [The /setup-matt-pocock-skills Skill - AI Hero](https://www.aihero.dev/skills-setup-matt-pocock-skills) — aihero.dev
3. [一個全是Markdown 的AI Skills Repo，累積16 萬顆Star、750 萬次 ...](https://www.threads.com/@aiposthub/post/DaqPQLGgRz6/%E4%B8%80%E5%80%8B%E5%85%A8%E6%98%AF-markdown-%E7%9A%84-ai-skills-repo%E7%B4%AF%E7%A9%8D-16-%E8%90%AC%E9%A1%86-star750-%E8%90%AC%E6%AC%A1%E4%B8%8B%E8%BC%89%E7%9B%B4%E5%88%B0%E7%8F%BE%E5%9C%A8%E6%89%8D%E7%B5%82%E6%96%BC%E6%9C%89%E5%AE%8C%E6%95%B4%E6%95%99%E5%AD%B8%E4%BD%9C%E8%80%85-matt-pocock-%E8%A6%AA%E8%87%AA/) — threads.com
4. [不只Vibe Coding：mattpocock/skills 完整教學，建立可靠的AI 編程工作流](https://www.aiposthub.com/mattpocock-skills-complete-guide-ai-engineering-workflow/) — aiposthub.com
