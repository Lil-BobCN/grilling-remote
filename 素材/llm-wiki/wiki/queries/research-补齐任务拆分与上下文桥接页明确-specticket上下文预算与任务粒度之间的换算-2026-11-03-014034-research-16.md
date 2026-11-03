---
type: query
title: "Research: 补齐“任务拆分与上下文”桥接页，明确 spec、ticket、上下文预算与任务粒度之间的换算及约束关系，并区分 pstack 与 Matt Pocock Skills 的做法及 15 万 token 说法的证据强度。"
created: 2026-11-03
origin: deep-research
tags: [research]
---

# Research: 补齐“任务拆分与上下文”桥接页，明确 spec、ticket、上下文预算与任务粒度之间的换算及约束关系，并区分 pstack 与 Matt Pocock Skills 的做法及 15 万 token 说法的证据强度。

# 任务拆分与上下文（桥接页）：spec、ticket 与上下文预算的换算

本页把三条原本各自表述的线索对齐：**产物链**（spec → ticket → implement）、**资源约束**（一次会话能承载多少上下文）与**工作流选择**（什么时候才值得拆分）。在此基础上评估“15 万 token”这一经验数值的证据强度，并区分 [[pstack]] 与 [[matt-pocock-skills]] 的侧重差异。

---

## 1. 流水线定位：拆分发生在哪一步

Matt Pocock Skills 把整条链路显式固定下来 [8][6]：

```
grill-with-docs → /to-spec → /to-tickets → /implement（或 /implement-spec）→ /code-review → /retro
```

| 环节 | 做什么 | 关键性质 |
|---|---|---|
| `/to-spec` | 把已经 grill 过的对话综合成 spec，发布到 issue tracker；**不做访谈**，只做综合 [5][8] | spec 的质量上限由 grill 阶段决定，此步只“固化” |
| `/to-tickets` | 把 spec 拆成 agent 能构建的小 ticket [1]，垂直 tracer-bullet 切片、带阻塞边 [6] | 上下文边界在这里被**物理确定** |
| `/implement` | 按 spec 或 tickets 构建，在预先约定的接缝（pre-agreed seams）驱动 `/tdd`，提交前跑 `/code-review` [5] | 单 ticket 执行器 |
| `/implement-spec` | 在单条集成分支上实现整份 spec，把 tickets 当任务图，在 ready frontier 上并发跑 implementer subagent，由 merger subagent 收口 [5][6] | 并发调度器 |

核心机制是：**这条链把“上下文管理”外化成了“文档结构”**。spec 是权威来源，ticket 是上下文边界，task graph 是并发调度表。这也解释了为什么 `to-tickets`、`triage`、`to-spec` 需要一个可配置的读写目的地主机——`gh issue create`、`.scratch/` 下的 markdown，或你自述的其他工作流 [4]；ticket 的载体因此是可替换的，但“ticket 是边界”这一点不可替换。

---

## 2. 四个量的定义

| 量 | 定义 | 载体 |
|---|---|---|
| **spec** | 需求的权威表述，从已对齐的对话中综合而来，不含新访谈 [5][8] | issue tracker / `.scratch/` markdown [4] |
| **ticket** | spec 的垂直切片，端到端可交付，带阻塞边，构成 DAG [2][6] | 同上 |
| **上下文预算** | 单个全新会话中可用于“读懂 + 改动 + 验证”的**有效** token 量 | 名义窗口 − 系统提示 − 工具 schema − 输出 − 验证开销 |
| **任务粒度** | 一个 ticket 的读入面 + 改动面 + 验证面 | 由 ticket 文本与阻塞边隐含 |

---

## 3. 换算关系：五条经验规则

以下模型是对 [2][6][7] 的综合归纳，不是任何单一来源的原话。

```
ticket_budget ≈ (window − system − tools − output − verify_margin) × safety
N（ticket 数） ≈ spec_工作量 / ticket_budget
P（并行度）  ≤ |ready_frontier(DAG)|
D（串行深度） = 最长阻塞链
总成本 ≈ N × ticket_budget + 拆分成本 + 合并/评审成本
```

**① 粒度上限由“读入面”决定，不由改动行数决定。**
“每个 ticket 面向一个全新上下文窗口” [6] 的度量单位是*agent 需要读多少东西才能自洽完成*。改 3 行却要求读 40 个文件的 ticket，比改 300 行但边界清晰的 ticket 更贵。

**② 有效预算 = 名义窗口 × 安全系数。**
安全系数不为 1，因为要扣除系统提示、工具定义、输出长度与验证循环。现有材料未给出系数取值，属推断项。

**③ ticket 数决定图管理成本，不决定并行度。**
任务尺度关注的不是“拆多细”，而是“这份规格里有多少工作，哪些工作能同时开始”——它读取 spec 与 tickets，把 tickets 当作带阻塞关系的 task graph，而非从上到下执行的列表 [2]。因此“拆得越细越快”不成立：细到一定程度，串行深度 `D` 不变，而图管理成本上升。

