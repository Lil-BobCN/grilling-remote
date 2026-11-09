---
name: spec-check
description: "to-spec 写完之后跑：对照地图、台账和决定票检查 spec，标出缺的、写弱的、没有来源的。用法：/spec-check <地图编号>"
disable-model-invocation: true
---

对照地图、`docs/decisions.md` 和决定票，检查刚写完的 spec。编号在命令后面。本技能只读：不改 spec，不改地图，不发评论。改动等运营者逐条确认后另做。

核对由没见过前面对话的子代理做。本会话如果跑过 `/to-spec`，已经带着写 spec 时的理解，自己查容易放过。

## 步骤

1. **取材。** spec：运营者给了 issue 编号就用它，否则用本会话刚发布的那张，再不然列出最近带 `ready-for-agent` 的开放 issue，请运营者选。地图：编号对应 issue 的全文。台账：仓库根目录的 `docs/decisions.md`；被取代的条目在 `docs/decisions-archive.md`，只当旧说法核对，不当现行。票：`docs/decisions.md` 里每条现行决定对应的来源票，各取正文和最后一条评论；地图 `Decisions so far` 只当索引，用来核对有没有漏票。完成条件：spec 全文、地图全文、台账全文、每张现行票都在手上。缺哪个，写明缺什么，然后停。

2. **起新子代理。** DSH 用 `subagent`，Claude 用 Agent 工具选 general-purpose。提示里放步骤 1 取到的全部内容，不放本会话的任何结论。让它报五项，每条带原文一句和位置：
   - 覆盖表：每条现行决定落在 spec 的哪一栏（Problem Statement、Solution、User Stories、Implementation Decisions、Testing Decisions、Out of Scope、Further Notes），落不到任何一栏的标「缺」。
   - 写弱：决定里写明的「必须」「不得」、默认值、数字、顺序，在 spec 里变成泛泛一句。两边原文都贴。
   - 没有来源：spec 里的实现决定或用户故事，在现行决定里找不到出处，也不是某条决定的直接推论。
   - 用了旧说法：spec 引用了 `docs/decisions-archive.md` 里的内容，或地图、仓库文件里标了「已被 <票名> 取代」的旧句。
   - 把未定当成已定：地图 `Not yet specified` 里的事，在 spec 里写成了要做的事。
   完成条件：每条现行决定在覆盖表里有一行，每个问题带原文。

3. **给运营者看。** 先贴覆盖表：决定（票名带链接）、落在哪一栏、状态（齐、缺、写弱）。再列没有来源、用了旧说法、把未定当成已定的条目。第一行写结论：「齐」，或「有 n 条要处理」。

4. **运营者逐条判。** 一次给一条：两边原文、你的推荐。运营者回：改 spec、改决定（决定本身写得不对，开一张取代票，旧票不重开）、不处理。你不自己改。完成条件：每个问题都有运营者的回答。

5. **改完重查。** 运营者说 spec 改了，只重查被改的条目，不重跑全部。

## 限制

只对照地图、台账和决定票，不判断 spec 写得好不好，也不查代码。台账漏记的决定，这里看不到；所以先跑 `map-gate` 查缺口。
