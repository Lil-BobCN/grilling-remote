# 项目规则

## 语言

- 默认用中文写自然语言内容：说明、文档、Issue 标题与正文、提交信息里的描述部分。
- 能准确翻译的翻成中文：先理解原意，再按中文里真实会说的方式重写，句子短、直接、好懂。
- 不该翻译的保留原文：代码、命令、路径、文件名、变量名、API 名称、官方产品名，以及翻译后失真的专有名词。
- 不要机翻腔：不逐词对译英文模板，不堆空话、客套和套词收尾。

## Agent skills

### 任务管理

任务和产品规格放在 GitHub Issues（`Lil-BobCN/grilling-remote`），用 `gh` CLI 操作。详见 `docs/agents/issue-tracker.md`。

### 分类标签

处理状态用五个固定标签：`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`。详见 `docs/agents/triage-labels.md`。

### 领域文档

采用单一上下文：根目录 `CONTEXT.md` 记领域词汇，重大决定写进 `docs/adr/`。详见 `docs/agents/domain.md`。
