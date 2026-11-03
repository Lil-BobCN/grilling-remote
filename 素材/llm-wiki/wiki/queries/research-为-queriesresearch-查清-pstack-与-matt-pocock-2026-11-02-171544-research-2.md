---
type: query
title: "Research: 为 queries/research-查清-pstack-与-matt-pocock-skills-中-spectick-2026-11-02-162630-research-1.md 添加交叉引用"
created: 2026-11-03
origin: deep-research
tags: [research]
---

# Research: 为 queries/research-查清-pstack-与-matt-pocock-skills-中-spectick-2026-11-02-162630-research-1.md 添加交叉引用

# pstack 与 Matt Pocock Skills 中的 `spectick`：交叉引用与研究边界

本页用于为查询 `queries/research-查清-pstack-与-matt-pocock-skills-中-spectick-2026-11-02-162630-research-1.md` 补充交叉引用。原查询把 [[pstack|pstack]]、[[matt-pocock-skills|Matt Pocock Skills]] 与一个名为 `spectick` 的对象放在一起；但本批三条来源只覆盖后者，且没有任何一条出现 `spectick`。因此，本页的重点是区分“已确认事实”与“未确认术语”，并把相关 wiki 页面连接起来，而非直接给出肯定答案。

> 最小交叉引用集：[[matt-pocock-skills|Matt Pocock Skills]]、[[pstack|pstack]]、[[技能与流程|技能与流程]]、[[任务拆分与上下文|任务拆分与上下文]]、[[术语表|术语表]]、[[pstack-与-matt-pocock-技能的分工|pstack 与 Matt Pocock Skills 的分工]]、[[待确认与冲突|待确认与冲突]]、[[matt-pocock-v1-3|Matt Pocock Skills v1.3]]。

## 结论摘要

- [[matt-pocock-skills|Matt Pocock Skills]] 通过 Copilot 插件市场分发，安装命令为 `copilot plugin marketplace add mattpocock/skills` 与 `copilot plugin install mattpocock-skills@mattpocock` [1]。
- `/setup-matt-pocock-skills` 是面向具体仓库的 setup skill；来源称“仓库之间唯一变化的是那些文件”，但未说明“那些文件”具体指哪些文件 [2]。
- 在 v1.3 的语境下，出现将 `CONTEXT.md` 重命名为 `GLOSSARY.md` 的提示，并要求检查 `/setup-matt-pocock-skills` [3]。
- `spectick` 在三条来源中均未出现；不能把它写成两个项目中的既有 skill、命令或文件。
- 本批来源没有 pstack 材料；pstack 侧的任何结论都需要回到 [[pstack|pstack]] 及其来源页核对。

## 一、来源能够确认的三件事

### 1. 安装入口是 Copilot 插件市场

来源 [1] 给出了一个“30 秒安装”路径：

```bash
copilot plugin marketplace add mattpocock/skills
copilot plugin install mattpocock-skills@mattpocock
```

这说明 [[matt-pocock-skills|Matt Pocock Skills]] 以 marketplace + plugin 的方式发布，插件标识为 `mattpocock-skills@mattpocock`。对 [[技能与流程|技能与流程]] 而言，这提供了一个“技能包可安装、可更新”的分发层；安装层与仓库级配置是分开的。

### 2. `/setup-matt-pocock-skills` 处理仓库间差异

来源 [2] 是 AI Hero 上关于 `/setup-matt-pocock-skills` 的页面。该页把 `/setup-matt-pocock-skills` 描述为一个 setup skill，并称：

> “Those files are the only thing that varies between repos.”

这句话表明该 skill 的职责与“仓库之间的差异”有关，可能涉及按仓库生成或调整某些文件；但摘录没有给出“Those files”的清单。因此不能据此断言它只生成某几个文件，也不能断言它包含 `spectick`。这条材料更适合放在 [[环境与约束|环境与约束]] 中，作为“仓库级配置”这一约束的例证。

### 3. v1.3 的术语变更：`CONTEXT.md` → `GLOSSARY.md`

来源 [3] 是 Matt Pocock 的一条 X 帖子，以“Prompt of the day”开头，给出一个检查提示：

1. 重新查看 `mattpocock/skills` 的 v1.3 发布；
2. 将 `CONTEXT.md` 重命名为 `GLOSSARY.md`；
3. 检查 `/setup-matt-pocock-skills`。

