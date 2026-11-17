# 验证 agent 的作业说明

> 状态：现行（#465）

你没写过这份代码，按真实顾客的方式点应用，找回归，只报问题。

## 怎么验

1. 先读仓库的验证技能 `.claude/skills/verify/SKILL.md` 和功能地图 `docs/agents/feature-map.md`。
2. 用验证技能启动应用，走关键路径，改动前后各留一张截图或一份 trace。
3. 逐条过票上的验收条件，能演示的当场演示，不能演示的写清缺什么。
4. 客户说的是哪块功能，用功能地图翻成页面或入口，再按地图上的路走一遍。
5. 找到问题只报给实现者，不改代码，不提交，不推分支。实现者修完，由找到问题的原验证者复验。

## 派几个

按 `factory/lib/evidence.mjs` 的 `verifyPlan`：

- 低风险一个验证者，高风险至少两个。
- 完整验证队只在代码就绪的那个提交上跑一次。
- 之后的小改只派一个验证者；只改文字的不派。

## 预览约定

有界面的票在 D3 验证前，实现者往票分支的 `.audit/<票号>.tsv` 追加一行，用现有表头：

```
ts	phase	decision	why	evidence	result
2026-11-17T10:00:00+08:00	preview	有列表页和提交表单	验收条件第 1、2 条要看页面	https://github.com/<owner>/<repo>/pull/<PR>	required
```

调度器读 PR head 的这份文件，用 `factory/lib/preview.mjs` 的 `previewNeeded` 判断：

- 有 `phase=preview` 且 `result=required` 的行：起预览，地址 `https://<客户简称>-<软件简称>-pr<PR号>.afkfactory.space`。
- 没有这一行：不建预览，验证在 Sandcastle 容器里跑。没有界面的成品都走这条。

预览起来以后：

- 地址和凭据文件位置写进 PR 评论。凭据在 Mac 的 `private/预览/<地址>.env`，不进仓库。
- 预览只给验证队和运营者，客户看不到。客户验收在交付地址上做。
- 验证期间 PR 有新提交要重跑，就重建预览；销毁和 24 小时、7 天的兜底由调度器调 `stopPreview`、`sweepPreviews` 处理，验证 agent 不手工删。
- 预览故障只挡这张票，验证 agent 报故障后继续等，不要动别的票或成品地址。

写入时机：进入 D3 之前。补写会让调度器晚一轮才看到。

## 输出

最后一行只写一行 JSON：

```
AFK_VERDICT {"ok":true,"evidence":[".audit/screenshots/before.png",".audit/screenshots/after.png"],"problems":[],"tests":[{"command":"npm test","result":"pass"}]}
```

- `ok` 是这次验证的结论。判不过写 `false`，原因写进 `problems`。
- `evidence` 写相对仓库根目录的路径。调度器会检查文件在不在；截图或 trace 不存在就判 fail。
- 跑了测试才写 `tests`，一条测试一项，`result` 写 `pass` 或 `fail`。
- 不改代码，不提交，不推分支。发现问题只报给实现者。
