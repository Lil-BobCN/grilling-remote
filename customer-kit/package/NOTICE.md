# 来源和改动

2026-11-13：删掉 `next`、`map-gate`、`wrap-up` 三个自建技能。上游技能照原版进包，正文不改；加进 `grill-with-docs` 后共七个。

本包的七个技能直接从上游 `mattpocock/skills` 复制，正文没有改动。

- 上游：https://github.com/mattpocock/skills
- 提交：`5863806dd4e15c63174bee4e7515a4256792ecfa`
- 取用日期：2026-11-13
- 许可证：MIT，版权归 Matt Pocock

七个技能是 `domain-modeling`、`grilling`、`grill-with-docs`、`wayfinder`、`prototype`、`research`、`wait-what`。每个目录里的 `SKILL.md`、`agents/` 和同目录的格式文件都按上游原样放。

## 只改了两个开关

- `wayfinder`：删掉 `disable-model-invocation: true`，模型才能自己调它。
- `grill-with-docs`：同样删掉这一行。客户侧的提问都要走它。

`wait-what` 保持上游原样，`disable-model-invocation: true` 不动。客户用日常话说明哪里没听懂，由 `AGENTS.md` 的讲解规则处理。

## 本包不含的技能

- `setup-matt-pocock-skills`：工作区文件已经预先写好，不需要它。
- `ask-matt`：它路由到运营者本机才有的步骤，客户用不到。

## 本项目新写的

- `AGENTS.md`、`README.txt`：不来自上游。
- `docs/agents/` 下两份文件：取自 `setup-matt-pocock-skills` 里的本地追踪器和领域文档模板，已按客户工作区改写。

`安装步骤.md` 在包外，供客服使用。