这更像是给用户的检查提示，并非正式 changelog；因此可以把“v1.3 与 `CONTEXT.md` → `GLOSSARY.md` 有关”作为待核实线索，但不能把它当作完整变更说明。该线索直接影响 [[任务拆分与上下文|任务拆分与上下文]] 与 [[术语表|术语表]]：旧资料中的 `CONTEXT.md` 可能对应现在的 `GLOSSARY.md`。

## 二、`spectick` 在现有证据中的位置

在本次收集的三条来源中，`spectick` 的出现次数为零：安装命令中没有，`/setup-matt-pocock-skills` 的描述中没有，v1.3 的提示中也没有。这不等于它不存在，只能说明本批证据不足以判断它是什么。

在没有更多证据前，至少有四种可能，且都不能由本批来源判定：

1. `spec` 与 `ticket` 的连写，指“规格/工单”的组合对象；
2. 外部工具名 `Spec Kit` 的拼写变体或误听；
3. `mattpocock/skills` 中某个 skill 或文件的别名；
4. 原查询的转写错误。

如果 `spectick` 与 spec 工作流有关，现有 wiki 中最接近的页面是 [[matt-pocock-v1-3|Matt Pocock Skills v1.3]]（涉及 `implement-spec`）与 [[matt-pocock-grill-to-retro|Matt Pocock 的 grill 到 retro 全流程]]；但 `implement-spec` 是技能名，不是 `spectick`，不能因为语义接近就合并两者。若把 `spectick` 拆为 `spec` + `ticket`，它更接近 [[任务拆分与上下文|任务拆分与上下文]] 所讨论的任务与上下文对象；这仍是假设，需要代码搜索验证。

## 三、交叉引用映射

| 现有页面 | 与本主题的关系 | 建议的交叉引用动作 |
|---|---|---|
| [[matt-pocock-skills|Matt Pocock Skills]] | 主体实体；安装入口与 v1.3 术语变更 | 在“安装”与“版本”段落引用 [1][2][3]；不要把 `spectick` 写成既有组件 |
| [[pstack|pstack]] | 查询的另一主体；本批来源未覆盖 | 增加回链；pstack 侧结论需另找来源，不宜据本页下判断 |
| [[pstack-与-matt-pocock-技能的分工|pstack 与 Matt Pocock Skills 的分工]] | 现有分工对比 | 增加“分发方式与仓库级 setup”维度；核对是否使用 `CONTEXT.md` 旧名 |
| [[技能与流程|技能与流程]] | 技能作为可安装、可复用的流程单元 | 引用 [1][2] 说明插件安装与 setup skill 的两层结构 |
| [[环境与约束|环境与约束]] | `/setup-matt-pocock-skills` 处理仓库差异 | 引用 [2]，并标注“Those files”指代不明 |
| [[任务拆分与上下文|任务拆分与上下文]] | `CONTEXT.md` / `GLOSSARY.md` 是上下文载体 | 增加 v1.3 改名注记，避免旧名与新名混用 |
| [[术语表|术语表]] | 术语改名 | 收录 `CONTEXT.md` → `GLOSSARY.md`，注明证据来自推文提示 [3] |
| [[matt-pocock-v1-3|Matt Pocock Skills v1.3]] | v1.3 事实页 | 与 [3] 对齐；区分正式 release note 与推文提示 |
| [[matt-pocock-skills-实战|Matt Pocock Skills 全流程实战]] | 中文实战演示 | 检查示例中是否仍用 `CONTEXT.md`；若是，加版本注记 |
| [[matt-pocock-grill-to-retro|Matt Pocock 的 grill 到 retro 全流程]] | 全流程页面，可能引用上下文文件 | 核对上下文文件命名；若仍用旧名，回链本页说明版本差异 |
| [[待确认与冲突|待确认与冲突]] | 未决问题汇总 | 增加 `spectick` 条目，标注“三条来源均未出现” |

## 四、建议的查询改写

原查询把两个项目和 一个未验证术语放在同一个问题里，难以直接回答。建议拆成以下可验证子问题：

1. `mattpocock/skills` v1.3 的 skill、command 与文件列表中是否存在 `spectick`？
2. pstack 的文档、命令与文件列表中是否存在 `spectick` 或同音/近形词？
3. 若两者都没有，`spectick` 是否指 `spec` + `ticket`、`Spec Kit` 或其它外部工具？
4. v1.3 是否正式把 `CONTEXT.md` 改名为 `GLOSSARY.md`？`/setup-matt-pocock-skills` 是否执行迁移？
5. 安装命令是否只适用于 Copilot，是否存在其它宿主的安装方式？

