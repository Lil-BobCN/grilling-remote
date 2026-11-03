---
type: query
title: "Research: 查清 pstack 与 Matt Pocock Skills 如何把 spec、ticket 拆成适配上下文预算的任务单元，并核验「15 万 token」换算及其对评审与验收的影响。"
created: 2026-11-03
origin: deep-research
tags: [research]
---

# Research: 查清 pstack 与 Matt Pocock Skills 如何把 spec、ticket 拆成适配上下文预算的任务单元，并核验「15 万 token」换算及其对评审与验收的影响。

# pstack 与 Matt Pocock Skills：spec/ticket 如何拆成适配上下文预算的任务单元（附「15 万 token」核验）

## 摘要

两套体系解决的是同一个约束，但切入角度不同：[[pstack]] 用**playbook（任务执行手册）**把一个非平凡请求拆成可勾选的步骤序列，落到 todo list 上；[[matt-pocock-skills]] 用**ticket 依赖图（task graph）**把一份 spec 拆成可并行的节点，每个节点交给一个独立的 implementer subagent [1][4][6]。前者是“流程模板驱动的拆分”，后者是“依赖关系驱动的拆分”。

关于「15 万 token」：**本批来源中没有任何一条直接写出这个数字，也没有给出它的换算口径**。它在本页被当作一个待核验的工程经验值处理——量级上说得通（与 200k 窗口扣除常驻开销后的可用工作区相符），但“15 万”究竟是单 ticket 上限、单次 subagent 可用窗口，还是整份 spec 的预算，来源无法判定。第 3 节给出可复现的核算方法与交叉检验。

---

## 一、两套体系的入口与拆分层级

### 1.1 pstack：`/poteto-mode` 作为总入口，playbook 作为拆分模板

pstack 的官方指南把 `/poteto-mode` 称为整个系统的“总入口”：一切非平凡任务的开头都先输入它，它会读取请求、匹配一个 playbook，**把 playbook 的步骤原样复制进 todo list**，并在执行过程中按需调用其他技能 [1][4]。规模上，pstack 包含 23 个工作流技能、21 条工程原则、22 套任务执行手册，以及 2 个专用子智能体 [4]；源码位于 Cursor 官方插件仓库 `cursor/plugins/tree/main/pstack` [3]。

这个设计里，“任务单元”的定义非常具体：**playbook 的一个步骤就是一个单元**。todo list 是这些单元的运行时表示，因此过程天然可审计——评审者可以逐条对照“哪一步被跳过了”。代价是拆分粒度由 playbook 作者预先决定，而非由当前任务的上下文规模动态决定。

### 1.2 Matt Pocock Skills：ticket 作为 task graph 的节点

v1.3 把 `/implement-spec`、`/pr`、`/retro` 提升进 Engineering 套件，并把 `CONTEXT.md` 改名为 `GLOSSARY.md` [5][7]。其中 `/implement-spec` 的机制描述得最清楚：**在一根 integration branch 上实现整份 spec，把 tickets 当作 task graph 来处理，在“ready frontier”（依赖已满足的前沿）上并发运行 implementer subagents，最后用 `/code-review` 收尾** [6]。

这里的任务单元是 **ticket**，而且隐含了一个关键前提：每个 implementer subagent 拥有**独立的上下文窗口**。这正是“按 ticket 分配上下文预算”得以成立的技术基础——如果所有 ticket 共享一个会话，预算就只能整体分配，无法逐个节点控制。

### 1.3 两种拆分哲学的对照

| 维度 | pstack | Matt Pocock Skills |
|---|---|---|
| 拆分依据 | 预置 playbook 的步骤序列 [1] | ticket 之间的依赖关系（task graph）[6] |
| 单元粒度 | playbook 的一步 | 一个 ticket（约等于一个 PR）|
| 并行方式 | 执行中“按需调用其他技能” [1] | 在 ready frontier 上并发 subagent [6] |
| 过程可见性 | todo list 逐条勾选 [1] | 分支 + PR + `/code-review` [6] |
| 收尾动作 | 由 playbook 定义 | `/code-review`、`/pr`、`/retro` [5][6] |

两者已在 [[pstack-与-matt-pocock-技能的分工]] 中做过分工层面的对照；本页关注的是**拆分粒度与上下文预算的耦合**。值得一提的是，两套体系的作者之间有过一次长约 65 分钟的对谈 [2]，说明二者被视为同一问题的两种解法，而非竞争关系。

