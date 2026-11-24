# I-0277 清图协议：设计与分工

日期：2026-11-25
票：I-0277「补缺口阶段由 bot 陪运营者清完地图」
决定：D-0404（bot 确认后写回地图）、D-0405（清完五条才点头）、D-0406（bot 陪运营者清图）

## 目标

补缺口阶段，工作台 bot 在同一个 chat 里陪运营者清完地图：列雾、提去处、起草票面和结论，运营者确认后用命令写回。写 `点头：补缺口` 前，带协议标记的地图必须满足五条判据。

## 非目标

- 不改补缺口 Agent 的列题逻辑。
- 不改三个人工点（上传、补缺口点头、拆票点头）。
- 不改客户上传前的流程，不改回传快照。
- 老地图（没有协议标记）行为不变。
- 不在本票改 D-0347、D-0341。

## 地图协议

### 标记

地图 `Notes` 段出现 `- 清图协议：v1` 才算启用严格门禁。`map.mjs init` 负责补这一行，重复跑不重复加。

### 清雾三个去处

原文从 `Not yet specified` 删除。删除按整项文本匹配，忽略首尾空白；找不到就报错，不改别的项。

1. 新建决定票：
   - 标题 `NN <标题>`，`NN` 取现有决定票标题开头的最大编号加一，两位补零。
   - 正文三段：`## Question`、`## 评论`（空）、`## 结论`（空）。
   - 挂 `wayfinder:<type>`，不挂 `状态:*`。
   - 加到地图下面做 sub-issue。
   - `接下来` 加 `- 第 NN 张：<标题>`。
2. 写进 `Out of scope`：加 `- <原文>（本版不做：<理由>）`。
3. 记 `未定`：`Notes` 加 `- 未定：<原文>（<谁回话>，<下一步>）`。

### 结论

决定票关闭时，必须有一条第一行是 `结论：<一句话>` 的评论。`map.mjs conclude` 写这条评论、关票、从 `接下来` 删对应行、在 `Decisions so far` 加 `- <标题>：<结论>`。重复跑不重复写。

## 严格门禁五条

`gateReady` 读到协议标记时检查：

1. `Not yet specified` 为空。
2. 地图下所有 sub-issue 都关闭。
3. 每张关闭的决定票都有一条 `结论：` 开头的评论（取第一行）。
4. `接下来` 为空（整段只有空白或「无」也算空）。
5. 每张关闭决定票的 `- <标题>：<结论>` 都出现在 `Decisions so far`。
6. `Notes` 里每条 `- 未定：` 都有非空的 `（...）`。

第 6 条和五条判据一起算，报错时按 kinds 列出：`not-yet-specified`、`open-ticket`、`missing-conclusion`、`next-not-empty`、`decisions-missing`、`unsettled-without-next`。

没有协议标记时，只查原来的两条：`Not yet specified` 为空、决定票全关。

## 命令 `factory/bin/map.mjs`

所有命令必填 `--owner`、`--repo`、`--parent`（父工单链接、`#N` 或 `N`）。从父工单正文的 `- 地图：<link>` 找地图编号，再用 `mapBelongsToParent` 校验地图正文含当前父工单链接。输出一行 JSON。

```text
node factory/bin/map.mjs list --owner <owner> --repo <repo> --parent <父工单>
node factory/bin/map.mjs init --owner <owner> --repo <repo> --parent <父工单>
node factory/bin/map.mjs ticket --owner <owner> --repo <repo> --parent <父工单> \
  --title <标题> --type <grilling|research|prototype|task> --question <正文> --from-item <原文>
node factory/bin/map.mjs conclude --owner <owner> --repo <repo> --parent <父工单> \
  --ticket <编号或标题前缀> --conclusion <一句话>
node factory/bin/map.mjs defer --owner <owner> --repo <repo> --parent <父工单> \
  --item <原文> --to <out-of-scope|notes> [--reason <理由>] [--who <谁回话>] [--next <下一步>]
node factory/bin/map.mjs check --owner <owner> --repo <repo> --parent <父工单>
```

- `list` 输出 `{ map, fog, next, openTickets, closedTickets, decisions, deferred, protocol }`。
- `init` 输出 `{ map, added }`。
- `ticket` 输出 `{ map, ticket: { number, title, url }, created, removedItem }`。
- `conclude` 输出 `{ map, ticket, commented, closed, decisionsAdded }`。
- `defer` 输出 `{ map, item, to, changed }`。
- `check` 输出 `{ ready, blockers }`，不通过退出码 1。

## 库 `factory/lib/map-clearing.mjs`

