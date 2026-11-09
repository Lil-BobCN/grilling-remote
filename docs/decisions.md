# 现行决定

由 `scripts/decisions build` 从已关闭票的关票评论生成，禁止手改。改决定就改票的关票评论，再跑 build。

| id | 决定 | 取代 | 解答未定 | 产出文件 |
| --- | --- | --- | --- | --- |
| D-0001 | 一项决定只在关票评论的四列表里写一次，五列固定为 `id`、`决定`、`取代`、`解答未定`、`产出文件`；没有结论的票第一行写 `无结论：<理由>` | 无 | 无 | docs/agents/issue-tracker.md |
| D-0001a | 编号形如 `D-0002`，全仓连续，从 `D-0001` 起；同一张票第二条起加小写字母后缀；编号写完不复用，新号取台账最大号加一 | 无 | 无 | docs/agents/issue-tracker.md |
| D-0001b | 开放票正文第一行写 `依据：D-0002,D-0005`，不依赖任何已定决定时写 `依据：无` | 无 | 无 | docs/agents/issue-tracker.md |
| D-0002 | 术语表用「决定」「台账」「依据」「推迟」四个词，旧词「已废」改成「被取代」；「扫描表」定义成决定的唯一写入点，「现行决定」定义成台账里没被标被取代的行 | 无 | 无 | GLOSSARY.md |
| D-0002a | 换法记进 ADR 0008：写入点退到关票评论，台账和地图 `Decisions so far` 由 `scripts/decisions build` 生成，验证分脚本八条加人工抽查两处 | 无 | 无 | docs/adr/0008-决定写在关票评论，台账编译生成.md |
| D-0002c | `docs/decisions.md` 只收现行决定；被取代的条目连编号带原行挪进 `docs/decisions-archive.md`，原样保留。ADR 整份被取代时删掉，靠 git 历史找回；部分被取代的保留，开头指向新 ADR | 无 | 无 | GLOSSARY.md、docs/adr/0008-决定写在关票评论，台账编译生成.md |
| D-0002d | 新编号取 `docs/decisions.md` 和 `docs/decisions-archive.md` 里最大的号加一；两个文件都不存在时，取所有已关闭票评论里的最大号加一 | 无 | 无 | docs/adr/0008-决定写在关票评论，台账编译生成.md |
| D-0002e | `to-spec` 读地图全文、`docs/decisions.md` 和台账里这条决定对应的来源票，地图 `Decisions so far` 只当索引；`map-gate` 与 `spec-check` 都按这个读法改，清单评论降为放行报告 | 无 | 无 | GLOSSARY.md、docs/adr/0008-决定写在关票评论，台账编译生成.md、docs/adr/0006-地图变动要留痕.md |
| D-0003 | `scripts/decisions` 三个子命令：`build <地图编号>` 编两份台账并重写地图 `Decisions so far`，`check <地图编号>` 只读跑八条不变量，`chain <编号>` 只读列引用票和派生编号 | 无 | 无 | scripts/decisions、docs/decisions.md、docs/decisions-archive.md |
| D-0003a | 报错分类：第 1、2、6 条不变量和覆盖表状态非法归 A（给改法），第 3、5、7 条归 B（二选一），第 4 条和缺覆盖表归 C（建议新票） | 无 | 无 | scripts/decisions |
| D-0003b | 地图 `Decisions so far` 整段由 `build` 重写，夹在 `<!-- decisions:begin… -->` 和 `<!-- decisions:end -->` 之间，只列地图的已关闭子票，一张票一行 | 无 | 无 | scripts/decisions |
| D-0003c | 被取代的条目进 `docs/decisions-archive.md` 时保留原行，取代关系另用「被取代、被谁取代」两列表标出；`产出文件` 多路径按 `,` 或 `、` 拆，文件名里的 `，` 不拆 | 无 | 无 | docs/decisions-archive.md、scripts/decisions |
| D-0003d | 退出码 0 全过、1 有不变量破、2 用法错；`build` 和 `check` 的目标 issue 必须带 `wayfinder:map` 标签，否则退出 | 无 | 无 | scripts/decisions |
| D-0004 | `scripts/decisions check` 是独立入口，运营者先跑，`wrap-up` 只读它的输出、不重跑；`wrap-up` 由八步改六步：前置 check、扫会话查漏、查冲突、查票、给运营者看、回应后动手 | 无 | 无 | .claude/skills/wrap-up/SKILL.md |
| D-0004a | 开放票前提不在 `wrap-up` 里逐张扫，改由领取时的「开工核对」查；客户版 `wrap-up` 由七步改六步，合并「扫对话」和「查漏」，没有 check 前置 | 无 | 无 | customer-kit/package/.dsh/skills/wrap-up/SKILL.md |
| D-0005 | 开工前先选方法：改动很小 one-shot，中等以上先 `/grill-with-docs`，grilling 中雾大升级 `/wayfinder`；钱、数据、安全、公开 API 类即使小 diff 也不 one-shot；不从 `/wayfinder` 起步再降级 | 无 | 无 | docs/agents/issue-tracker.md、.claude/skills/next/SKILL.md |
| D-0005a | 票型按保真度选：低保真讨论，中保真方框箭头或线框图，高保真半可运行原型；grilling 停在抽象层面转 prototype；原型票写「用 `/prototype`」，研究票写「用 `/research`」；先拆小原型验证方案 | 无 | 无 | docs/agents/issue-tracker.md |
| D-0005b | 客户单分流（G-009）与本仓任务选方法各管各的；工厂流程、术语表、讲解的分流句加范围限定，指回 issue-tracker.md 的入口；不取代 G-009 | 无 | 无 | docs/工厂流程.md、GLOSSARY.md、docs/讲解.md |
| D-0006 | 词汇表格式以 `domain-modeling` 技能的 `GLOSSARY-FORMAT.md` 为准，本仓不再另写格式说明 | 无 | 无 | docs/agents/domain.md |
| D-0006a | ADR 只在难回退、不写会让人意外、真取舍三条同时成立时写，缺一条不写；修剪按三条复检，够不上的删掉，被取代的删留按 D-0002c | 无 | 无 | docs/agents/domain.md |
| D-0006b | `docs/agents/issue-tracker.md` 只留 GitHub 特有差异：sub-issue、原生 blocked-by、`wayfinder:*` 标签、`gh` 命令；地图结构、四种票型、frontier、关票动作指向 `/wayfinder` | 无 | 无 | docs/agents/issue-tracker.md |
| D-0007 | Destination 覆盖表由 `build` 按 `## Destination` 原文切句生成，固定四列：句、原文片段、由哪张票落、状态；切句按 `。！？`，跳过 `<details>` 旧稿、`**状态：**` 行和以冒号结尾的引导行；agent 只填第三列，有票即已落票、无票未定、原文变了标原文已改并清空旧票 | 无 | 无 | scripts/decisions |
| D-0007a | `check` 第 8 条校验覆盖表：句数和原文片段与 Destination 对齐、状态只取三值、已落票必须有票，输出行报「n 句里 m 句没落票」 | 无 | 无 | scripts/decisions |
| D-0007b | 在 D-0003 的 build、check、chain 三个子命令之外新增只读子命令 `coverage`，报「n 句里 m 句没落票」并列出没落的句子；`map-gate` 第 1 步记数、第 7 步 m 不为 0 不发布放行报告，D-0003 原文不动 | 无 | 无 | scripts/decisions、.claude/skills/map-gate/SKILL.md |
| D-0008 | 「关票扫描」的五项检查并进一张四列表：结论进「决定」列，产出进「产出文件」列，被推翻的决定进「取代」列；删掉逐张判开放票和判地图索引行两项，开放票前提改由领取时的「开工核对」查 | 无 | 无 | docs/agents/issue-tracker.md |
| D-0008a | 关票顺序写死：贴四列表 → 关票 → `scripts/decisions build` → `scripts/decisions check` → `/wrap-up` 和 `/next` → 推当前 PR → 合并；`check` 只读已关闭票，本票的四列表关票后才进 `check`，`build` 也在关票后跑 | 无 | 无 | docs/agents/issue-tracker.md |
| D-0008b | `map-gate` 第 7 步发的评论降为放行报告，不再是新会话的唯一输入；给新会话的提示词改成读地图全文、`docs/decisions.md` 和决定对应的来源票，地图 `Decisions so far` 只当索引 | 无 | 无 | .claude/skills/map-gate/SKILL.md |
| D-0008c | 被取代的 ADR 整份删掉，靠 git 历史找回；部分被取代的保留，开头指向新 ADR；流程文档的旧句句末注「被取代，见 <票名>」，四列表例子用同一说法 | 无 | 无 | docs/agents/issue-tracker.md |
| D-0008d | `customer-kit/package/` 下的同名文件是本地 Markdown 跟踪器和客户版技能，没有 `scripts/decisions`、`build`、`check`，和本仓不同构，保持原样；客户版 `wrap-up` 已在 #121 改六步 | 无 | 无 | 无 |
| D-0009 | 删除 `init-trail` 技能及其模板，不再向新项目复制地图变动留痕规则和四个技能；`map-gate`、`wrap-up`、`next`、`spec-check` 留在本仓，ADR 0006 第 2 条同步去掉 init-trail | D-0002b | 无 | docs/adr/0006-地图变动要留痕.md |
