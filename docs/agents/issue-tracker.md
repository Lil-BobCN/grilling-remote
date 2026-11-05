# 任务管理：GitHub Issues

本仓库的任务和产品规格统一放在 GitHub Issues 中，使用 `gh` CLI 操作。
仓库为私有仓库 `Lil-BobCN/grilling-remote`，在仓库目录内运行时 `gh` 会自动识别。

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