---

## 二、为什么必须在“拆分”这一层解决预算问题

[[任务拆分与上下文]] 的核心命题在来源 [8] 中被直接点破：**拆细任务本身有成本，只有当它换来“每次模型调用只加载真正需要的上下文”时才是划算的**。反过来说，如果一个 ticket 大到一次调用装不下，拆分就失败了——不是流程失败，是预算失败。

[[成本与模型]] 侧的工程做法是**预算法而非事后补救**：程序应在调用模型之前计算预算，而不是等请求失败后再处理；实际配置需要根据模型上下文窗口、业务回答长度、工具返回规模和价格表进行校准，并做到可观测、可降级 [9]。

把这两条合起来看，pstack 与 Pocock 的拆分机制其实各自对应一种预算控制手段：

- **pstack 是“静态预算”**：22 套 playbook 预先规定了每类任务要加载哪些步骤与技能，相当于把“该加载什么”提前固化，减少临场判断带来的上下文膨胀 [4]。
- **Pocock 是“动态预算”**：ticket 只有在依赖满足、进入 ready frontier 时才启动 subagent，且每个 subagent 从干净上下文开始，避免前序 ticket 的对话残渣累积 [6]。

两者都指向同一个反模式：**在一个长会话里连续做完所有事**。

---

## 三、「15 万 token」核验

### 3.1 来源核查结论

在本批 9 条来源中，`150k`／`15 万`这一数字**未被任何一条直接给出**。相关来源只提供了三类可用信息：

1. 拆分的目的是让每次调用只加载必要上下文 [8]；
2. 预算应在调用前按“窗口 − 回答长度 − 工具返回 − 价格”校准 [9]；
3. `/implement-spec` 为每个 ticket 启动独立 subagent [6]，即预算可以按 ticket 分配。

因此本页的判断是：**「15 万 token」目前是一个“量级合理、口径未定”的经验值，不应作为已验证事实引用**。它需要在 [[待确认与冲突]] 中挂起，直到找到原始出处。

### 3.2 三种可能的口径

| 口径 | 含义 | 与来源的相容性 |
|---|---|---|
| A. 单 ticket 上限 | 一个 ticket 的输入材料不得超过 150k，超过就必须再拆 | 与 [6][8] 的拆分逻辑一致，但阈值无出处 |
| B. 单次 subagent 可用窗口 | 200k 窗口扣除系统提示、技能清单、工具定义、输出预留后剩约 150k | 与 [9] 的“扣减项”算法一致，属推算 |
| C. 整份 spec 预算 | 一份 spec 的拆解总量控制在 150k 内 | 与 `/implement-spec` 的“整份 spec”表述 [6] 相容，但会限制 spec 规模，可能性较低 |

三种口径对实践的含义完全不同：A 要求“按 ticket 卡阈值”，B 要求“按会话卡开销”，C 要求“按 spec 卡总量”。**在没有原文的情况下，最稳妥的做法是把 150k 当作口径 B 来用**——即“单个 subagent 实际可用于工作的窗口”，因为它可以由窗口大小和开销清单独立推出，不依赖任何未公开的团队约定。

### 3.3 可复现的预算公式

```
可用工作区 = 模型窗口
           − 系统提示与工具定义
           − 常驻技能/原则清单（pstack 为 23 技能 + 21 原则 + 22 手册的索引部分 [4]）
           − 输出与推理预留
           − 重试与工具返回抖动余量
```

若窗口为 200k，代入一组**示意性**的开销值（系统与工具约 10k、技能索引约 15k、输出预留约 20k、抖动余量约 5k），可得约 150k。**这组开销值是本页假设，不是实测数据**——这也正是「15 万」最可能的来源：它看起来像一个被反复引用、但已无人回溯计算过程的推导结果。

### 3.4 换算表（量级参考，非精确值）

| 换算方向 | 约值 | 说明 |
|---|---|---|
| 150k token → 英文 | 约 10 万单词 / 60 万字符 | 常见英文 tokenizer 约 1 token ≈ 4 字符 |
| 150k token → 中文 | 约 15 万–22 万汉字 | 强依赖 tokenizer，跨模型差异大 |
| 150k token → 代码 | 约 8k–12k 行（含注释） | 按每行约 13–18 token 粗估 |
| 150k token → 成本 | 约 \$0.45（\$3/M 档）至 \$2.25（\$15/M 档） | 未计缓存折扣；缓存命中可降到 1/10 量级 |

