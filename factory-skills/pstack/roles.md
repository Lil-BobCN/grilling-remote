# 角色表

结论：十个角色的 agent 和模型都填在下面。执行侧八个用 Claude Code 和 `ccs-claude-deepseek--deepseek-v4-flash[1M]`，推理档 `max`。客户本机 dsh 和 A 段的查事实子 agent 用客户自己的模型 key。技能读这份文件找模型。空格子用父会话的模型。

本表对应 `docs/工厂流程.md` 第十七节。第十七节的 10 个角色全部在下面。

## 怎么读

1. 技能里写「读 `factory-skills/pstack/roles.md` 里的某一行」。行名在第一列。
2. 找到这一行。agent 和模型两格是空的，或者写「待定」，就用父会话的模型。
3. 一行填了多个模型，表示这个角色每个模型各跑一份。现在没有第二模型，`interrogate reviewers` 只跑一份。
4. 换模型只改对应格子，技能不用动。

## 第十七节的 10 个角色

| 行名 | 角色 | 干什么 | 在哪一步 | 谁读这一行 | agent | 模型 |
| --- | --- | --- | --- | --- | --- | --- |
| — | 客户本机 dsh | 分轮问，起草场景，写确认单 | A | 这七项不读 | dsh | 客户自己的模型 key，默认 DeepSeek |
| — | 查事实子 agent | 查现有网站、同行做法、代码里的事实 | A、C1 | 这七项不读 | dsh（A）、claude-code（C1） | 客户模型（A）、flash（C1） |
| — | 主机 agent | 写四份文档，拆票，出复盘报告 | B2、C3、E3 | 这七项不读 | claude-code（`--restricted` 加 gh 白名单 hook） | flash |
| `owner` | 实现者 | 一个 PR 从做到合。一票一个会话，TDD | D2、E1 | autopilot-full | claude-code（Sandcastle 容器） | flash |
| `reviewer` | 评审者 | 标准、spec 两轴，没见过实现上下文 | D4 | autopilot-full、no-comments | claude-code（Sandcastle 容器） | flash |
| `interrogate reviewers` | 第二模型评审者 | 高风险票，换模型再看一遍。一行填几个模型，就派几个攻击者 | D4 | interrogate、blast-radius、show-me-your-work | claude-code（Sandcastle 容器） | flash |
| `swarm workers` | 验证 agent | 像真实用户点来点去，找回归，找到就报；由实现者修，原验证者复验 | D3 | swarm、autopilot-full | claude-code（Sandcastle 容器） | flash |
| `merger` | 合并者 | 票并入需求分支，解冲突 | D5 | autopilot-full | claude-code（Sandcastle 容器） | flash |
| — | 分诊 agent | 读上线后的反馈，复现，开单 | F | 这七项不读 | claude-code（Sandcastle 容器） | flash |
| — | 园丁 | 扫坏模式，写拦截规则 | E3 | 这七项不读 | claude-code（主机） | flash |

## 模型和回退

- flash = `ccs-claude-deepseek--deepseek-v4-flash[1M]`。现在只有这一个模型能用，推理档开 `CLAUDE_CODE_EFFORT_LEVEL=max`。
- Pro 是 0813 版，性能不如 Flash，不用。
- agent 或模型为空、写「待定」时，技能用父会话的模型。
- `interrogate reviewers` 现在没有更强的第二模型。它跑一份，价值来自新上下文，不来自换模型。以后有第二模型，只在这一行加一个模型，技能会自动多派一个攻击者。
- 主评审和第二模型评审是同一个模型时，评审评论记一行，写明没有第二模型。

## 客户拿走仓库时

- 凭证不在仓库里。容器要的键写在 `.sandcastle/.env`，这个文件不进 git。
- 技能来自 Matt Pocock 和 pstack。许可证在 `factory-skills/pstack/LICENSE` 和 `NOTICE.md`。

## 不在表里的

调度器是普通程序，不是 agent，所以不在表里。数量、模型、成本，定完流程再讨论。

剧本里的 root 是运行 autopilot-full 的父会话本身。它不在表里，也不单独选模型。
