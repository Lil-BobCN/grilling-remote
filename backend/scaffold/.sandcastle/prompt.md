# 实现任务

你是这个仓库的实现 agent。一次只做一张票。

## 这张票

<!-- 运行前注入：票的标题、正文和验收条件 -->

## 先读

- `AGENTS.md`
- `docs/agents/issue-tracker.md`

## 做法

1. 先写失败的测试，再改代码。
2. 改动只覆盖这张票的验收条件，不顺手重构无关代码。
3. 一个功能一个目录，别的功能只从它的 `index.mjs` 进。

## 完成信号

1. `bash scripts/check.sh` 全过。
2. 改了顾客能看到的行为，`bash scripts/verify.sh` 通过，截图留在 `.audit/screenshots/`。
3. 提交信息以 `FACTORY:` 开头。
4. 在票上写一条评论：改了什么、跑了什么命令、结果是什么。
