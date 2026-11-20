---
type: query
title: "Research: 补全「技能与流程」桥接页，核清 pstack 与 Matt Pocock Skills 的 skill 清单、触发方式及其在 spec/ticket 到实现、PR、retro 流程中的编排位置，并标明验证与人工验收的嵌入点。"
created: 2026-11-09
origin: deep-research
tags: [research]
---

# Research: 补全「技能与流程」桥接页，核清 pstack 与 Matt Pocock Skills 的 skill 清单、触发方式及其在 spec/ticket 到实现、PR、retro 流程中的编排位置，并标明验证与人工验收的嵌入点。

# 技能与流程：从 spec/ticket 到实现、PR、retro 的 skill 编排（桥接页）

## 摘要

本页补全 [[技能与流程]] 的桥接信息，重点回答三个问题：[[matt-pocock-skills]] 与 [[pstack]] 各自有哪些 skill、它们如何被触发、在「spec/ticket → 实现 → PR → retro」的链条上各处于什么位置；同时标出验证与人工验收的嵌入点。

核心判断如下：

- [[matt-pocock-skills]] 的编排是显式的两段式：前半段用 `/grill-with-docs`、`/to-spec`、`/to-tickets` 把对话收敛成带 blocking edges 的 ticket 图；后半段用 `/implement` 或 `/implement-spec` 执行，再由 `pr`、`/retro` 收尾 [1][3][4]。
- 触发方式被硬性二分为 user-invoked 与 model-invoked，且 user-invoked skill 不得自动调用另一个 user-invoked skill，人保留阶段切换权 [4][11]。
- 验证不是单点，而是分布在前半段（seam 约定、拆分审批）、执行段（`/tdd`、`/code-review`）、交付段（`pr` 的分层证据、人工合并）与复盘段（`/retro` 的环境修复）[1][2][3][4]。
- [[pstack]] 的公开证据集中在「验证契约」与 `/poteto-mode` 入口；本批来源没有给出它的完整 skill 清单与触发模型，这是本页最主要的证据缺口 [6][7][8]。

---

## 1. Matt Pocock Skills：安装、清单与版本

### 1.1 安装与仓库级初始化

Matt Pocock Skills 以 Claude Code 插件形式分发：

- 插件安装：`/plugin install mattpocock-skills` [11]。
- 仓库级初始化：每个 repo 运行一次 `/setup-matt-pocock-skills`；它会询问你在 triage ticket 时使用哪些 label，因为 `/triage` 依赖这些 label [1][11]。
- 单个 skill 也可独立安装，例如 `npx skills@latest add mattpocock/skills --skill=implement-spec` [2]。

这套设计把「仓库配置」与「流程 skill」分开：`/setup-matt-pocock-skills` 负责把仓库的 ticket 标签体系接入，`/triage` 则消费这些标签 [1]。

### 1.2 Engineering skill 清单

[1] 的 README 只截取了 Engineering 分类的一部分，列出 `to-spec`、`to-tickets`、`implement`、`implement-spec` 四项；其余关键 skill 由 [3][4] 补足。合并后的清单如下：

