# I-0268 模拟环境记录

票：I-0268「模拟环境：scratch 仓和测试调度器」。分支 `issue-0268`，基线 `bot-transport-integration`（已含 I-0260、I-0261、I-0262）。日期 2026-11-24。

一句话：私有 scratch 仓里放了三张假父工单，一条命令播种并跑一轮测试调度器；补缺口、拆票、点火三条决策都走到，点火是假的。

## 一、怎么起

```bash
cd "/Users/Admin/orca/workspaces/grilling 远程/issue-0268"
node factory/test/sim/run-sim.mjs
```

这一条会做四件事：

1. 确认 `Lil-BobCN/scratch-bot-sim` 存在，私有；不存在就建，带 README。
2. 删掉 scratch 仓里所有 issue，重新播种。每次跑都是干净环境。
3. 写假回传件到 `factory/test/sim/.state/inbox/`，跑真的 `gap.mjs apply-map`、`propose`、`point`，建地图、决定票、点头和假 spec。
4. 用 `scheduler.mjs --once` 跑一轮。点火、拆票、补缺口、to-spec、流水线全部注入假实现。

输出是 NDJSON，每行一个 `step`。最近一次输出存在：

`/Users/Admin/orca/workspaces/grilling 远程/drill4-repair-plan/.inbox/plans/bot-transport-environment-output-2026-11-24.txt`

## 二、怎么停和清

```bash
cd "/Users/Admin/orca/workspaces/grilling 远程/issue-0268"
node factory/test/sim/run-sim.mjs --cleanup
```

这一条删掉 scratch 仓里全部假 issue，删掉 `factory/test/sim/.state/`，**不删仓**。实测删了 13 个 issue，状态目录消失。

守卫：只认仓名 `scratch-bot-sim`。换别的仓名会拒绝，必须加 `--force`：

```
{"step":"error","message":"只认模拟仓 scratch-bot-sim，不删别的仓：some-customer-repo。确实要用加 --force"}
```

## 三、最终环境

- 仓：https://github.com/Lil-BobCN/scratch-bot-sim （私有，保留）
- 假父工单（补缺口路径）：#92 https://github.com/Lil-BobCN/scratch-bot-sim/issues/92
- 假父工单（拆票路径）：#93 https://github.com/Lil-BobCN/scratch-bot-sim/issues/93
- 假父工单（点火路径）：#94 https://github.com/Lil-BobCN/scratch-bot-sim/issues/94
- 地图：#95（父 #92）、#97（父 #93）、#99（父 #94）
- 决定票：#96、#98、#100，已关闭，`gateReady` 才过
- 假 spec：#101（`yuyue-kafei`）、#102（`baoxiu-gongdan`）、#103（`pandian-qingdan`），都挂 `ready-for-agent`
- 假回传件：`factory/test/sim/.state/inbox/upload-sim-0001/`、`upload-sim-0002/`、`upload-sim-0003/`。每个下面有 `meta.json` 和 `.scratch/<需求名>/`，包含 `map.md`、`pending.md`、`验收场景.md`、`决策记录.md`、`issues/01-*.md`
- 临时 customers：`factory/test/sim/.state/customers.json`，只放 scratch 仓
- 临时作业表：`factory/test/sim/.state/jobs.json`
- 临时锁目录：`factory/test/sim/.state/locks/`
- 临时 notifier 主目录：`factory/test/sim/.state/notifier/`，`channels.orca_bot` 开，邮件和推送关

注意：跑完一轮后父 #94 已转 `开发中`，子 #104 挂 `Sandcastle`。下一次用之前重跑起命令，会重置成干净状态。

## 四、四项能力结论

### 1. 假回传件能建图、过 gateReady、写点头

证据：runner 对三张父工单各跑了一次真 `gap.mjs apply-map`，输出三张地图和决定票；决定票关闭后 `gap.mjs point` 对 #93、#94 返回 `posted: true`。

测试 `apply-map 在假仓建出地图和决定票，关票后 gateReady 通过` 直接断言 `gateReady.ready === true`。`propose` 的提案正文含 `## 技术题`，`point` 写出的最新关口是 `点头：补缺口`。

### 2. 假 spec 让调度器走拆票，不跑 to-spec

证据：父 #93 状态 `排队中`、最新关口 `点头：补缺口`、有 spec #102、没有子票。调度器决策 `decompose`，动作 `runDecompose`，`reason` 是 `状态:排队中｜最新关口:点头：补缺口`。

runner 断言 `actions.toSpecCalls.length === 0`。三张 spec 标题都带需求名，`specForParent` 能按需求名匹配。

### 3. 拆票 Agent 的输入齐了

测试 `拆票 brief 带父工单验收条件和假 spec` 用真 `createDecompose`、假 runner，抓到实际 brief。断言 brief 里有：

- 父工单的 `## 验收条件` 和两条验收原文
- 需求名 `baoxiu-gongdan`
- 假 spec 的标题和正文
- `提案：拆票` 的写法要求

没有跑真 agent。真 agent 跑通是 I-0265 的事。

