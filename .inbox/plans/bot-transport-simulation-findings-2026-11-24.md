# I-0264 发现的根因分析

- 日期：2026-11-24。
- 来源：`.inbox/plans/bot-transport-simulation-2026-11-24.md`（I-0264 演练记录）。
- 分支：`Lil-BobCN/622`，基线 `origin/Lil-BobCN/drill4-repair-plan` `5ca75d7`。
- 范围：只查原因，不改代码、不建票、不动中台和 GitHub。
- 术语：SOUL（角色说明文件）、handoff（交接消息）、pane（终端面板）、base64url（一种文本编码）、spec（规格）、scratch（模拟仓）、gateReady（门禁检查）、repoBusy（整仓忙碌判定）、to-spec（把点头结果写成规格）。
- 一句话：8 条里有 1 条夹具 bug 挡 I-0265，1 条通知契约缺口要拍板，2 条地图和门禁一致性问题要拍板或修，1 条 bot 行为要补规则，3 条只记录或清理。

## 一、发现总表

| # | 现象 | 根因 | 性质 | 影响 | 建议 |
| --- | --- | --- | --- | --- | --- |
| 1 | bot 回发件 bot 报 `terminal_not_found` | 发件 bot 没有活跃 pane 或持久信箱；bot 用 `orchestration reply` 回给发件人 | 通知契约缺口 | 不挡 chat 和写回，浪费 bot 回合，回程没人收 | 先拍板：单向通知、给发件 bot 信箱、或换 `--type` |
| 2 | `run-sim.mjs` 加载测试配置失败 | I-0268 的配置生成器没跟 I-0269 的必填 `sender`；测试断言旧值 | 夹具 bug | 挡 I-0265 的整轮重播 | 小 task 票，先修 |
| 3 | `gateReady` 放行了结论没回写的地图 | 门禁只查 `Not yet specified` 和决定票关没关，不查结论和地图 `接下来` | 流程或门禁规则缺口 | 门禁可过，地图可能过期；to-spec 可能停下 | 先拍板门禁口径，再定代码 |
| 4 | `apply-map` 没换旧地图链接，`point` 会查错地图 | `appendMapLink` 见链接就跳过；`point` 信这个链接 | 产品缺陷，低概率但静默 | 可能对着旧地图放行 `点头` | 小 hardening 票：替换或校验链接 |
| 5 | 新 issue 第一轮调度没看到 | GitHub 列表 API 最终一致；单轮不等 | 外部服务或演练工具缺口 | 单轮演练会漏新单；生产 `--loop` 下一轮会补 | 只记录；演练驱动加等待 |
| 6 | bot 误报票单两处错字 | bot 手抄 627 字符 base64url，抄件短 4 个字符、至少 118 处不同 | bot 行为或 SOUL 缺口 | 会误导驳回；没有数据损坏 | SOUL 加规则；并入 I-0267 或小票 |
| 7 | `驳回：` 第一行只有关口，理由在下面 | 解析只看首行前缀，理由取全文；文档写「后面写理由」 | 不是缺陷，文档措辞差 | 无 | 只记录；I-0267 统一写法 |
| 8 | 第 L 轮点火被 #104 挡住 | I-0268 留下的 `Sandcastle` 标签；`repoBusy` 见它就等 | 夹具 | 第一轮点火等待；清掉即好 | 只记录；演练前清理 |

## 二、逐条

### 1. bot 回发件 bot 失败

**已确认事实**

- bot 会话 `acd407f5-6d11-408d-846e-76da38c7c75d` 在 2026-11-24T02:32:55Z 跑：

  ```text
  orca orchestration reply --id msg_cbe6c22dae65 \
    --from orca_session_id:3ee2d30c-5d14-4b25-ac35-def729852b0e --body ...
  ```

  返回退出码 1：

  ```text
  terminal_not_found: Terminal bot:400bfe9e-1663-4419-95e8-de3468335454
  has no live pane or durable Run/Dispatch mailbox. No reply was sent.
  ```