| Skill | 作用 | 触发类型 | 输入 → 输出 | 编排位置 |
|---|---|---|---|---|
| `/grill-with-docs` | 用编号问题轮次持续追问，直到设计树被问空，形成共享理解与词汇 [3] | user-invoked [4] | 对话/文档 → 共识与词汇 | 最前端，spec 之前 |
| `/to-spec` | 把已经讨论过的对话综合成 spec 并发布到 issue tracker；不重新做需求访谈 [1] | user-invoked [4] | 对话 → spec issue | 前半段收束 |
| `/to-tickets` | 把 plan、spec 或对话拆成 tracer-bullet tickets，每个 ticket 声明 blocking edges，可写成本地文件或 tracker 原生 blocking links [1] | user-invoked [4] | spec → ticket 图 | 拆分与依赖建模 |
| `/implement` | 实现一个 ticket 或当前线程里的 plan；在预先约定的 seam 驱动 `/tdd`，提交前用 `/code-review` 收尾 [1] | user-invoked [4] | ticket/plan → commit | 单 ticket 执行 |
| `/implement-spec` | 在单条 integration branch 上实现整个 spec；把 tickets 当任务图，在 ready frontier 上并发运行 implementer subagents，最后 `/code-review` [1][2] | user-invoked [4] | spec + ticket 图 → integration branch | 多 ticket 并行执行 |
| `/tdd` | 先与你确认 seam，再按红→绿逐片推进 [3] | 由编排器驱动；推断为 model-invoked | ticket 切片 → 测试与实现 | `/implement`、`/implement-spec` 内部 |
| `/code-review` | Standards 与 Spec 并行审查 [3] | 由编排器驱动；推断为 model-invoked | 变更 → review findings | 提交前/收尾 |
| `pr` | 自底向上组织 PR 审查，强调 one-way doors 与分层证据 [4] | v1.3 毕业的 Engineering skill [4] | branch → PR | 交付 |
| `/retro` | 读取会话，提出对 agent 环境的修复：lint 规则、编码规范、steering files [3] | user-invoked [4] | session → 环境改动建议 | 流程末端，回流环境 |
| `/triage` | 用 label 对 ticket 做分诊 [1] | 来源未明确说明 | ticket → label/优先级 | 辅助层 |
| `/setup-matt-pocock-skills` | 仓库级初始化，收集 triage labels [1] | 手动 | repo → 配置 | 安装层 |

需要特别说明：`/tdd` 与 `/code-review` 的「model-invoked」身份是从行为推断的，而非来源的直接枚举。[1] 说 `/implement` 会「driving `/tdd` at pre-agreed seams and closing out with `/code-review` before committing」，[2] 说每个 implementer 用 `tdd` 构建自己的 ticket；而 [4] 又规定 user-invoked skill 不得自动调用另一个 user-invoked skill。因此 `/tdd`、`/code-review` 必须属于可被编排器驱动的 model-invoked 层。它们 frontmatter 中的确切标记仍需查 `SKILL.md` 原文。

### 1.3 版本演化与仓库定位

- `mattpocock/skills` v1.3 于 2026 年 10 月 4 日发布，把 `/implement-spec`、`pr`、`/retro` 毕业进 Engineering suite [4]。后续来源提到 v1.3.1 [5]。
- 官方 v1.3 graduation PR（`mattpocock/skills#1120`）是用 `pr` skill 自己生成的 [4]。
- 仓库保留可见的 `in-progress/` 与 `deprecated/` 目录，正在推进的 `wayfinder` 试图把单会话 skill 推向通过 issue tracker 的多会话编排 [10]。
- 第三方对比把 Matt Pocock Skills 定位为「精选、可组合的命令工具箱」，并认为其 grill 循环是三者中最锋利的 requirements 工具 [10][11]。

---

## 2. 触发方式：user-invoked 与 model-invoked 的硬边界

[11] 明确把 skill 分为两类：

- **user-invoked**：只有你输入时才运行，并且承担编排职责。
- **model-invoked**：agent 可以自行取用。

[4] 进一步给出了 user-invoked 的完整名单与实现机制：

> User-invoked skills（`disable-model-invocation: true`）：`/grill-with-docs`、`/to-spec`、`/to-tickets`、`/implement`、`/implement-spec`、`/retro`。这些 skill 是由开发者显式发起的顶层工作流编排器。一个 skill 永远不能自动调用另一个 user-invoked skill。

这条规则的含义值得展开：

1. **人保留阶段切换权**。agent 不能在 spec 尚未收敛时自行进入 `/to-tickets`，也不能在 ticket 尚未批准时自行进入 `/implement-spec`。阶段推进必须由人输入命令触发 [4]。
2. **子技能是原子动作**。`/tdd`、`/code-review` 这类 skill 不承担顶层编排，而是被 `/implement` 或 `/implement-spec` 在内部驱动 [1][2]。
3. **与信任分层的关系**。这与 [[信任阶梯]] 的逻辑一致：随着验证与约束增强，人可以下放更多执行权，但「何时进入下一阶段」的决定权仍保留在 user-invoked 边界上 [4]。
4. **与任务拆分的关系**。user-invoked 边界也解释了为什么 `/to-tickets` 必须由人批准拆分：ticket 图一旦生成，后续并发执行会放大拆分错误，因此拆分点被设为人工闸门 [3]。这也直接关联 [[任务拆分与上下文]]。

