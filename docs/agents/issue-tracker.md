# 任务管理：GitHub Issues

本仓库的任务和产品规格统一放在 GitHub Issues 中，使用 `gh` CLI 操作。
仓库为私有仓库 `Lil-BobCN/grilling-remote`，在仓库目录内运行时 `gh` 会自动识别。

## 常用操作

- 创建：`gh issue create --title "..." --body "..."`。多行正文用 heredoc。
- 查看：`gh issue view <编号> --comments`，同时读标签；需要筛评论时用 `jq`。
- 列表：`gh issue list --state open --json number,title,body,labels,comments`，再按状态和标签筛选。
- 评论：`gh issue comment <编号> --body "..."`。
- 增删标签：`gh issue edit <编号> --add-label "..."` 或 `--remove-label "..."`。
- 关闭：`gh issue close <编号> --comment "..."`。

## 是否把 Pull Request 纳入分类处理

**否。** 目前只有你自己的提交，没有外部贡献者。

## 其他 Skill 如何操作

- "发布到任务系统" = 创建一个 GitHub Issue。
- "读取相关任务" = 运行 `gh issue view <编号> --comments`。

## Wayfinder 约定

- **总任务**：带 `wayfinder:map` 标签的 Issue，正文记录笔记、已做决定和仍不清楚的地方。
- **子任务**：优先用 GitHub sub-issue；不可用时在总任务和子任务正文里互相引用。按类型打
  `wayfinder:research`、`wayfinder:prototype`、`wayfinder:grilling`、`wayfinder:task` 标签。
- **阻塞关系**：优先用 GitHub 原生 issue dependencies，创建时需要阻塞任务的数据库编号。
  原生依赖不可用时，在子任务正文顶部写 `Blocked by: #<编号>`。
- **选择下一项**：按总任务里的顺序检查未关闭子任务，跳过仍有未关闭阻塞项或已分配负责人的。
- **领取**：`gh issue edit <编号> --add-assignee @me`，这是一次工作会话的首次写操作。
- **完成**：先评论结论，再关闭子任务，最后把链接补到总任务的"已做决定"里。