- 同一 handoff 在 02:32 到 03:30 间到了 4 次；bot 前两次重试回复，后面停止重试。chat 里的说明和写回正常。
- 发件人由 notifier 的 `orca_bot` 通道指定：`notifier/channels/orca_bot.py:137-140` 发 `orca orchestration send --to bot:<bot> --from <sender> --type handoff`。
- 发件 bot 是「工厂通知」，id `400bfe9e-…`，只有 1 个 Home chat，没有活动 pane。`orca bot list` 能看到它，`orca bot chats --bot 工厂通知` 能看到 Home chat。

**根因链**

1. D-0394 把发送方定为专用 bot「工厂通知」，解决 launchd 没有终端句柄的问题。
2. notifier 用 `--type handoff`，Orca 把它当成要接管、要回执的交接。
3. bot 的运行时用 `orchestration reply` 回给手交的发送方。
4. `orchestration reply` 按发送方句柄找终端或持久信箱；「工厂通知」只有 Home chat，没有 pane，也没有 Run/Dispatch 信箱。
5. 回复失败。chat 是另一条投递路径，所以运营者能看到 bot 的话。

**影响**

- 不挡主链路。运营者在 chat 里和 bot 对话，bot 写 GitHub 都正常。
- bot 每次要花一个回合处理失败，最后写一段「回程断了」。
- 如果发送方以后需要回执（比如调度器要确认 bot 收到了），这条回程没有落点。

**性质**

这是通知契约缺口。`orca_bot.py` 的参数没写错；问题在「发件 bot 只发不收」和「handoff 默认要回」撞在一起。

**建议**

先开一张 grilling 票拍板，再动代码。可选方向：

1. 明确单向：SOUL 写「叫醒消息不回发件 bot，只回 chat 里的运营者」；并验证 `--type status` 能不能照样叫醒且不要求回执。
2. 给「工厂通知」一个持久信箱或常驻 run；需要确认 Orca 是否支持给 bot 配 durable mailbox。
3. 真要回执时，bot 用 `orca orchestration send --to bot:工厂通知 --chat <Home chat id>` 发到 Home chat，而不是 `orchestration reply`。

I-0265 的「重复叫醒、离线兜底」正好可以顺带验第 1 种。

**查重**

I-0269（closed）只修了发送方身份和 chat 标题，没修回程；I-0263（closed）只验了叫醒。没有现成票。

### 2. I-0268 测试配置过期

**已确认事实**

- `factory/test/sim/seed.mjs:177-201` 的 `writeSimNotifierConfig` 写：

  ```json
  "orca_bot": {"enabled": true, "bot": "afk", "timeout_seconds": 30}
  ```

- `notifier/config.py:107-140` 在 `orca_bot` 开启时要求 `bot`、`sender`、`timeout_seconds` 都非空。缺 `sender` 抛 `ConfigError`。
- `factory/test/sim/run-sim.mjs:392` 用临时 `NOTIFIER_HOME` 跑 `load_config` 校验。用上面这份配置实测：

  ```text
  notifier.config.ConfigError: channels.orca_bot.sender 必须是非空字符串
  ```

- `factory/test/sim.test.mjs:350-352` 断言 `config.channels.orca_bot.bot === 'afk'`，没有调用 `load_config`。所以测试是绿的，`run-sim.mjs` 会挂。

**根因链**

1. I-0268 先做，测试配置写成占位 `afk`，没写 `sender`。
2. I-0269 后做，给 `orca_bot` 增加了必填 `sender`，并改了真实 bot 名。
3. I-0269 只改 notifier 和文档，没有回头改 I-0268 的夹具。
4. I-0268 的测试只断言 JSON 形状，没有把这份配置交给 `load_config`，所以契约变化没被拦住。

**影响**

`node factory/test/sim/run-sim.mjs` 现在会在加载配置时失败。I-0265 要用同一个环境，不修就跑不起来。这次演练是手写临时配置绕过的。

**性质**

夹具 bug，测试覆盖缺口。

**建议**

开一张小 task 票，agent 可做：

