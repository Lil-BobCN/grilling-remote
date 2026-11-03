---
type: query
title: "Research: 查清 pstack 与 Matt Pocock Skills 中 spec、ticket 和上下文预算（尤其 15 万 token 说法）随任务拆分的换算关系，并厘清验证与环境约束对拆分粒度的影响。"
created: 2026-11-03
origin: deep-research
tags: [research]
---

# Research: 查清 pstack 与 Matt Pocock Skills 中 spec、ticket 和上下文预算（尤其 15 万 token 说法）随任务拆分的换算关系，并厘清验证与环境约束对拆分粒度的影响。

# spec、ticket 与上下文预算：pstack 与 Matt Pocock Skills 的拆分换算关系

本页核查 [[pstack]] 与 [[matt-pocock-skills]] 两套体系中 spec、ticket 与上下文预算的关系，重点解释“15 万 token”说法的来源与适用范围，并说明验证与环境约束如何影响任务拆分粒度。

先给出一个限定：**“15 万 token”目前只出现在对 Matt Pocock Skills 的二手总结中，并非其官方文档的硬性数值；pstack 的公开资料中没有对应的 token 预算。** 因此，本页把可确认的规则与推断分开陈述，并在末尾列出待补来源。

## 一、摘要

一句话回答：**15 万 token 是规划会话的软预算，不是每张 ticket 的配额；ticket 的尺度是“一个新鲜上下文窗口”，ticket 数由垂直切片和阻塞图决定，而不是 token 除法。**

具体结论如下：

- Matt Pocock Skills 用三层结构管理任务规模：**spec 是跨窗口的持久推理记录，ticket 是单窗口的一次性执行单元，context window 是物理边界，约 150k token 的 smart zone 是质量软边界**。[7][8]
- ticket 的尺度是“一个新鲜上下文窗口”，不是固定 token 数；tickets 之间是带阻塞关系的 task graph，由 `/implement-spec` 按 frontier 在隔离 git worktree 中调度。[1][7][9]
- 换算关系可以拆成三层判定：工作能否在一个上下文窗口内完成 → 是否跳过 spec；每张 ticket 能否在一个新鲜窗口内完成 → 拆分粒度；ticket 之间有无阻塞 → 能否并行。[7][9]
- 验证约束会把某些 ticket 从 worktree 拉回 main checkout：验证依赖未跟踪材料时，必须在主检出中运行，形成串行/集成例外。[6]
- pstack 以 `/poteto-mode` 为入口，匹配 playbook 并把步骤复制进 todo list；其 `prove-it-works` 原则要求用真实产物验证后才宣告完成。[3][4] 公开来源未给出 token 预算或 spec→ticket 的换算规则，不能把 Matt 的 150k 规则直接套到 pstack。

## 二、术语与三个层级

### 2.1 spec：跨窗口的持久记忆

在 Matt Pocock 的流程中，spec 是唯一持久的规划产物。`/to-spec` 把已经决定的方向整理成正式规格，包含边界与验收标准 [2]；tickets 完成后会被删除或关闭，而 spec 保留下来，作为记录“为什么这样拆”的唯一位置 [7]。`to-spec.md` 明确说：

> “Each ticket is sized for one fresh context window and then gets deleted or closed, while the spec stays as the one place that records the reasoning behind them.” [7]

这解释了 spec 的存在理由：**上下文窗口会结束，推理需要被外部化** [8]。如果工作本身能在一个上下文窗口内完成，`to-spec` 的建议是直接使用 `/implement`，跳过 spec [7]。换言之，spec 不是每个任务的仪式，而是跨窗口工作的交接文档；它的完整性直接决定后续 ticket 能否在脱离原始对话的情况下执行。

### 2.2 ticket：单窗口的一次性执行单元

ticket 是一次性执行单元，按“一个新鲜上下文窗口”来定尺，完成后删除或关闭 [7]。它不是按文件或技术层切分，而是垂直切片，每张 ticket 应能独立交付和验证 [2]。多张 tickets 之间不是列表顺序，而是带阻塞关系的 task graph；`/implement-spec` 把整份 spec 当作 task graph 来构建，并按 frontier（阻塞已解除的节点）在隔离 git worktree 中调度子智能体 [1][9]。