对照之下，pstack 侧只确认了 `/poteto-mode` 这一显式入口 [6]；它是否采用同样的 user/model 二分，本批来源没有说明，属于待核实项。

---

## 3. 编排位置：从 spec/ticket 到实现、PR、retro

### 3.1 主链

[2] 给出了最简主链：

```
/grill-with-docs → /to-spec → /to-tickets → /implement-spec → /retro
```

把各 skill 的输入输出展开后，可以得到更完整的编排图：

```
[/grill-with-docs]   人触发，问空设计树
        │
        ▼
[/to-spec]           人触发，综合对话 + 约定 test seams
        │
        ▼
[/to-tickets]        人触发，垂直切片 + blocking edges；人批准拆分
        │
        ├── 单 ticket / 串行 ──▶ [/implement #N] ──▶ /tdd ──▶ /code-review ──▶ commit
        │
        └── 多 ticket / 并行 ──▶ [/implement-spec] ──▶ worktree × N + merger ──▶ integration branch ──▶ /code-review
        │
        ▼
[pr]                 分层证据、one-way doors
        │
        ▼
人审查 / 合并
        │
        ▼
[/retro]             环境修复：lint、规范、steering files
```

这条链的关键在于：**前半段负责把不确定性压到 ticket 图里，后半段才允许并发执行**。没有 blocking edges 的 ticket 图是平的，`/implement-spec` 会让所有 ticket 同时开工，失去依赖调度的意义 [2]。

### 3.2 四条路径与路由规则

[3] 给出了从「单行为」到「多会话并行」的四条路径；[4] 补充了按上下文预算路由的规则。

| 路径 | 序列 | 适用条件 | 人工节点 |
|---|---|---|---|
| Tiny：单行为、测试先行 | `/grill-with-docs`（可选）→ `/tdd` → `/code-review main` → 开 PR | 一个行为，改动小 | 确认 seam；审 PR [3] |
| 单会话：grill 后直接建 | `/grill-with-docs` → `/implement` → 开 PR | 设计能在一会话内收敛；build 需要 grill 的原文推理 [3] | grill 问答；审 PR |
| 多会话串行：主流程 | `/grill-with-docs` → `/to-spec` → `/to-tickets` → `/clear` → `/implement #N` ↺ → 开 PR | ticket 数少、依赖偏串行 | 约定 test seam；批准拆分；逐个 PR [3] |
| 多会话并行：任务图 | `/grill-with-docs` → `/to-spec` → `/to-tickets` → `/clear` → `/implement-spec` | 4 个以上 ticket 且有独立并行前沿 [4] | 同上；合并点集中在 integration branch/PR |

路由规则有两条值得注意：

- **上下文预算规则**：如果 `/grill-with-docs` 结束时上下文窗口还剩 60% 以上，且改动能装进一个模块，就跳过 `/to-spec` 与 `/to-tickets`，直接在同一会话里跑 `/implement`，让 `pr` 格式化 PR；如果 agent 遇到环境摩擦，再跑 `/retro` [4]。
- **并行阈值规则**：`/implement-spec` 应保留给真正能拆成 4 个以上 ticket、且存在独立并行前沿的 spec；只有当 worktree 并发收益超过合并协调开销时才值得使用 [4]。

[4] 还特别提醒：最常见的错误是把 `/grill-with-docs → /to-spec → /to-tickets → /implement-spec` 当成每个任务的强制序列。流程应按上下文预算与改动形状裁剪，而不是机械执行。

[3] 另有一个上下文管理细节：在 `/to-spec` 之后不要清空或压缩上下文，因为 `/to-tickets` 还需要它；ticket 产出之后才 `/clear`，再进入实现。

### 3.3 `/implement-spec` 的任务图调度

`/implement-spec` 是后半段最复杂的编排器，其语义可拆为以下几点：

