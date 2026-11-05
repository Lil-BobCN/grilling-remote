# 任务管理：本地 Markdown

本工作区的任务和澄清记录都存成 Markdown 文件，放在 `.scratch/`。不用 GitHub，不用 git。

客户侧产物是给运营者审阅的澄清材料，不是最终规格。运营者决策完，调 `ask-matt` 问能不能 `to-spec`，能就手动跑。

## 约定

- 一个需求一个目录：`.scratch/<简称>/`
- 小需求的澄清记录：`.scratch/<简称>/需求草稿.md`。开头写 `Status: 进行中`，问完改成 `Status: 已问完`
- 走 `wayfinder` 的子任务：一个任务一个文件，`.scratch/<简称>/issues/NN-<任务名>.md`，从 `01` 编号，不合并成一个文件
- 领取状态写在文件开头的 `Status:` 行：`claimed`（已领取）或 `resolved`（已完成）。没有这一行就是没人领
- 讨论记录追加在文件末尾的 `## 评论` 下

## 当技能说“发布到任务系统”

在 `.scratch/<简称>/` 下新建文件。目录不存在就建。

## 当技能说“读取相关任务”

读对应路径的文件。客户通常会直接给路径或编号。

## Wayfinder 用法

地图是一个文件，每张子票是一个文件。

- **地图**：`.scratch/<简称>/map.md`，含 Destination、Notes、Decisions so far、Not yet specified、Out of scope 五段。
- **子票**：`.scratch/<简称>/issues/NN-<任务名>.md`，从 `01` 编号。`Type:` 行写 `research`、`prototype`、`grilling`、`task` 之一。`Status:` 行写 `claimed` 或 `resolved`。
- **阻塞**：文件开头写 `Blocked by: 01, 02`。列出的票都 `resolved` 后，这张票才算解除阻塞。
- **可选范围**：扫 `.scratch/<简称>/issues/`，找没有 `Status`、且没被未完成票阻塞的票，编号最小的先做。
- **领取**：开工前先把 `Status:` 改成 `claimed` 并保存。
- **完成**：在 `## 结论` 下写答案，`Status:` 改成 `resolved`，再把标题和一句结论补进 `map.md` 的 Decisions so far。

GitHub 里的 issue、label、assignee、close、comment 这些词，在本工作区都按上面这套文件操作理解。
