# 现行决定

由 `scripts/decisions build` 从已关闭票的关票评论生成，禁止手改。改决定就改票的关票评论，再跑 build。

| id | 决定 | 取代 | 解答未定 | 产出文件 |
| --- | --- | --- | --- | --- |
| D-0001 | 一项决定只在关票评论的四列表里写一次，五列固定为 `id`、`决定`、`取代`、`解答未定`、`产出文件`；没有结论的票第一行写 `无结论：<理由>` | 无 | 无 | docs/agents/issue-tracker.md |
| D-0001a | 编号形如 `D-0002`，全仓连续，从 `D-0001` 起；同一张票第二条起加小写字母后缀；编号写完不复用，新号取台账最大号加一 | 无 | 无 | docs/agents/issue-tracker.md |
| D-0001b | 开放票正文第一行写 `依据：D-0002,D-0005`，不依赖任何已定决定时写 `依据：无` | 无 | 无 | docs/agents/issue-tracker.md |
| D-0002 | 术语表用「决定」「台账」「依据」「推迟」四个词，旧词「已废」改成「被取代」；「扫描表」定义成决定的唯一写入点，「现行决定」定义成台账里没被标被取代的行 | 无 | 无 | GLOSSARY.md |
| D-0002a | 换法记进 ADR 0008：写入点退到关票评论，台账和地图 `Decisions so far` 由 `scripts/decisions build` 生成，验证分脚本八条加人工抽查两处 | 无 | 无 | docs/adr/0008-决定写在关票评论，台账编译生成.md |
| D-0002b | `init-trail` 的 `glossary-trail.md` 模板随词条重新生成，不手改 | 无 | 无 | .claude/skills/init-trail/templates/glossary-trail.md |
| D-0002c | `docs/decisions.md` 只收现行决定；被取代的条目连编号带原行挪进 `docs/decisions-archive.md`，原样保留。ADR 整份被取代时删掉，靠 git 历史找回；部分被取代的保留，开头指向新 ADR | 无 | 无 | GLOSSARY.md、docs/adr/0008-决定写在关票评论，台账编译生成.md |
| D-0002d | 新编号取 `docs/decisions.md` 和 `docs/decisions-archive.md` 里最大的号加一；两个文件都不存在时，取所有已关闭票评论里的最大号加一 | 无 | 无 | docs/adr/0008-决定写在关票评论，台账编译生成.md |
| D-0002e | `to-spec` 读地图全文、`docs/decisions.md` 和台账里这条决定对应的来源票，地图 `Decisions so far` 只当索引；`map-gate` 与 `spec-check` 都按这个读法改，清单评论降为放行报告 | 无 | 无 | GLOSSARY.md、docs/adr/0008-决定写在关票评论，台账编译生成.md、docs/adr/0006-地图变动要留痕.md |
