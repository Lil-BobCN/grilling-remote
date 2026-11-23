# bot 传递人工点：implement-spec 批次报告（2026-11-24）

四张票做完，合在 `bot-transport-integration`。基 `7341ddb`，代码末笔 `fbcc887`；之后只有报告和进度两个文件。票没关，`dt sync` 没跑，分支没推远端。

## 票

| 票 | 分支 | 提交 | 合入 | 测试 | 偏离和没证据 |
| --- | --- | --- | --- | --- | --- |
| I-0260 | `issue-0260` | `7dc3611` | `2b19ef9` | 文档，无单测；两份 SOUL diff 一致 | SOUL 已改正式文件，bot 没重启；MCP 清单待运营者裁定；chat 行为待运营者验 |
| I-0262 | `issue-0262` | `b4cf072` | `803c2c5` | factory 629、backend 192 | 真实 Agent 重跑留给 I-0264；作业失败写表沿用现有路径，只测了路由层退避 |
| I-0261 | `issue-0261` | `0151c29` | `f4d2730` | factory 635、backend 192、notifier 102、中台 102 | 未向真 bot 发 handoff；24 小时和同日二次提案只有单测；主 config 保持关闭 |
| I-0268 | `issue-0268` | `ccd68f3` | `e484da2` | factory 645、backend 192、notifier 102、中台 102 | 真实 Orca chat 和真拆票 Agent 留给 I-0264/I-0265；主 config 只核了 mtime/size |
| 修正 | `review-fix` | `2028179` | `fbcc887` | factory 645、backend 192、notifier 104、中台 102 | 无 |

## 最终测试

- factory：645 项通过。
- backend：192 项通过。
- notifier：104 项通过。
- 中台：102 项通过。
- 最终代码 HEAD：`fbcc887`。

## code-review

固定点 `7341ddb`，标准和票面两路审查。

修了：

- `docs/agents/bot-soul.md` 的 `SOUL` 加中文解释，正式副本同步。
- `docs/通知.md` 的术语解释、顿号和英文小标题。
- chat 标题拼法收敛到 `notifier/chat_titles.py`。
- `pipeline.mjs` 认证失败、`ignition.mjs` 点火失败的「出事」事件补父工单 `owner/repo/ticket`。
- `test_orca_bot.py` 补同一父工单两种 chat 标题的用例。
- I-0268 的记录和输出提交进分支（`3994f32`）。

没改：

- `notifier/__main__.py` 六张通道表沿用现有写法。
- `docs/工单模型.md` 的驳回旧说法留给 I-0267。
- `--chat new` 按标题回找 chat 留给 I-0263。
- 部署完成事件拿不到父工单号，会落 Home Chat。

## 需要运营者

1. 重启 Orca bot 和调度器，才能加载新代码和新 SOUL；本批没动主进程。
2. 拍板 bot 的 MCP：cloudflare、composio 是否删除。删之前先轮换或确认不用。
3. 主 notifier config 的 `orca_bot` 保持关闭，等 I-0263–I-0265 模拟通过再开。
4. 用 `Lil-BobCN/scratch-bot-sim` 跑 I-0263–I-0265；I-0266、I-0267 等模拟通过后再做。
5. 票未关；按流程关票。

## scratch 环境

- 仓：https://github.com/Lil-BobCN/scratch-bot-sim （私有，保留）
- 假父工单：#92、#93、#94；地图 #95/#97/#99；假 spec #101/#102/#103；点火子票 #104。
- 起：`cd "/Users/Admin/orca/workspaces/grilling 远程/issue-0268" && node factory/test/sim/run-sim.mjs`
- 停：同一行加 `--cleanup`，删假 issue 和 `.state/`，保留仓。
- 重跑会重置 issue，编号会变；记录里的链接以当前这次为准。
