# I-0264 模拟记录：补缺口和拆票两条人工点

- 票：GitHub #622 / 中台 I-0264，父地图 GitHub #551 / 中台 I-0208。
- 日期：2026-11-24。时区：北京时间（UTC+8）。
- 分支：`Lil-BobCN/622`，基线 `origin/Lil-BobCN/drill4-repair-plan` `5ca75d7`，含 I-0269。
- 一句话：四条路径都跑通；bot 在 chat 里讲和写回，调度器转状态；发现 6 个问题或偏差，根因分析另开一个会话做，结果统一汇报；运营者已确认模拟通过。

## 一、换了什么环境

| 项 | 值 |
| --- | --- |
| scratch 仓 | `Lil-BobCN/scratch-bot-sim`（私有，不动 demo、生产、中台、已交付客户） |
| 补缺口确认 | 父工单 #92，地图 #95，决定票 #96 |
| 补缺口驳回 | 父工单 #105，地图 #106，决定票 #107；这张是为测驳回新造的夹具 |
| 拆票 | 父工单 #93，地图 #97，假 spec #102 |
| bot | 莹宝（AFK），id `b3258c07-6bf2-4df0-a8e7-b4d1334e8009` |
| 发件 bot | 工厂通知，id `400bfe9e-1663-4419-95e8-de3468335454` |
| 临时状态目录 | `factory/test/sim/.state/`，下面有 `customers.json`、`jobs.json`、`locks/`、`runs.jsonl`、`notifier/`、`inbox/`、`repos/` |
| 临时 NOTIFIER_HOME | `factory/test/sim/.state/notifier/`，配置里只开 `orca_bot`，邮件和推送关 |

chat：

| 路径 | chat id | 标题 |
| --- | --- | --- |
| #92 补缺口 | `3ee2d30c-5d14-4b25-ac35-def729852b0e` | `your owner's agent: 补缺口 Lil-BobCN/scratch-bot-sim#92` |
| #105 补缺口 | `99e9f7a2-6b6f-47ca-b397-06ef15a7684c` | `your owner's agent: 补缺口 Lil-BobCN/scratch-bot-sim#105` |
| #93 拆票 | `9c792526-df46-4fa8-9aa3-dda66b7c9c82` | `your owner's agent: 拆票 Lil-BobCN/scratch-bot-sim#93` |

## 二、演练怎么驱动

调度器判断和发通知用的是生产代码。驱动脚本 `.state/drill/round.mjs` 直接调用 `factory/bin/scheduler.mjs` 的 `run()`，和 `scheduler.mjs --once` 同一入口。一次跑一轮，由我在 bot 的关口评论出现后触发。没有跑常驻 `--loop`。

按票面注入：

- 补缺口 Agent 和拆票 Agent：真实现，真 `claude` 子进程。
- to-spec、点火、流水线：假实现，只记录调用。
- 通知：真 notifier，真 `orca orchestration send`。

我手动做的：

- 建 #105 和它的回传件；重置过 #94；清过 #104 残留的 `Sandcastle` 标签。
- 写演练驱动、临时 notifier 配置和两个等待脚本。这些都在 `.state/drill/`，被 gitignore，不属于产品代码。
- 在每一步之间触发下一轮调度。

我没做的：

- 没手写任何 GitHub 评论。`点头：补缺口`、`驳回：补缺口`、`驳回：拆票`、`点头：拆票` 都是 bot 在 chat 里等运营者确认后自己写的。
- 没手动改 #92 和 #93 的状态标签；`排队中`、`开发中` 是调度器算的。
- 没碰主 launchd 调度器、主作业表、主锁目录、主 notifier config。

## 三、四条路径

### 路径 1：补缺口确认（#92）

