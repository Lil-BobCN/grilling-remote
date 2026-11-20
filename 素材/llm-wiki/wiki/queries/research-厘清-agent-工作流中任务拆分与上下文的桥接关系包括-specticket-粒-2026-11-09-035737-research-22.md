---
type: query
title: "Research: 厘清 agent 工作流中任务拆分与上下文的桥接关系，包括 spec、ticket 粒度、上下文预算、15 万 token 说法的可靠依据，以及它们与验证和环境约束的联动。"
created: 2026-11-09
origin: deep-research
tags: [research]
---

# Research: 厘清 agent 工作流中任务拆分与上下文的桥接关系，包括 spec、ticket 粒度、上下文预算、15 万 token 说法的可靠依据，以及它们与验证和环境约束的联动。

# 任务拆分与上下文的桥接：spec、ticket 粒度与上下文预算

在 [[matt-pocock-skills|Matt Pocock Skills]] 的流程里，任务拆分主要服务于一个目标：让每一段工作都能被一个“从未见过前文的新上下文窗口”（一个“新鲜”的上下文窗口）独立承接，而不只是把工作改小。spec 是跨会话保存共识的载体，ticket 是会话层面的调度单位，验收标准决定一个 ticket 能否被独立判定为完成。“15 万 token”并不是这套流程的预算参数，而是一篇 Medium 文章对“朴素做法”的成本举例，证据强度有限。

| 层 | 载体 | 上下文角色 | 典型失效模式 |
|---|---|---|---|
| 共识 | grill 对话 | 单一连续窗口内累积 | 窗口结束即丢失 |
| 规格 | spec issue | 可被后续会话重新读取的状态 | 缺少 test seams，无法执行 |
| 工作单元 | ticket | 一个新鲜上下文窗口 | 过度拆分、水平切片 |
| 完成判据 | 验收标准 + TDD | 可在起始 commit 上被证伪 | 标准不可失败 |
| 执行边界 | `/clear`、worktree、subagent | 隔离上下文 | 自动化缺口 |

## 1. 度量单位是会话数，不是项目规模

[5] 直接把原则表述为“Session count, not project size”：spec 之所以存在，是因为上下文窗口会结束；tickets 之所以存在，是为了让构建的每一块都能放进一个新鲜窗口。因此，选择工作流的依据并不是项目有多大，而是两个判断：**这次改动能否放进一个上下文窗口？是否已经看得到终点？**

[6] 给出了对应的下限：如果整个改动能放进一个上下文窗口，就直接用 `/implement`，跳过 tickets。这说明 ticket 化并非默认正确，它只是上下文超限时的补救结构；如果不需要拆分却强行拆分，反而会引入额外成本。

## 2. spec：把共识写成可供“失忆会话”读取的状态

[1][2] 把 Matt Pocock 的技能集概括为把需求澄清、领域建模、规格整理、任务拆分、TDD 实现与代码审查分别做成可组合的 Skill，以此取代盲目生成代码的“Vibe Coding”。在这条链上，spec 是第一个跨会话产物。

流程上，`/grill-with-docs` 产出的共享理解与词汇，会在同一个未中断的窗口里继续交给 `/to-spec`；[5] 特别提醒此处“不要 clear 或 compact”。`/to-spec` 不再做访谈，只做综合，并与你确认 test seams 后发布 spec issue。这一步的桥接意义在于：后续执行 ticket 的会话可能从未见过这段对话，spec 是它唯一能继承的共识。因此 spec 必须包含可执行的接口约定（test seams），而不只是需求叙述。相关提问规则可对照 [[grilling-提问规则]]。

[3] 把自包含性推得更远：当某个 issue 被打上特定标签时，agent 需要写一份“agent brief”——一份让另一个 agent 无需上下文即可执行的任务说明。这是 spec/ticket 自包含性的更强版本，也是 issue 工作流与 AFK（离开键盘）自动接单的前提，可与 [[沙箱与自动接单]] 对照。

## 3. ticket 粒度：垂直切片，而不是按层切