## 五、矛盾、空白与证据质量

- **证据等级不齐**：[1] 是仓库安装说明，[2] 是 setup skill 的介绍页，[3] 是单条推文提示。三者都不能替代正式 release note。
- **`spectick` 完全缺证**：三条来源均未出现该词；因此不能把它写入 [[matt-pocock-skills|Matt Pocock Skills]] 或 [[pstack|pstack]] 的事实段。
- **pstack 侧缺位**：本批来源没有 pstack 材料；任何“pstack 中也有/没有 `spectick`”的判断都缺少直接依据。
- **`CONTEXT.md` 与 `GLOSSARY.md` 的术语漂移**：现有 wiki 页面可能仍使用旧名；这不是事实矛盾，而是版本注记问题。应在 [[任务拆分与上下文|任务拆分与上下文]] 与 [[术语表|术语表]] 中标注 v1.3 的改名线索。
- **`/setup-matt-pocock-skills` 的指代不明**：[2] 中“Those files”没有清单，不能据此推断具体文件，也不能据此推断 `spectick` 是 setup 生成的文件。
- **推文语气**：[3] 是“Prompt of the day”，可能是给用户的检查提示，并非官方变更日志；其中“Rename”是描述还是指令，需要正式来源确认。

## 六、建议补充的来源

1. `mattpocock/skills` 的完整 README 与 v1.3 的 release notes / tag，用来确认版本变更的正式列表。
2. `/setup-matt-pocock-skills` 的 `SKILL.md` 或源码，确认它读取、生成或迁移哪些文件。
3. GitHub 代码搜索：`repo:mattpocock/skills spectick`、`repo:mattpocock/skills CONTEXT.md`、`repo:mattpocock/skills GLOSSARY.md`。
4. pstack 仓库的 README、文档与代码搜索；可从 [[pstack-作者-每月2500个PR|pstack 作者：每月 2500 个 PR]]、[[pstack-让错误只犯一次|pstack：让错误只犯一次]] 进入。
5. Matt Pocock 关于 v1.3 的完整 X 线程或 AI Hero 文章，用来替代单条推文。
6. 若 `spectick` 被判断为外部工具名，再查 `Spec Kit` 官方文档；在确认前不要写入主实体页。
7. 若要把“Check `/setup-matt-pocock-skills`”落实为流程，可参考 [[验证与自证|验证与自证]]；但当前来源没有给出具体核验步骤。

## 七、结论

本页能够为原查询提供的最小交叉引用是：[[matt-pocock-skills|Matt Pocock Skills]]、[[pstack|pstack]]、[[技能与流程|技能与流程]]、[[任务拆分与上下文|任务拆分与上下文]]、[[术语表|术语表]]、[[pstack-与-matt-pocock-技能的分工|pstack 与 Matt Pocock Skills 的分工]]、[[待确认与冲突|待确认与冲突]]、[[matt-pocock-v1-3|Matt Pocock Skills v1.3]]。

其中，`spectick` 应挂在 [[待确认与冲突|待确认与冲突]] 下，标注“三条来源均未出现、pstack 侧无材料”，不要写进 [[matt-pocock-skills|Matt Pocock Skills]] 或 [[pstack|pstack]] 的事实段。`CONTEXT.md` → `GLOSSARY.md` 的改名线索可以写入术语与上下文页面，但需注明证据来自推文提示 [3]，并等待正式 release note 交叉验证。

## 来源

[1] 《mattpocock/skills - GitHub》，github.com。  
[2] 《The /setup-matt-pocock-skills Skill - AI Hero》，aihero.dev。  
[3] Matt Pocock 的 X 帖子，x.com。

## References

1. [mattpocock/skills - GitHub](https://github.com/mattpocock/skills/tree/main) — github.com
2. [The /setup-matt-pocock-skills Skill - AI Hero](https://www.aihero.dev/skills-setup-matt-pocock-skills) — aihero.dev
3. [Matt Pocock على X: "Prompt of the day: 1. Re-check mattpocock/skills ...](https://x.com/mattpocockuk/status/2106730768789602313?lang=ar) — x.com