因此，ticket 的粒度同时受两个因素约束：**单窗口可完成性**（一张 ticket 不能大到一次会话装不下）和**依赖关系**（一张 ticket 不能依赖尚未完成的 ticket，否则不能进入当前 frontier）。这也是为什么 ticket 可以“小”，但不能“乱”：它必须是一个可独立调度的节点。相关概念可参考 [[任务拆分与上下文]]。

### 2.3 context window 与 smart zone：硬边界与软边界

上下文窗口是硬边界，smart zone 是软边界。[8] 指出，模型在约 150k token 以内推理仍然敏锐，超过后质量下降；因此 grill、spec、tickets 应在一个不中断的窗口内完成，只在阶段之间切换上下文。`to-spec` 也建议 spec 和 tickets 在同一窗口生成，这样 `/to-tickets` 不必再次抓取 spec [7]。这形成了“阶段内连续、阶段间切换”的上下文使用模式：**同一阶段内保持推理链完整，阶段边界才重置上下文**。

这里需要区分两个概念：context window 是模型一次能处理的 token 上限；smart zone 是在上限之内、模型仍能保持推理质量的区间。前者是硬约束，后者是经验约束。来源没有给出具体模型的窗口大小，也没有说明 150k 对应哪个模型，因此不能把两者等同。[8]

## 三、“15 万 token”说法的来源与含义

### 3.1 原文与语境

目前可查的出处是 Dan Does Code 对 Matt Pocock Skills 的总结：

> “Stay in the smart zone. Up to about 150k tokens, the model still reasons sharply. Past that, quality drops. So the grilling, spec and tickets should happen in one unbroken window, and you only change context at the boundary between phases.” [8]

这段话有三个限定。第一，**“about”**：150k 是经验阈值，不是精确数字。第二，**“the model”**：来源没有指定模型，因此不能把它理解为某个模型的固定窗口。第三，**“the grilling, spec and tickets”**：它限定在规划阶段，而不是整个实现阶段。作者同时提出“Session count, not project size”，即用会话数而不是项目规模来规划工作 [8]。

### 3.2 三个数字不要混淆

| 数字 | 含义 | 来源是否给出 |
|---|---|---|
| 模型上下文窗口 | 一次可处理的 token 硬上限，由具体模型决定 | 来源未给出具体数值 [8] |
| smart zone（约 150k） | 模型仍能保持推理质量的经验区间，低于窗口上限 | [8] |
| 每张 ticket 的预算 | 一个新鲜上下文窗口；来源未说必须 ≤150k | [7] |

把“15 万 token”说成“每张 ticket 的固定配额”或“上下文窗口大小”，都超出了原文。更准确的表述是：**150k 是规划会话的 soft budget，ticket 的 hard budget 是“一个新鲜窗口”，两者不是同一个量。**

### 3.3 常见误读与纠正

| 常见误读 | 纠正 |
|---|---|
| 15 万 token 是模型上下文窗口大小 | 它是 smart zone 的质量阈值；窗口硬上限由模型决定，来源未给出 [8] |
| 每张 ticket 的配额是 15 万 token | ticket 的尺度是“一个新鲜上下文窗口”，来源未说必须 ≤150k [7] |
| ticket 数 = spec 总 token ÷ 15 万 | ticket 数由垂直切片和阻塞图决定，不是 token 除法 [1][2][9] |
| pstack 也使用 15 万 token 预算 | pstack 来源未提及 150k 或类似预算 [3][4][5] |

### 3.4 对拆分的影响：规划会话 vs 实现会话

- **规划会话**（grill + spec + tickets）：应尽量控制在一个 smart zone 内。如果接近 150k，应考虑缩小 spec 范围、拆成多个 spec，或在新窗口用交接文档继续。来源没有给出具体操作，属于空白。[8]
- **实现会话**（每张 ticket）：获得一个新鲜窗口 [7]。ticket 太大就继续拆，太小则增加调度开销；来源没有给出下限。
- **阶段边界**：是推荐的上下文切换点；不要在 grill 中途或 spec 写到一半切换 [8]。这也是“同窗口生成 spec 与 tickets”的原因 [7]。