- **读图而非读列表**。它把 tickets 当作「什么阻塞什么」的任务图，找出当前所有 ready 的 ticket，把每个交给一个 subagent [2][5]。
- **前置条件是 blocking edges**。ticket 必须像 `/to-tickets` 写出的那样带 blocking edges；没有边，图就是平的，所有 ticket 会同时开工 [2]。
- **单条 integration branch**。v1.3 之前它可能为每个 ticket 开单独 PR；v1.3 改为瞄准单条 integration branch [4]。每个 ready ticket 分配一个独立 worktree 与 implementer subagent，另有 merger subagent 做 fast-forward [4]。
- **每个 implementer 用 `/tdd`**。每个 implementer 按红→绿逐片构建自己的 ticket [2]。
- **收尾对整份 spec 做 `/code-review`**。review 以整份 spec 为参照，因此只有在所有 ticket 落地后才有意义；每个 implementer 完成 ticket 又会触发一次 review [2]。
- **PR 的打开条件**。只有当配置的 tracker 以 PR 关闭工作、或你明确要求时，才会打开 PR；在本地 markdown tracker 上，运行结束时所有 ticket 已 resolved，工作已合到 branch [2]。
- **并发隔离的代价**。每个 implementer 只看到自己的 ticket 与共享 notes，看不到其他人的 WIP；有用户的 web 与 mobile ticket 同时引入了 `blockedSince` 与 `blockedOn` 这个相同字符串，造成冲突 [2]。
- **没有交互式 seam 约定**。与 `/implement` 不同，`/implement-spec` 没有「与你交互确认 seam」的步骤；要钉 seam，必须写进 spec 或 ticket [2]。
- **验证依赖未跟踪材料时**，让 orchestrator 在主 checkout 里跑该 ticket [2]。
- **frontier 的计算**：让 orchestrator 自己跟踪哪些 ticket 已并入 integration branch，并据此计算 frontier [2]。
- **成本信号**：有用户报告，一个五 ticket 特性的 review 与 fix 循环大约花了四小时 [2]。这是单用户报告，不是系统测量。

### 3.4 PR 与 retro 的位置

- **PR**：[3] 把「open a PR」写成流程末端的动作，PR body 采用 `/pr` 形状；[4] 则把 `pr` 列为 v1.3 毕业的 Engineering skill，强调自底向上的审查、one-way doors 与分层证据。可以理解为：v1.3 之后 `pr` 成为可调用的收尾 skill，而 [3] 描述的是更早或更轻的用法。v1.3 的三个重点是并行 ticket 执行、**human pull request review speed** 与仓库环境维护 [4]——PR 环节被优化的是人的审查速度，而不只是 agent 的产出速度。
- **retro**：`/retro` 读取会话，提出对 agent 环境的修复，包括 lint 规则、编码规范与 steering files [3]。它的作用是把「一次性的错误」转成「长期的环境约束」，对应 [[环境与约束]] 与 [[修正阶梯与-correct]] 的回路。v1.3 把 `/retro` 毕业，说明仓库环境维护被视为一等公民 [4]。

---

## 4. 验证与人工验收的嵌入点

### 4.1 分阶段嵌入表

| 阶段 | 验证动作 | 人工验收/决策 | 产物与证据 | 来源 |
|---|---|---|---|---|
| grill | 用编号问题轮次把设计树问空 | 人回答、确认共识 | 对话与共享词汇 | [3] |
| to-spec | 约定 test seams；只综合、不访谈 | 人确认 spec 与 seam | spec issue | [1][3] |
| to-tickets | 垂直切片 + blocking edges | 人批准拆分 | ticket 图 | [1][3] |
| tdd | 先确认 seam，再红→绿逐片 | 人确认 seam | 测试与增量提交 | [3] |
| implement | 在预先约定 seam 驱动 tdd；提交前 code-review | 人审 PR | commit + review | [1] |
| code-review | Standards 与 Spec 并行 | 人处理 findings | review 结果 | [3] |
| implement-spec | 每个 implementer 用 tdd；收尾对整份 spec 做 code-review | 人在 integration branch/PR 验收 | 分支 + review | [1][2] |
| pr | 自底向上、one-way doors、分层证据 | 人做最终合并 | PR body 与证据 | [4] |
| retro | 从会话提取环境修复 | 人决定是否采纳 | lint/规范/steering 改动 | [3][4] |
| pstack verification | 说明 owner 如何证明完成；观察触发变更的行为；回归检查；在运行应用中验证 | 合并留给人 | PR + 观察到的值 + 跑过的检查 | [6] |

### 4.2 三类人工闸门

