# Grilling 技能的网页交互仓库调研

调研日期：2026-11-04。

## 结论

最符合“保留 Matt Pocock 的 grilling 技能，用前端承载交互”的仓库是：

**[intelligentrascal/skills](https://github.com/intelligentrascal/skills)**

它提供 grill-me-ui、grill-docs-ui 和内部传输层 grilling-ui。做法是：

1. 先加载 Matt Pocock 的原始 grilling 技能。
2. 保留原来的决策树、frontier（当前可问的问题集合）、分轮提问和推荐答案。
3. 用 grilling-ui 把终端输出替换成浏览器页面。
4. 网页展示整轮问题卡片。
5. 用户可以选答案、写自由文本、讨论单题、延后、重开、请求视觉原型。
6. 点击 **Send** 后，agent 才收到这一轮操作。
7. 点击 **Finish** 后，agent 写设计文档。

关键源码：

- [grill-me-ui 包装技能](https://github.com/intelligentrascal/skills/blob/main/skills/grill-me-ui/SKILL.md)
- [浏览器传输技能](https://github.com/intelligentrascal/skills/blob/main/skills/grilling-ui/SKILL.md)
- [本地 hub](https://github.com/intelligentrascal/skills/blob/main/skills/grilling-ui/hub.mjs)
- [页面入口](https://github.com/intelligentrascal/skills/blob/main/skills/grilling-ui/page/inbox.html)
- [页面交互逻辑](https://github.com/intelligentrascal/skills/blob/main/skills/grilling-ui/page/core.js)
- [服务端安全边界](https://github.com/intelligentrascal/skills/blob/main/skills/grilling-ui/lib/server.mjs)

仓库元数据：MIT 许可证，主要语言 JavaScript，默认分支提交 `589b9c73b2ebab8f693b644c2793d46b7e9c4d38`，日期为 2026-10-07。代码形态是 Node 本地 hub 加单页 HTML/CSS/JS，无构建依赖。

我按 README 运行了 `node --test skills/grilling-ui/test/*.test.mjs scripts/test/*.test.mjs plugins/rascal/test/*.test.mjs`：346 项通过、1 项因本机没有上游 Wayfinder 缓存而跳过、0 项失败。浏览器 E2E 测试没有运行。

## 为什么它最像你记得的项目

仓库 README 明确说：

> The interview method stays Pocock's: each wrapper loads his grilling skill first, then grilling-ui swaps the terminal transport for the page.

这对应你的记忆：

- 技能负责怎么问。
- 前端负责怎么显示和收集答案。
- 不重新发明 grilling 的决策树逻辑。
- 视觉原型是浏览器交互的一部分。

## 前端交互方式

该仓库已经覆盖 Issue 16 需要的主要交互：

| Issue 16 的需求 | 该仓库的实现 |
| --- | --- |
| 一轮展示多个问题 | 每轮把整个 frontier 显示为问题卡片 |
| 推荐答案 | 每题有推荐项，可直接接受 |
| 自由输入 | 问题卡支持自由文本 |
| “看不懂” | 单题讨论线程和后续解释 |
| 请求示意图 | 页面可请求 Visualize |
| 原型页 | agent 生成 visual.html，页面放进 iframe |
| 修改原型 | 视觉反馈进入 visual thread，下一次 Send 触发重画 |
| 延后问题 | 卡片支持 Defer |
| 重新打开 | 已处理问题支持 Reopen |
| 事实查询 | agent 后台查，页面用 note 和状态反馈 |
| 等待 agent | 页面显示是否正在监听，未监听时 Send 会排队 |

值得借鉴的细节：

- 选项先暂存，点击 Send 才一次性发给 agent。
- 刷新后暂存答案仍保留。
- 一次 Send 可以包含多个答案、thread 回复和视觉反馈。
- 原型页面有版本号。只有版本变化时才刷新 iframe。
- 问题卡和视觉原型可以互相高亮。
- agent 不监听时，页面明确显示发送会排队。

## 第二候选：jasonku09/grill-with-ui

仓库：[jasonku09/grill-with-ui](https://github.com/jasonku09/grill-with-ui)

它是独立的浏览器版 Agent Skill。README 明确写了：

- 每道题是一张卡片。
- 有字母选项和推荐项。
- 可以延后、重开和讨论单题。
- Send to Agent 一次提交所有暂存操作。
- Explore deeper 显示选项利弊。
- Visualize 生成交互式原型。
- 状态由 agent 写入 state.json。
- 页面把 Send 追加到 events.jsonl。
- Node server 加单 HTML 文件，无依赖、无构建。

仓库元数据：MIT，326 stars，52 forks。默认分支最新提交为 fc0de407，日期为 2026-10-22。

我在仓库运行了 node --test test/server.test.mjs，48 个测试全部通过。

源码：

- [README](https://github.com/jasonku09/grill-with-ui/blob/main/README.md)
- [SKILL.md](https://github.com/jasonku09/grill-with-ui/blob/main/SKILL.md)
- [页面](https://github.com/jasonku09/grill-with-ui/blob/main/page.html)
- [服务端](https://github.com/jasonku09/grill-with-ui/blob/main/server.mjs)

## 第三候选：adesombergh/bbq

仓库：[adesombergh/bbq](https://github.com/adesombergh/bbq)

它是 MCP 加浏览器 UI，实现了：

- 通过 MCP server 驱动浏览器页面。
- 运行 grilling 技能的多轮提问。
- 每道题支持按钮或自由文本。
- 单题右侧有 Wait what、Show me 和 ELI5。
- 可通过 bbq-offload 把其他技能的问题转到浏览器。
- MCP 工具包括 open_session、ask_round、wait_for_answers、post_aside 和 close_session。
- WebSocket 负责状态推送。
- 每轮只有一个 open round。
- 默认按顺序回答问题。

它特别适合参考 Issue 16 的“看不懂”链路：

- Wait what：重讲当前题。
- Show me：给当前题画图或给原型。
- ELI5：用白话解释。
- 解释内容进入右侧上下文面板，不替换原问题。

它的 HTML aside 使用脚本关闭的 sandbox iframe，代码在 `ui/src/components/html-frame.tsx`。当前主分支提交为 2026-10-05，版本 0.1.0。README 要求 Bun 1.4 或更高版本，本机没有 Bun，因此没有运行它的测试。

它的 iframe 配置含 `allow-same-origin`，虽然不允许脚本运行。这和 Issue 16 已选的“不加 `allow-same-origin`”不同，不能直接照搬它的沙箱配置。

源码：

- [README](https://github.com/adesombergh/bbq/blob/main/README.md)
- [MCP 入口](https://github.com/adesombergh/bbq/blob/main/src/mcp.ts)
- [问题卡](https://github.com/adesombergh/bbq/blob/main/ui/src/components/question-card.tsx)
- [侧栏](https://github.com/adesombergh/bbq/blob/main/ui/src/components/aside-panel.tsx)
- [iframe](https://github.com/adesombergh/bbq/blob/main/ui/src/components/html-frame.tsx)

## 第四候选：newstonnate-png/visual-grilling

仓库：[newstonnate-png/visual-grilling](https://github.com/newstonnate-png/visual-grilling)

它是另一条路线：

- 每轮把整个 frontier 放在一个本地网页。
- 支持单选、多选、量表、排序、自由文本和内联 SVG。
- 用 Claude Code / Codex Stop hook 暂停 agent turn。
- 用户提交后，hook 恢复 agent turn。
- 每轮 token 隔离。

我运行了 python tests/test-isolation.py：21 项通过，1 项失败。失败项是无 session id 时的 fallback round 没有按测试预期交付。因此不能把它标记为全绿。

它更像“把一轮表单外置给浏览器”，不像带持续状态、单题解释和原型反馈的长会话 UI。

## 上游原始技能的视觉提案

Matt Pocock 的上游仓库有一个仍开放的提案：

[Proposal: grilling puts visual options in front of the user as wireframes](https://github.com/mattpocock/skills/issues/1125)

提案要求：

1. 计算 frontier。
2. 把问题分成普通问题和视觉问题。
3. 普通问题继续用文字提问。
4. 为视觉问题的每个选项画低保真 wireframe。
5. 在每个选项下写取舍并标记推荐项。
6. 用户仍按问题编号回答。

这个提案很适合 Issue 16 的“题、选项、示意图由谁生成”问题，但它仍是上游提案，不是已合并实现。

## 论坛检索

没有找到可核实的 HN 或 Reddit 讨论能证明这些项目来自某篇论坛帖子。论坛搜索结果噪声较多，不作为结论依据。

## 和 Issue 16 的关系

Issue 16 当前的 prototype/clarify.html 只演示：

固定题卡 → 中文重讲 → 原型小窗。

调研显示，真实网页形态应分成两层。

以上候选仓库都把页面开在 agent 所在机器的 loopback（本机回环地址）上。它们不是面向客户的托管接单网站。适合参考交互和本地 agent 通信，不是可直接部署给客户使用的成品。

### 第一层：整轮澄清页

参考 intelligentrascal/skills 和 grill-with-ui：

- 一轮显示整个 frontier。
- 每道题是一张卡片。
- 推荐答案明显标记。
- 自由输入和选项并存。
- 答案先暂存，点击 Send 才发给 agent。
- 单题 thread 用于追问。
- Defer / Reopen 控制问题状态。
- 页面显示 agent 是否正在监听。
- 事实查询中显示“正在查”，不阻塞无关题。

### 第二层：单题解释和原型页

参考 bbq 和 intelligentrascal/skills：

- “看不懂”是当前题右侧的上下文面板。
- 面板提供 Wait what、Show me、ELI5 三类入口。
- Wait what 保留题目和选项，只替换解释。
- Show me 输出图或 HTML 原型。
- 原型只在隔离 iframe 中显示。
- 视觉反馈和题目建立关联。
- 原型版本变化时才刷新 iframe。

### 最小下一步

不建议马上重写成完整 MCP 产品。最小有效路径是：

1. 把 prototype/clarify.html 的单题演示改成整轮题卡列表。
2. 增加答案暂存和一次 Send。
3. 给每张题卡加 thread、Defer、Reopen。
4. 把“看不懂”改成右侧面板，先实现 Wait what。
5. 再接 Show me 和原型 iframe。
6. 最后再接真实 agent 状态、事实查询和 Send 事件。

这样先验证前端交互模型，再决定是否采用 intelligentrascal/skills 的 Node hub 或 bbq 的 MCP 加 WebSocket 架构。