- `writeSimNotifierConfig` 的 `bot` 改成 `莹宝（AFK）`，`sender` 做成必填参数或从环境读，缺了直接报错。
- `sim.test.mjs` 增加一条：生成配置后用子进程 `load_config`，断言不抛错、`sender` 读得到。
- 更新 I-0268 记录里的配置说明。
- 验收：`node factory/test/sim/run-sim.mjs` 能跑完；把 `sender` 删掉时测试失败。

**查重**

I-0268（closed）是环境票，没有覆盖 I-0269 后的契约；没有现成票。

### 3. 门禁只看票关没关，不看结论和地图 `接下来`

**已确认事实**

- `factory/lib/gap.mjs:181-193` 的 `gateReady` 只查两件事：地图 `Not yet specified` 为空；地图下的子 issue（决定票）全部 `closed`。
- `factory/test/sim/seed.mjs:93-105` 的 `closeMapDecisionTickets` 直接 `closeIssue`，不写结论。这是模拟夹具的做法。
- #92 的 `点头：补缺口` 写最终答案「全城配送」（[评论 7121199287](https://github.com/Lil-BobCN/scratch-bot-sim/issues/92#issuecomment-7121199287)）。地图 #95 的 `Decisions so far` 没有这条，`接下来` 还挂着「1 配送范围怎么定」；决定票 #96 已关闭，正文没有结论。
- `factory/agents/to-spec.md:10` 要求 to-spec 先读最新 `点头：补缺口` 的 `## 最终答案`；`:4` 要求读地图六段和决定票。`docs/工单模型.md:220-221` 说点头前查地图的 `Not yet specified` 和开放决定票；地图上的最终答案看 `Decisions so far` 和关闭的决定票，技术闸门看最新 `点头`。
- `factory/bin/gap.mjs` 的 `postPoint` 用 `mapIssueNumber` 做 `gateReady`；它不比对 `点头` 的答案和地图内容。

**根因链**

1. 门禁只要求「没有开放问题」；它不要求答案已经写进地图。
2. 地图的 `接下来` 来自回传包的 `map.md`；`apply-map` 只按回传校验一次（`factory/lib/map-issues.mjs:241-254`），运营者关决定票后不会自动更新。
3. 运营者可以在 chat 里改答案，bot 只写 `点头` 评论，不写地图（SOUL 规定 bot 不改地图）。
4. 门禁看到决定票都关了，就放行。地图的 `接下来` 和 `Decisions so far` 可能仍是旧内容。
5. to-spec 会读最新 `点头`，所以技术答案不会丢；但地图六段和 `接下来` 可能和 `点头` 冲突，to-spec 的「父工单和地图冲突时停下」可能触发。

**影响**

- 门禁可以过，但地图是过期的。to-spec 要么停下（拖一天），要么把旧地图内容写进 spec（业务决定漏掉）。
- 本次演练没跑真实 to-spec，所以这个影响是合理推测，不是现场观察。

**性质**

流程和门禁规则缺口。`closeMapDecisionTickets` 是夹具行为，但「运营者关票不写结论」在真实流程里也可能发生。

**建议**

先开一张 grilling 票拍板，二选一：

1. 门禁加严：`gateReady` 要求每张关闭的决定票有结论（评论或地图 `Decisions so far` 有对应行），`接下来` 为空或只剩开放票。bot 的 SOUL 同步改。
2. 明确单一来源：`点头` 评论是最终答案，地图只是快照；在 to-spec 的说明里写清冲突时以 `点头` 为准，不因地图 `接下来` 停下。`gateReady` 不改，文档改。

拍板后再决定要不要改 `gateReady` 和测试。

**查重**

I-0240（closed）是「点头后调度器不跑 to-spec」，不是门禁内容；I-0267（open）是文档更新，可以承接第 2 种做法，但没覆盖原因。没有现成票。

### 4. `apply-map` 不换旧地图链接，`point` 会查错地图

**已确认事实**

