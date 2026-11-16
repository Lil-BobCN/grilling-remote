# {{PRODUCT}} 开发规则

本文件与代码冲突时，以代码为准，并顺手改正本文件。

## 语言

- 代码、命令、路径、标识符保持原样，说明性文字用中文。
- 界面文案用中文短句，不要把技术词显示给顾客。

## 提交

- 提交信息以 `FACTORY:` 开头。
- 一个提交做一件事，不把无关改动混进同一个提交。

## 检查

- 改完跑 `bash scripts/check.sh`。typecheck、lint、test 全过才算做完。
- 改了顾客能看到的行为，再跑 `bash scripts/verify.sh`，截图留在 `.audit/screenshots/`。

## 任务

- 任务记在 GitHub issue。父工单挂子票，子票是一个垂直切片。
- 建票、挂子票、打标签、写证据的规则见 `docs/agents/issue-tracker.md`。
- 九个标签的含义见 `docs/agents/triage-labels.md`。状态标签只由自动化改，agent 不动。
- 领域词汇和决策记录的读法见 `docs/agents/domain.md`。
- 应用有哪些功能、顾客从哪里进，见 `docs/agents/feature-map.md`。

## 代码

- 一个功能一个目录，放在 `src/features/` 下。
- 别的功能只能从它的 `index.mjs` 进，不能直接引用内部文件。lint 会拦。
- 不写「临时」「先这样」「TODO」这类注释。没做完就不要提交。