**这张表只能用于量级判断。** 把 150k 换成“多少行代码”意义有限，因为 ticket 的上下文里通常只有一部分是代码，其余是 spec、GLOSSARY、测试输出与工具返回。

### 3.5 交叉检验：用 PR 数量反推

Lauren（poteto）公开提到“上个月我上线了 2000 个 PR” [3]。这个数字可以用来反向检验 150k 是否被真的用满：

- 若**每个 PR 都吃满** 150k 输入：2000 × 150k ≈ **3 亿 token/月**，按 \$3/M 计约 **\$900/月**（缓存命中后降至百美元量级）。
- 若**均值只有 20k–40k**（更符合“预算按 p95 设计、均值远低于上限”的常规）：2000 × 30k ≈ **6000 万 token/月**。

两种情形的成本相差 5 倍以上。**这个检验目前无法闭环**，因为来源 [3] 没有披露 token 消耗，且“2000 个 PR”很可能包含大量小改动，与“一个 spec ticket 对应一个 PR”并非一一映射。但它是可执行的下一次核验动作：若能拿到任一公开的月度用量数据，就能判定 150k 是“天花板”还是“平均值”。

---

## 四、对评审与验收的影响

### 4.1 预算决定评审单元的大小

链条是清晰的：**上下文预算 → ticket 粒度 → PR 大小 → 评审质量**。ticket 一旦超出预算，agent 会在中途压缩或丢弃上下文，产出变成“部分完成但看起来完整”；评审者于是被迫用人工时间补回被丢掉的那部分上下文。这正是 [[评审与验收]] 中“评审成本随 diff 非线性上升”的机制来源。

### 4.2 `/pr` 是评审侧的预算管理

`/pr` 的定位是“写出可评审的 PR body” [5][6]。它做的事情本质上是**把意图压缩成评审者能低成本消费的形式**——评审者不必从 diff 反推意图，从而把有限的注意力预算从“重建上下文”转移到“判断正确性”。这与 [[验证与自证]] 中的思路一致：让产物自带证据，而不是让评审者去搜寻证据。

### 4.3 验收对象是集成结果，不是单 ticket

`/implement-spec` 在**一根 integration branch** 上完成整份 spec，最后以 `/code-review` 收尾 [6]。这意味着验收的粒度高于评审的粒度：每个 ticket 被单独评审，但**验收判断的是整份 spec 的集成行为**。当 ticket 因预算被切得很碎时，集成风险会集中释放到最后一环——这是并发 ready frontier 策略的固有代价，也是 [[环境与约束]] 中“约束前移”原则要处理的问题。

### 4.4 建议的门禁项

结合 [8][9] 的预算法思路，可把预算检查做成验收门禁的一环：

1. **拆分时**：预估每个 ticket 的输入 token，超过阈值（无论取 150k 还是其他值）就强制再拆；
2. **执行时**：记录每个 subagent 的实际输入量，作为可观测指标 [9]；
3. **评审时**：把“是否有步骤/验收标准被静默跳过”列为固定检查项——pstack 的 todo list 与 Pocock 的 task graph 都提供了对照依据 [1][6]；
4. **收尾时**：`/retro` 用于改进 agent 的运行环境 [5]，可把预算超限事件沉淀为环境约束，而不是留在个人经验里。这与 [[信任阶梯]] 的递进逻辑吻合：先让过程可见，再逐步放权。

---

## 五、矛盾与空白

1. **「15 万 token」无原始出处。** 本批来源均未给出该数字或推导过程（见 3.1）。任何引用都应标注为“经验值”。
2. **来源 [7] 的日期存疑。** 该文称 v1.3 发布于 **2026 年 10 月 4 日**，与其余来源的时间线不一致，疑为站点日期错误或抓取异常。本页因此只采用其内容性描述（v1.3 包含哪些技能），不采用其日期。
3. **“2000 个 PR”与“一 ticket 一 PR”可能不自洽。** [3] 的 PR 计数未说明粒度，用它反推 token 用量只能得到上界（见 3.5）。
4. **两种拆分哲学缺少正面对撞的证据。** pstack 偏“流程固化”，Pocock 偏“依赖图并发”；两者在什么任务类型下各自更省预算，本批来源没有对比数据 [2] 虽有 65 分钟对谈，但未提供结论性内容。
5. **子智能体的预算隔离程度不明。** [4] 提到 pstack 有 2 个专用子智能体，[6] 提到 implementer subagents，但两者是否共享缓存、是否继承父会话上下文，来源未说明——这直接决定了“按 ticket 分配预算”能有多严格。

