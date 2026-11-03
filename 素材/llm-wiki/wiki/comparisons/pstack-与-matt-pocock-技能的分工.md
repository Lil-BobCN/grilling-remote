---
type: comparison
title: pstack 与 Matt Pocock Skills 的分工
tags: [pstack, Matt Pocock, skill, 比较]
related: [pstack, matt-pocock-skills, 技能与流程, 任务拆分与上下文]
sources: ["口播提取/pstack-让错误只犯一次.md", "口播提取/pstack 作者_每月 2500 个 PR，睡觉时 AI 还在干活.md", "口播提取/Matt Pocock 推荐_用动画讲解从 grill 到 retro 的全程工作流 p01 【中英字幕】Matt Pocock 推荐_用动.md", "口播提取/Matt Pocock v1.3 工作流：implement-spec、pr、retro.md"]
evidence_status: partial
created: 2026-11-03
updated: 2026-11-03
---
# pstack 与 Matt Pocock Skills 的分工

两套 skill 库常被拿来比较。按流程阶段拆开看，它们更多是接力，不是替代。

| 阶段 | pstack | Matt Pocock Skills |
| --- | --- | --- |
| 入口 | poteto mode 一条命令，选 playbook | 按任务挑具体 skill，如 grill、to-spec |
| 澄清 | 有 grill 类 skill，但演示里更强调执行 | grill 是核心，一次问一层决策树 |
| 拆分 | playbook 内含步骤，不强调 ticket 预算 | to-spec、to-tickets 按 15 万 token 切 |
| 执行 | implement 循环，sub agent 加 worktree | implement、implement-spec，同样用 sub agent |
| 验证 | 验证 skill 是招牌，CLI 固化确定性步骤 | 要求 before/after 证据，验证不单独成技能 |
| 评审 | 裁判、三模型、验证小队、抽样 | pr 四栏、两个新 agent 换桌子评审 |
| 复盘 | /correct 把重复错误变成规则 | retro 回读会话，改仓库和指令 |

## 怎么合

S3 里两边都说可以拼：用 Matt 的 grill-with-docs 把需求问清楚，再用 pstack 的执行 skill 跑完，中间用 spec 接上。也可以把 wayfinder 和 poteto mode 拼成自己的入口。

## 边界

两套都假设仓库有一定规范、agent 有验证能力。缺这两样，拼起来也不会自动变好。

## Related
- [[concepts/技能与流程]]