- `factory/lib/map-issues.mjs:219-232` 的 `appendMapLink`：`## 需求全文` 段里只要出现任意 `- 地图：` 行，就直接返回原文，不比较 URL。
- `factory/lib/map-issues.mjs:305-306` 的 `ensureMapIssues` 按「地图正文含父工单链接」找已有地图；找不到就建新图，然后在 `:331` 调用 `appendMapLink`。
- `factory/bin/gap.mjs:160-175` 的 `point` 从父工单正文读 `- 地图：` 链接，把编号传给 `postPoint`。
- `factory/lib/gap.mjs:281-295` 的 `postPoint` 用这个编号取地图正文，跑 `gateReady`。
- #105 正文是 #92 的复制件，链接仍指 #95；`apply-map` 建了新地图 #106，但没换正文链接。bot 读到 #95，发现不对，拒绝点头。
- #95 的 `Not yet specified` 为空、决定票 #96 已关闭，`gateReady` 会放行。也就是说，如果没人拦，`point` 会对着 #95 过门禁，再把 `点头` 写到 #105。

**根因链**

1. `appendMapLink` 把「有链接」当成「链接正确」。
2. `point` 完全信任父工单正文的链接，不验证那张地图正文是否含当前父工单链接。
3. 两者叠加，旧链接会把门禁指向另一张地图。本次是复制父工单造成的；地图被删后重建、父工单被手工编辑，也可能留下旧链接。

**影响**

- 静默放行：门禁查的是另一张地图，`点头` 却写到当前父工单。
- 概率低，但一旦发生没人看得出来。本次是 bot 主动核对才拦住的；控制台或运营者直接跑 `gap.mjs point` 不会拦。

**性质**

产品缺陷。低概率，失败静默，值得修。

**建议**

开一张小 task 票，agent 可做，不需要再拍板（「不要对着不相干的地图放行」是明确行为）：

- `appendMapLink`：已有链接和目标 URL 不同就替换；相同才跳过。
- `point`：取到地图后先校验地图正文含当前父工单链接，不含就报错，提示先修父工单正文或重跑 `apply-map`。
- 测试：父工单有旧链接时，`apply-map` 换链接；`point` 对错地图报错，不写评论。
- 验收：复制父工单的场景不再能对着旧图过门禁。

**查重**

没有现成票。

### 5. GitHub 新 issue 列表延迟

**已确认事实**

- #105 的 `created_at` 是 `2026-11-24T03:36:10Z`。
- 第 D 轮调度在 `03:36:19Z` 跑，快照里只有 #92、#93、#94，没有 #105。
- 同一天 `03:36:44Z` 的 `--dry-run` 能看到 #105，路由是 `gap-proposal`。
- `factory/lib/scheduler.mjs:737` 用 `gh.listIssues({ state: 'open' })` 取快照。
- I-0268 记录已经写过「GitHub 列表有短暂延迟」，`run-sim.mjs` 里有 30 秒等待 spec、状态和关口的循环。

**根因链**

1. GitHub 的 issue 列表 API 对新 issue 有最终一致延迟。从这次两轮的时间看，延迟在 9 到 34 秒之间。
2. 单轮 `--once` 只取一次快照，不等。
3. 常驻 `--loop` 每 30 秒重取，延迟会被下一轮吃掉。

**影响**

只影响单轮演练和一次性触发；生产 loop 不受影响。本次漏了一轮，第二轮正常。

**性质**

外部服务行为，加演练工具缺口。不是产品缺陷。

**建议**

不开票。写进演练记录和环境说明：单轮之前先等新 issue 可见，或复用 `run-sim.mjs` 的等待循环。演练驱动可以在建完夹具后先 dry-run 一次，看到新单再跑真轮。

**查重**

I-0268 记录提过延迟，没有票。

### 6. bot 误报票单错字

**已确认事实**

- bot 会话 `58d943e2-1c59-47d5-a74e-6d7bce3fe76a` 在 `2026-11-24T04:03:52Z` 跑：

  ```text
  printf '%s' '<base64>' | base64 -d
  ```

  结果里的票单是 `店员揍照提交报修单`、`店员毛交的报修单`，在 `04:04:06Z` 报给运营者「两处错字」。
