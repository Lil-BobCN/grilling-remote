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
| `src/styles/home.css` | 首页：首屏、三理由、三步、技能清单、黑底回传、手机档 |
| `src/styles/motion.css` | 入场、滚动出现、减少动态 |
| `src/motion.js` | 滚动出现的观察器、离开视口暂停循环 |
| `src/components/RiseChars.jsx` | 标题逐字入场 |
| `design/tokens.md` | 变量清单，和 `tokens.css` 对应 |
| `design/refined-v1-anthropic-top.html` | 选定草图，设计参考，不参与构建 |
| `public/favicon.svg` | AF 字标图标 |
| `scripts/prerender.mjs` | 构建时写静态 HTML |

## 设计

方向契约在 `.impeccable/surfaces/site-index-html.md`，草图在 `design/refined-v1-anthropic-top.html`。页面里的颜色、字号、间距从 `tokens.css` 取，不写零散数值。新增变量时同时改 `tokens.css` 和 `design/tokens.md`。

两处用色由 live 审阅定下：

- 首页「三步装好」是深色带，步骤号底用陶土、燕麦、薄荷三色循环，见 `home.css` 的 `.home-steps--night`。
- 下载页文件区是燕麦色纸面，右下有一枚陶土落款章，旋转 -2.5 度，版本和日期和数据栏一致，见 `download.css` 的 `.download-seal`。
- 技能清单的序号、细线和很浅的底色每三行换一组陶土、天蓝、橄榄，见 `skills.css`。

2026-11-14 运营者要求下载页和技能清单页更接近 Anthropic 官网的纸面配色，强调色扩充为陶土 `#d97757`、燕麦 `#e3dacc`、天蓝 `#6a9bcc`、橄榄 `#788c5d`、薄荷 `#bcd1ca`。纸底、墨字和宋体标题不变，强调色只做色块、编号和小面积标记。完整清单见 `design/tokens.md`。

## 动效

首屏只有一段编排好的入场：标题逐字上浮、去模糊、淡入，说明和版本信息随后，视频面板带着内容最后落定。其余动效只做两件事：滚动出现，以及悬停、焦点、按钮的即时反馈。

- 页面加载入场：给元素加 `motion-rise`（文字块）或 `motion-panel`（大面），用内联 `--motion-delay` 排顺序。顶栏胶囊和字标字母另有一段加载动画，见 `base.css` 的 `header-item-in` 和 `brand-letter-in`。
- 顶栏联动：桌面端滚动 480px 内，`FACTORY` 的字母从右往左逐个退场，剩下的 `AFK` 滑到中间；一条细线从字标下方长到两侧，胶囊的底色和描边随之退掉，只剩文字。停下来后悬停，胶囊会重新长回来。手机上顶栏不吸附，也不做这套联动；减少动态时保持展开状态。
- 顶栏玻璃：滚动约 24px 内收满。纸色 96%、模糊 22px、饱和度 1.45，覆盖整宽和 80px 高，另加 1px 顶边高光；手机上不启用。
- 胶囊悬停：悬停色从中间向两侧铺开，描边和文字同时收紧；按下缩到 97%，松开回弹。减少动态时只换底色。
- 首屏视频拉伸：面板在页面里按满宽铺开，左右先用 `--gutter` 裁切；往下滚时 `--hero-stretch` 从 0 走到 1，`clip-path` 收到 0，画面横向铺满视口。进度按面板顶部收口。
- 滚动出现：给元素加 `data-reveal`，可选 `--reveal-delay`。默认块淡入 640ms、去模糊 520ms、上移 760ms；成排条目用 `data-reveal="row"`，大面用 `data-reveal="panel"`，元信息用 `data-reveal="fade"`。观察器在 `src/motion.js`，进入视口后加 `is-revealed`。
- 循环动效：给容器加 `data-motion-loop`，离开视口自动暂停。
- 标题逐字：用 `src/components/RiseChars.jsx`，标题本体用 `aria-label` 给读屏完整句子。
- 默认内容可见。`index.html` 等五个 HTML 在 `<head>` 里加 `js-motion` 类，只在 JS 接上后才收起待出现的元素；2.5 秒内没接上就撤掉这个类，避免脚本失败时页面空着。
- `prefers-reduced-motion: reduce` 时去掉位移和模糊，只留淡入；视频直接满宽，不跟随滚动；视频占位的循环停掉。

滚动出现只在成组出现时错开，不要每段都排一套延迟。同一页最多用三种动效材料：文字上浮、成排条目错开、大面收边。

## 明暗模式

- 顶栏右侧有圆形切换按钮，`ThemeToggle.jsx` 把 `data-theme` 写到 `<html>`，选择存 `localStorage` 的 `afk-theme`。
- 五个 HTML 在 `<head>` 里先读存储或系统偏好，再画页面，避免闪白。
- 夜间色值在 `src/styles/tokens.css` 的 `html[data-theme="dark"]`，清单见 `design/tokens.md`。
- 切换时同步更新 `<meta name="theme-color">`；首屏视频的渐变从 `--paper` 起，夜间不会露出浅色边。

## 检测器

`impeccable detect site/dist` 现在 0 条。例外都记在 `.impeccable/config.json` 的 `detector.ignoreValues` 里，每条带理由：

- `cream-palette`：暖白纸 `#f0eee6` 是方向契约定的底色，地图 I-0058 写着「配色不再改」。
- `low-contrast`（只限 `dist/index.html`）：静态扫描把首屏视频里的白字当成纸色背景；1440 URL 扫描不报，渲染后的背景是深色渐变。
- `repeating-stripes-gradient`：订单五档的分支状态用斜线填充做非颜色提示，是状态编码。
- `numbered-section-labels`（只限首页）：三步是必须按顺序走的流程，01/02/03 承载顺序信息。

`--muted-strong` 比草图的 `#8a867c` 深一档。草图的灰在暖白纸上只有 3.1:1，小字达不到 4.5:1。改后是 4.9:1。

## 还没做

- 标题宋体先用系统字体。锁定字形后自托管中文子集，控制在 50–130 KB。来源：票 I-0061 评论 C-0375。
- Windows 上宋体标题的回退字形还没验证。来源同上。
- 首屏视频还是动态渐变占位，真实素材到位再换。来源：地图 I-0058 的 Not yet specified、票 I-0062 评论 C-0374。
