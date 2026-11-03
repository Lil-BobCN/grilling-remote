---
type: source
title: Sandcastle：让 AI 自动接单写代码
tags: [S7, 口播, ASR]
related: [Sandcastle, 沙箱与自动接单, 验证与自证, 任务拆分与上下文]
sources: ["口播提取/Matt Pocock 开源工具_Sandcastle 让 AI 自动接单写代码.md"]
evidence_status: partial
created: 2026-11-03
updated: 2026-11-03
---
# Sandcastle：让 AI 自动接单写代码

## 来源信息

| 字段 | 内容 |
| --- | --- |
| 标题 | Sandcastle：让 AI 自动接单写代码 |
| 作者 | B 站 ChHsich |
| 平台 | bilibili |
| URL | https://www.bilibili.com/video/BV1CWgJ69EGE |
| 原始文件 | `raw/sources/口播提取/Matt Pocock 开源工具_Sandcastle 让 AI 自动接单写代码.md` |
| 提取方式 | 本地 ASR（英文） |
| 时长 | 685 秒（11:25） |
| 口播状态 | partial（本地 ASR） |
| 主张状态 | 视频观点未经独立核验 |

## 一句话摘要

Sandcastle 是 TypeScript 库：把 agent 关进沙箱，按 GitHub issue 标签接单，再跑计划、实现、评审、合并四段流水线。

## 主要论点

- AFK 的前提是沙箱，否则 agent 要么被权限请求卡住，要么在 YOLO 模式下乱动系统。
- 核心原语是 sandcastle.run：传 agent、沙箱和提示词。
- planner 读未阻塞的 issue 出计划，implementer 每票一个分支，reviewer 看 diff，merger 合回主干。
- 流程不强制，模板只是作者自己的习惯。

## 关键数字与案例

- 初始化、包名、模板名均为口播，未对 npm 页面核对。

## 待核验

- 包名与命令是听写。
- 视频没有回答客户直接提需求时怎么翻译成 issue。

## 关联页面

- [[Sandcastle]]
- [[沙箱与自动接单]]
- [[验证与自证]]
- [[任务拆分与上下文]]
