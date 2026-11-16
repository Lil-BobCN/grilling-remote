# 回传样例

这是一份走完流程、可以回传的工作区样例。客户是鲜果铺，需求名 `xianguopu`。只保留 `.scratch/`，真实回传件是整个工作区。

父工单五段从回传件这样读：

| 父工单段 | 从哪读 |
| --- | --- |
| 客户原话 | `工作区/.scratch/xianguopu/问答记录.md` 的 `## 客户原话` |
| 客户确认的结论 | `工作区/.scratch/xianguopu/map.md` 的 `## Decisions so far`，取冒号后面那句，链接不抄 |
| 验收条件 | `工作区/.scratch/xianguopu/验收场景.md` 的条目 |
| 不做清单 | `工作区/.scratch/xianguopu/map.md` 的 `## Out of scope` |
| 需求全文 | 整个 `工作区/.scratch/xianguopu/` 目录 |

读出来的父工单见 `父工单.md`。决策记录 `工作区/.scratch/xianguopu/决策记录.md` 随需求目录一起存档，不进父工单五段；它是背景，不当决策来源。

客户侧全程流程、开场白原文和一次完整会话的样本见 [客户侧流程样本.md](客户侧流程样本.md)。它只作样例，规则以 `docs/客户工作区.md` 和包内 `docs/agents/issue-tracker.md` 为准。

小需求的读法：客户原话看 `需求草稿.md` 第 1 段第一条，结论看第 3 段「已经定下的」，不做清单看第 5 段。验收条件仍看 `验收场景.md`。

## 怎么核

2026-11-13 本机手工核过：

- 五个来源都能在样例里找到，条目和 `父工单.md` 一致。
- `决策记录.md` 在，开头有目录，五节对应五张票。
- `验收场景.md` 开头有「客户确认：2026-11-13」。
- `issues/` 下五张票都是 `Status: resolved`，四类票各一张以上：`grilling`、`research`、`prototype`、`task`。
- `map.md` 的「接下来」和「Not yet specified」为空，「Out of scope」有内容。
