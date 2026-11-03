---
type: query
title: "Research: 研究口播素材中「验证与自证」在 agent 工作流里的定义、可操作证据（测试、lint、类型检查）、与信任阶梯及环境约束的关系，以及其适用边界。"
created: 2026-11-03
origin: deep-research
tags: [research]
---

# Research: 研究口播素材中「验证与自证」在 agent 工作流里的定义、可操作证据（测试、lint、类型检查）、与信任阶梯及环境约束的关系，以及其适用边界。

# 验证与自证：可操作证据、信任阶梯与适用边界

> 本页综合外部资料，梳理「验证与自证」在 agent 工作流中的定义、证据形态、与 [[信任阶梯]] 及 [[环境与约束]] 的关系，并界定其失效边界。与 [[验证与自证]] 的概念页互补：概念页给出定义骨架，本页补充外部证据与反例。

---

## 一、定义：判定权的归属

在 agent 工作流语境下，「验证」与「自证」的差别不在方法，而在**谁持有判定权、证据能否被第三方重放**。

- **验证（verification）**：由生成者之外的实体（人、独立 reviewer agent、CI 流水线）依据**实现之前就已写定**的验收标准，对变更做出通过或不通过的判定 [3][8]。
- **自证（self-verification）**：生成者在自己的上下文窗口内，对自己刚产出的结果做出「完成了」的判断 [8]。

由此派生出 agent 工作流的核心命题：agent 说「done」并不构成证据，它只是一个待验证的声明 [6]。CodeRabbit 的表述更为直白——生成变便宜之后，**验证成为整个系统的约束条件（binding constraint）**，瓶颈从「写出来」转移到「证明它能用」[8]。

---

## 二、可操作证据的四个层级

ShipWithAI 指出，多数开发者的「验证」止步于语法检查（lint、format、type-check）[4]。但语法通过只是最低门槛，完整的证据链应分层：

| 层级 | 证据形态 | 回答的问题 | 典型实现 | 来源 |
|---|---|---|---|---|
| L0 语法层 | lint / format / type-check | 代码是否**合法** | 编辑器与 CI 前置钩子 | [4] |
| L1 行为层 | 单元测试、构建、test-lint-build 循环 | 代码是否**按预期运行** | `test → lint → build → fix → repeat` | [5] |
| L2 意图层 | 验收标准比对、stop hook 拦截 | 改动是否**是用户要的那件事** | 拦截 agent 的停止意图并回喂缺口 | [4][5] |
| L3 运行层 | telemetry、生产运行时证据 | 在真实环境中是否**真的成立** | 运行时观测反哺 agent | [10] |

### L1：循环而非单次检查

关键机制不是「跑一次测试」，而是**拦截 agent 的停止意图**：反复向 agent 发送提示、在其试图结束时检查成功标准是否达成，未达成则重新喂回缺口 [5]。这是一个闭环，不是一道闸门。Loop Engineering 一类工作把这种「验证—自纠」循环视为 agent 从一次性提示走向可交付系统的主要路径 [7]。

### L2：意图验证是最容易被跳过的一层

ShipWithAI 给出的 stop prompt hook 配置是一个可复用的最小实现：读取被修改的文件、核对改动是否匹配用户请求、运行测试套件，若缺失或损坏则说明需要修什么 [4]。它的价值在于把「完整性判断」也交给一个可执行的检查，而不是留给 agent 的自我感觉。

与之配套的是**验收标准的时序要求**：验收标准必须在任何人开始实现之前写定，review agent 才能拿它做比对 [3]。若标准事后补写，就会退化成为实现背书。

### L3：从「猜对了」到「有证据」

Arize 的观点是，完全自主的 agent 应当**依据运行时证据**而非猜测来判断变更是否满足需求 [10]。这一层目前最不成熟，多数团队的证据链止步于 L2。

---

## 三、自证为何结构性偏弱

这是「验证与自证」议题中最硬的一条经验结论，也是独立 reviewer 存在的全部理由。

CodeRabbit 引用的 SAFE 框架测量显示：在多跳推理任务上，自验证使平均准确率从 **76.7% 降至 75.2%**；对某一模型，从 **80.7% 降至 75.1%** [8]。同一来源还提到 Anthropic 的观察——agent 会自信地夸赞自己平庸的工作 [8]。机制解释是：当同一个模型在同一个上下文窗口内既生成又验证时，它会把自己的原始假设一并带入评审 [8]。