## 四、从 spec 到 ticket 的换算

### 4.1 顶层判定：是否需要 spec

Matt Pocock 的流程先判断工作规模，再决定是否进入 spec：

```text
工作是否能在一個上下文窗口內完成？
├─ 是 → /implement（跳过 spec）
└─ 否 → /to-spec → /to-tickets → /implement-spec
```

`implement` 适合“一次一张 ticket、在自己的上下文窗口中、ticket 之间清空上下文”的场景；`implement-spec` 适合“整份 spec 作为 task graph、子智能体在各自 worktree 中执行”的场景 [6]。这就是最顶层的换算：**spec 的必要性由工作是否跨窗口决定，而不是由项目大小决定** [7][8]。如果一份工作能在一个窗口内完成，生成 spec 和 tickets 反而是额外开销；`to-spec` 明确建议跳过 [7]。

### 4.2 ticket 数与并行度：task graph / frontier

ticket 数没有公开公式。来源给出的约束是：

1. 每张 ticket 以“一个新鲜上下文窗口”为尺度 [7]。
2. ticket 是垂直切片，每张应能独立交付和验证 [2]。
3. tickets 之间有阻塞关系，`/implement-spec` 按 frontier 调度 [1][9]。
4. 任务尺度的问题是“这份规格里有多少工作，哪些工作能同时开始” [1]。

因此，**ticket 数 ≈ 可独立验证的垂直切片数，受阻塞图约束**；它不是总 token 除以 150k。150k 约束的是规划会话的质量，不是 ticket 的切分单位。换句话说，拆分的驱动因素是“工作结构”和“单窗口可完成性”，token 只是判断单窗口是否够用的一个代理指标。

### 4.3 换算规则总结

可以把来源中的规则整理成四条：

- **规则一（是否 spec）**：工作跨窗口 → 需要 spec；单窗口 → 跳过 spec，直接 implement。[7][8]
- **规则二（ticket 大小）**：每张 ticket 以一个新鲜上下文窗口为尺度；超过则继续拆成垂直切片。[7]
- **规则三（并行度）**：ticket 之间无阻塞 → 可进入同一 frontier，在隔离 worktree 中并行；有阻塞 → 等前置完成。[1][9]
- **规则四（规划预算）**：grill + spec + tickets 尽量在一个约 150k token 的 smart zone 内完成；阶段边界才切换上下文。[8]

用定性表达可以写成：

```text
是否需要 spec        ≈ 工作是否超出一个上下文窗口
ticket 数            ≈ 可独立验证的垂直切片数（受阻塞图约束）
每张 ticket 的规模   ≈ 一个新鲜上下文窗口
规划会话预算         ≈ 150k token（软阈值，非硬配额）
并行度               ≈ 当前 frontier 的宽度（受 worktree 环境与验证依赖约束）
```

这四条规则是定性换算，不是定量公式。来源没有给出“spec 多少字 → 多少 ticket”的比例，也没有给出“每张 ticket 多少 token”的硬指标。

### 4.4 应用示例（推导，非原文）

假设一份 spec 包含 5 个垂直切片，每片都能在一个新鲜窗口内完成：

- 若 5 片互不阻塞，`/implement-spec` 可以把 5 张 ticket 都放入 frontier，在 5 个隔离 worktree 中并行（实际并行度受机器和子智能体数量限制）。
- 若 ticket B、C 依赖 ticket A 的产出，则第一波 frontier 只有 A；A 完成后，B、C 才进入 frontier。
- 若 ticket E 的验证依赖未跟踪的本地配置，E 不应放入 worktree，而应安排在 main checkout 串行执行 [6]。

这个例子只用于说明调度逻辑，不是来源原文；实际 ticket 数取决于工作结构和验证方式，而不是 token 除法。

## 五、验证约束对拆分粒度的影响

### 5.1 验收标准写在 spec，ticket 只负责单窗口执行

spec 记录边界与验收标准 [2]；tickets 完成后删除或关闭，spec 保留 [7]。这意味着验证的可追溯性依赖 spec，而不是 ticket。拆分时应确保每张 ticket 的验收标准都能在 spec 中找到对应条目；否则 ticket 完成后，验收依据会随 ticket 消失。**spec 越完整，ticket 可以越小、越临时**；因为“为什么这样验收”留在 spec 里，ticket 只需携带“这一次做什么”。相关讨论见 [[评审与验收]]。

