---
type: source
title: Software Factories for Real Engineers（38 集课程）
tags: [S9, 口播, ASR, 软件工厂, Matt Pocock]
related: [matt-pocock-skills, 技能与流程, 领域语言与决策记录, wayfinder-地图与决策票, 保真度与原型, 软件工厂, 评审与验收, 软件工厂课程综览]
sources:
  - "口播提取/Software Factories for Real Engineers/00-系列索引.md"
  - "口播提取/Software Factories for Real Engineers/第 1 集_Domain Language.md"
  - "口播提取/Software Factories for Real Engineers/第 2 集_Using Grill with Docs.md"
  - "口播提取/Software Factories for Real Engineers/第 3 集_Using Grill with Docs Solution.md"
  - "口播提取/Software Factories for Real Engineers/第 4 集_ADRs _ Domain Language.md"
  - "口播提取/Software Factories for Real Engineers/第 5 集_Writing an ADR.md"
  - "口播提取/Software Factories for Real Engineers/第 6 集_Writing an ADR Solution.md"
  - "口播提取/Software Factories for Real Engineers/第 7 集_Pruning the Glossary.md"
  - "口播提取/Software Factories for Real Engineers/第 8 集_Pruning the Glossary Solution.md"
  - "口播提取/Software Factories for Real Engineers/第 9 集_Pruning ADRs.md"
  - "口播提取/Software Factories for Real Engineers/第 10 集_Pruning ADRs Solution.md"
  - "口播提取/Software Factories for Real Engineers/第 11 集_Q&A _ Domain Language.md"
  - "口播提取/Software Factories for Real Engineers/第 12 集_The Limits Of One Session.md"
  - "口播提取/Software Factories for Real Engineers/第 13 集_Charting The Way.md"
  - "口播提取/Software Factories for Real Engineers/第 14 集_Chart The Map.md"
  - "口播提取/Software Factories for Real Engineers/第 15 集_Chart The Map Solution.md"
  - "口播提取/Software Factories for Real Engineers/第 16 集_Grilling Ticket.md"
  - "口播提取/Software Factories for Real Engineers/第 17 集_Grilling Ticket Solution.md"
  - "口播提取/Software Factories for Real Engineers/第 18 集_Grilling Ticket 2.md"
  - "口播提取/Software Factories for Real Engineers/第 19 集_Grilling Ticket 2 Solution.md"
  - "口播提取/Software Factories for Real Engineers/第 20 集_Task Ticket.md"
  - "口播提取/Software Factories for Real Engineers/第 21 集_Task Ticket Solution.md"
  - "口播提取/Software Factories for Real Engineers/第 22 集_Prototype Ticket.md"
  - "口播提取/Software Factories for Real Engineers/第 23 集_Prototype Ticket Solution.md"
  - "口播提取/Software Factories for Real Engineers/第 24 集_Finish The Map.md"
  - "口播提取/Software Factories for Real Engineers/第 25 集_Finish The Map Solution.md"
  - "口播提取/Software Factories for Real Engineers/第 26 集_Spec → Implement.md"
  - "口播提取/Software Factories for Real Engineers/第 27 集_Spec → Implement Solution.md"
  - "口播提取/Software Factories for Real Engineers/第 28 集_Grill vs Wayfinder vs Ship First.md"
  - "口播提取/Software Factories for Real Engineers/第 29 集_The Three Kinds Of Review.md"
  - "口播提取/Software Factories for Real Engineers/第 30 集_The PR Skill.md"
  - "口播提取/Software Factories for Real Engineers/第 31 集_Running The PR Skill.md"
  - "口播提取/Software Factories for Real Engineers/第 32 集_Running The PR Skill Solution.md"
  - "口播提取/Software Factories for Real Engineers/第 33 集_The _code-review Skill.md"
  - "口播提取/Software Factories for Real Engineers/第 34 集_Testing Out The Code Review Skill.md"
  - "口播提取/Software Factories for Real Engineers/第 35 集_Testing Out The Code Review Skill Solution.md"
  - "口播提取/Software Factories for Real Engineers/第 36 集_Why Retro.md"
  - "口播提取/Software Factories for Real Engineers/第 37 集_Trying Out Retro.md"
  - "口播提取/Software Factories for Real Engineers/第 38 集_Trying Out Retro Solution.md"
evidence_status: partial
created: 2026-11-09
updated: 2026-11-09
---
# Software Factories for Real Engineers（38 集课程）

## 来源信息

