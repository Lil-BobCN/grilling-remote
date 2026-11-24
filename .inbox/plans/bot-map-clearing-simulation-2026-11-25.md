# I-0277 清图端到端模拟记录

日期：2026-11-25
票：I-0277「补缺口阶段由 bot 陪运营者清完地图」
测试：`factory/test/map-clearing-sim.test.mjs`

## 场景

假 GitHub 仓 `acme/acme-shuiguo` 上造一张父工单和一张六段地图：

- 父工单正文有 `- 地图：<链接>`，另有一条 `提案：补缺口` 评论。
- 地图 `Notes` 有 `- 父工单：<链接>`。
- `Not yet specified` 放两条雾：「送货范围怎么定」「起送价多少（你答）」。
- `接下来` 放一张还开着的决定票：「- 第 01 张：现有决定票」。
- `Out of scope` 放「会员积分」。

## 用到的命令

| 步骤 | 命令 | 预期 |
| --- | --- | --- |
| 1 | `map.mjs init --owner acme --repo acme-shuiguo --parent <父工单>` | Notes 加 `- 清图协议：v1` |
| 2 | `map.mjs ticket --title 送货范围怎么定 --type grilling --question 送货送到哪？ --from-item 送货范围怎么定` | 建 `02 送货范围怎么定`，清掉第一条雾，`接下来` 加一行 |
| 3 | `map.mjs defer --item 起送价多少（你答） --to notes --who 运营者 --next 下周和客户定` | 第二条雾变成 Notes 里的 `未定` 行 |
| 4 | `map.mjs conclude --ticket 01 --conclusion 维持现有做法` | 旧票写结论、关票、删 `接下来` 行、加 Decisions 行 |
| 5 | `map.mjs conclude --ticket 02 --conclusion 只送镇上，超区自取` | 新票写结论、关票、删 `接下来` 行、加 Decisions 行 |
| 6 | `map.mjs check --owner acme --repo acme-shuiguo --parent <父工单>` | 严格门禁全过 |
| 7 | `postPoint` 写 `点头：补缺口` | 门禁放行，点头落库 |
| 8 | `parseMap` 读最终地图 | 六段齐全，格式合法 |

## 断言

- `init` 返回 `added: true`。
- `ticket` 返回 `created: true`，标题 `02 送货范围怎么定`，`removedItem` 是第一条雾。
- `defer` 返回 `changed: true`。
- 两次 `conclude` 都返回 `closed: true`、`commented: true`，第二次 `decisionsAdded: true`。
- `check` 返回 `{ ready: true, blockers: [] }`。
- 再次直接调 `gateReady` 仍返回 `{ ready: true, blockers: [] }`。
- `postPoint` 返回 `true`，父工单出现 `点头：补缺口`，正文含最终答案。
- `parseMap` 不抛错，标题顺序是 Destination、Notes、接下来、Decisions so far、Not yet specified、Out of scope。
- 最终地图：`Not yet specified` 为空，`接下来` 为空，Notes 有协议标记和一条带下一步的未定行，Decisions so far 有旧票和新票各一行。

## 实际输出

命令来自测试里对 `run` 的调用，正常 CLI 用 `node factory/bin/map.mjs <子命令> --owner ... --repo ... --parent ...`。

```json
{"map":"https://github.com/acme/acme-shuiguo/issues/3","added":true}
{"map":"https://github.com/acme/acme-shuiguo/issues/3","ticket":{"number":4,"title":"02 送货范围怎么定","url":"https://github.com/acme/acme-shuiguo/issues/4"},"created":true,"removedItem":"送货范围怎么定"}
{"map":"https://github.com/acme/acme-shuiguo/issues/3","item":"起送价多少（你答）","to":"notes","changed":true}
{"map":"https://github.com/acme/acme-shuiguo/issues/3","ticket":{"number":2,"title":"01 现有决定票","url":"https://github.com/acme/acme-shuiguo/issues/2"},"commented":true,"closed":true,"decisionsAdded":true}
{"map":"https://github.com/acme/acme-shuiguo/issues/3","ticket":{"number":4,"title":"02 送货范围怎么定","url":"https://github.com/acme/acme-shuiguo/issues/4"},"commented":true,"closed":true,"decisionsAdded":true}
{"ready":true,"blockers":[]}
```

测试输出：

```text
✔ 清图协议端到端：init → ticket → defer → conclude → check → 点头 (112.562791ms)
ℹ tests 1
ℹ pass 1
ℹ fail 0
```

## 说明

这是脚本模拟。`startFakeGithub` 在内存里实现 issue、评论、sub-issue 和标签接口，跑的是真实的 `map.mjs` 命令和真实的地图解析。

真实 bot chat、真实 GitHub 写回、运营者在 chat 里逐条确认，留给第五次演练。本记录不替代演练证据。