---

## 六、建议补充的来源

- Lauren Tan（poteto）关于 pstack 的原始长文或演讲，尤其是 playbook 与 subagent 的上下文传递细节；
- Matt Pocock 的 `implement-spec` SKILL.md 全文（GitHub `mattpocock/skills`），确认 ticket 拆分是否有显式规模约束；
- 任一方公开的月度 token 用量或单 PR 平均 token 数据，用于闭环 3.5 的交叉检验；
- 两人 65 分钟对谈的逐字稿 [2]，其中很可能直接讨论过任务粒度与上下文窗口；
- 关于“长上下文质量衰减”的实证研究，用于判断 150k 是工程约定还是有质量依据的阈值。

---

## 相关页面

- 实体：[[pstack]]、[[matt-pocock-skills]]、[[GrokBot]]、[[Sandcastle]]
- 概念：[[任务拆分与上下文]]、[[成本与模型]]、[[评审与验收]]、[[验证与自证]]、[[技能与流程]]、[[环境与约束]]、[[信任阶梯]]、[[沙箱与自动接单]]、[[修正阶梯与-correct]]、[[术语表]]
- 对比：[[pstack-与-matt-pocock-技能的分工]]
- 综述与待办：[[口播素材综览]]、[[待确认与冲突]]
- 来源：[[pstack-让错误只犯一次]]、[[pstack-作者-每月2500个PR]]、[[matt-pocock-v1-3]]、[[matt-pocock-grill-to-retro]]、[[matt-pocock-skills-实战]]、[[一个月上线2000个PR]]

## References

1. [Cursor 的Lauren Tan 开发的pstack 使用指南 - 知乎专栏](https://zhuanlan.zhihu.com/p/2091493912611500369) — zhuanlan.zhihu.com
2. [負責Grok Bot 專案的Lauren Tan，最近在X 爆紅，他的pstack workflow ...](https://www.threads.com/@mukiwu/post/DfJVoerk-dF/%E8%B2%A0%E8%B2%AC-grok-bot-%E5%B0%88%E6%A1%88%E7%9A%84-lauren-tan%E6%9C%80%E8%BF%91%E5%9C%A8-x-%E7%88%86%E7%B4%85%E4%BB%96%E7%9A%84-pstack-workflow-%E6%90%AD%E9%85%8D-grok-bot%E8%AE%93%E6%95%B4%E5%80%8B-ai-%E4%BB%A3%E7%90%86%E5%8F%88%E4%B8%8A%E5%8D%87%E4%BA%86%E4%B8%80%E5%80%8B%E6%AA%94/) — threads.com
3. [她憑什麼敢讓AI 自己merge？｜pstack - YouTube](https://www.youtube.com/watch?v=SygfYGjR8A4) — youtube.com
4. [Michael Guo on X: "pstack 是Lauren Tan 开源的一套工程技能和原则体系 ...](https://x.com/Michaelzsguo/status/2092787251281334593) — x.com
5. [v1.3: /implement-spec, /pr, /retro, and GLOSSARY.md - AI Hero](https://www.aihero.dev/skills-changelog-v13-implement-spec-pr-retro-and-glossary-md) — aihero.dev
6. [Skills for Real Engineers. Straight from my .agents directory. · GitHub](https://github.com/mattpocock/skills) — github.com
7. [Matt Pocock Skills 1.3: /implement-spec, /pr & /retro](https://developer.tenten.co/mattpocock-skills-v1-3-pr-implement-spec-retro) — developer.tenten.co
8. [AI 编程省Token 实战：从Spec、上下文工程到模型分层的降本策略](https://zhuanlan.zhihu.com/p/2035098622812013558) — zhuanlan.zhihu.com
9. [Agent 上下文预算工程：从Token 失控到可观测、可降级的调用链 - 腾讯云](https://developer.cloud.tencent.com/article/2722446) — developer.cloud.tencent.com
