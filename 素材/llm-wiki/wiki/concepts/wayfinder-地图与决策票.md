---
type: concept
title: Wayfinder：地图与决策票
tags: [wayfinder, 地图, decision-ticket, 战争迷雾, frontier]
related: [wayfinder, grilling-提问规则, 任务拆分与上下文, 保真度与原型, 技能与流程]
sources:
  - "口播提取/Software Factories for Real Engineers/第 12 集_The Limits Of One Session.md"
  - "口播提取/Software Factories for Real Engineers/第 13 集_Charting The Way.md"
  - "口播提取/Software Factories for Real Engineers/第 14 集_Chart The Map.md"
  - "口播提取/Software Factories for Real Engineers/第 15 集_Chart The Map Solution.md"
  - "口播提取/Software Factories for Real Engineers/第 24 集_Finish The Map.md"
  - "口播提取/Software Factories for Real Engineers/第 25 集_Finish The Map Solution.md"
evidence_status: partial
created: 2026-11-09
updated: 2026-11-09
---
# Wayfinder：地图与决策票

一句话：一张地图装目的地和已做的决定，一堆决策票装细节；每关一张票，就多看清一段路。

## 定义

**地图（map）**：issue tracker 里的一个 issue，标签是 `wayfinder map`。它只存索引、目的地、一般性笔记、已做决定和未定迷雾，不存细节。

**决策票（decision ticket）**：地图下的子 issue。每张票处理一个决策，可能是一次 grilling、一次原型、一次研究或一组手动任务。

**战争迷雾（fog of war）**：规划时看不全的决策空间。随着票被解决，更多票会浮现，地图逐渐清晰。

**frontier**：开放的、未被阻塞的、未被认领的子票。它们是当前可以同时处理的票。

**目的地（destination）**：第一次会话要定的东西。做代码工作时，课程建议把目的地定成一份 spec，而不是做完的功能。

## 来源观点

### 为什么需要跨会话规划

课程第 12 集的说法：agent 让实现变便宜后，瓶颈从「干活」移到「规划」。单次 `grilling` 会话有上下文上限，压缩会丢信息，拆会话又要来回搬上下文。Wayfinder 的目标是跨多次会话规划任意大小的工作。

### 地图和票的关系

第 13 集给了完整结构：

- 地图是一个 GitHub issue，决策票是它的子 issue。课程把地图标签写作 `wayfinder map`；本机 1.3.1 技能文件写作 `wayfinder:map`，见 [[wayfinder|Wayfinder 技能]]。
- 票之间用 issue tracker 原生的 `blocked by` 表达依赖。所有阻塞票关闭后，这张票才解除阻塞。
- 票构成有向无环图（DAG）。课程说有些地图可以有 50、60 张票。
- 做决定会揭示新票。新票加进地图，继续走，直到目的地清晰到可以转成 spec。

### 四种票

| 票型 | 用途 | 保真度 |
| --- | --- | --- |
| grilling ticket | 一次 `grill with docs` 会话，回答一组问题 | 讨论 |
| prototype ticket | 做一个便宜、粗糙、可反应的产物 | 原型 |
| research ticket | 查第三方文档、API 或本地知识库，补一个决定等待的事实 | 事实 |
| task ticket | 做只有人才能做的手动步骤，比如注册服务、开通密钥 | 操作 |

研究票是 AFK（away from keyboard）的：票创建后立刻派给子代理，研究结果附回票上。任务票不是决策票，它只列步骤。

### 两种用法

- `wayfinder` 加一段提示词：创建新地图，并做一次 grilling 会话定目的地。
- `wayfinder` 加票号：在新会话里处理某张具体的票。

### 收尾

第 24、25 集演示了收尾：票全关之后，还要检查「not yet specified」里的迷雾。作者会在关地图前再做一次 grilling，把能决定的决定掉，把超范围的写进范围外。地图完成后用 `to-spec` 转成 spec。

## 已核验事实

本页没有独立核验的外部事实。地图、票、frontier 的行为来自课程演示和作者讲解；具体实现以 Wayfinder 技能文件为准。

## 分析

Wayfinder 把「规划」从一次长会话拆成一张可并行的图。它和 [[grilling-提问规则]] 的关系是：grilling 是每张票内部的问法，Wayfinder 是票与票之间的组织方式。

它和 [[任务拆分与上下文]] 的区别在于粒度：spec 和 ticket 处理「一次实现会话装什么」，Wayfinder 处理「几十次会话怎么排」。两者都用阻塞关系，但 Wayfinder 的票是决策票，不一定产出代码。

## 反例或边界

- 小任务不需要地图。课程第 28 集给的决策树是：小改动 one-shot，中等改动从 `grill with docs` 开始，雾太大再升级 Wayfinder。
- DAG 假设决策可以排序。如果票互相纠缠，frontier 出不来，并行会退化成串行。
- 地图需要持续更新。战争迷雾意味着新票会不断出现，没人维护的地图会误导后续会话。
- 依赖 issue tracker 的父子 issue 和 `blocked by`。工具不支持时，这套结构要另找载体。
- 地图上的票是决策，不是实现。把实现任务塞进决策票，会让会话重新变长。

## 关联页面

- [[wayfinder|Wayfinder 技能]]
- [[grilling-提问规则]]
- [[任务拆分与上下文]]
- [[保真度与原型]]
- [[技能与流程]]
- [[软件工厂]]

## 开放问题

- 一张地图多少张票算合适？课程说见过 50、60 张，但没有给上限。
- 多语境项目要不要按 bounded context 拆多张地图？
- 地图和 spec 冲突时，以哪个为准？