**④ 拆分成本与实现成本不同量级。**
`/to-tickets` 需要读 spec、ADR、其阻塞 ticket，并**逐行对照代码验证每个断言**，然后才写出它的矩阵 [7]。这是 O(整个 spec × 相关代码面) 的读取，而单个 ticket 只是 O(切片)。把拆分成本摊进“每 ticket 预算”会系统性低估。

**⑤ 工作流按会话数选择，不按项目规模选择。**
判据是“这活能否装进一个上下文窗口、你是否已能看到终点” [6]。一个窗口能做完，就不该走 `to-spec`/`to-tickets` 链；做不完，才需要切分与 `/clear` 边界。链上已标注 clear 的位置：`/grill-with-docs → /to-spec → /to-tickets` 在同一窗口，随后 `/clear`，再进 `/implement-spec` [6]。

---

## 4. 约束关系

**硬约束**

- **单 ticket 自洽**：新窗口 + ticket 文本 + 仓库即可完成，不依赖跨窗口的隐含记忆。这是 “sized for one fresh context window” [6] 的直接含义。
- **阻塞边必须显式**：否则并发会踩踏 [2][6]。
- **边界处必须清空上下文**：链路上的 `/clear` 是流程的一部分，不是可选项 [6]。

**软约束**

- **垂直切片优先于水平分层**：tracer-bullet vertical slices [6]。垂直切片让每个 ticket 端到端可验证，直接对接 [[评审与验收]] 与 [[验证与自证]]。
- **不要接下过大的任务**：原文即 “Never take on a task that’s too big.” [5]
- **多模块项目做物理隔离**：以 Multi-Context 方式避免上下文互相污染 [3]。

**反向约束（拆分过度的代价）**

- 图管理、合并冲突、以及每开一个新窗口都要重建“我在哪”的上下文重建成本，三项均随 ticket 数上升。
- 拆分动作本身的 token 成本可能远超任何单个 ticket [7]。
- 过度拆分还会稀释 [[信任阶梯]] 的推进节奏：验收点变多，但每个验收点的信息量变少。

---

## 5. “15 万 token”说法的证据强度

**检索材料中没有任何来源直接写出“15 万 token”。** 可核查的只有两条：

- **(a) 定性表述**：“each sized for one fresh context window” [6] —— 支持“ticket 应装进一个窗口”这一*形式*，不给数值。
- **(b) 定量反例**：`/to-tickets` 一次消耗 **1.5M+** tokens，占满两个 Claude Max 5x 计划的会话 [7] —— 数量级是 **150 万**，不是 15 万。

| 说法 | 支撑来源 | 证据强度 |
|---|---|---|
| ticket 应以“一个全新上下文窗口”为粒度 | [6] 明确表述 | **强**（定性） |
| 该窗口的有效预算约 15 万 token | 无来源 | **弱**（推断／经验值） |
| 单个 ticket 的实现成本约 15 万 token | 无来源 | **弱**（未测量） |
| 拆分动作本身可能消耗百万级 token | [7] 单一 issue 报告 | **中**（个案，待复现） |

**风险提示**：15 万与 1.5M 相差整整一个数量级，不能排除转述过程中把 [7] 的“1.5M／150 万”压缩成了“15 万”。在把 15 万当作设计参数使用前，应完成两件事：先标注它是“经验预算假设”而非来源事实；再注明它依赖模型窗口、工具定义长度与验证循环轮数这三个可变项。

**更稳健的表述**：ticket 粒度以“单窗口可完成”为准；在 200k 级窗口上，扣除系统提示、工具 schema、输出与验证开销后，留给“读入 + 推理”的有效预算明显小于名义窗口，15 万可作为保守起点，但必须在实测中校准。

---

## 6. Matt Pocock Skills 的做法（细化）

- **产物链显式、可审阅、可重跑**：spec 与 ticket 落在 issue tracker 或 markdown，是人可读、agent 可读的中间产物 [4][5]。
- **拆分即建图**：`/to-tickets` 产出的是带阻塞边的 DAG，而非有序列表 [2][6]。
- **执行分层**：单 ticket 用 `/implement`（内置 `/tdd` + `/code-review` 收口）[5]；整份 spec 用 `/implement-spec`（集成分支 + 每 ready ticket 一个 worktree + merger subagent）[5][6]。
- **团队流转**：大需求走 `/to-spec` → `/to-tickets` → `/triage` 三段 [3]。
- **上下文卫生**：多模块项目用物理隔离实现 Multi-Context，日常调用形如 `/grill-with-docs 开发 billing 模块的发票导出功能...` [3]。

---

## 7. pstack 的做法与差异