- 提案评论 7121663214 的 `created_at` 和 `updated_at` 都是 `2026-11-24T04:03:14Z`，没有被编辑。
- 同一会话 `04:06:49Z` 从评论正文重新提取 marker：

  ```text
  gh api .../comments/7121663214 --jq .body | grep -o 'W3si[^ ]*' | base64 -d
  ```

  输出正确：`店员拍照提交报修单`、`店员新提交的报修单`。建出的 #108、#109 正文也正确。
- 对比 bot 手抄的 base64 和评论里的原文：原文 627 字符，手抄 623 字符；在重叠的 623 个位置里至少 118 处不同，差异从第 24 个字符开始，后半段大段错位。
- bot 在 `04:07:13Z` 自己更正：「我之前报的两处错字不成立……是我那次解码看错了。」

**根因链**

1. 票单的机器可读数据藏在 `<!-- factory:tickets <base64url> -->` 里，是给 `tickets.mjs` 用的。
2. bot 想看完整票单，手工把 627 字符的 base64url 复制进 shell。
3. 复制件少了 4 个字符、错了 118 处，`base64 -d` 解出乱码 JSON。
4. bot 相信乱码，报了两处不存在的错字。
5. 后来从 API 原文重新提取，才恢复正确。

**影响**

会误导运营者做一次不必要的驳回；没有数据损坏，`tickets.mjs` 用的是原文，建票正确。属于行为问题，不是代码问题。

**性质**

bot 行为或 SOUL 缺口。SOUL 没让 bot 解码 marker，bot 自己多做了一步，又没有校验。

**建议**

在 SOUL 或拆票说明里加一条：

- 票单以评论里可见的 `## 票单` 为准，不要手工复制或解码 `factory:tickets` marker。
- 需要机器可读数据时，用 `tickets.mjs` 解析，或从 API 原样取出后交给命令，不手抄长字符串。
- 报错字前先复核原文；不能确认就不报。

可以并进 I-0267（仓库文档和 SOUL 更新），或在 I-0267 前开一张小 SOUL 票。I-0265 复验时看 bot 还会不会报假错字。

**查重**

没有现成票。

### 7. `驳回：` 第一行只有关口，理由在下面

**已确认事实**

- bot 的 #93 驳回评论 [7121640372](https://github.com/Lil-BobCN/scratch-bot-sim/issues/93#issuecomment-7121640372) 第一行是 `驳回：拆票`，理由从第三行开始。
- `factory/lib/scheduler.mjs:39-45` 的 `normalizedFirstLine` 取第一行；`:94-102` 的 `latestSignal` 只看第一行是否以 `驳回：` 开头。
- `factory/lib/scheduler-jobs.mjs:36-46` 的 `latestRejectionText` 取整条评论正文，作为重跑 brief 的「这次驳回的理由」。
- `docs/工单模型.md:189` 和 `:192` 写的是「驳回：补缺口」/「驳回：拆票」，「后面写理由」；没有要求同一行。

**根因链**

解析只看首行前缀，理由取全文；文档允许理由在后面。bot 的写法符合文档。票面写的 `驳回：拆票 <理由>` 是简写，不是强制格式。

**影响**

无。重跑拿到了完整理由。

**性质**

文档措辞不一致，不是缺陷。

**建议**

不开票。I-0267 更新文档时统一写法：要么写「第一行写关口，理由可以换行」，要么写「同一行写理由」。代码不用改。

**查重**

无。

### 8. 第 L 轮点火被 #104 残留 `Sandcastle` 挡住

**已确认事实**

- I-0268 记录第 55 行：「跑完一轮后父 #94 已转 `开发中`，子 #104 挂 `Sandcastle`。下一次用之前重跑起命令，会重置成干净状态。」
- `factory/test/sim/seed.mjs:128-157` 的 `createQueuedChild` 只给子票挂 `状态:排队中`，不加 `Sandcastle`。
- `factory/test/sim/round.mjs` 的假 `ignite` 只记录调用，不加标签。
- 我们的第 L 轮在 `04:07:10Z` 看到 #93 有 2 张子票、最新关口 `点头：拆票`，但 `decision=wait`，没有 ignite。清掉 #104 的 `Sandcastle` 后，第 L2 轮 `decision=develop`，假点火 #108。
- `factory/lib/scheduler.mjs:895-897` 的 `repoBusy`：同一仓里只要有一个 open 子票是 `Sandcastle`，整仓算忙；`排队中` 分支在点火前检查 `repoBusy`，忙就等。