### 5.2 未跟踪材料例外：main checkout

`implement-spec` 的常见问题条目明确说：**如果一张 ticket 的验证依赖未跟踪材料（untracked material），告诉 orchestrator 改在 main checkout（主检出）运行。** [6] 这是一个具体的“验证-环境”耦合规则。未跟踪材料可能包括本地配置、密钥、生成文件、数据库状态等；它们不在 worktree 中，因此隔离环境无法完成验证。

对拆分粒度的影响有三点：

1. **该 ticket 不能并行**：main checkout 是共享的，不能像 worktree 那样为每张 ticket 提供独立副本；它必须串行执行。
2. **可能需要拆出“环境准备”ticket**：先把未跟踪材料变成可跟踪的 fixture，或把环境准备作为前置 ticket，才能让后续 ticket 回到 worktree。
3. **可能需要把实现与验收合并**：如果验证只能在 main checkout 做，把实现和验收放在同一张 ticket 里，避免跨环境交接；但这会增大 ticket，受单窗口上限约束。

### 5.3 `prove-it-works` 与垂直切片

pstack 的 `prove-it-works` 原则要求“宣告完成前，拿真的产物验：跑功能” [4]。这把“完成”定义为真实产物可验证，而不仅是代码写完或测试通过。对拆分粒度的影响是：**ticket 倾向于端到端垂直切片，而不是“先写模型层、再写 API 层”的水平切片**；因为水平切片往往无法单独证明功能可用。垂直切片通常比水平切片略大，但只要不超过一个新鲜窗口，就是合理的。

Matt Pocock 的流程也有类似倾向：ticket 是垂直切片 [2]，`/code-review` 在 implement 之后执行 [7]。验证不只是单元测试，还包括 review 和 retro 的反馈。相关概念见 [[验证与自证]]。

### 5.4 评审与 retro 的反馈

`/code-review` 与 `/retro` 是实现之后的质量门 [2][7]。它们不直接改变 ticket 大小，但会影响“什么算完成”的标准。如果 review 经常发现同一类问题，retro 应把教训写回 spec 或 playbook，从而间接调整后续拆分。pstack 的“记住教训，别重复花钱”也是同一逻辑 [2]。这说明拆分粒度不是一次性的，而是随着验证反馈迭代的。

## 六、环境约束对拆分粒度的影响

### 6.1 worktree 隔离与并行

`/implement-spec` 的核心机制是“task-graph frontier scheduling across isolated git worktrees” [9]。隔离 worktree 让每张 ticket 拥有独立的文件系统和构建环境，从而可以并行执行、互不干扰。但隔离也带来环境一致性要求：worktree 必须能独立安装依赖、运行测试、访问所需服务。如果某张 ticket 依赖 main checkout 中的未跟踪文件、密钥或本地数据库，它就不适合放进 worktree [6]。

因此，**环境越隔离、越可复现，ticket 越可以小而并行；环境越耦合、越依赖共享状态，ticket 越需要合并或串行**。这是拆分粒度的一个隐性约束：不是所有工作都能被切小，只有能被独立验证的工作才能。相关讨论见 [[环境与约束]] 与 [[沙箱与自动接单]]。

### 6.2 issue tracker 前置

`/implement-spec` 会先确认 tickets 存放在 GitHub Issues、Linear 还是本地 Markdown；如果未配置，会提示运行 `/setup-matt-pocock-skills` [9]。issue tracker 的选择会影响 ticket 的状态流转、关闭方式和跨会话可见性。如果 tracker 未配置，ticket 可能只存在于对话中，无法被 frontier 调度。因此，**环境准备不仅是代码环境，也包括任务跟踪环境**；它应在 `/to-tickets` 之前完成。

### 6.3 同窗口生成 spec 与 tickets

