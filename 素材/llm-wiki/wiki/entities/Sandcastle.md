---
type: entity
title: Sandcastle
tags: [Sandcastle, 沙箱, TypeScript, AFK]
related: [沙箱与自动接单, 验证与自证, 任务拆分与上下文]
sources: []
evidence_status: partial
created: 2026-11-03
updated: 2026-11-03
---
# Sandcastle

## 定义

Sandcastle 是 Matt Pocock 写的 TypeScript 库，用来在隔离沙箱里编排编码 agent。核心原语是 `sandcastle.run`，传入 agent、沙箱和提示词。

## 来源观点

S7 演示了默认四段流水线：planner 读带 `sandcastle` 标签且未阻塞的 GitHub issue，输出计划；implementer 每票一个分支；reviewer 看 diff 和项目规范；merger 合回主干并关 issue。

作者强调库本身不规定流程，模板只是他自己的习惯；可以改成 PR 分支、多个 agent 各写一版再挑。

## 待核验

- npm 包名、初始化命令、模板名均为口播听写。
- 客户直接用自然语言提需求时，如何翻译成 issue，视频没有回答。

## Related
- [[sources/matt-pocock-sandcastle]]