| 时间 | 谁 | 动作 | 证据 |
| --- | --- | --- | --- |
| 11:30:46 | 调度器 | 读到 `提案：补缺口`，发 `补缺口提案` 通知 | chat `3ee2d30c…`，notifier 日志 `ok: true` |
| 11:30 后 | bot | 复述两题：小程序用哪家云、配送范围怎么定；列推荐和出处 | chat |
| 11:32:51 | bot | 运营者确认后写 `点头：补缺口` | [评论 7121199287](https://github.com/Lil-BobCN/scratch-bot-sim/issues/92#issuecomment-7121199287) |
| 11:32:59 | bot | 报告写回结果 | 命令 `node factory/bin/gap.mjs point --owner Lil-BobCN --repo scratch-bot-sim --number 92 --answers '[...]'`，退出码 0，返回 `{"posted":true,"parent":92}` |
| 11:33:34 | 调度器 | 已提交 → 排队中，写进度评论 | 第 B 轮，`decision=advance` |

最终答案：第 1 题微信云开发；第 2 题全城配送。第 2 题是运营者在 chat 里改的口径，不是提案原推荐。

验收对上了：从提案走到 `点头：补缺口`，调度器状态变成 `排队中`。

### 路径 2：补缺口驳回（#105）

#92 被直接确认，补缺口驳回改用新夹具 #105。做法是把 #92 的回传件复制一份，需求名改 `yuyue-kafei-b`，父工单正文换成 #105。这是对 I-0268 夹具的扩展。

| 时间 | 谁 | 动作 | 证据 |
| --- | --- | --- | --- |
| 11:36:19 | 调度器 | 第一轮没看到 #105，GitHub 新 issue 列表延迟 | 第 D 轮输出没有 #105 |
| 11:38:25 | 补缺口 Agent | 真跑，建地图 #106、决定票 #107，写 `提案：补缺口` | [评论 7121284204](https://github.com/Lil-BobCN/scratch-bot-sim/issues/105#issuecomment-7121284204) |
| 11:39:07 | 调度器 | 发 `补缺口提案` 通知 | chat `99e9f7a2…`，notifier `ok: true` |
| 11:46:43 | bot | 运营者确认后写 `驳回：补缺口 ...` | [评论 7121411360](https://github.com/Lil-BobCN/scratch-bot-sim/issues/105#issuecomment-7121411360) |
| 11:46:49 | bot | 报告写回结果 | 命令 `gh issue comment 105 --repo Lil-BobCN/scratch-bot-sim --body '驳回：补缺口 ...'`，退出码 0 |
| 11:53:04 | 补缺口 Agent | 按驳回重跑，更新 #106 和 #107，写新 `提案：补缺口` | [评论 7121509841](https://github.com/Lil-BobCN/scratch-bot-sim/issues/105#issuecomment-7121509841) |
| 11:53:47 | 调度器 | 第 F 轮：`runGapProposal` 真跑，返回 `ok:true, code:0` | drill.log |
| 11:54:09 | 调度器 | 发新提案通知 | notifier `ok: true` |
| 11:54 后 | bot | 读新提案，再讲一遍 | chat `lastSaid`：两题都在，推荐已换成腾讯云开发、全城 |

新提案内容：技术题推荐腾讯云开发；业务题推荐全城。`apply-map` 返回地图 #106、决定票 #107，`created:false`。地图和决定票各一套。

夹具偏差：#105 正文的 `- 地图：` 是从 #92 复制来的，仍指 #95。bot 自己发现并拒绝点头；`apply-map` 只在没有这行时补，不替换旧行。这是夹具造成的，但它暴露了真实边界，见第六节第 4 条。

### 路径 3 和 4：拆票（先驳回，再确认，#93）

先把两条路径合并成一条时序：第一份提案被驳回，重跑出新提案，运营者再点头。

| 时间 | 谁 | 动作 | 证据 |
| --- | --- | --- | --- |
| 11:55:59 | 拆票 Agent | 真跑，写 `提案：拆票`，共 1 张票 | [评论 7121553469](https://github.com/Lil-BobCN/scratch-bot-sim/issues/93#issuecomment-7121553469) |
| 11:56:09 | 调度器 | 第 H 轮：`runDecompose` 真跑，`ok:true, code:0, ticketCount:1` | drill.log |
| 11:56:32 | 调度器 | 发 `拆票提案` 通知 | chat `9c792526…` |
| 12:01:47 | bot | 运营者确认后写 `驳回：拆票` | [评论 7121640372](https://github.com/Lil-BobCN/scratch-bot-sim/issues/93#issuecomment-7121640372) |
| 12:01:51 | bot | 报告写回结果 | 命令 `gh issue comment 93 --repo Lil-BobCN/scratch-bot-sim --body-file reject-split-93.md`，退出码 0 |
| 12:03:14 | 拆票 Agent | 按驳回重跑，写新 `提案：拆票`，共 2 张票 | [评论 7121663214](https://github.com/Lil-BobCN/scratch-bot-sim/issues/93#issuecomment-7121663214) |
| 12:03:25 | 调度器 | 第 J 轮：`runDecompose` 真跑，`ok:true, code:0, ticketCount:2` | drill.log |
| 12:03:43 | 调度器 | 发新提案通知 | notifier `ok: true` |
| 12:06:30 | bot | 运营者确认后建票 | 命令 `node factory/bin/tickets.mjs create --owner Lil-BobCN --repo scratch-bot-sim --parent 93 --from-proposal --point`，退出码 0 |
| 12:06:40 | bot | 写 `点头：拆票`，建了 2 张子票 | [评论 7121715889](https://github.com/Lil-BobCN/scratch-bot-sim/issues/93#issuecomment-7121715889) |
| 12:06:40 | GitHub | 子票 #108 店员拍照提交报修单、#109 师傅在列表里看到新报修单，都 `状态:排队中` | #93 的 `sub_issues_summary.total=2` |
| 12:07:10 | 调度器 | 第 L 轮点火没发：`repoBusy` 为真，因为旧的 #104 还挂着 `Sandcastle` | 第 L 轮 `decision=wait`，无 ignite |
| 12:08:09 | 调度器 | 清掉 #104 的 `Sandcastle` 后重跑，转 `开发中`，假点火第一张票 #108 | 第 L2 轮 `decision=develop`，`fake.igniteCalls=[{parent:93,ticket:108,action:'ignite'}]` |

验收对上了：

- 拆票路径从提案走到建票和 `点头：拆票`，调度器状态变成 `开发中`，假 ignite 记录到 #108。
- 拆票驳回后出新提案，子票没有重复：重跑时子票为 0，最终建出 #108、#109 两张，没有第三张。
- 补缺口驳回后出新提案，地图和决定票只有一套。

## 四、调度器轮次

| 时间 | 轮 | 真实动作 | 结果 |
| --- | --- | --- | --- |
| 11:30:46 | A | 无，全假 | 发 #92 补缺口提案通知 |
| 11:33:34 | B | 无 | #92 已提交 → 排队中 |
| 11:35:38 | C | 补缺口 Agent，#94 | 幂等重跑，没有新提案 |
| 11:36:19 | D | 无，全假 | #105 还没进快照 |
| 11:38:51 | D2 | 补缺口 Agent，#105 | 建 #106、#107，写提案 |
| 11:39:07 | E | 无 | 发 #105 补缺口提案通知 |
| 11:53:47 | F | 补缺口 Agent，#105 | 驳回后重跑，出新提案 |
| 11:54:09 | G | 无 | 发 #105 新提案通知 |
| 11:56:09 | H | 拆票 Agent，#93 | 第一份拆票提案，1 张票 |
| 11:56:32 | I | 无 | 发 #93 拆票提案通知 |
| 12:03:25 | J | 拆票 Agent，#93 | 驳回后重跑，新提案 2 张票 |
| 12:03:43 | K | 无 | 发 #93 新提案通知 |
| 12:07:10 | L | 无 | 点火被 #104 残留挡住 |
| 12:08:09 | L2 | 无 | #93 → 开发中，假点火 #108 |

## 五、隔离证据

| 项 | 结果 |
| --- | --- |
| 临时 customers、作业表、锁、调度日志、NOTIFIER_HOME | 全在 `factory/test/sim/.state/` |
| 主 launchd 调度器 | 没调用，没重装；测试调度器只跑 `--once` |
| 主 notifier config `~/.grilling/notifier/config.json` | mtime `1794812304809`、size `347`，和 I-0268 基线一致；没读内容，没改 |
| 主锁目录 `~/.grilling/factory/locks` | mtime `1795460626357`，和 I-0268 基线一致 |
| 主作业表 `~/.afkfactory/jobs.json` | mtime 变了。生产调度器还在跑，它自己会写；本轮只写临时作业表 |
| 主调度日志 `~/.afkfactory/scheduler/runs.jsonl` | 本轮没写；变化来自生产调度器 |
| 真实 to-spec、Sandcastle、部署 | 没跑。点火是假实现，只记录调用 |
| demo、生产、中台、已交付客户 | 没碰；只动 scratch 仓 |

## 六、发现和偏差

1. **bot 回发件 bot 失败**：每次 handoff 后 bot 尝试回给「工厂通知」，报 `terminal_not_found: ... has no live pane or durable Run/Dispatch mailbox`，退出码 1。chat 里的对话和写回不受影响。这是通知回程的契约缺口，需要先定发件 bot 要不要有信箱，还是通知只做单向。
2. **I-0268 的测试 notifier 配置生成器没跟上 I-0269**：`factory/test/sim/seed.mjs` 的 `writeSimNotifierConfig` 还写 `bot: "afk"`，缺 I-0269 要求的 `sender`。直接跑 `run-sim.mjs` 会在加载配置时失败。这次我在 `.state/notifier/config.json` 另写了一份正确配置。这个夹具缺口挡 I-0265，应该先修。
3. **门禁只看决定票关没关，不看结论写没写**：`gateReady` 判断 `Not yet specified` 为空、决定票全部关闭。#92 的 `点头` 最终答案写「全城配送」，地图 #95 和决定票 #96 没有对应结论，门禁照样通过。要判定是补规则，还是归运营者责任。
4. **`apply-map` 不替换已有的地图链接**：#105 正文沿用 #92 的 `- 地图：...#95`，新地图 #106 建出来后，旧链接还在，bot 拒绝点头。这次是复制夹具造成的；真实的重传或复制场景能不能触发，要先确认。
5. **GitHub 新 issue 列表延迟**：#105 建好后第一轮调度没看到，等了一会儿才进快照。常驻 `--loop` 下一轮会补；单轮 `--once` 演练会漏，记录里写清。
6. **bot 误报票单错字**：#93 新提案的票单藏在 base64 marker 里，bot 第一次解码报了两处错字，后来自己更正，说解码看错了。没有影响建票，但会误导运营者。

另外两点小的：

- bot 写的 `驳回：拆票` 第一行只有关口，理由在下面几行。调度器按整条正文读，工作正常；和票面写的 `驳回：拆票 <理由>` 一行格式不完全一致。
- 第 L 轮点火被 #104 残留的 `Sandcastle` 标签挡住。这是 I-0268 假点火留下的夹具状态，不是产品问题；清掉后同一轮逻辑转 `开发中` 并点火。

## 七、没覆盖的

- I-0265 的四类边界：重复叫醒、两个父工单并发、Orca 重启、bot 离线兜底。
- 常驻 `--loop` 自动发现驳回。这次是 `--once`，由我在关口评论出现后触发。
- 真实点火、真实 to-spec、真实 Sandcastle、部署。
- 主 notifier config 打开 `orca_bot` 后的行为。
- 24 小时提醒再叫醒 bot 的路径。

## 八、复现

- 驱动脚本：`factory/test/sim/.state/drill/round.mjs`。用 `--real-gap --only <号>` 或 `--real-decompose --only <号>` 选真动作，其它父工单走假动作。
- 等待脚本：`.state/drill/watch.py`，按父工单号等 `点头：` 或 `驳回：` 评论。
- 夹具脚本：`.state/drill/create-gap2.py`，建 #105 和回传件。只在 scratch 仓用。
- 环境：先 `set -a; . ~/.afkfactory/env; set +a`，再跑驱动；临时路径都在 `.state/`。
- 注意：`run-sim.mjs` 现在会被第 2 条发现卡住，不能直接整轮重播。

## 九、验收对照

| 验收条件 | 结果 | 证据 |
| --- | --- | --- |
| 补缺口路径从提案走到 `点头：补缺口`，调度器状态变成 `排队中` | 通过 | #92 评论 7121199287；第 B 轮 `advance` |
| 补缺口驳回后出新提案，地图和决定票只有一套 | 通过 | #105 驳回 7121411360；新提案 7121509841；#106/#107 `created:false` |
| 拆票路径从提案走到建票和 `点头：拆票`，状态变成 `开发中`，假 ignite 记录到第一张票 | 通过 | #93 点头 7121715889；子票 #108、#109；第 L2 轮 `fake.igniteCalls` 记 #108 |
| 拆票驳回后出新提案，子票没有重复 | 通过 | 新提案 7121663214；重跑时子票 0；最终 2 张，没有第三张 |
| 每次写回前 bot 复述并等确认，没有未经确认的评论 | 通过 | bot 会话里四个写回点都有 Needs you 项和运营者确认；四条关口评论都在确认之后写 |
| 主 launchd 调度器、主 notifier config、主作业表、主锁目录没被碰；没有真实 to-spec、Sandcastle、部署 | 通过，主作业表 mtime 变化来自生产调度器 | 第五节 |
| 全程用临时 `NOTIFIER_HOME` 和测试 `config.json`，主 config 没读没改 | 通过 | 第五节 |
| 记录文件有完整证据，运营者确认模拟通过 | 通过 | 本文件；运营者 2026-11-24 在会话里确认 |

## 十、运营者确认

2026-11-24，运营者在会话里确认这次模拟通过。关 I-0264 按数据票流程走；GitHub #622 的镜像等运营者触发同步。

发现的问题不在本票里修。另起一个会话做根因分析，结果统一汇报。

---

# I-0265 边界演练（2026-11-25）

票：GitHub #623 / 中台 I-0265。父地图 GitHub #551 / 中台 I-0208。
日期：2026-11-25（北京时间）。工作区：`/Users/Admin/orca/workspaces/grilling 远程/623`。
环境：I-0268 的 scratch 仓 `Lil-BobCN/scratch-bot-sim`；临时状态在 `factory/test/sim/.state/`。
分支：main 合入 `drill4-repair` 的 I-0269–I-0272；只在本票 worktree，未推远端。
bot：莹宝（AFK）。发件 bot：工厂通知。
SOUL：从 `docs/agents/bot-soul.md` 同步到 `~/.orca/bots/afk/SOUL.md`，旧版备份 `.state/drill/SOUL-before-i0265.md`。

## 一、夹具

| 用途 | 父工单 | 需求名 | 地图 | 提案评论 |
| --- | --- | --- | --- | --- |
| 并发补缺口 | #110 咖啡店预约取货（边界并发） | `yuyue-kafei-boundary` | #111 | 7138150635 |
| 并发拆票 | #113 门店报修工单（边界并发） | `baoxiu-gongdan-boundary` | #114 | 7138105821 |
| 重启 | #119 咖啡店预约取货（重启演练） | `yuyue-kafei-restart` | #120 | 7138493489 |
| 重启后实际写回 | #122 咖啡店预约取货（兜底演练） | `yuyue-kafei-fallback` | #123 | 7138501843 |
| 兜底 | #125 咖啡店预约取货（兜底演练二） | `yuyue-kafei-fallback2` | #126 | 7138771459 |

#119、#122、#125 是新增夹具。I-0268/I-0264 的旧 issue #92–#109 保留，没有重置 scratch 仓。

## 二、两个父工单并发

两个提案同时存在。通知分别进两个 chat：

| 父工单 | chat id | chat 标题 |
| --- | --- | --- |
| #110 | `04cc45b6-26e3-44a1-86e1-45752273bb0b` | `your owner's agent: 补缺口 Lil-BobCN/scratch-bot-sim#110` |
| #113 | `4c07b714-03d8-4891-a9d9-43f61e706c78` | `your owner's agent: 拆票 Lil-BobCN/scratch-bot-sim#113` |

运营者在两个 chat 分别确认。bot 写回：

- #110 写 `点头：补缺口`，评论 [7138329697](https://github.com/Lil-BobCN/scratch-bot-sim/issues/110#issuecomment-7138329697)，命令 `node factory/bin/gap.mjs point`，退出码 0，返回 `{"posted":true,"parent":110}`。
- #113 写 `点头：拆票`，评论 [7138239345](https://github.com/Lil-BobCN/scratch-bot-sim/issues/113#issuecomment-7138239345)，建子票 #117、#118。

核对：#110 没有拆票评论，#113 没有 #110 的答案。两条写回各进自己的父工单，消息没有串。

## 三、重复叫醒

同一事件用独立 `NOTIFIER_HOME`（`.state/notifier-dup/`）走真 notifier 通道再发一次，避开 notifier 的去重键。

- 再发 #110 的 `补缺口提案`。bot 回：「重复叫醒，这单已经点过头，我没有重复写。现有评论：`提案：补缺口`（7138150635）→ `点头：补缺口`（7138329697，上一轮已写）。#110 当前：`状态:排队中`……」
- 再发 #113 的 `拆票提案`。bot 回：「重复叫醒（同一提案 7138105821）。#113 已处理完：最新评论是 `点头：拆票`（7138239345），子票 #117、#118 已建。不再写回，无需你操作。」

结果：#110 评论数不变，没有第二条 `点头`；#113 评论数不变，子票仍 2 张，没有第二套。

## 四、Orca 重启

1. 重启前 #119 有提案 7138493489，没有 `点头`；#122 有提案 7138501843，没有 `点头`。两个 chat 都已收到提案通知。
2. 运营者退出 Orca 并重开。终端里的代理会话中断，按 `.inbox/plans/i0265-checkpoint.md` 恢复。
3. 重启后 bot 在 #119 chat 复述提案：引用评论 7138493489，说明地图 #120 的 `Not yet specified` 为空、决定票全关，没有 `点头`。回复见 chat `45b48404-02d8-4805-8e6e-75ff2453ad64` 的 `lastSaid`。
4. 运营者实际在 #122 chat 完成确认。bot 写 `点头：补缺口`，评论 [7138700933](https://github.com/Lil-BobCN/scratch-bot-sim/issues/122#issuecomment-7138700933)，命令 `gap.mjs point`，退出码 0，返回 `{"posted":true,"parent":122}`。写回发生在重启后，bot 从 GitHub 读到提案和已有评论。
5. 再把同一 `补缺口提案` 事件发到 #122 chat。bot 回：「重复叫醒（同一提案 7138501843），这单已经点过头，我没有重复写。现有评论：`提案：补缺口`（7138501843）→ `点头：补缺口`（7138700933，上一轮已写）。`点头` 内容：1 小程序部署到哪家云 → 用默认技术栈，部署到我们管理的香港服务器……」。没有新增评论。

偏差：#119 是重启夹具，运营者实际在 #122 写回。#119 保留为「重启后能复述当前提案和已有评论」的证据，#122 提供「重启后继续写回并拒绝重复写」的证据。两项分开记，两单没有串。

另外，本轮 bot 会话没有出现 `terminal_not_found`。用 `orca search` 查 2026-11-24T16:40Z 以后的会话，结果为 0。I-0275 的单向回程规则生效。

## 五、bot 离线兜底

用 `.state/notifier-fallback/config.json`：邮件和推送保持主 config 的开关和地址，`orca_bot.command` 指向 `.state/drill/orca-fail`，必失败。

发 #125 的 `补缺口提案` 事件，notifier 结果：

| 通道 | 结果 | 耗时 |
| --- | --- | --- |
| push | ok | 331ms |
| email | ok | 595ms |
| orca_bot | 失败 | 752ms，`ChannelError: orca bot chats 失败：模拟：orca orchestration send 不可用` |

退出码 1。运营者确认企业微信和邮件都收到。Orca 里没有出现 #125 的 bot chat，bot 没有被叫醒。

运营者在终端用控制台写回：

1. 直接跑 `node factory/bin/console.mjs answer --kind gap --owner Lil-BobCN --repo scratch-bot-sim --ticket 125 --answer '[...]'`，报错：`GitHub GET /repos/Lil-BobCN/scratch-bot-sim/issues/125 返回 404`。
2. 原因：控制台的 `githubToken()` 从 `~/.afkfactory/env` 读到了 token，只用于自己的 GitHub 客户端；启动 `gap.mjs` 时没有把 token 传给子进程。空 token 访问私有仓，GitHub 返回 404。已开新票 I-0276。
3. 在同一 shell 先 `set -a; . ~/.afkfactory/env; set +a` 再跑同一条命令，返回 `{"posted":true,"parent":125}`，写 `点头：补缺口`，评论 [7138871203](https://github.com/Lil-BobCN/scratch-bot-sim/issues/125#issuecomment-7138871203)。
4. 调度器下一轮把 #125 从 `状态:已提交` 转 `状态:排队中`，bot 没有被叫醒，工厂照常推进。

## 六、隔离

| 项 | 结果 |
| --- | --- |
| 主 launchd 调度器 | 没调用，没重启；测试调度器只跑 `--once` |
| 主 notifier config | mtime `1794812304809`、size `347`，跑前跑后一致；没写。兜底临时 config 从主 config 复制通道参数 |
| 主锁目录 `~/.grilling/factory/locks` | mtime `1795460626357`，跑前跑后一致 |
| 主作业表 `~/.afkfactory/jobs.json` | mtime `1795538484341` → `1795540475518`，size `3903`。生产调度器 `scheduler.mjs --loop` 在跑（PID 75333），模拟只写 `.state/jobs.json` |
| 主调度日志 `~/.afkfactory/scheduler/runs.jsonl` | mtime `1795496709122`，没变 |
| 真实 to-spec、Sandcastle、部署 | 没跑 |
| demo、生产、已交付客户 | 没碰 |
| bot SOUL | 同步到 `~/.orca/bots/afk/SOUL.md`，备份 `.state/drill/SOUL-before-i0265.md`；这是 I-0275 的验收要求 |

## 七、发现和偏差

1. **console answer 子进程缺 token**：默认 shell 不导出 `GITHUB_TOKEN` 时，控制台自己的 `list` 能看，`answer` 写不回，私有仓返回 404。导出 token 后才能写。新票 I-0276；按运营者要求在本票本地分支当场修复，commit `28989f6`，factory 652 项测试全过，和 I-0265 一起关。
2. **chat 语义**：两个父工单是一个走补缺口、一个走拆票，各自一个 chat；不是每张父工单同时有补缺口和拆票两个 chat。按实际路径记。
3. **重启夹具和实际操作不在同一张单**：#119 提供重启后复述提案的证据，#122 提供确认写回和重复拒绝的证据。原因是运营者在 #122 完成确认；不影响「重启后从 GitHub 恢复」的结论，记录里写清。
4. **通知通道**：兜底事件的 notifier 退出码是 1，因为 orca_bot 一路失败；push 和 email 都成功。这是预期结果。

## 八、验收对照

| 验收条件 | 结果 | 证据 |
| --- | --- | --- |
| 用的是 I-0268 的两个假父工单，记录写清 repo#号和需求名 | 通过 | 第一节；#110 `yuyue-kafei-boundary`、#113 `baoxiu-gongdan-boundary` |
| 重复事件不产生第二条 `点头：` 或 `驳回：`，不产生第二张子票 | 通过 | 第三节；#110 评论数不变，#113 子票仍 2 张 |
| 两个父工单各有 chat，消息不串 | 通过 | 第二节；两个 chat id，两条写回各进自己的父工单 |
| 重启后 bot 能说出当前提案和已有评论，并拒绝重复写 | 通过 | 第四节；#119 复述提案 7138493489；#122 写回 7138700933 后拒绝重复 |
| bot 叫不醒时微信和邮件都到，控制台能完成写回 | 通过，有缺口 | 第五节；push/email ok，orca_bot 失败；控制台导出 token 后写回 7138871203。开箱路径缺 token，见 I-0276 |
| 没有碰主 launchd 调度器、主 notifier config、主作业表、主锁目录 | 通过 | 第六节；主作业表 mtime 变化来自生产调度器 |
| 记录有每项的证据和结论 | 通过 | 本文件 |

## 九、运营者确认

2026-11-25，运营者在会话里确认本轮模拟通过。I-0276 按运营者要求在本票本地分支直接修，修完和 I-0265 一起关；没有 PR，commit `28989f6` 在 `Lil-BobCN/623`。