`to-spec` 建议在同一窗口运行 spec 和 tickets，这样 `/to-tickets` 不必再次抓取 spec [7]。`implement-spec` 的总结也建议只在阶段边界切换上下文 [8]。跨窗口生成会带来两个问题：一是重新读取 spec 的 token 开销；二是 spec 与 tickets 的版本漂移，因为“Nothing keeps it in sync” [7]。因此，**同窗口生成是保证 spec 与 tickets 一致性的环境约束**；如果必须跨窗口，应把 spec 作为唯一真相源重新注入，并接受额外的 token 开销。

### 6.4 环境-验证耦合的粒度规则

| 约束 | 对拆分粒度的影响 | 来源 |
|---|---|---|
| 验证需要真实产物（`prove-it-works`） | 倾向垂直切片，每张 ticket 带可观察验收 | [4] |
| 验证依赖未跟踪材料 | 该 ticket 回 main checkout，串行化；可能拆出环境准备 ticket | [6] |
| 隔离 worktree 可独立运行 | 支持小 ticket 并行，frontier 宽度大 | [9] |
| issue tracker 未配置 | 先配置，否则 ticket 无法跟踪 | [9] |
| 规划会话接近 150k | 缩小 spec 范围或分多个 spec，避免质量下降 | [8]（推导） |
| spec 与 tickets 跨窗口 | 需重新抓取 spec，漂移风险高 | [7] |

这张表把“验证”和“环境”对粒度的影响放在一起：验证决定一张 ticket 需要多大才能被证明，环境决定一张 ticket 能否被隔离和并行。两者共同约束 frontier 的形状。

## 七、pstack 的对照

### 7.1 pstack 的规划单位：playbook + todo

pstack 的公开资料没有描述 spec/ticket 流水线。它的入口 `/poteto-mode` 会读取请求、匹配一个 playbook、把 playbook 的步骤原样复制进 todo list，并在执行中按需调用其他技能 [3]。整个体系包含 23 个工作流技能、21 条工程原则、22 套任务执行手册、2 个专用子智能体 [5]。因此，pstack 的拆分单位更像“playbook 步骤 / todo item”，其规模由 playbook 和子智能体任务决定，而不是 token 预算。相关概念见 [[技能与流程]]。

### 7.2 pstack 的验证原则：`prove-it-works`

pstack 的原则体系中有一条 `prove-it-works`：宣告完成前用真实产物验证，例如跑功能 [4]。这为每个 playbook 步骤提供了验证门，但来源没有说明它如何换算成 ticket 数或上下文预算。可以说，pstack 用“真实产物验证”约束步骤的完成标准，Matt 用“ticket 单窗口 + 验收标准”约束拆分；两者都在防止“代码写完但没验证”的假完成，但机制不同。

### 7.3 pstack 没有 150k 说法

就本页收集到的 pstack 来源而言，没有出现 150k token、smart zone 或 spec→ticket 的换算规则。[3][4][5] 因此，不能把 Matt Pocock 的 150k 规则直接套到 pstack；pstack 的上下文管理更可能由 playbook 的步骤划分和子智能体调用隐式处理，但来源没有展开。这是本页的一个主要空白。

### 7.4 对照表

| 维度 | Matt Pocock Skills | pstack |
|---|---|---|
| 规划产物 | spec（持久，含边界与验收）[2][7] | playbook + todo list [3] |
| 执行单元 | ticket（一次性，一个新鲜上下文窗口）[7] | playbook 步骤 / todo item [3] |
| 拆分依据 | 是否跨上下文窗口；垂直切片；阻塞关系 [1][2][7] | 请求匹配 playbook；按需调用技能 [3] |
| 并行机制 | task graph frontier；隔离 git worktree [9] | 22 套 playbook、2 个子智能体 [5]；来源未详述调度 |
| 上下文预算 | 约 150k token 的规划会话 smart zone [8] | 来源未提及 token 预算 |
| 验证门 | 验收标准；验证依赖未跟踪材料时回 main checkout [2][6] | `prove-it-works`：真实产物验证 [4] |
| 环境前置 | GitHub Issues / Linear / 本地 Markdown；`/setup-matt-pocock-skills` [9] | 来源未详述 |

