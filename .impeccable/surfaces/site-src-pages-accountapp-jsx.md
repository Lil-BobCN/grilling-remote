---
version: 1
slug: "site-src-pages-accountapp-jsx"
primary_target: "site/src/pages/AccountApp.jsx"
related_targets: ["site/src/pages/LoginPage.jsx","site/src/pages/OrdersPage.jsx","site/src/pages/OrderDetailPage.jsx","site/src/styles/account.css","site/src/styles/orders.css"]
---

## Direction contract

THESIS: 账号区是客户查进度的操作台。登录后先看每一单走到哪，再点开看这一档的细步骤；两个分支（校验未通过、已驳回）在对应位置说清楚要做什么。拒绝把五档画成彩色仪表盘，也拒绝把订单做成卡片墙。

OWN-WORLD: 沿用整站暖白纸 #f0eee6、墨黑 #141413、暖棕 #c8b69b、蓝灰 #5f7385；宋体标题、苹方正文、等宽字只给单号、时间和状态。细线分隔，不用卡片；进度用墨黑、蓝灰和虚线，不新增色板。

STORY: 客户从微信点进来，用邮箱和密码登录。订单列表一单一行，五档小进度和当前小步一眼可读。详情先给一句人话，再给五档和这一档的固定小步骤。校验未通过时看到缺什么和重新上传；驳回后看到上一轮原话和第几轮。

FIRST VIEWPORT: 登录页左边宋体标题「登录」和五档说明，右边「邮箱登录」表单，中间一条竖线。列表页标题「我的订单」、汇总句、传新需求，下面一单一行。详情页标题、当前状态块、五档和当前档的细步骤；右栏交付地址、单号、传包时间、轮次、客服入口。手机单栏，表单和状态块在前，说明和侧栏在后。

FORM: 既有世界里的操作台页 · code-led；seed: none (pinned)。地图 I-0058 的 Notes 已由运营者确认，原话「设计方向不再重选，配色不再改」；世界按 `.impeccable/surfaces/site-index-html.md`，五档和固定小步骤按 `prototype/issue-109/`。

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review and the verdict. 全站 DESIGN.md 留给 I-0069（全站验收与设计定稿）。
