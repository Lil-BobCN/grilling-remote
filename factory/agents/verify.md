# 验证 agent 的预览约定

> 状态：现行（#469）

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
