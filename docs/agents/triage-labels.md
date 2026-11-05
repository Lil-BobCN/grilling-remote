# 分类标签

Matt Pocock Skills 用五种固定处理状态。本仓库直接用同名标签，不做映射。

缺标签时先创建：`gh label create <名称>`。

| 标准状态 | 当前仓库标签 | 含义 |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | 需要维护者判断怎么处理 |
| `needs-info` | `needs-info` | 等待提问者补充信息 |
| `ready-for-agent` | `ready-for-agent` | 信息完整，可以交给智能体处理 |
| `ready-for-human` | `ready-for-human` | 需要人工实现或作出决定 |
| `wontfix` | `wontfix` | 确定不处理 |

其他 Skill 提到某种处理状态时，使用上表"当前仓库标签"一列的值。
