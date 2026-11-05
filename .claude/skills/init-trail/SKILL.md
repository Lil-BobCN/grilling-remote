---
name: init-trail
description: "新项目跑完 setup-matt-pocock-skills 之后跑：装上地图变动留痕的规则、术语和三个技能。用法：/init-trail"
disable-model-invocation: true
---

给当前项目装上「地图变动留痕」：规则、术语、规则文件里的指针，和 `map-gate`、`wrap-up`、`next` 三个技能。内容来自本技能目录下的 `templates/`，和 grilling-remote 仓库里的同名内容一致。

本技能不改上游模板，也不重跑 setup。每一步先查再写：已有的不重复写，已有的文件不覆盖。

## 步骤

1. **查前提。** 三项都要有结果：
   - `docs/agents/issue-tracker.md` 存在，且含「## Wayfinder 约定」。不满足就停，告诉运营者先跑 `/setup-matt-pocock-skills`。
   - 当前目录是 git 仓库。先跑 `git status --short`，记下已有的未提交改动。
   - 规则文件：有 `CLAUDE.md` 用它，否则有 `AGENTS.md` 用它，都没有就停下来问。

   完成条件：三项各有结论，缺的写明缺什么。

2. **规则。** 把 `templates/issue-tracker-trail.md` 追加到 `docs/agents/issue-tracker.md` 末尾。文件里已有「## 地图上的变动怎么留痕」就跳过，并说明已有。完成条件：该标题恰好出现一次，`git diff` 里这个文件只有追加，旧行没动。

3. **术语。** `GLOSSARY.md` 不存在就新建，只放 `# <项目名>` 和 `## 语言` 两行标题。把 `templates/glossary-trail.md` 里的四个词追加进去，已有同名词的跳过。完成条件：冒头、扫描表、现行决定、已废各出现一次。

4. **指针。** 把 `templates/agents-pointer.md` 放进第 1 步选定的规则文件：有 `## Agent skills` 就放在这一节末尾、下一个 `##` 标题之前，没有就追加到文件末尾。已有「### 地图变动」就跳过。完成条件：该标题恰好出现一次，其他段落没动。

5. **技能。** 对 `map-gate`、`wrap-up`、`next` 各做一次：把 `templates/skill-<名>.md` 复制到 `.claude/skills/<名>/SKILL.md`。目标已存在时不覆盖：和模板比较，相同就跳过，不同就把差异列给运营者选。完成条件：三个目标文件都在，内容和模板一致，或差异已由运营者选定。

6. **报告。** 列出新建、追加、跳过各是什么，再给 `git status --short`。说明没有提交。技能有没有被加载，开新会话输入 `/next` 看是否识别。

## 不装的

本仓库的 ADR 0006 记的是本仓库为什么这样做，不带到新项目。新项目要不要写自己的 ADR，由运营者定。

## 维护

`templates/` 是拷贝。本仓库里对应的内容改了，在 grilling-remote 根目录运行 `.claude/skills/init-trail/sync-templates.sh` 重新生成。