从数量上看，有中文总结把 pstack 描述为“重型工程作业系统”，而 Matt Pocock 的流程更接近 5 个轻量阶段的串联 [2]。这与上表的差异一致：pstack 用更多技能、原则和 playbook 覆盖工程全流程；Matt 用更少的阶段和更明确的 spec/ticket 边界管理上下文。两者的分工可参考 [[pstack-与-matt-pocock-技能的分工]]。

## 八、矛盾与空白

1. **150k 的来源级别**：目前只有 [8] 这个二手总结给出数值；官方 `to-spec.md` 只说“一个上下文窗口”，没有 150k [7]；`implement-spec` 文档也没有给出数值 [6]。需要 Matt Pocock 本人的一手表述来确认。
2. **150k 的作用域**：原文把它放在“grilling, spec and tickets”规划会话上 [8]；它是否也适用于每张 ticket 的实现会话，来源没有明说。`to-spec` 只说 ticket 以“一个新鲜上下文窗口”为尺度 [7]，没有说 150k。
3. **是否每张 ticket 都要 ≤150k**：没有来源给出这个硬性规则。把 150k 当作每 ticket 配额，是对原文的过度延伸。
4. **pstack 的计数矛盾**：[5] 说 21 条工程原则，[4] 说 24 条原则。可能是版本差异或统计口径不同；需要 pstack 官方仓库确认。
5. **pstack 的 token 预算**：就本页收集到的来源而言，pstack 没有提到 150k 或类似阈值；不能把 Matt 的规则直接套到 pstack。
6. **spec 与 ticket 的同步**：`to-spec.md` 明确说“Nothing keeps it in sync” [7]；同窗口生成只是缓解，不是同步机制。跨会话修改 spec 后，tickets 可能过期。
7. **“未跟踪材料”的定义**：来源没有举例 [6]。哪些算 untracked material（本地配置、密钥、生成文件、数据库状态）需要进一步澄清。
8. **ticket 的删除与关闭**：来源说“deleted or closed” [7]，但在 GitHub Issues/Linear 中通常只能关闭，不能真正删除；这对审计和 retro 有影响。
9. **不同来源的流程图不一致**：[6] 的流程是 `grill-with-docs → to-spec → to-tickets → implement-spec → retro`；[7] 的流程是 `grill-with-docs → to-spec → to-tickets → implement → code-review → retro`。这与版本有关：`to-spec` 在 v1.1 改名，v1.3 引入 `/implement-spec` 等技能 [7][9]。需要按版本区分，不能把不同版本的流程图混用。
10. **pstack 与 Matt 的术语不可直接对齐**：pstack 的 playbook 步骤是否等同于 ticket、todo item 是否等同于 task graph 节点，来源没有说明；目前的对照是功能类比，不是文档化的映射。相关待确认项可汇总到 [[待确认与冲突]]。

## 九、建议补充的来源

- **Matt Pocock 官方 `mattpocock/skills` 仓库**：`to-spec.md`、`to-tickets.md`、`implement-spec.md`、`implement.md`、`code-review.md`、`retro.md`，用于确认 150k 是否出现在一手文档，以及 ticket 的准确定义。
- **AI Hero 的文章与词典**：`The /implement-spec Skill`、`The /to-spec Skill`、`The /to-tickets Skill`，以及 AI Coding Dictionary 的 `context-window`、`clearing` 条目 [6][7]。
- **Dan Does Code 原文的完整版本**：确认 150k 的上下文、是否引用 Matt 本人的话，以及“session count, not project size”的完整论证 [8]。
- **pstack 官方仓库 / Cursor plugins repo**：确认 23 个工作流技能、21 条工程原则、22 套 playbook、2 个子智能体的版本，以及 24 条原则的差异 [5]。
- **Lauren Tan 的原帖、访谈或 README**：补充 pstack 的上下文管理、子智能体调度和验证流程；现有来源多为中文二手总结。
- **Matt Pocock 的播客/视频/直播**：他可能在口头解释 150k 的经验来源和适用范围。
- **GitHub Issues / Linear 与 `/setup-matt-pocock-skills` 的集成文档**：确认 ticket 的存储、关闭和跨会话可见性 [9]。
- **长上下文质量下降的实证研究**：用于验证“150k smart zone”是否具有普适性，而不只是某个模型的经验。

## 十、相关页面

