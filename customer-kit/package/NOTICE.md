# 来源和改动

本技能包基于 Matt Pocock 的 `mattpocock/skills`，MIT 许可证，版权归 Matt Pocock。

- 上游：https://github.com/mattpocock/skills
- 取用日期：2026-11-05
- 上游分支：`main`

## 改了什么

- `grilling`：开头加客户模式约束。对客户说日常中文；技术题旁加提示；客户说不懂就按推荐答案走，记进 `pending.md`；推荐答案先查证并写出处。
- `domain-modeling`：未改。
- `wayfinder`：删掉 `disable-model-invocation`；原型、任务两类加客户规则；研究结论改到 `.scratch/{简称}/research/`，不建分支、不推送、不开 PR；补本地追踪器说明。
- `prototype`：路径改到 `.scratch/{简称}/prototypes/`；改成双击单文件 HTML；结论写进票的 `## 结论`，不建分支、不推送、不开 PR；`UI.md` 重写成单文件三版本版；`LOGIC.md` 改路径和收尾。
- `research`：加客户模式，固定写到 `.scratch/{简称}/research/`；没有子代理工具时自己查。
- `setup-matt-pocock-skills`：改成模型可调用、人不可见；加“客户工作区模式”，只写本地追踪器和领域文档，不写 `AGENTS.md`，不装 triage 标签。
- `wait-what`：正文改成日常简体中文。
- `ask-matt`：重写成客户版，只路由本包八个技能。

`AGENTS-TEMPLATE.md`、`README.txt` 是本项目新写的，不来自上游。`安装步骤.md` 和装配提示词在包外，供客服和官网使用。