把来源中所有「you」的动作归纳起来，可以看到三道人工闸门：

1. **入口闸门：需求与拆分**
   - `/grill-with-docs` 的问答与共识确认 [3]。
   - `/to-spec` 的 test seam 约定 [3]。
   - `/to-tickets` 的拆分审批 [3]。

2. **执行闸门：实现与审查**
   - `/tdd` 的 seam 确认 [3]。
   - `/implement` 提交前的 `/code-review` [1]。
   - `/code-review` 的 Standards 与 Spec 并行审查 [3]。

3. **交付闸门：合并与复盘**
   - `pr` 的 PR 审查与最终合并 [4]。
   - `/retro` 提出的环境修复是否采纳 [3][4]。
   - pstack 示例明确写「Leave merging to me」，把合并保留给人 [6]。

这三道闸门与 [[验证与自证]]、[[评审与验收]] 的分层一致：越靠前的闸门越便宜，越靠后的闸门越接近不可逆决策，因此人工介入的密度也越高。

### 4.3 验证强度的非对称性

`/implement` 与 `/implement-spec` 的验证强度并不对等：

- `/implement` 有「预先约定的 seam」这一交互步骤，`/tdd` 会与你确认 seam [1][3]。
- `/implement-spec` 没有交互式 seam 约定，必须把 seam 写进 spec 或 ticket [2]。
- `/implement-spec` 的并发隔离会让 implementer 看不到彼此的 WIP，从而产生重复标识符一类的集成冲突 [2]。

这意味着：**并行度越高，越需要把验证契约前置到 spec/ticket 文本里**。如果 seam 与验证方式没有被写下来，`/implement-spec` 不会替你补上。

### 4.4 pstack 的验证契约

[6] 把 pstack 的验证思路概括为：verification skill 说明 owner 如何证明任务完成；验证应观察「触发这次变更的那个行为」，而不只是跑一遍测试。其示例任务契约包括：

- 先复现失败，定位重复存储的位置；
- 实现聚焦修复与回归检查；
- 在运行中的应用里验证正常导出与重试；
- 返回 PR、观察到的存储值、以及跑过的检查；
- 合并留给人 [6]。

pstack 还会检查是否已有验证方法，并可能提议创建一个项目专属的 verification skill [6]。不过 [6] 同时声明其中一处是编辑性建议，并对「20+ Grok Bots」等说法持保留态度，因此这部分应视为二手分析，而非官方文档。

---

## 5. pstack 侧：已证实的部分与证据边界

### 5.1 已知事实

- pstack 是 Cursor 插件，作者是 Cursor 工程师 Lauren Tan（poteto），目标是把 AI coding agent 变成结构化工程流程 [7]。
- 在 Lauren 的工作流中：Grok Bots 收集上下文并路由任务，Cursor Cloud Agents 执行工程工作，pstack 提供可复用的实现与验证方法 [6]。[[GrokBot]] 负责协调，cloud agents 负责执行，pstack 负责方法与验证。
- `/poteto-mode` 是入口命令，用于跑一个有界任务 [6]。
- pstack 的 verification stack 已在 [[验证与自证]] 中整理；[8] 明确该 verification stack 的内容来自 pstack。
- 相关 wiki 来源包括 [[pstack-让错误只犯一次]]、[[一个月上线2000个PR]]、[[一个人如何带一支AI团队-Lauren访谈]]，以及 [[pstack新视频对流程的启示]]。

### 5.2 在流程中的位置

[6] 给出的流程图可概括为：

```
人的优先级
   │
   ▼
Grok Bots（收集上下文、路由任务）
   │
   ▼
Cursor Cloud Agents（执行工程工作）
   │
   ▼
pstack（实现与验证的可复用方法 / verification skill）
   │
   ▼
独立验证
   │
   ▼
可审阅的 PR ──▶ 人合并
```

在这个位置中，pstack 不是 ticket 拆分器，也不是 PR 合并器；它更像「实现与验证的方法层」，把 cloud agents 的产出约束成可验证、可审阅的 PR [6]。

### 5.3 证据边界与缺口

本批来源没有给出 pstack 的完整 skill 清单、触发方式（是否存在 user/model 二分）、以及在 spec/ticket → PR → retro 链上的明确编排位置。具体缺口包括：

