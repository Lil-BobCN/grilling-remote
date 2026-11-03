---
type: source
title: pstack：让错误只犯一次（动画拆解）
tags: [S1, 口播, ASR]
related: [pstack, 修正阶梯与-correct, 环境与约束, 评审与验收, 信任阶梯]
sources: ["口播提取/pstack-让错误只犯一次.md"]
evidence_status: partial
created: 2026-11-03
updated: 2026-11-03
---
# pstack：让错误只犯一次（动画拆解）

## 来源信息

| 字段 | 内容 |
| --- | --- |
| 标题 | pstack：让错误只犯一次（动画拆解） |
| 作者 | Kevin Araujo，B 站 ChHsich |
| 平台 | bilibili |
| URL | https://www.bilibili.com/video/BV1nVpy6QEMx |
| 原始文件 | `raw/sources/口播提取/pstack-让错误只犯一次.md` |
| 提取方式 | 本地 ASR（英文原声，中文稿为译写） |
| 时长 | 578 秒（9:38） |
| 口播状态 | partial（本地 ASR） |
| 主张状态 | 视频观点未经独立核验 |

## 一句话摘要

一个购物车 bug 被临时方案盖住，一个月扩散到 40 个文件。Lauren Tan 的 /correct 把同一类错误第二次出现当作模式，从架构、类型、lint、测试往下修，最后才靠人审。

## 主要论点

- agent 只看自己打开过的文件，照抄最近的例子，走能编译的最短路径。
- 修正阶梯：架构高于类型，类型高于 lint，lint 高于测试，人审垫底（NGMI）。
- pstack 是 Cursor 免费插件，50 个 skill、23 本 playbook，入口是 poteto mode。
- /correct 读提交、回滚和评审意见，错两次算模式，新检查必须能在历史错误上亮红灯。

## 关键数字与案例

- 8 月约 2,500 个 PR，平均一天 80 个（自述）。
- 临时方案扩散到 40 个文件（动画示意，不是真实 run）。
- 154 个植入缺陷，删指令前抓到 142 个，删后 139 个（自述）。
- 9 月删掉 34 条指令（自述）。

## 待核验

- 购物车案例是动画示意。
- Lauren 的团队归属在本片写作 SpaceX AI，另片写作 Cursor。
- 所有数字均为讲者自述。

## 关联页面

- [[pstack]]
- [[修正阶梯与-correct]]
- [[环境与约束]]
- [[评审与验收]]
- [[信任阶梯]]

## Related
- [[sources/pstack-作者-每月2500个PR]]
