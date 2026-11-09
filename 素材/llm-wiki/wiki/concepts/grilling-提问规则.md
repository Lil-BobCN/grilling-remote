---
type: concept
title: grilling 的提问规则
tags: [grilling, wayfinder, 提问, 需求澄清, frontier, domain-modeling]
related: [技能与流程, 任务拆分与上下文, matt-pocock-skills, 接单流程与口播的冲突, 术语表, 领域语言与决策记录, wayfinder-地图与决策票]
sources: ["口播提取/Matt Pocock 推荐_用动画讲解从 grill 到 retro 的全程工作流 p01 【中英字幕】Matt Pocock 推荐_用动.md", "口播提取/Matt Pocock Skills 全流程实战.md", "口播提取/Software Factories for Real Engineers/第 3 集_Using Grill with Docs Solution.md", "口播提取/Software Factories for Real Engineers/第 6 集_Writing an ADR Solution.md", "口播提取/Software Factories for Real Engineers/第 17 集_Grilling Ticket Solution.md"]
evidence_status: mixed
created: 2026-11-03
updated: 2026-11-09
---
# grilling 的提问规则

一句话：grilling 按决策树分轮提问。每一轮问完此刻能问的全部问题，每题附推荐答案。问到没有可问的为止，没有题数上限。

## 证据口径

- 技能原文：2026-11-03 在本机读取，版本 1.3.1，路径见文末。这部分是读到的原文。
- 口播：S4、S6 的说法是讲者自述，数字可能听错。
- 口播稿里的「思考一下」和「综合解读」是整理者加的。本页不把它们当讲者主张。

## 原文规定了什么

1. 把计划画成设计树。每个决策下面挂着依赖它的决策。
2. frontier（待问清单）是前提都已定、现在就能问的决策。
3. 一轮问完整个 frontier。题目编号，每题带推荐答案，然后等用户回答。
4. 措辞要让答「是」就等于接受推荐答案。
5. 用户答完，重算 frontier，问下一轮。依赖未答问题的题，留到后面的轮次。
6. 事实归 agent 查，不问用户。可以派子 agent 去查。只有依赖这个事实的题要等，其余照问。
7. 决策归用户。wayfinder 原文写明：grilling 的 agent 自己回答自己的问题，就是违规。
8. frontier 为空，每个分支都走过，没有东西被默默假设，才算问完。用户确认之前不动手。

原文没有题数上限。

## 讲者怎么说题数

- S4（动画拆解，作者转述 Matt，自述）：小改动约 6 个问题，一般约 20 个，讲课时有一次问了 46 个。题数跟场景走。
- S6（中文演示，ASR 原文含混，大意如下）：需求越模糊，问得越多，可能要答几十个，会很累。讲者建议先用别的办法把需求理清，再交给这个技能补充。
- S6 演示：每题有编号和推荐答案。用户可以说「都按你的推荐来」，只指出不同的题。
- 插件自带文档（domain-modeling）：给没有词汇表的老仓库补词汇表，有用户报告被问了 50 多个问题。这条来自文档，不是口播。

引用提醒：S6 稿里「问题超过二十个就先回去补背景」是整理者的延展建议，不是讲者原话。

## 和 grill-with-docs 的关系

grill-with-docs 等于 grilling 加 domain-modeling。问的过程中，定下来的词当场写进 GLOSSARY.md。用户打「wait what」，agent 用词汇表里的词重讲上一条（S4 自述）。

domain-modeling 文档提醒：词汇表只放术语，不能长成 spec。没人审过的 agent 词汇表，会塞满自信但没验证的说法。

## 课程里的 grilling（S9）

课程第 3、6、17 集把 grilling 和 domain modeling 放在一起演示。每次 grilling 会话都会调用两次技能：grilling 负责提问，domain modeling 负责维护术语表和 ADR。

课程里能看到三种动作：

- 逐题裁决：agent 给推荐答案，人只需说同意或改。第 17 集一口气过了十五个问题，票最后以决定表关闭。
- 场景测试：候选词在边缘场景下自相矛盾，就拆概念。第 3 集用退款请求和退款两条生命周期演示。
- 读不懂就停：第 6 集作者遇到一句读不懂的话，立刻要求做场景测试，最后发现团队许可证、座位、个人购买三个概念混在一起。

grilling 结束后，结论写进票的 resolution 和地图的 Decisions so far。grilling 票只做决定，不改代码；实现另开票。这和 [[wayfinder-地图与决策票]] 的分工一致。

## 谈不拢的题怎么办

S4：有些题谈不拢，比如页面长什么样。agent 交给新会话做一次性原型，几个屏幕样子差得很远，用户点选。选完回到 grilling。

## 成立前提

- agent 分得清事实和决策。
- 用户在场，能回答。
- 推荐答案够好，用户才敢答「是」。

## 边界

- 一个会话能做完的小事，不值得走全套（S4）。
- 题多是需求模糊的结果。问得少不等于需求清楚。S4 开场的例子：只写一句话，agent 用猜填满每个空。
- 研究文档引过商品检索的实验：问题多了，有 12% 到 17% 的回答和真实目标相反。这是相邻场景的外推，没有在需求澄清里验证。

## 本机原文位置

- ~/.claude/plugins/cache/claude-plugins-official/mattpocock-skills/1.3.1/skills/productivity/grilling/SKILL.md
- 同目录下 skills/engineering/wayfinder/SKILL.md
- 同目录下 skills/engineering/domain-modeling/SKILL.md

## 勘误

[[任务拆分与上下文]] 写的是「逐个问」。原文是一轮问完整个 frontier。该页待改，见 [[接单流程与口播的冲突]]。

## 开放问题

- 面向不懂技术的客户，一轮放几个题合适？没有数据。
- 推荐答案由谁校准？