由此可以提炼一条判据：**自证不是「较弱的验证」，而是方向可能相反的信号**——它倾向于确认而非否证。

### 反例与张力

不过「自证全然无效」并非定论。ReVeal 一类工作（self-evolving code agents via reliable self-verification）恰恰在追求**可靠的自验证**，其前提是把自验证做成可执行、可回放的机制，而非让模型凭感觉打分 [9]。可执行、可验证、有状态的 agent 系统也是当前研究的一个明确方向 [9]。二者的分歧可能不在于「自证有没有用」，而在于「自证必须先被工具化」。

另一处相关空白是**跨模型、跨 agent 的技能验证**。有 issue 直接质疑：技能文档声称「works with any model」，但实践中如何验证这一声称并无公开方法 [2]。这意味着很多「验证通过」的结论其实绑定在特定模型与特定版本上。

---

## 四、与信任阶梯的关系

[[信任阶梯]] 的实质可以重述为：**自主度不是授予的，是用可验证性换来的**。阶梯的每一级，对应的其实是「人把判定权下放到哪一层证据」。

- 人逐行审代码 → 人的证据是阅读本身；
- 人只审测试 → 人信任 L1 行为层证据；
- 人只审验收标准 → 人信任 L2 意图层证据；
- 人只处理异常与告警 → 人信任 L3 运行时证据。

这条映射解释了两个常见现象：其一，**验证成本决定自主度上限**——如果一次改动的验证开销高于人工重写，下放判定权在经济上就不成立 [8]；其二，**验证失败必须有回馈路径**，否则阶梯会在第一次失败时整体崩塌，这正是 [[修正阶梯与-correct]] 与 [[评审与验收]] 在流程中不可省的原因。

[[pstack]] 与 [[matt-pocock-skills]] 的流程设计（见 [[pstack-与-matt-pocock-技能的分工]]）都把这套阶梯编码进了技能：日常开发优先走结构化 skills，跨天的大型任务才引入更重的流程编排 [1]。也就是说，**流程的重量应当与验证的强度匹配**，而不是一律拉满。

---

## 五、与环境约束的关系

环境不是验证的背景板，而是验证能否成立的前提。

1. **可复现性**：只有在隔离、可重建的环境里，「跑一遍」才能产生可信信号。[[沙箱与自动接单]] 描述的沙箱机制，使 L1 证据的采集成本降到可以每个任务都做一次。
2. **前置约束替代事后验证**：类型系统、lint 规则、schema 属于「把验证左移」——它们在生成阶段就排除了大一类错误，从而减少了 L1 层的负担。这与 [[环境与约束]] 中「约束既限制也赋能」的判断一致。
3. **生产就绪的三件套**：CodeRabbit 提出，可上生产的 agentic workflow 还需补齐**幂等性**（重试不重复副作用）、**回滚路径**（回到已知良好状态）、以及**评审检查点**（在落地前捕获语义级失败）[8]。这三者本质上都是「验证失败时的环境响应能力」。
4. **证据的采集面**：agent 需要文件系统访问、环境隔离、权限控制，以及「让它能验证自己工作」的反馈机制——后者被 Arize 视为 agent 区别于裸模型的核心组件 [10]。

反过来，环境缺失会直接伪造出「验证通过」：不可复现的环境、被 mock 掉的依赖、以及不稳定的测试，都会让 L1 证据失去意义（见下节）。

---

## 六、适用边界

| 边界 | 说明 | 来源 |
|---|---|---|
| **验收标准的盲区** | 验收标准只能检查「你预先想到的」；未写进标准的失败模式不会被捕获 | [6] |
| **语义与架构判断** | 命名、抽象层次、可维护性等无法用测试表达，仍需独立评审 | [3][8] |
| **规格本身错误** | 若规格有误，验证只会确认「实现与错误规格一致」 | [5][6] |
| **信号噪声** | flaky test、环境漂移会产生假阳性/假阴性，使闭环自我欺骗 | [7]（隐含） |
| **成本反转** | 当验证开销超过生成开销，约束条件从「验证」变成「验证的成本」 | [8] |
| **跨模型可移植性** | 「works with any model」类声称缺少公开验证方法 | [2] |
| **自证的适用残余** | 在缺少外部判据、且验证本身昂贵的场景，工具化的自验证仍是唯一选项 | [9] |