- [[matt-pocock-skills]]
- [[pstack]]
- [[任务拆分与上下文]]
- [[验证与自证]]
- [[环境与约束]]
- [[评审与验收]]
- [[技能与流程]]
- [[成本与模型]]
- [[术语表]]
- [[pstack-与-matt-pocock-技能的分工]]
- [[matt-pocock-grill-to-retro]]
- [[matt-pocock-v1-3]]
- [[matt-pocock-skills-实战]]
- [[pstack-让错误只犯一次]]
- [[一个人如何带一支AI团队-Lauren访谈]]
- [[pstack-作者-每月2500个PR]]
- [[待确认与冲突]]

## References

1. [Matt Pocock 的3 个工程Skill：把一次AI 开发串成「实现、交付、复盘 ...](https://zhuanlan.zhihu.com/p/2086525922371430256) — zhuanlan.zhihu.com
2. [結論：Matt Pocock 把個人.claude 目錄做成Skills Repo，用5 個流程把模糊 ...](https://www.threads.com/@meta.ai/post/Darg0fMgKUV/%E7%B5%90%E8%AB%96matt-pocock-%E6%8A%8A%E5%80%8B%E4%BA%BA-claude-%E7%9B%AE%E9%8C%84%E5%81%9A%E6%88%90-skills-repo%E7%94%A8-5-%E5%80%8B%E6%B5%81%E7%A8%8B%E6%8A%8A%E6%A8%A1%E7%B3%8A%E6%83%B3%E6%B3%95%E8%AE%8A%E6%88%90%E5%8F%AF%E4%BA%A4%E4%BB%98%E5%8A%9F%E8%83%BD%E6%A0%B8%E5%BF%83%E6%98%AF%E5%85%88%E6%8A%8A%E9%9C%80%E6%B1%82%E5%95%8F%E6%B8%85%E6%A5%9A%E5%86%8D%E5%AF%AB%E7%A8%8B%E5%BC%8F3-%E5%88%86%E9%90%98%E8%A8%AD%E8%A8%88/) — threads.com
3. [Cursor 的Lauren Tan 开发的pstack 使用指南 - 知乎专栏](https://zhuanlan.zhihu.com/p/2091493912611500369) — zhuanlan.zhihu.com
4. [3/ 24 條原則，我挑四條prove-it-works 宣告完成前，拿真的產物驗：跑功能 ...](https://www.threads.com/@ci.fullstack/post/De14Nm8CQet/3-24-%E6%A2%9D%E5%8E%9F%E5%89%87%E6%88%91%E6%8C%91%E5%9B%9B%E6%A2%9Dprove-it-works%E5%AE%A3%E5%91%8A%E5%AE%8C%E6%88%90%E5%89%8D%E6%8B%BF%E7%9C%9F%E7%9A%84%E7%94%A2%E7%89%A9%E9%A9%97%E8%B7%91%E5%8A%9F%E8%83%BD%E8%AE%80%E5%AF%A6%E9%9A%9B%E7%9A%84%E5%80%BC%E7%9C%8B-diff%E6%9B%BF%E4%BB%A3%E6%8C%87%E6%A8%99agent-%E8%87%AA%E8%BF%B0%E8%83%BD%E7%B7%A8%E8%AD%AF%E9%83%BD%E4%B8%8D%E7%AE%97guard-the-c/) — threads.com
5. [Michael Guo on X: "pstack 是Lauren Tan 开源的一套工程技能和原则体系 ...](https://x.com/Michaelzsguo/status/2092787251281334593) — x.com
6. [The /implement-spec Skill - AI Hero](https://www.aihero.dev/skills-implement-spec) — aihero.dev
7. [skills/docs/engineering/to-spec.md at main - GitHub](https://github.com/mattpocock/skills/blob/main/docs/engineering/to-spec.md) — github.com
8. [Matt Pocock's Skills: Choosing The Right Workflow - Dan Does Code](https://www.dandoescode.com/blog/matt-pococks-skills-choosing-the-right-workflow) — dandoescode.com
9. [Matt Pocock Skills 1.3: /implement-spec, /pr & /retro](https://developer.tenten.co/mattpocock-skills-v1-3-pr-implement-spec-retro) — developer.tenten.co
