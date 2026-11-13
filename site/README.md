# site

官网前端。React + Vite。公开页在构建时预渲染成静态 HTML，账号区在浏览器里渲染。

## 跑

```bash
cd site
npm install
npm run dev
npm run build
npm run preview
```

`npm run dev` 和 `npm run preview` 都支持干净 URL：`/download`、`/skills`、`/tutorial`、`/app/*`。线上映射按 D-0097，由上线票 I-0070 落 Caddy。

## 路由

| 路径 | 页面 | 渲染方式 |
| --- | --- | --- |
| `/` | 首页 | 构建时预渲染 |
| `/download` | 下载 | 构建时预渲染 |
| `/skills` | 技能清单 | 构建时预渲染 |
| `/tutorial` | 教程 | 构建时预渲染 |
| `/app` | 登录 | 客户端 |
| `/app/upload` | 上传工作区 | 客户端 |
| `/app/orders` | 我的订单 | 客户端 |
| `/app/orders/{id}` | 订单详情 | 客户端 |

登录是账号区入口，不单独成页。

## 预渲染怎么走

1. `vite build` 生成 5 个 HTML 和前端 bundle。
2. `vite build --ssr src/entry-server.jsx --outDir .ssr` 生成渲染入口。
3. `scripts/prerender.mjs` 把四个公开页的 HTML 写进 `dist/`，并删掉 `.ssr/`。

公开页的 HTML 里已经有完整内容，关掉 JavaScript 也能读。浏览器加载后由 `src/main.jsx` 水合。账号区 HTML 只有空壳，`src/main.jsx` 按 `data-page="app"` 挂载 `AccountApp`，再由路径决定显示哪一页。

## 目录

| 路径 | 内容 |
| --- | --- |
| `src/components/` | 顶栏、页脚、页面壳 |
| `src/pages/` | 各页面的壳。页面票在这里填内容 |
| `src/styles/tokens.css` | 色值、字体、字号、间距、线宽变量 |
| `src/styles/base.css` | 全站版式和响应式 |
| `design/tokens.md` | 变量清单，和 `tokens.css` 对应 |
| `design/refined-v1-anthropic-top.html` | 选定草图，设计参考，不参与构建 |
| `public/favicon.svg` | AF 字标图标 |
| `scripts/prerender.mjs` | 构建时写静态 HTML |

## 设计

方向契约在 `.impeccable/surfaces/site-index-html.md`，草图在 `design/refined-v1-anthropic-top.html`。页面里的颜色、字号、间距从 `tokens.css` 取，不写零散数值。新增变量时同时改 `tokens.css` 和 `design/tokens.md`。

## 检测器

`impeccable detect` 扫 `dist/` 和预览地址，桌面、手机两档都只剩一条 `cream-palette`。暖白纸底色是方向契约定下的配色，不换。其他规则没有报错。

`--muted-strong` 比草图的 `#8a867c` 深一档。草图的灰在暖白纸上只有 3.1:1，小字达不到 4.5:1。改后是 4.9:1。

## 还没做

- 标题宋体先用系统字体。锁定字形后自托管中文子集，控制在 50–130 KB。来源：票 I-0061 评论 C-0375。
- Windows 上宋体标题的回退字形还没验证。来源同上。
- 首屏视频、各页正文、账号区接口都留给后面的页面票。
- `impeccable` 的 finish review 和 `DESIGN.md` 在全站页面完成后做，票 I-0069。