一个值得强调的推论：**验证强度应与任务的可逆性挂钩**。可回滚、影响面小的改动可以只做 L0/L1；不可逆或跨模块的改动必须补 L2 的独立评审 [8]。

---

## 七、矛盾与空白

1. **SAFE 数据的可信度存疑**。76.7%→75.2% 这组数字来自 CodeRabbit 的指南页 [8]，而 CodeRabbit 销售的正是独立评审产品，存在利益相关；其引用的 arXiv 编号（`2604.01993`）在时间上不可核验。这组数据在找到原始论文前，宜作为「方向性证据」而非精确数值使用。
2. **「自证无效」与自验证研究存在张力**。[8] 主张自证结构性偏弱，[9] 则在构建可靠自验证。二者的调和点可能是「自证必须先被外部化为可执行检查」，但这一调和目前是推断，不是文献结论。
3. **中文二手资料缺少验证强度维度**。[1] 给出的是工具选型建议（日常用 skills、大型任务用 GSD、0→1 用另一套），但没有说明不同选型对应的验证强度差异，无法直接支撑「流程重量匹配验证强度」的判断。
4. **L3 运行层证据几乎无落地案例**。[10] 描述的是愿景，缺少可复用的实现模式。

---

## 八、建议补充的来源

- SAFE framework 原始论文（核对 76.7%→75.2% 的实验设置与任务类型）。
- ReVeal: *Self-evolving code agents via reliable self-verification*（arXiv:2506.11442），用于确认「可靠自验证」的具体机制 [9]。
- Anthropic 关于 agent 自我评估偏乐观的原始研究或工程博客（[8] 仅转述，未给出来源）。
- Claude Code hooks / stop hook 官方文档，用于核实 [4] 中配置示例的字段语义与 timeout 行为。
- 关于 flaky test 对 agent 闭环影响的实证研究——目前只能从 [7] 间接推断。
- 跨模型技能验证的实践报告，用以回应 [2] 中「works with any model」的验证缺口。

---

## 九、一句话小结

在 agent 工作流里，「验证」是可被第三方重放的证据链（lint → 测试 → 验收标准 → 运行时观测），「自证」是生成者在同一上下文内的自我判断，后者在实证上倾向于确认而非否证 [8]；**信任阶梯的每一级本质上是人把判定权下放到哪一层证据**，而环境约束决定这些证据能否被廉价、安全、可复现地采集 [4][10]。其边界由验收标准的盲区、语义判断的不可自动化、以及验证成本的反转共同划定。

## References

1. [打造真实项目的AI 编程环境：Matt Pocock 的Skill 工作流完整上手攻略](https://zhuanlan.zhihu.com/p/2051704671073481406?utm_medium=openapi_platform&utm_source=1394c) — zhuanlan.zhihu.com
2. [How do you validate skills across agents and models? #1127 - GitHub](https://github.com/mattpocock/skills/discussions/1127) — github.com
3. [How I Validate Quality When AI Agents Write My Code](https://dev.to/teppana88/how-i-validate-quality-when-ai-agents-write-my-code-481c) — dev.to
4. [Build a Self-Verification Loop for Claude Code - ShipWithAI](https://shipwithai.io/blog/claude-code-self-verification-loop/) — shipwithai.io
5. [Verification Loop capability (test-lint-build → fix → repeat) #9143](https://github.com/pydantic/pydantic-ai-harness/issues/79) — github.com
6. [Your coding agent said “done”. Why are you still checking ... - Reddit](https://www.reddit.com/r/AI_Agents/comments/1wzpw1z/your_coding_agent_said_done_why_are_you_still/) — reddit.com
7. [Loop Engineering for AI Agents: Building Verifiable, Self-Correcting ...](https://pub.towardsai.net/loop-engineering-for-ai-agents-building-verifiable-self-correcting-coding-workflows-8b32c72184a1) — pub.towardsai.net
8. [How to design agentic workflows that actually ship - CodeRabbit](https://www.coderabbit.ai/guides/how-to-design-agentic-workflows) — coderabbit.ai
9. [Toward Executable, Verifiable, and Stateful Agent Systems - arXiv](https://arxiv.org/html/2605.18747v1) — arxiv.org
10. [Coding Agents, Telemetry, and the Path to Self-Improving Software](https://arize.com/blog/closing-the-loop-coding-agents-telemetry-and-the-path-to-self-improving-software/) — arize.com
