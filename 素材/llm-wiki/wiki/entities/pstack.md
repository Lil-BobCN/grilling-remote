---
type: entity
title: pstack
tags: [pstack, poteto, skill, Lauren Tan]
related: [修正阶梯与-correct, 技能与流程, 信任阶梯, GrokBot]
sources: []
evidence_status: partial
created: 2026-11-03
updated: 2026-11-03
---
# pstack

## 定义

pstack 是 Lauren Tan（网名 poteto）公开的一套 agent skills，作为 Cursor 插件分发。它把常见任务分成 playbook（任务剧本），入口是 poteto mode：输入一条命令加任务描述，由它挑剧本并调用底层 skill。

## 来源观点

S1 说它内置 50 个 skill、23 本 playbook，其中大约一半是单条规则，比如「先删再加」「两次修复都失败就质疑共同假设」。

S3 里 Lauren 说，pstack 最早来自她 2026 年初的副业项目和一批个人 skill；加入 Cursor 后，这批经验在 agent window 和 GrokBot 上重新用上。

## 与修正阶梯的关系

pstack 的 /correct 负责把重复错误变成规则，fix-root-causes 要求追到根因。见 [[修正阶梯与-correct]]。

## 待核验

- 仓库地址：B 站简介写作 `github.com/cursor/plugins/tree/main/pstack`。
- skill 数量、playbook 数量都是口播自述。
