# bot 传递人工点：implement-spec 进度（2026-11-24）

集成分支：`bot-transport-integration`，基 `7341ddb`，代码末笔 `fbcc887`；之后是报告和进度提交。
本批只做 I-0260、I-0261、I-0262、I-0268；I-0263–I-0267 不在本批。

## 工作区

| 票 | 工作区 | 分支 | GitHub 镜像 |
| --- | --- | --- | --- |
| I-0260 | `/Users/Admin/orca/workspaces/grilling 远程/issue-0260` | `issue-0260` | #618 |
| I-0261 | `.../issue-0261` | `issue-0261` | #619 |
| I-0262 | `.../issue-0262` | `issue-0262` | #620 |
| I-0268 | `.../issue-0268` | `issue-0268` | #626 |

## 计划

| 步 | 内容 | 状态 |
| --- | --- | --- |
| 1 | 四个实现 agent 在各自工作区按 tdd 做票 | 完成 |
| 2 | 逐张合进 `bot-transport-integration`，每次合完跑相关测试 | 完成 |
| 3 | 集成分支跑 code-review，问题交给一个实现 agent 修 | 完成 |
| 4 | 写批次报告；不关票、不跑 `dt sync` | 完成 |

## code-review 处理

审查固定点 `7341ddb`，两个并行子代理。

现在修：

- `docs/agents/bot-soul.md` 的 `SOUL` 首次出现加中文解释，同步正式 SOUL。
- `docs/通知.md` 的术语解释、顿号和英文小标题。
- chat 标题拼法收敛到 `notifier/chat_titles.py`。
- `pipeline.mjs` 认证失败、`ignition.mjs` 点火失败的「出事」事件补 `owner/repo/ticket` 父工单身份。
- `test_orca_bot.py` 补同一父工单两种 chat 标题的用例。

接受或留到别的票：

- `notifier/__main__.py` 六张通道表：沿用现有写法，不在这批重构。
- `docs/工单模型.md` 驳回旧说法：留给 I-0267 模拟通过后改。
- `--chat new` 不传标题、按标题回找 chat：spec 已列为未验证能力，留给 I-0263。
- 拆票 Agent 真跑出提案：留给 I-0264。
- 部署完成事件没有父工单身份：`deploy.mjs` 层面拿不到父工单号，按规则落 Home Chat；留给运营者知道。
- `docs/通知.md` 提前更新：这份是 notifier 模块自己的事件表，模板措辞必须和它一致；其余文档留 I-0267。

## 票状态

| 票 | 分支提交 | 合入提交 | 测试 | 备注 |
| --- | --- | --- | --- | --- |
| I-0260 | `7dc3611` | `2b19ef9` | 文档，无单测；两份 SOUL diff 一致 | MCP 待运营者裁定；chat 验收待运营者 |
| I-0262 | `b4cf072` | `803c2c5` | factory 629、backend 192 全绿 | 真实 Agent 重跑证据留给 I-0264 |
| I-0261 | `0151c29` | `f4d2730` | factory 635、backend 192、notifier 102、中台 102 全绿 | 未向真 bot 发 handoff；部署事件身份缺失会进 Home Chat |
| I-0268 | `ccd68f3` | `e484da2` | factory 645、backend 192、notifier 102、中台 102 全绿 | scratch 仓 `Lil-BobCN/scratch-bot-sim` 保留；真 chat 留给 I-0265 |
| 修正 | `2028179` | `fbcc887` | factory 645、backend 192、notifier 104、中台 102 全绿 | code-review 修正 |

## 边界

- 不重启、不停主 launchd 调度器；不碰主作业表、主锁目录。
- 不读不改 `~/.grilling/notifier/config.json`；主 config 的 `orca_bot` 保持关闭。
- 不碰 demo、生产、已交付客户；scratch 仓建或删先报运营者。
- 不改 Orca 管的 `bot.json`、`AGENTS.md`、`CLAUDE.md`、`MEMORY.md`。
- 不启动 I-0263–I-0267 的模拟或文档修改。

## 备注

- 旧 SOUL 备份：`.inbox/plans/bot-soul-before-2026-11-24.md`，不覆盖。
- I-0268 的 scratch 仓已由运营者确认：私有仓 `Lil-BobCN/scratch-bot-sim`，保留。