**根因链**

1. I-0268 的测试轮把 #104 留在了 `Sandcastle`。
2. 我们的演练没有重置环境，继续用同一个 scratch 仓。
3. `repoBusy` 按设计认为仓里有活，挡住 #93 的点火。
4. 清掉标签后同一轮逻辑正常。

**影响**

只影响演练。生产里 `Sandcastle` 表示真有点火在跑；有活时挡住第二张票是设计行为。子票进入 `待验收` 或关闭后，`cleanupActions` 会摘掉标签。

**性质**

夹具状态。

**建议**

不开票。演练开始前重置环境，或加一条前置清理：把父工单和子票上残留的 `Sandcastle` 摘掉。I-0268 的 `run-sim.mjs` 本来每次重置 issue，是我们为了保留 #92 的证据没重置。写进演练记录即可。

**查重**

无。

## 三、查重结果

中台当前与本主题相关的 open：I-0208（地图）、I-0228、I-0239、I-0265、I-0266、I-0267。没有覆盖上面 1 到 4、6 的票。

相关的已关票：

| 票 | 关系 | 没覆盖什么 |
| --- | --- | --- |
| I-0268 | 模拟环境 | 配置生成器没跟 I-0269 |
| I-0269 | 发送方身份和 chat 标题 | 回程通道 |
| I-0262 | 驳回后重跑 | 门禁内容和地图链接 |
| I-0240 | 点头后自动跑 to-spec | 门禁口径 |
| I-0170 | 补缺口提案与点头建票 | 门禁口径 |

GitHub 镜像搜索没有新票。I-0264（#622）已在中台关闭，镜像等运营者同步。

## 四、建议的票分组

| 组 | 内容 | 票型 | 前置/优先级 |
| --- | --- | --- | --- |
| A | 修 I-0268 测试配置：bot 名、必填 sender、`load_config` 测试 | task，AFK | 先做，挡 I-0265 |
| B | 通知回程拍板：单向、信箱、或换 `--type` | grilling，HITL | 第五次演练前 |
| C | 门禁口径拍板：结论和 `接下来` 要不要卡 | grilling，HITL | 第五次演练前 |
| D | 地图链接 hardening：`appendMapLink` 替换、`point` 校验 | task，AFK | 独立，可先做 |
| E | SOUL 禁用人工解码 marker；票单以可见段为准 | task 或并入 I-0267 | 和 I-0267 一起 |

不合成一张的原因：

- A 是夹具和测试，B 是通知契约，C 是流程规则，D 是 gap CLI 的输入校验，E 是 bot 行为。层不同，验收不同，owner 不同。
- 合成一张，关票的四列表和影响清单会混，回滚也只能整张回。
- 地图 I-0208 现在 61 张票，离 80 张的归档线还有空间；拆开不会撞容量。

## 五、未验证

- `--type status` 能不能照样叫醒 bot、让它读 GitHub 和讲给运营者。没试。
- Orca 能不能给「工厂通知」配持久信箱或常驻 run。没查 Orca 内部。
- to-spec 真的遇到 #95 这种「决定票关了、`接下来` 还挂着」的地图会不会停。演练里 to-spec 是假动作，这个影响是从 `factory/agents/to-spec.md:16` 推出来的。
- `appendMapLink` 的旧链接在真实流程里除了复制父工单，还能不能由地图删除、父工单手工编辑触发。没实测。
- #104 的 `Sandcastle` 到底是 I-0268 哪一步加的。I-0268 记录说它挂着，当前 seed 代码不加；具体来源未验证。
- `point` 对着 #95 放行的行为没有实际跑过（bot 拒绝了）。结论来自代码阅读和 #95 的门禁状态。