- `/poteto-mode` 之外还有哪些 skill，来源未列出 [6]。
- pstack 是否有 retro 等价物，来源未说明。
- pstack 是否强制 PR、如何处理本地 tracker，来源未说明。
- [6] 对「20+ Grok Bots」等具体数字持保留态度，说明该文本身也区分了「Lauren 报告过的」与「材料能支持的」。
- 需要以 pstack 官方 `docs/guide/01-setup.md` 与 plugin manifest 补齐 [6]。

---

## 6. 两者的分工与桥接

[[pstack-与-matt-pocock-技能的分工]] 已从分工角度整理过两者；本页补充流程编排层面的对照。

| 维度 | Matt Pocock Skills | pstack |
|---|---|---|
| 重心 | 前半段需求收敛 + 可组合编排 [1][3][10] | 实现与验证的方法层，尤其是 verification skill [6][8] |
| 入口 | `/plugin install` + `/setup-matt-pocock-skills`，再按需输入 user-invoked skill [1][11] | `/poteto-mode` 跑有界任务 [6] |
| 拆分 | `/to-tickets` 产出带 blocking edges 的 tracer bullets [1] | 来源未给出 ticket 拆分 skill |
| 并行执行 | `/implement-spec` 在 integration branch 上按任务图前沿调度 [2][4] | Cursor Cloud Agents 执行，Grok Bots 协调 [6] |
| 验证 | `/tdd`、`/code-review`、`pr` 的分层证据 [1][3][4] | verification skill 定义「如何证明完成」，观察触发行为 [6] |
| 人工验收 | seam 约定、拆分审批、PR 合并、retro 采纳 [3][4] | 合并留给人 [6] |
| 环境回流 | `/retro` 修 lint、规范、steering files [3] | 项目专属 verification skill 的创建 [6] |

两者可以互补：

- Matt 的 `/to-spec` 与 `/to-tickets` 产出可执行的 ticket 图；pstack 的 verification skill 可以作为每个 ticket 的「完成定义」，嵌入到 ticket 文本或 spec 中。
- Matt 的 `/retro` 与 pstack 的项目级 verification skill 都在做同一件事：把一次性的错误或验证方式固化成环境的一部分，减少重复犯错的概率 [3][6]。
- 两者都不让 agent 自行合并：Matt 的 `pr` 仍以人的 PR 审查与合并为终点 [4]；pstack 示例明确「Leave merging to me」[6]。

[9] 显示已有 marketplace 以「逐项吸收 Lauren Tan 与 Matt Pocock 的 agent workflows」为目标，说明社区倾向于把两者视为可组合而非互斥。

---

## 7. 矛盾、缺口与待核实

1. **`pr` 的身份**：[3] 把「open a PR」写成手工步骤，PR body 采用 `/pr` 形状；[4] 把 `pr` 列为 v1.3 毕业的 Engineering skill。两者可能反映 v1.3 前后的差异，需以 `SKILL.md` 与 release notes 核实。参见 [[待确认与冲突]]。
2. **`/to-spec` 是否访谈**：[1] 说「No interview, just synthesizes what you've already discussed」；[3] 说 `/to-spec` 会「agrees test seams with you」。可调和为「不重新访谈需求，但仍会就 test seam 与人对齐」，但具体交互形式来源未说明。
3. **model-invoked 清单不完整**：[4] 只枚举了 user-invoked；`/tdd`、`/code-review` 的触发类型是从「被编排器驱动」的行为推断的，需查 frontmatter 的 `disable-model-invocation`。
4. **`/implement-spec` 的隔离缺陷**：implementer 只看到自己的 ticket 与共享 notes，看不到彼此的 WIP，已有重复标识符的实际案例 [2]。
5. **`/implement-spec` 的验证强度低于 `/implement`**：没有交互式 seam 约定，必须把 seam 写进 spec 或 ticket [2]。
6. **四小时 review 成本是单用户报告**，不是系统测量 [2]。
7. **pstack 全量 skill 清单缺失**：本批来源只能确认 `/poteto-mode` 与 verification skill 的存在，无法核对完整清单与触发方式 [6]。
8. **pstack 的「20+ Grok Bots」未被来源证实**：[6] 明确对 roster count 持保留态度。
9. **`wayfinder` 仍是 in-progress**：[10] 提到它试图把单会话 skill 推向通过 issue tracker 的多会话编排；它与 `/implement-spec` 的关系、是否会取代后者，来源未说明。