⚠️ **证据说明**：本轮 8 条来源全部集中在 Matt Pocock Skills，未包含新的 pstack 材料。以下概括依据既有 wiki 页面（[[pstack]]、[[pstack-让错误只犯一次]]、[[pstack-作者-每月2500个PR]]、[[一个月上线2000个PR]]），精确到机制层需补采原始文档。

- **重心在“错误只犯一次”的机制化**：把失败沉淀为约束，交给环境与验证环节承接，见 [[环境与约束]]、[[验证与自证]]、[[修正阶梯与-correct]]。
- **吞吐量级**（每月 2500 PR、一个月 2000 PR）说明它更依赖自动化闸门与沙箱接单，见 [[沙箱与自动接单]]、[[Sandcastle]]。
- **拆分不是独立产物**：pstack 侧更接近“约束先行 + 高吞吐流水线”，而 Matt Pocock Skills 把拆分本身产品化成了可单独调用的 skill。

**一句话差异**：pstack 用**约束**压缩上下文的重复消耗（同样的错不犯第二次），Matt Pocock Skills 用**切分**压缩单次上下文的规模（每个 ticket 一个新窗口）。两者正交，可叠加——见 [[pstack-与-matt-pocock-技能的分工]]。

---

## 8. 与既有页面的接口

- [[技能与流程]]：`/to-spec`、`/to-tickets`、`/triage` 是“技能”层的具体实例。
- [[成本与模型]]：拆分成本、窗口预算、模型选择三者的交汇点即本页第 3、5 节。
- [[评审与验收]]：垂直切片把验收点前移到 ticket 边界。
- [[口播素材综览]]：口播素材的“验证—约束—拆分—验收”四段叙事，与本页的产物链同构。
- [[术语表]]：spec / ticket / task graph / tracer bullet 的术语归一。

---

## 9. 矛盾、空白与建议来源

**矛盾**

1. **数量级冲突**：15 万 vs 1.5M（见 §5），二者不可能同时成立为“同一件事的成本”。
2. **细分收益递减点缺失**：“拆得越细越好”的直觉与 [7] 显示的拆分成本爆炸相冲突，且没有任何来源量化递减点在哪里。
3. **选择判据与估算方法不匹配**：[6] 说按会话数选工作流，但没有来源给出“如何估算一个任务需要几个会话”的可操作方法。

**空白**

- 没有来源给出 ticket 粒度的可操作判据（例如“读入文件数 ≤ N”“改动面 ≤ M 个模块”）。
- 没有来源量化 `/implement-spec` 的并发上限（worktree 数量、merger 冲突率、ready frontier 实际宽度）。
- `/triage` 在链中的确切位置与产物形态，材料只有只言片语 [3][4]。

**建议补充来源**

1. `mattpocock/skills` 仓库中 `to-tickets`、`implement-spec` 的 `SKILL.md` 原文——找粒度判据与依赖矩阵格式的**第一手定义**。
2. 对 [7] 的成本测量做复现：同一份 spec 在 `/to-tickets` 前后的 token 计数，区分“拆分”与“实现”两个账户。
3. pstack 侧关于队列、拆分与上下文管理的原始说明，补齐 §7 的证据基础。
4. 主流模型窗口与工具 schema 开销的实测数据，用于校准 §3 的 `safety` 系数。
5. 与 [[Dune]]、[[GrokBot]] 相关材料，可提供“非 issue-tracker 载体”的对照实现。

相关待办已登记在 [[待确认与冲突]]。

## References

1. [The /to-tickets Skill - AI Hero](https://www.aihero.dev/skills-to-tickets) — aihero.dev
2. [Matt Pocock 的3 个工程Skill：把一次AI 开发串成「实现、交付、复盘 ...](https://zhuanlan.zhihu.com/p/2086525922371430256) — zhuanlan.zhihu.com
3. [Matt Pocock Skills 完整使用指南与最佳实践 - 博客园](https://www.cnblogs.com/Boy-boy/p/21844276) — cnblogs.com
4. [配置Matt Pocock 的Skills - GitHub](https://github.com/vinvcn/mattpocock-skills-zh-CN/blob/main/skills/engineering/setup-matt-pocock-skills/SKILL.md) — github.com
5. [Skills for Real Engineers. Straight from my .agents directory. · GitHub](https://github.com/mattpocock/skills) — github.com
6. [Matt Pocock's Skills: Choosing The Right Workflow - Dan Does Code](https://www.dandoescode.com/blog/matt-pococks-skills-choosing-the-right-workflow) — dandoescode.com
7. [to-tickets consumed 2 whole sessions of a claude max 5x plan!!! 1.5M+ ...](https://github.com/mattpocock/skills/issues/826) — github.com
8. [The /to-spec Skill - AI Hero](https://www.aihero.dev/skills-to-spec) — aihero.dev
