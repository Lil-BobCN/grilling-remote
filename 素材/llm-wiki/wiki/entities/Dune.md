---
type: entity
title: Dune
tags: [Dune, 框架, GrokBot, Electron, 架构]
related: [环境与约束, GrokBot, pstack, 信任阶梯]
sources: ["口播提取/一个月上线2000个PR-Lauren的AI团队工作流.md"]
evidence_status: partial
created: 2026-11-03
updated: 2026-11-03
---

# Dune

## 定义

Dune 是 GrokBot 背后的架构和客户端框架，定位是「面向 agent 的框架」。它不是开源项目，Lauren 在分享里用它举例，说明怎样把团队经验写进代码库。

## 设计取舍

核心原则是让最容易走的路恰好是正确的路。对人类来说，这套框架限制很死，写起来会烦；对 agent 来说，它把常见错误变成了结构上做不到的事。

具体做法包括：功能代码放在同一个目录，React 部分有入口，会话卡片、虚拟机宿主端和客户端之间划严格边界。应该跑在 Electron 主进程的逻辑，不允许跑到渲染线程。Dune 用 import 依赖图强制这些边界。

渲染线程有帧预算：60 帧不超 16 毫秒，120 帧不超 8 毫秒。这条约束来自 Cursor agent window 的性能教训。

Dune 还禁止代码注释。原因是 agent 会把注释当成借口，解释为什么不解决真正的问题。

## 与 pstack 的关系

Dune 管代码库长什么样，pstack 管任务怎么跑。前者是环境，后者是流程。两者都服务于同一个目标：让 agent 默认做对。

## 待核验

- 拼写与产品状态只有口播来源，没有官方文档。
- 「五层约束」与 Dune 的边界有重叠，具体分层需看原始幻灯片。

## 关联页面

- [[环境与约束]]
- [[GrokBot]]
- [[pstack]]
- [[信任阶梯]]
