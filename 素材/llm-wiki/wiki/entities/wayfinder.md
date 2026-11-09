---
type: entity
title: Wayfinder
tags: [Wayfinder, skill, 地图, 决策票, Matt Pocock]
related: [wayfinder-地图与决策票, grilling-提问规则, 任务拆分与上下文, 技能与流程, matt-pocock-skills]
sources:
  - "口播提取/Software Factories for Real Engineers/第 12 集_The Limits Of One Session.md"
  - "口播提取/Software Factories for Real Engineers/第 13 集_Charting The Way.md"
  - "口播提取/Software Factories for Real Engineers/第 15 集_Chart The Map Solution.md"
  - "口播提取/Software Factories for Real Engineers/第 25 集_Finish The Map Solution.md"
evidence_status: mixed
created: 2026-11-09
updated: 2026-11-09
---
# Wayfinder

## 定义

Wayfinder 是 Matt Pocock 技能库里的规划技能。它把超出一次 agent 会话的工作，画成 issue tracker 上的一张地图和一组决策票，逐张解决，直到通往目的地的路清晰。

## 本机技能文件（已核验）

本机存在 Wayfinder 的技能文件，版本 1.3.1，大小 12,380 字节：

`~/.claude/plugins/cache/claude-plugins-official/mattpocock-skills/1.3.1/skills/engineering/wayfinder/SKILL.md`

文件里能直接读到这些结构：

- 地图是单个 issue，标签为 `wayfinder:map`，决策票是它的子 issue。
- 票的类型标签是 `wayfinder:<type>`，四种：`research`、`prototype`、`grilling`、`task`。
- 地图正文分五段：Destination、Notes、Decisions so far、Not yet specified、Out of scope。
- 票用 assignee 认领；开放、未阻塞、未认领的子票是 frontier。
- 一次会话最多解决一张票，研究票除外。
- grilling 票要求调用两次 Skill 工具，分别是 `grilling` 和 `domain-modeling`。
- 研究票由子代理在一次性 `research/<name>` 分支上解决，不开 PR，不合并。

这部分是文件直接读到的事实，不是口播。

## 课程里的说法（讲者观点）

课程第 12–15 集和第 24–25 集把 Wayfinder 讲得更细：

- 单次 `grilling` 会话装不下大块工作，压缩会丢信息，拆会话又要搬上下文，所以需要跨会话规划。
- 地图承载目的地、已做决定和迷雾；决策票承载细节。
- 票之间用 `blocked by` 表达依赖，构成 DAG；frontier 是当前可以并行处理的票。
- 四种票分别补不同的缺口：讨论、原型、事实、操作。
- 目的地建议定成 spec，而不是做完的功能。
- 地图完成后用 `to-spec` 转成 spec。

课程里的标签写法是 `wayfinder map`、`Wayfinder grilling`、`Wayfinder task`，和本机 1.3.1 的 `wayfinder:map`、`wayfinder:<type>` 不完全一致。这可能是版本差异，也可能是讲者口头简写。具体以所用版本的技能文件为准。

## 和其他技能的关系

- [[grilling-提问规则]]：grilling 是每张票内部的问法；Wayfinder 是票与票之间的组织方式。
- [[任务拆分与上下文]]：spec 和 ticket 处理一次实现会话装什么；Wayfinder 处理几十次会话怎么排。
- [[保真度与原型]]：prototype、research、task 三种票分别对应不同保真度和缺口。
- [[matt-pocock-skills|Matt Pocock Skills]]：Wayfinder 是这套技能库里的规划入口。

## 边界

- 小任务不需要地图。课程第 28 集的决策树建议先 one-shot 或 `grill with docs`，雾太大再升级。
- 地图是决策层，不是实现层。把实现任务塞进决策票，会让会话重新变长。
- 地图需要持续维护。新票会随着决定浮现，没人更新的地图会误导后续会话。
- 依赖 issue tracker 的父子 issue 和原生阻塞关系。工具不支持时，要另找载体。

## 开放问题

- 课程用的版本和本机 1.3.1 是同一版吗？标签写法和「一次一张票」的规则没有在课程里逐一对照。
- 一张地图多少张票算合适？课程说见过 50、60 张，没有给上限。
- 多语境项目要不要按 bounded context 拆多张地图？

## Related

- [[concepts/wayfinder-地图与决策票]]
- [[concepts/grilling-提问规则]]
- [[concepts/任务拆分与上下文]]
- [[concepts/保真度与原型]]
- [[entities/matt-pocock-skills]]
