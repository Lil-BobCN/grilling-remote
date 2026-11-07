# 来源和改动

2026-11-07：按 `docs/客户工作区方案.md` 更新。包改成工作区 zip，技能放在 `.dsh/skills/`。不再含 `setup-matt-pocock-skills` 和 `ask-matt`。新增 `next`、`map-gate`、`wrap-up`。路径里的 `{简称}` 改成 `{需求名}`。

本包里的上游技能基于 Matt Pocock 的 `mattpocock/skills`，MIT 许可证，版权归 Matt Pocock。

- 上游：https://github.com/mattpocock/skills
- 取用日期：2026-11-05
- 上游分支：`main`

## 改了什么

- `grilling`：开头加客户模式约束。对客户说日常中文；技术题旁加提示；客户说不懂就按推荐答案走，记进 `pending.md`；推荐答案先查证并写出处。
- `domain-modeling`：未改。
- `wayfinder`：删掉 `disable-model-invocation`；原型、任务两类加客户规则；研究结论改到 `.scratch/{需求名}/research/`，不建分支、不推送、不开 PR；补本地追踪器说明；地图加「接下来」成六段，票类型改读 `Type:` 行，补第二段开场词和开工第一句。
- `prototype`：路径改到 `.scratch/{需求名}/prototypes/`；改成双击单文件 HTML；结论写进票的 `## 结论`，不建分支、不推送、不开 PR；`UI.md` 重写成单文件三版本版；`LOGIC.md` 改路径和收尾。
- `research`：加客户模式，固定写到 `.scratch/{需求名}/research/`；没有子代理工具时自己查。
- `wait-what`：正文改成日常简体中文；允许模型自动调用。

## 本包不含的技能

- `setup-matt-pocock-skills`：工作区文件已经预先写好，不需要它。
- `ask-matt`：它路由到运营者本机才有的步骤，客户用不到。

## 本项目新写的

- `next`、`map-gate`、`wrap-up`：不来自上游。步骤参照运营者本机的同名技能，数据源换成 `map.md` 和 `issues/*.md`，不读 GitHub。
- `AGENTS.md`、`README.txt`：不来自上游。
- `docs/agents/` 下两份文件：取自 `setup-matt-pocock-skills` 里的本地追踪器和领域文档模板，已按客户工作区改写。

`安装步骤.md` 在包外，供客服使用。
