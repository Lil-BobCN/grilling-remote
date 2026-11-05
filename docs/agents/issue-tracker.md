# 任务管理：GitHub Issues

本仓库的任务和产品规格统一放在 GitHub Issues 中，使用 `gh` CLI 操作。
仓库为公开仓库 `Lil-BobCN/grilling-remote`，不放客户数据。在仓库目录内运行时 `gh` 会自动识别。

## 常用操作

- 创建：`gh issue create --title "..." --body "..."`。多行正文用 heredoc。
- 查看：`gh issue view <编号> --json number,title,body,labels,comments`。需要人读全文时加 `--comments`。
- 列表：`gh issue list --state open --json number,title,body,labels,comments`，再按状态和标签筛选。
- 设为子任务：`gh issue create --parent <父编号> ...`，或事后 `gh issue edit <父编号> --add-sub-issue <子编号>`（`gh` 2.94+）。旧版 `gh`：`gh api --method POST repos/<owner>/<repo>/issues/<父编号>/sub_issues -F sub_issue_id=<子任务数据库编号>`。用不了子任务时，在子任务正文顶部写 `Part of #<父编号>`。
- 阻塞：用 GitHub 原生 issue dependencies。加边用 `gh issue create --blocked-by <n>,<n> ...`，或 `gh issue edit <子编号> --add-blocked-by <阻塞编号>`（`gh` 2.94+）。旧版：`gh api --method POST repos/<owner>/<repo>/issues/<子编号>/dependencies/blocked_by -F issue_id=<阻塞任务数据库编号>`。数据库编号用 `gh api repos/<owner>/<repo>/issues/<编号> --jq .id` 取，不是 `#编号`，也不是 `node_id`。所有阻塞项关闭，任务才可开工。
- 数未关闭的阻塞项：`gh api repos/<owner>/<repo>/issues/<编号> --jq .issue_dependencies_summary.blocked_by`。`gh issue view <编号> --json blockedBy` 会带出已关闭的，要过滤：`--jq '[.blockedBy.nodes[] | select(.state == "OPEN")] | length'`。
- 评论：`gh issue comment <编号> --body "..."`。
- 增删标签：`gh issue edit <编号> --add-label "..."` 或 `--remove-label "..."`。
- 关闭：先用 `gh issue comment <编号> --body "..."` 写说明，再 `gh issue close <编号>`。对已关闭的 issue，`gh issue close --comment` 会丢掉评论，退出码仍是 0。

只往本仓库建 issue，不要往上游 `mattpocock/skills` 建。每次会话第一次 `gh issue create` 前，先用 `gh repo view --json nameWithOwner` 核对目标；不是 `Lil-BobCN/grilling-remote` 就先问。

## 是否把 Pull Request 纳入分类处理

**否。** 目前只有你自己的提交，没有外部贡献者。以后要纳入时，读 PR 正文和评论要分两次：`gh pr view <编号>`，再 `gh pr view <编号> --comments`（非终端环境下 `--comments` 只打印评论）。

## 其他 Skill 如何操作

- "发布到任务系统" = 创建一个 GitHub Issue。
- "读取相关任务" = 运行 `gh issue view <编号> --json number,title,body,labels,comments`。

## Wayfinder 约定

- **总任务**：带 `wayfinder:map` 标签的 Issue，正文记录笔记、已做决定和仍不清楚的地方。
- **子任务**：优先用 GitHub sub-issue（见"设为子任务"）；不可用时在总任务和子任务正文里互相引用。按类型打 `wayfinder:research`、`wayfinder:prototype`、`wayfinder:grilling`、`wayfinder:task` 标签。地图和它的票只带 `wayfinder:*`，不打 `ready-for-agent`。
- **阻塞关系**：优先用 GitHub 原生 issue dependencies（见"阻塞"）。原生依赖不可用时，在子任务正文顶部写 `Blocked by: #<编号>`。
- **选择下一项**：按总任务里的顺序检查未关闭子任务，跳过仍有未关闭阻塞项或已分配负责人的。
- **领取**：`gh issue edit <编号> --add-assignee @me`，这是一次工作会话的首次写操作。
- **完成**：先评论结论，再关闭子任务，最后把链接补到总任务的"已做决定"里。

## 地图上的变动怎么留痕

一个决定被后来的票推翻，旧票、旧索引行、开放票的前提都要同步处理。否则 `to-spec` 会读到两个互相矛盾的说法。三个动作管这件事：冒头、关票扫描、开工核对。

规则只写在这一节。技能 `wrap-up` 和 `map-gate` 引用本节，不另抄。引用票时写票名，链接包在票名里，不单写编号。

状态：2026-11-06 起草，没试跑。

### 冒头

冒头指谈话中冒出来、还没落到票或地图里的新需求。

1. 先记一条，附原话。不当场展开。
2. 会话结束前跑 `/wrap-up`，由运营者逐条判去向：新票、并入已有票、未定、范围外、当场做完。
3. 领取了某张票的会话里发现的事，一律归这张地图，不当散票。判据看在哪发现的，和事情大小无关。
4. 建票前先搜 open 和 closed 票，能并进已有票就并。
5. 运营者点头的才建。

### 关票扫描

关闭一张票之前，先在这张票上评论一份扫描表。没有扫描表，不关票。表有五项：

1. 本票结论，一句话。
2. 产出了什么，推迟了什么。例：决定了要写 ADR 但没写，下游票的阻塞要保留。
3. 地图下每张开放票和「未定」每一项，各判一档：无关、前提受影响、与结论矛盾、阻塞变化。每行写一句理由。整表只写「无影响」不算数。
4. 地图 `Decisions so far` 每一行，判现行还是已废。
5. 碰到已关闭决定的矛盾，列出来，由运营者判。agent 不自己判。

按判定结果这样改：

| 对象 | 怎么改 |
| --- | --- |
| 开放票 | 原地改正文，删掉被推翻的前提，末尾记一行「按 <票名> 更新」 |
| 已关闭票 | 正文不动，加评论「被 <票名> 部分取代」，写明哪一部分 |
| 地图索引行 | 保留原行，行首标「已废，见 <票名>」 |
| 已关闭的决定被推翻 | 新开一张取代票，旧票不重开 |
| 阻塞边 | 按第 2 项补加或移除 |

上面「完成」一步照此执行：先贴扫描表，再关闭子任务，最后把链接补到「已做决定」。

### 开工核对

领取一张票之后、动手之前，把票里写的前提和阻塞，对照这张票创建以来关闭的票再查一遍。前提变了，先改票，再开工。

查法：`gh issue list --state closed --search "closed:>=YYYY-MM-DD" --json number,title,closedAt`，日期取这张票的创建日。

### 关票之后：下一步建议

关闭一张子票、把链接补进「已做决定」之后，运营者最想知道的是下一步做哪张。读阻塞关系很费力，所以由技能 `next` 算出来，只给一句结论。

1. 关票后先跑 `/wrap-up`，处理完它列出的新需求和冲突，再跑 `next`，把结论贴在对话里。wrap-up 可能新建票或改票，next 要等它做完再算。
2. 结论不写进票，不存文件，不打标签。它每次现算，存下来就会过期。
3. 运营者随时可以输入 `/next <地图编号>` 重算。

阻塞关系只认 GitHub 原生依赖。