---

## 8. 建议补充的来源

- `mattpocock/skills` v1.3.1 各 `skills/engineering/*/SKILL.md` 原文，重点核对 `/tdd`、`/code-review`、`pr`、`/retro` 的 frontmatter 与 `disable-model-invocation` 标记。
- 官方 v1.3 release notes（[4] 引用的 aihero.dev changelog），核对 `pr`、`/retro`、`/implement-spec` 的毕业说明与行为变化。
- `implement-spec`、`to-tickets`、`tdd`、`pr`、`retro` 各自的 AI Hero 专页，补齐交互细节与前置条件。
- pstack 官方 `docs/guide/01-setup.md`、plugin manifest 与 skill 目录，补齐 skill 清单、触发方式与 `/poteto-mode` 的完整语义。
- pstack verification skill 的示例或 `SKILL.md`，确认「验证观察触发行为」在工程上的落地形式。
- `wayfinder` 的设计文档，确认 issue tracker 多会话编排与 `/implement-spec` 的衔接方式。
- 一手实测：同一 spec 分别用 `/implement` 串行与 `/implement-spec` 并行，记录 review 时长、冲突率与人工介入次数。

---

## 9. 相关页面

- [[技能与流程]]：本页为其桥接与核对页。
- [[matt-pocock-skills]]、[[pstack]]、[[GrokBot]]
- [[验证与自证]]、[[评审与验收]]、[[信任阶梯]]
- [[任务拆分与上下文]]、[[grilling-提问规则]]
- [[环境与约束]]、[[修正阶梯与-correct]]
- [[沙箱与自动接单]]、[[成本与模型]]
- [[pstack-与-matt-pocock-技能的分工]]
- [[matt-pocock-v1-3]]、[[matt-pocock-grill-to-retro]]、[[matt-pocock-skills-实战]]
- [[pstack-让错误只犯一次]]、[[pstack新视频对流程的启示]]

## References

1. [Skills for Real Engineers. Straight from my .agents ... - GitHub](https://github.com/mattpocock/skills) — github.com
2. [The /implement-spec Skill - AI Hero](https://www.aihero.dev/skills-implement-spec) — aihero.dev
3. [Matt Pocock's Skills: Choosing The Right Workflow](https://www.dandoescode.com/blog/matt-pococks-skills-choosing-the-right-workflow) — dandoescode.com
4. [Matt Pocock Skills 1.3: /implement-spec, /pr & /retro](https://developer.tenten.co/mattpocock-skills-v1-3-pr-implement-spec-retro) — developer.tenten.co
5. [Matt Pocock's Skills Update Turns Your Coding Agent Into a ...](https://medium.com/@creativeaininja/matt-pococks-skills-update-turns-your-coding-agent-into-a-parallel-build-team-037c77b56c11) — medium.com
6. [Lauren Tan's Grok Bot Workflow: pstack & Cloud Agents](https://aiidelist.com/blog/lauren-tan-grok-bot-pstack-workflow) — aiidelist.com
7. [Killer combo: Cursor Projects + pstack. Huge improvements in ...](https://www.reddit.com/r/cursor/comments/1wrmig0/killer_combo_cursor_projects_pstack_huge/) — reddit.com
8. [pstack Verification Stack for Coding Agents Explained - LinkedIn](https://www.linkedin.com/posts/yupo-niu_aiagents-softwareengineering-aiengineering-activity-7517269716327915520-Vknz) — linkedin.com
9. [Epic: absorb Lauren Tan's and Matt Pocock's agent workflows ...](https://github.com/melodic-software/claude-code-plugins/issues/7555) — github.com
10. [agent-skills/docs/comparison.md at main - GitHub](https://github.com/addyosmani/agent-skills/blob/main/docs/comparison.md) — github.com
11. [Superpowers vs Agent Skills vs Pocock vs ECC - Medium](https://medium.com/@martin.jordanovski/superpowers-vs-agent-skills-vs-pocock-vs-ecc-four-philosophies-of-ai-coding-workflows-c996eab1c899) — medium.com