[6] 的规则是“tracer bullets, not layers”：每个 ticket 应当是一条贯穿各层的可演示行为，而不是“所有 schema 一个 ticket、所有 API 另一个”。判断粒度是否正确的操作性问题是：**“这个 ticket 做完，我能演示什么？”**答案必须是行为，不是层。

`/to-tickets` 会把拆分以编号列表呈现，并反过来考你：粒度是否合适、blocking edges 是否真实、有没有该合并或该拆开的 [6]。编号前缀是真实 ticket ID，因此可以直接 `/implement 03`，不必重打长标题；当依赖关系是原生的时候，模板会省略 `## Blocked by`。

两个已知失败模式：

- **过度拆分**：这是该 skill 被报告最多的问题，典型例子是“三行改动产出十二个 ticket” [6]。
- **水平切片**：按层拆分的失败正是垂直切片规则要防的，但该 skill 仍偶尔产出 [6]。

因此 ticket 粒度遵循的是“一个新鲜窗口能完成”与“有可演示行为”的交集，而不是越细越好。这与 [[任务拆分与上下文]] 中记录的一般原则一致。

## 4. 上下文预算：定性启发式，以及“15 万 token”说法的可靠性

关键事实是：Matt Pocock 的文档并没有给出 token 数值预算。“sized for one fresh context window”是定性约束，依赖模型窗口与任务复杂度，并随版本变化；[5] 也提醒技能迭代很快（其说明基于 skills v1.3.1）。

“15 万 token”来自 [4] 的一篇 Medium 文章，原文是：按朴素做法，每个工具定义都加载进上下文、完整 transcript 两次穿过模型（一次输入、一次输出），该工作流“大约花费 150,000 tokens”。评估其可靠性需要注意：

- 它描述的是**朴素做法的总成本**，不是 ticket 的大小阈值，也不是上下文窗口容量。
- 只有单一来源，用词是“about”，未给出工具定义数量、transcript 长度、轮次或计数口径。
- “两次穿过模型”暗示输入与输出分别计数，不能直接等同于“窗口里放得下多少”。
- 摘录标题称“two numbers that justify all of this”，但提供的材料只包含其中一个数字，另一个缺失，无法交叉验证。

结论：这个数字可以作为“朴素上下文管理成本量级”的修辞参照，**不能作为拆分粒度的工程依据**。若要把它变成可靠依据，需要可复现的 token 计数（固定模型、工具集、轮次，输入与输出分开）以及对照组的实测。

同一来源还提出一个与“每个 ticket 都新开窗口”相反的成本直觉：单一累积上下文“在 token 上最便宜，因为只有一个上下文在累积成本” [4]。这与 [5][6] 的新鲜上下文策略构成真实矛盾：新开窗口意味着每个 ticket 都要重新读取 spec/ticket，付出重新载入成本（rehydration 成本），换取的是避免上下文污染与退化。现有材料没有量化这一权衡。

[6] 的一个细节降低了重新载入成本：`/to-spec` 与 `/to-tickets` 在同一上下文窗口内运行，agent 不必回头去取 spec；到 `/implement` 前才 `/clear`。ticket 模板本身也承担自包含说明的职责。

## 5. 与验证的联动

拆分和验证在同一处衔接：**test seams**。

- spec 阶段就与你商定 test seams [5]，这决定了 ticket 的验收接口。
- `/implement` 驱动 `/tdd` 与 `/code-review`，然后提交；`/tdd` 是 red → green，一次一个垂直切片 [5]。
- [6] 指出模板只要求写验收标准，不要求标准“可失败”，因此会出现无法证伪的标准。手工检查方法是：对每条标准，说出一个能证明它为假的观察，并确认在实现者起始的 commit 上它确实失败。

这与 [[验证与自证]] 的核心一致：验收标准必须能被观测推翻，否则 ticket 的“完成”无法验证。另有一个自动化缺口：[6] 明确说 `/implement` 完成时并不可靠地关闭或勾选 ticket（GitHub 与本地 markdown 都如此），状态需要你手动更新。这意味着“拆分—执行—验收”的闭环目前仍有一小段依赖人工，与 [[评审与验收]] 中的观察相呼应。

