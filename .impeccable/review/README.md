# 全站验收截图

来源：issue #254「全站验收与设计定稿」。截图在 2026-11-14 用本地开发服务（`npm run dev`，端口 5175）和 Chromium 1440×900、1920×1080、390×844 三个视口拍。

长页截图先撤掉 `js-motion` 并给 `[data-reveal]` 补 `is-revealed`，让滚动出现的段落一次显示完；这不改页面源码，只影响截图。

`desktop.png` 和 `mobile.png` 是 finish reviewer 要的标准文件名，内容分别等于 `1440-home.png` 和 `390-home.png`。

## 全站三档

| 文件 | 页面 |
| --- | --- |
| `1440-home.png`、`1920-home.png`、`390-home.png` | 首页 |
| `1440-download.png`、`1920-download.png`、`390-download.png` | 下载 |
| `1440-skills.png`、`1920-skills.png`、`390-skills.png` | 技能清单 |
| `1440-tutorial.png`、`1920-tutorial.png`、`390-tutorial.png` | 教程 |
| `1440-app.png`、`1920-app.png`、`390-app.png` | 登录 |
| `1440-app-upload.png`、`1920-app-upload.png` | 上传（没连上服务的状态） |
| `390-app-upload.png` | 上传表单在 390 的单栏重排（临时 mock 的登录态） |
| `1440-app-orders.png`、`1920-app-orders.png`、`390-app-orders.png` | 订单（没连上服务的状态） |

## 上传页状态

| 文件 | 状态 |
| --- | --- |
| `state-upload-login.png` | 没登录，页内登录表单 |
| `state-upload-disabled.png` | 选好 zip，没勾「已问完」，上传按钮禁用 |
| `state-upload-notzip.png` | 不是 zip 的错误 |
| `state-upload-toobig.png` | 超过 50 MB 的错误 |
| `state-upload-ready.png` | 勾上「已问完」，可以上传 |
| `state-upload-progress.png` | 上传中，进度条和百分比 |
| `state-upload-success.png` | 已收到，聚焦成功面板 |

点「再传一个」后的重置状态没有单独截图：文件行、勾选、按钮和提示一起回到初始态，检查结果写在票的评论里。

账号接口不在本仓库，状态图用临时 mock 服务（`/app/api/session`、`/app/api/uploads`）跑出来，mock 服务不进仓库。

## 订单页

`mock-orders-*.png`、`mock-order-detail-*.png`、`mock-order-invalid-*.png`、`mock-order-rejected-*.png` 用临时 mock 数据拍，覆盖五档中段、待客户验收、校验未通过和驳回后第二轮。同上，mock 服务不进仓库。

## 检查记录

- 横向滚动：7 条路径 × 3 个宽度，`scrollWidth` 都等于 `clientWidth`。
- 键盘：每页从「跳到正文」开始 Tab，导航、下载、上传、订单都能走到；焦点框是 2px 蓝灰，深色区改成纸色。
- 触控：手机上胶囊、按钮、页脚链接都不小于 44px；正文里的行内链接按 WCAG 2.5.8 的行内例外处理。
- `impeccable detect site/dist`：0 条。例外和理由在 `.impeccable/config.json`。