| 字段 | 内容 |
| --- | --- |
| 标题 | Software Factories for Real Engineers |
| 作者 | Matt Pocock（原课程作者）；B 站上传：红白RW |
| 平台 | bilibili |
| URL | https://www.bilibili.com/video/BV1K2sf6VEkc |
| 原始文件 | `raw/sources/口播提取/Software Factories for Real Engineers/`，共 39 个文件（38 集正文加 1 份系列索引） |
| 提取方式 | 本地 ASR（whisper.cpp small，英文）后翻译整理；平台无字幕 |
| 时长 | 10,704.8 秒，约 2 小时 58 分 |
| 口播状态 | partial（本地 ASR，翻译整理） |
| 主张状态 | 视频观点未经独立核验 |

原文目录：`素材/口播提取/Software Factories for Real Engineers/`，按集号排序；`00-系列索引.md` 是 38 集的阅读入口。`raw/sources/` 下有同一份副本，供 wiki 溯源。38 集不单独建来源页；每集的一手材料在 `raw/sources/` 下，本页做索引和摘要。

## 一句话摘要

这是一门用 38 集讲完整条软件工厂流程的课程：先用领域语言、术语表和 ADR 把话说准，再用 Wayfinder 的地图和决策票跨会话规划，接着转成 spec、拆票、并行实现、PR 评审和 retro 复盘。核心主张是 agent 让实现变便宜后，瓶颈移到规划和评审，质量和速度要靠语言、保真度和三层刹车一起管。

## 系列结构

| 段落 | 集数 | 主题 |
| --- | --- | --- |
| 领域语言 | 1–11 | 术语表、ADR、场景测试、修剪、bounded context |
| Wayfinder 理论 | 12–13 | 单会话上限、地图、决策票、战争迷雾、frontier、四种票 |
| 画地图与票型 | 14–25 | 通知功能案例、grilling、task、prototype、收尾地图 |
| spec 与实现 | 26–27 | to-spec、to-tickets、implement-spec、PR |
| 评审 | 28–35 | 决策树、三层刹车、PR 技能、code-review 技能 |
| retro | 36–38 | 人工评审改进系统、规则和代码一起改 |

## 每集一句话

| 集 | 标题 | 一句话 |
|---|---|---|
| 1 | Domain Language | 语言决定产出质量，用 `GLOSSARY.md` 统一用户、代码和 agent 的用词。 |
| 2 | Using Grill with Docs | 练习：用 `grill with docs` 给混乱的退款说法找一个统一的词。 |
| 3 | Using Grill with Docs Solution | 用场景测试把 refund 拆成 refund request 和一条退款生命周期。 |
| 4 | ADRs / Domain Language | 代码只给答案，ADR 补上被排除的方案和取舍。 |
| 5 | Writing an ADR | 练习：做退款批准界面，决定退款后进度怎么处理。 |
| 6 | Writing an ADR Solution | 术语表暴露代码缺陷，最后写四份很短的 ADR。 |
| 7 | Pruning the Glossary | 练习：修剪被 agent 塞满的术语表。 |
| 8 | Pruning the Glossary Solution | 删实现细节和通用词，用词频决定统一到 learner 还是 student。 |
| 9 | Pruning ADRs | 练习：用三条标准复检一堆 ADR，决定删除还是废弃。 |
| 10 | Pruning ADRs Solution | 删四份、写一份反转 ADR，留下「决定不做」的记录。 |
| 11 | Q&A / Domain Language | 拆分、更新时机、好词来源、边做边建、人不能缺席。 |
| 12 | The Limits Of One Session | 瓶颈移到规划，单会话装不下，引出 Wayfinder 和保真度。 |
| 13 | Charting The Way | 地图加决策票，战争迷雾、frontier、四种票型。 |
| 14 | Chart The Map | 练习：给应用内通知画地图，目的地定成 spec。 |
| 15 | Chart The Map Solution | 七张票、四种票型齐全，研究票自动跑出服务商和渠道策略。 |
| 16 | Grilling Ticket | 练习：新会话处理第一张 grilling 票「发哪些通知、给谁」。 |
| 17 | Grilling Ticket Solution | 十五问定通知目录，给 question 和 reply 加 discussion 前缀。 |
| 18 | Grilling Ticket 2 | 练习：第二张 grilling 票，选通知服务商。 |
| 19 | Grilling Ticket 2 Solution | 不在错误保真度上承诺 Knock，拆两张原型票和前置任务票。 |
| 20 | Task Ticket | 练习：用 `wizard` 技能做 Knock 注册向导。 |
| 21 | Task Ticket Solution | 向导读地图和研究，人注册取密钥，agent 用真实请求验证。 |
| 22 | Prototype Ticket | 练习：原型票做到所有决定落进代码，原型放一次性分支。 |
| 23 | Prototype Ticket Solution | Knock 原型逐项验证，卡在偏好界面反而验证了产品契合度。 |
| 24 | Finish The Map | 练习：走完剩余票，清空 not yet specified 的迷雾。 |
| 25 | Finish The Map Solution | v1 只做通知信息流，比较原型变体选 A2，清空迷雾。 |
| 26 | Spec → Implement | 练习：`to-spec` → `/to-tickets` → `/implement-spec`。 |
| 27 | Spec → Implement Solution | 61 条故事、八张票并行、15 条评审发现、管理 API 替代向导。 |
| 28 | Grill vs Wayfinder vs Ship First | 决策树：小改动 one-shot，中等 grilling，太大升级 Wayfinder。 |
| 29 | The Three Kinds Of Review | 三层刹车：自动检查、自动评审、人工评审。 |
| 30 | The PR Skill | PR 模板：可视化摘要、前后证据、单向门和爆炸半径。 |
| 31 | Running The PR Skill | 练习：生成草稿 PR，让 agent 按 `pr` 技能重写正文。 |
| 32 | Running The PR Skill Solution | 摘要清楚但证据弱，标出单向门和隐私风险。 |
| 33 | The /code-review Skill | 实现和评审分开，评审读 `coding-standards.md`，专门把草稿变好。 |
| 34 | Testing Out The Code Review Skill | 练习：对 PR 跑 `code-review`，要求主动修，并给一份 spec。 |
| 35 | Testing Out The Code Review Skill Solution | 两轴评审抓术语、注释、spec 偏差和权限漏洞，修完再交给人。 |
| 36 | Why Retro | 人工评审的第三作用：把重复意见变成系统改进，同一条评论不留第二次。 |
| 37 | Trying Out Retro | 练习：留流程性评论，让 `retro` 读 PR 评论和所有相关会话。 |
| 38 | Trying Out Retro Solution | `retro` 看六个会话，筛掉过头建议，加类型、测试类型和新规则。 |