纯函数，方便单测：

- `PROTOCOL_MARKER = '- 清图协议：v1'`
- `hasProtocol(body)`
- `addProtocolMarker(body)`
- `sectionText` 可复用 `map-issues.mjs` 的解析（需要导出或复制）。
- `removeFogItem(body, item)`：从 `Not yet specified` 删整项；找不到抛 `MapClearingError`。
- `addNextTicket(body, number, title)`
- `removeNextTicket(body, number, title)`
- `appendOutOfScope(body, item, reason)`
- `appendUnsettledNote(body, item, who, next)`
- `appendDecision(body, title, conclusion)`
- `nextTicketNumber(titles)`
- `renderDecisionTicket({ number, title, question })`
- `conclusionOf(comments)`：取第一条第一行 `结论：` 后面的文本。
- `strictGate({ body, subIssues, commentsByTicket })`：返回 `{ ready, blockers }`。

## gateReady 改动

`factory/lib/gap.mjs` 的 `gateReady`：

- 保留原签名，增加可选 `commentsByTicket`（测试注入）。
- `hasProtocol(mapBody)` 为真时，读关闭票的评论，跑 `strictGate`，返回 blockers。
- 为假时走原逻辑。
- `GATE_REMINDER` 文案补一句「带清图协议的地图还要看决定票结论、接下来和 Decisions so far」。

## 通知

`notifier/templates.py` 的 `_gap_proposal` 正文改成：

```text
闸门题和推荐答案列好了。到 bot chat「...」里看题、答题，和 bot 一起清完地图。
控制台兜底：
...
```

同步 `notifier/tests/test_templates.py`、`docs/通知.md`。

## bot SOUL

`docs/agents/bot-soul.md` 和 `~/.orca/bots/afk/SOUL.md` 同步改：

- 「我处理什么」的补缺口一条加：讲完题后，如果地图还有 `Not yet specified` 或开放决定票，逐条和运营者清。
- 新一节「清地图」：列项、提三个去处、起草、复述、等明确确认、调 `map.mjs`；写后贴链接。`未定` 项在写点头前逐条复述，运营者确认。
- 「边界」改成：可以建决定票、写结论、关决定票、改地图两段；仍不写提案、不建图、不改回传快照、不改 `状态:*`。
- 「怎么写回」加 `map.mjs` 五个命令和参数。
- 写 `点头` 前先跑 `map.mjs check`，不通过就把 blockers 讲给运营者。

## 文档

- `docs/工厂流程.md` 第八节 C1：补缺口阶段由 bot 陪清图；三步去处；清完才点头。
- `docs/工单模型.md`：信号表后加「清图协议」；结论格式；严格门禁五条；`未定` 行格式。
- `docs/agents/operator-daily.md`：补缺口阶段的动作改成「在 bot chat 里答题并和 bot 清完地图」。
- `factory/agents/console.md`：兜底时用同一套 `map.mjs`。
- `factory/agents/to-spec.md`：去掉「地图落后不停」的例外，恢复「冲突停下」。
- `docs/agents/issue-tracker.md`：wayfinder 子票一节加结论格式和协议标记。
- `docs/adr/决策记录.md`：新增 D-0404–D-0406；D-0397、D-0396、D-0340 标被取代；目录行同步。
- `GLOSSARY.md`：如需，加「清图协议」「结论评论」。

## 测试

- `factory/test/map-clearing.test.mjs`：纯函数逐条测；六段解析；雾删除；编号；结论；未定；严格门禁。
- `factory/test/map-cli.test.mjs`：用 `startFakeGithub` 跑 init/ticket/conclude/defer/check；重复跑幂等；父工单和地图不匹配报错。
- `factory/test/gap.test.mjs`：协议地图缺结论、`接下来` 非空、`Decisions so far` 缺行、`未定` 缺下一步时拒绝；协议地图齐全时通过；老地图不受影响。
- `notifier/tests/test_templates.py`：补缺口提案文案。
- 全量：`node --test factory/test/*.test.mjs`、`python3 -m unittest discover -s notifier/tests -q`、`python3 scripts/check-decisions.py`。

## 分工

- 主会话：写协议、审代码、跑全量测试、写关票记录、同步。
- code 子分支：`factory/lib/map-clearing.mjs`、`factory/bin/map.mjs`、`factory/lib/gap.mjs`、三个测试文件。
- docs 子分支：SOUL、模板、文档、ADR、演练计划。
- 模拟：code 分支的测试覆盖命令和门禁；真实 bot chat 留给第五次演练。
