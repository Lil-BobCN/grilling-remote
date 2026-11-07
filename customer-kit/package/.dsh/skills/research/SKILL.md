---
name: research
description: Investigate a question against high-trust primary sources and capture the findings as a Markdown file in the workspace. Use when the user wants a topic researched, docs or API facts gathered, or reading legwork delegated to a background agent.
---

## 客户模式

在客户工作区，结论写到 `.scratch/{需求名}/research/<name>.md`。文件开头写清要回答的问题和日期，每条结论后面写出处链接。

没有子代理工具时，自己查，不要假装派了代理。

---

Spin up a **background agent** to do the research, so you keep working while it reads. Start it with a fresh context window.

Its job:

1. Investigate the question against **primary sources** (official docs, source code, specs, first-party APIs), not a secondary write-up of them. Follow every claim back to the source that owns it.
2. Write the findings to a single Markdown file, citing each claim's source.
3. In the customer workspace, save it to `.scratch/{需求名}/research/<name>.md`. Do not create a branch, push, or open a PR.