## 主要论点

- 语言是产出质量的前置。agent 会生造词，代码和界面会出现多个名字，最后用户和 agent 都找不到东西。共享术语表能把这个成本压下来。
- 代码只说明最后做了什么，不说明排除了什么。ADR 用一到三句话记录难逆转、无上下文会意外、来自真实取舍的决定。
- 术语表和 ADR 都会膨胀。实现细节、通用编程词和过期数字是主要杂质；修剪和建表同样重要。
- 一次会话装不下大块工作。Wayfinder 用一张地图承载目的地和已做决定，用决策票承载细节，票据之间的阻塞关系形成 DAG，frontier 是当前可做的票。
- 规划要在正确的保真度上做。低保真讨论便宜，高保真原型清楚但贵；原型票、研究票、任务票和 grilling 票分别补不同的缺口。
- 小改动可以 one-shot，中等改动从 `grill with docs` 开始，发现雾太大再升级 Wayfinder。反过来从 Wayfinder 起步，失败成本高。
- 软件工厂需要三层刹车：自动检查、自动评审、人工评审。自动评审应该主动修确定性问题，只把判断性问题留给人。
- PR 描述是评审界面：先给可视化摘要，再给改前失败、改后成功的证据，最后用单向门/双向门和爆炸半径决定评审深度。
- 人工评审的目的不只是修这次代码，还要改进产出代码的系统。同一条评论不该留第二次；规则和仓库里的示例代码要一起改。

## 关键数字与案例

- 术语表修剪：113 行降到 87 行；`student` 出现 180 次，`learner` 出现 8 次（agent 统计，未独立复核）。
- 通知功能地图：约七张票，四种票型齐全；两张研究票自动派给子代理。
- 原型会话：约 10.7 万 token；通知界面比较 A/B/C 三个变体后选 A2。
- spec 实现：61 条用户故事，八张票并行，代码评审发现 15 个问题，约两小时。
- retro：读取 PR 34 背后的六个会话；修复提交额外加了 32 行注释，成为编码标准的新规则来源。

## 待核验

- 第 1 集 `in what December 2025` 的具体月份听不清。
- 第 19 集 `career` 可能是通知服务商 Courier。
- 第 27 集 `cohort of five notes` 的目录名不确定。
- 第 32 集 `migration O12` 可能是 012 或 0012。
- 第 36 集 `cherry-pick` 与 `reset` 两处说法冲突。
- Knock 的价格、管理 API 能力和 web push 限制来自课程中的研究与演示，可能随版本变化。
- 课程与现有 S4、S5、S6 的版本关系没有核实。S4/S5/S6 讲的是 Matt Pocock Skills v1.3；这门课可能是同一套技能的长课程版，也可能是不同版本，暂不合并结论。

## 关联页面

- [[matt-pocock-skills|Matt Pocock Skills]]
- [[技能与流程]]
- [[领域语言与决策记录]]
- [[wayfinder-地图与决策票]]
- [[保真度与原型]]
- [[软件工厂]]
- [[评审与验收]]
- [[软件工厂课程综览]]
- [[待确认与冲突]]
