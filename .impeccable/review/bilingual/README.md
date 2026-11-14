# 中英双语版本截图（2026-11-14）

这一组是加入顶栏语言切换后的当前构建截图，用来替换根目录 18:32 那批中文版验收图。根目录的旧图保留作历史，不再代表当前页面。

## 拍摄条件

- 构建：`cd site && npm run build`，本地 `npm run preview -- --port 4174`。
- 基线：`0e379b8` 加当前工作区改动（改动尚未提交）。
- 浏览器：Chromium，1440×900、1100×800、390×844。
- 明暗：`prefers-color-scheme` 模拟；每次拍前清掉 `afk-theme`。
- 语言：`localStorage.afk-lang` 设为 `zh` 或 `en`；英文首屏走客户端渲染。
- 长页：截图前撤掉 `js-motion` 并给 `[data-reveal]` 补 `is-revealed`，内容一次显示完；不改源码。
- 账号区：临时 mock `/app/api/session`、`/app/api/orders`、`/app/api/orders/ord-1`，登录页用 401 的 session。mock 不进仓库。

## 文件

| 文件 | 内容 |
| --- | --- |
| `{width}-{route}-{lang}-{theme}.png` | 主矩阵，100 个文件名（拍了 104 次，订单列表 1440/390 各重拍一次，同名覆盖） |
| `desktop.png`、`mobile.png` | 当前默认中文首页 1440 / 390，standard names |
| `desktop-en.png`、`mobile-en.png` | 英文首页 1440 / 390 |
| `switch-1-zh-1440.png` | 切换前，中文首页 |
| `switch-2-focus-1440.png` | 键盘焦点在语言按钮上 |
| `switch-3-en-1440.png` | 点 EN 后，英文首页 |
| `switch-4-reload-en-1440.png` | 刷新后仍是英文，无中文首屏 |
| `switch-5-back-zh-1440.png` | 切回中文 |
| `switch-6-en-390.png` | 手机英文态 |
| `checks.tsv` | 100 个文件名的 `html lang`、`data-lang`、标题、description、横向溢出、控制台错误、失败请求、字体请求 |

## 检查记录

- 横向滚动：全部拍摄的 `scrollWidth` 都等于 `clientWidth`，0 张溢出。
- 语言状态：刷新英文后 `<html lang="en">`、`data-lang="en"`、标题英文、`lang-pending` 已撤；切回中文后 `lang="zh-CN"`、无 `data-lang`、标题中文。
- 控制台：只有 12 个 `app-login` 文件名出现 401，这是 mock 的未登录会话，登录页本来就该收到；其余 88 个文件名 0 error。
- 失败请求：29 个文件名有 `favicon.svg net::ERR_ABORTED`，是连续快速导航时浏览器取消的图标请求，不影响页面。
- 字体：全新浏览器先看中文首页，只请求 HTML、JS、CSS、favicon，不请求两个字体；切到英文并刷新后才请求 `SourceSerif4-Variable.woff2` 和 `InstrumentSans-Variable.woff2`。矩阵里 50 个英文页面文件名有字体请求，0 个中文页面有。
- 检测器：`impeccable detect --json site/dist` 为 0 条。`overused-font` 的 Instrument Sans 例外和理由记在 `.impeccable/config.json`。

## 已知边界

- 公开页预渲染的仍是中文；英文是客户端切换，URL 不变。要做英文 SEO 需要另开 `/en` 路由。
- 订单标题、反馈、缺失项、试用清单由服务端返回，按运营者填写的内容显示，通常还是中文；静态界面和五档状态文字会跟着语言换。
- 英文正文里的中文例子（「需求澄清」「开始需求澄清」、继续行）是有意保留的：它们是 agent 实际识别的工作区用语。