## 6. 与环境约束的联动

ticket 同时是环境调度单位：

- 每个 ticket 之间执行 `/clear`，给它一个新鲜上下文 [6]。
- 并行工作流 `/implement-spec` 为每个 ready ticket 开一个 worktree，使用 integration branch 与 merger subagent [5]。
- [7] 提议用 subagent 自动串行多个 ticket，理由是 subagent 拥有独立上下文窗口，可以在自动化的同时保留“每 ticket 干净上下文”的原则。但这是 feature request，尚非已交付能力。

也就是说，blocking edges 不只是阅读顺序，还是并行调度与环境隔离的约束；[[环境与约束]] 中的隔离原则在这里具体化为 worktree、subagent 与 `/clear` 三件事。相关技能组合逻辑可参见 [[技能与流程]]。

## 7. 矛盾、张力与空白

1. **粒度上下限冲突**：一边警告过度拆分（十二个 ticket 对三行改动），一边警告不拆分（放不进一个窗口的 feature 直接 `/implement` 会“ends in tears”）[5][6]。判据是窗口容量与可演示行为，但两者都未被数值化。
2. **成本模型冲突**：[4] 认为单一累积上下文最省 token；[5][6] 主张每个 ticket 都新开窗口。前者计算原始 token，后者计算有效产出与污染成本，两者没有共同度量。
3. **自动化缺口**：`/implement` 不关闭 ticket；auto-sequencing 仍是提案 [6][7]。
4. **证据缺口**：“15 万 token”单来源、无方法；“one context window”无 token 定义；[5] 提到的五条工作流，材料只展开了两条（主流程与并行任务图），另外三条缺失。
5. **版本漂移**：技能迭代快，[5] 基于 v1.3.1，[6] 的模板细节（如省略 `Blocked by`）可能随版本变化。可与 [[matt-pocock-v1-3]] 对照。

这些可作为 [[待确认与冲突]] 的补充条目。

## 8. 建议补充的来源

- Matt Pocock 的 skills 仓库与 aihero.dev 的 context-window 词条，用于确认“一个窗口”的官方定义与版本差异。
- [4] 原文全文，尤其是缺失的第二个数字及其计数方法。
- 可复现的 token 实测：固定模型与工具集，分别记录 spec 读取、ticket 执行、review 的输入/输出 token。
- `/to-tickets` 的 issue 讨论与 over-decomposition 实际案例，用于估计粒度分布。
- [7] 对应 GitHub issue 的进展，确认 auto-sequencing 是否落地。
- 与 [[pstack|pstack]] 或 [[Sandcastle|Sandcastle]] 等自动接单实现的对照，验证 ticket 自包含性在真实流水线中的要求。

## References

1. [Matt Pocock 的AI Coding Skills 工作流](https://gaome.de/posts/matt-pocock-ai-coding-skills-workflow-cn/) — gaome.de
2. [Matt Pocock Skills 完整使用指南与最佳实践 - 博客园](https://www.cnblogs.com/Boy-boy/p/21844276) — cnblogs.com
3. [告别「AI 写了一堆屎」：Matt Pocock 的工程师级Agent Skills ...](https://zhuanlan.zhihu.com/p/2033476732142007734) — zhuanlan.zhihu.com
4. [Token-Efficient Agentic Workflows That Actually Hold Up](https://topuzas.medium.com/building-a-one-person-software-factory-token-efficient-agentic-workflows-that-actually-hold-up-c2edabc007a8) — topuzas.medium.com
5. [Matt Pocock's Skills: Choosing The Right Workflow](https://www.dandoescode.com/blog/matt-pococks-skills-choosing-the-right-workflow) — dandoescode.com
6. [The /to-tickets Skill - AI Hero](https://www.aihero.dev/skills-to-tickets) — aihero.dev
7. [`/implement` support for auto-sequencing multiple tickets via ...](https://github.com/mattpocock/skills/issues/618) — github.com
