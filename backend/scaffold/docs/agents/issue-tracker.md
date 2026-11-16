# 任务管理：GitHub issue

这个仓库的任务全部记在 GitHub issue 里。没有别的追踪器。

## 三层结构

| 层 | 是什么 | 放在哪 |
| --- | --- | --- |
| 父工单 | 一张需求 | 一个 issue，标题用客户原话 |
| 子票 | 一个垂直切片 | 父工单的 sub-issue |
| spec | 一次开发的规格 | 独立 issue，不挂父工单 |

子票必须挂在父工单下面。父工单下面只挂实现子票。

## 看任务

```bash
gh issue list --state open --json number,title,labels
gh issue view <编号> --json number,title,body,labels,comments
```

要读评论全文时加 `--comments`。任务状态只从 issue 和标签推导，不另写进度文件。

## 标签

九个标签已经在仓库里建好。不要另造同义词，不要新建标签。

| 标签 | 用在哪 | 谁贴 |
| --- | --- | --- |
| `状态:已提交` | 父工单 | 建单时 |
| `状态:排队中` | 父工单、子票 | 建票时 |
| `状态:开发中` | 父工单、子票 | 自动化 |
| `状态:待验收` | 父工单、子票 | 自动化 |
| `needs-triage` | 任意 | 人工 |
| `needs-info` | 任意 | 自动化或人工 |
| `ready-for-agent` | spec | 人工，表示可以开工 |
| `ready-for-human` | 任意 | 人工 |
| `wontfix` | 任意 | 人工，确定不做 |

- 状态标签只由自动化改。agent 不贴、不摘。
- 子票只挂 `状态:*`，不挂 `ready-for-agent`。
- 标签含义和颜色见 `docs/agents/triage-labels.md`。

## 建票

```bash
gh issue create --title "顾客看到什么" --body "$(cat body.md)" --label "状态:排队中"
```

- 建之前先搜 open 和 closed，能并进已有票就加评论，不新建。
- 标题写这张票做完后顾客能看到什么，不写实现步骤。
- 子票正文三段：`## 垂直切片`、`## 验收条件`、`## 阻塞`。没有阻塞就删掉整段。
- 验收条件只能从父工单的验收条件里拆。要新造，先回父工单补。

## 挂子票和阻塞

```bash
gh issue edit <父编号> --add-sub-issue <子编号>
gh issue edit <子编号> --add-blocked-by <阻塞编号>
```

阻塞用 GitHub 原生依赖。所有阻塞票关闭后，这张票才能开工。

## 写评论和关票

- 干完在票上写一条评论：改了什么、跑了哪些命令、结果是什么。证据写进评论，不写进度文件。
- 子票合并后关闭。父工单的子票全部关闭后，再关父工单。
- 关票用 `gh issue close <编号>`。不删票。

## Pull request

- 一张票一个 PR。没合并前的新提交都推到同一个 PR，不另开。
- PR 正文写三样：改了什么、怎么验证的（命令和截图）、影响范围。
- PR 合并后再关票。