### 4. 测试调度器和假 ignite

证据：一轮输出三行：

| 父工单 | decision | 动作 | reason |
| --- | --- | --- | --- |
| #94 | `develop` | `setState`、`comment`、`ignite #104` | `状态:排队中｜最新关口:点头：拆票｜点火:#104` |
| #93 | `decompose` | `runDecompose` | `状态:排队中｜最新关口:点头：补缺口` |
| #92 | `gap-proposal` | `runGapProposal` | `状态:已提交` |

假 `ignite` 只记录一次：`{"owner":"Lil-BobCN","repo":"scratch-bot-sim","parent":94,"ticket":104,"action":"ignite"}`。没有容器、没有 Sandcastle 进程、没有 PR；runner 查了 `gh.listPulls`，结果 0。

临时作业表里有成功的点火行：`parent 94`、`ticket 104`、`attempt 0`、`stop 空`。临时锁目录没有残留 `.lock`。

## 五、notifier 隔离

- 测试 notifier 读的是临时 home。runner 用真的 `notifier.config.load_config` 检查，输出 `loadedHome` 等于临时路径。
- 临时 config：`channels.orca_bot.enabled=true`、`bot=莹宝（AFK）`、`sender=bot:sim-notifier`，邮件和推送都关。`sender` 由 `writeSimNotifierConfig` 必填，缺了直接报错。
- 主 config 没读内容，只记录 mtime 和 size：`mtimeMs 1794812304809`、`size 347`，跑前跑后一样。
- 测试 `临时 notifier 给两张父工单各开 chat` 用假 `orca` 命令跑真 `python3 -m notifier send`，两张父工单的事件分别得到标题 `补缺口 Lil-BobCN/scratch-bot-sim#101` 和 `拆票 Lil-BobCN/scratch-bot-sim#102`，正文带父工单链接和提案评论链接。没有往真 bot 发消息。
- 未验证：主 config 的 `orca_bot` 是否真的关着。按要求不读主 config，只能确认这次没写它。

## 六、主环境没有被碰

runner 的作业表、锁、调度日志、NOTIFIER_HOME 全在 `factory/test/sim/.state/`。主路径只做 mtime/size 快照：

| 主路径 | 跑前跑后 |
| --- | --- |
| `~/.grilling/notifier/config.json` | 没变 |
| `~/.grilling/factory/locks/` | 没变 |
| `~/.afkfactory/jobs.json` | 变了 |
| `~/.afkfactory/scheduler/runs.jsonl` | 这一轮没变，前一轮变过 |

主作业表变了不是模拟写的。生产调度器 `node factory/bin/scheduler.mjs --loop --customers customers.json --owner Lil-BobCN` 在跑（runner 输出 `mainSchedulerRunning: true`），它自己会写作业表。模拟用的作业表路径在临时目录，输出里能看到。没有调用 launchd，没有重启主调度器。

## 七、测试

| 命令 | 结果 |
| --- | --- |
| `cd factory && npm test` | 645 通过，0 失败 |
| `cd backend && npm test` | 192 通过，0 失败 |
| `python3 -m unittest discover -s notifier/tests` | 102 通过，0 失败 |
| `node factory/test/sim/run-sim.mjs` | 退出码 0，12 项检查通过 |
| `node factory/test/sim/run-sim.mjs --cleanup` | 删 13 个 issue，状态目录清掉，仓保留 |
| 清理守卫换仓名 | 退出码 1，拒绝 |

runner 反复跑过多遍，每次都先删上一轮的全部假 issue，重置行为稳定。失败过一次：`点头：拆票` 写到了另一张父工单，且新建 spec 在列表里短暂不可见，调度器误走 to-spec。已修：拆票评论指向点火父工单，播种后等到 spec、状态和关口都可读再跑调度。

## 八、偏离票面的地方

1. 票写「至少两个假父工单」。实际三张：两张够并发（#92 补缺口、#93 拆票），第三张 #94 专门走到 `ignite`，这样一轮就能覆盖三条决策，不用跑第二轮。
2. 票说假 spec 挂 `ready-for-agent`、标题或正文带需求名。实际标题和正文都带需求名，匹配不靠运气。
3. 票说临时 `config.json` 开 `orca_bot`。本分支已合入 I-0261，配置能真加载；但 runner 一轮用记录替身发通知，没用真 `orca` 往外发。chat 标题用假 `orca` 命令单独验证。
4. 主作业表 mtime 变化是生产调度器自己的活动，不是模拟写的；已在第五节和第六节说明。

## 九、没有证据的验收项

- 「两个假父工单每个有自己的补缺口和拆票 chat」：chat 标题和建 chat 参数由测试里的假 `orca` 证明；真实 Orca 里有没有这两个 chat，要等 I-0265 用真 bot 跑。
- 「拆票 Agent 能从假 spec 和父工单验收条件拆出提案」：只证明输入齐了，没有跑真 agent。
- 「主 config 的 `orca_bot` 保持关闭」：按要求不读主 config，只能证明这次没改它。
