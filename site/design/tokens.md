# 设计变量清单

这份清单对应 `site/src/styles/tokens.css`。色值、字体、字号、间距、线宽都从这里取，页面里不写零散数值。新增变量时，先改 `tokens.css`，再补这张表。

来源：方向契约 `.impeccable/surfaces/site-index-html.md`，选定草图 `site/design/refined-v1-anthropic-top.html`。

## 颜色

| 变量 | 值 | 用途 |
| --- | --- | --- |
| `--paper` | `#f0eee6` | 页面底色，暖白纸 |
| `--paper-raised` | `#f7f5ef` | 浅一级的纸，按钮上的字 |
| `--paper-press` | `#e6e2d6` | 浅色按钮悬停 |
| `--ink` | `#141413` | 正文、标题、粗线 |
| `--ink-soft` | `#3d3d3a` | 胶囊文字 |
| `--body` | `#4a4843` | 说明文字 |
| `--body-soft` | `#5c5a54` | 段落和页脚 |
| `--muted` | `#6f6b61` | 元信息 |
| `--muted-strong` | `#6a665c` | 等宽小字 |
| `--tan` | `#c8b69b` | 暖棕，方向契约的第四色 |
| `--slate` | `#5f7385` | 焦点框 |
| `--slate-text` | `color-mix(in srgb, var(--slate) 90%, var(--ink))` | 蓝灰当文字（链接悬停）；纸上 4.81:1 |
| `--line` | `#d9d4c7` | 细线分隔 |
| `--line-soft` | `#cfc9bb` | 元信息上方细线 |
| `--line-pill` | `#d6d1c4` | 胶囊描边 |
| `--pill-wash` | `rgba(255, 255, 255, 0.32)` | 胶囊底色 |
| `--pill-hover` | `rgba(20, 20, 19, 0.08)` | 胶囊悬停 |
| `--night` | `#0b0b0b` | 黑底区 |
| `--night-video` | `#0b0d0e` | 视频面板底色 |
| `--night-hover` | `#2b2a27` | 黑底胶囊悬停 |
| `--on-night` | `#f7f5ef` | 黑底上的字 |
| `--on-night-soft` | `#b8b4aa` | 黑底上的段落 |
| `--on-night-chip` | `rgba(247, 245, 239, 0.78)` | 黑底上的小标签 |
| `--on-night-note` | `rgba(247, 245, 239, 0.62)` | 黑底上的注释 |
| `--night-line` | `rgba(247, 245, 239, 0.5)` | 黑底上的描边 |
| `--clay` | `#d97757` | 陶土：下载按钮、首页三步第一号、技能第一组 |
| `--oat` | `#e3dacc` | 燕麦：暖色面基色、落款章底 |
| `--blue` | `#6a9bcc` | 天蓝：技能第二组序号和细线 |
| `--olive` | `#788c5d` | 橄榄：技能第三组序号、哈希块边线 |
| `--mint` | `#bcd1ca` | 薄荷：首页三步第三号 |
| `--clay-text` | `color-mix(in srgb, var(--clay) 62%, var(--ink))` | 陶土当文字 |
| `--blue-text` | `color-mix(in srgb, var(--blue) 60%, var(--ink))` | 天蓝当文字，纸上 5.0:1 |
| `--olive-text` | `color-mix(in srgb, var(--olive) 68%, var(--ink))` | 橄榄当文字 |
| `--on-accent` | `#141413` | 亮色块上的字，不随明暗模式翻转 |
| `--clay-deep` | `color-mix(in srgb, var(--clay) 88%, #141413)` | 陶土按钮悬停 |
| `--surface-warm` | `#e9e1d1`（夜间 `#2a2521`） | 暖色面：下载文件区、技能页下一步、教程卡住块 |
| `--surface-cool` | `#dfe8e3`（夜间 `#1f2824`） | 冷色面：SHA256 块 |
| `--glass-highlight` | `rgba(255, 255, 255, 0.42)`（夜间 `rgba(250, 249, 245, 0.1)`） | 顶栏玻璃顶边高光 |
| `--glass-shadow` | `rgba(20, 20, 19, 0.06)`（夜间 `rgba(0, 0, 0, 0.45)`） | 顶栏玻璃下沿阴影 |

`--muted-strong` 比草图的 `#8a867c` 深一档。草图的灰在暖白纸上只有 3.1:1，小字达不到 4.5:1。改后是 4.9:1。

## 夜间模式

页面 HTML 在样式前读 `localStorage` 的 `afk-theme`，没有就跟随系统 `prefers-color-scheme`，给 `<html>` 加 `data-theme="dark"`。`tokens.css` 末尾用 `html[data-theme="dark"]` 覆盖这些值：

| 变量 | 夜间值 |
| --- | --- |
| `--paper` | `#141413` |
| `--paper-raised` | `#1f1e1d` |
| `--paper-press` | `#30302e` |
| `--ink` | `#faf9f5` |
| `--ink-soft` | `#e8e6dc` |
| `--body` | `#c9c6bd` |
| `--body-soft` | `#b0aea5` |
| `--muted` | `#9a978e` |
| `--muted-strong` | `#87867f` |
| `--tan` | `#d4a27f` |
| `--slate` | `#8fa9bd` |
| `--line` / `--line-soft` / `--line-pill` | `#30302e` / `#262624` / `#3d3d3a` |
| `--pill-wash` / `--pill-hover` | `rgba(250, 249, 245, 0.06)` / `rgba(250, 249, 245, 0.1)` |
| `--surface-warm` / `--surface-cool` | `#2a2521` / `#1f2824` |

强调色本身不翻；`--clay-text` 等用 `var(--ink)` 混色，会自动变浅。亮色块上的字固定用 `--on-accent`。顶栏右侧的圆形按钮切明暗，选择写进 `localStorage`，同时更新 `<meta name="theme-color">`。

## 字体

| 变量 | 字体 | 用途 |
| --- | --- | --- |
| `--font-serif` | Songti SC → SimSun → Noto Serif SC → serif | 宋体标题 |
| `--font-sans` | PingFang SC → Hiragino Sans GB → Microsoft YaHei → Noto Sans SC → system-ui | 苹方正文 |
| `--font-mono` | SF Mono → SFMono-Regular → ui-monospace → Menlo → Consolas | 版本号和 SHA |

| 字重变量 | 值 |
| --- | --- |
| `--weight-regular` | `400` |
| `--weight-semibold` | `600` |
| `--weight-bold` | `700` |

| 字号变量 | 值 | 用途 |
| --- | --- | --- |
| `--text-brand` | `20px` | 顶栏字标 |
| `--text-display` | `44px` | 页面主标题 |
| `--text-display-narrow` | `32px` | 手机主标题 |
| `--text-section` | `38px` | 区块标题 |
| `--text-section-narrow` | `32px` | 手机区块标题 |
| `--text-subhead` | `26px` | 步骤标题 |
| `--text-lead` | `16.5px` | 标题下的说明 |
| `--text-control` | `16px` | 按钮和链接动作 |
| `--text-body` | `15px` | 正文 |
| `--text-ui` | `14px` | 导航、页脚、按钮 |
| `--text-pill-narrow` | `12.5px` | 手机胶囊 |
| `--text-mono` | `12.5px` | 元信息、路径 |
| `--text-micro` | `12px` | 页脚版本 |

## 间距

基准是 4px，变量名就是像素值。

| 变量 | 值 | 变量 | 值 |
| --- | --- | --- | --- |
| `--space-4` | `4px` | `--space-24` | `24px` |
| `--space-6` | `6px` | `--space-28` | `28px` |
| `--space-8` | `8px` | `--space-32` | `32px` |
| `--space-10` | `10px` | `--space-40` | `40px` |
| `--space-12` | `12px` | `--space-48` | `48px` |
| `--space-14` | `14px` | `--space-56` | `56px` |
| `--space-16` | `16px` | `--space-64` | `64px` |
| `--space-18` | `18px` | `--space-80` | `80px` |
| `--space-20` | `20px` | `--space-96` | `96px` |
| | | `--space-120` | `120px` |

页面留白：桌面 `--gutter: 64px`，手机 `--gutter-narrow: 24px`。

## 线宽和圆角

| 变量 | 值 | 用途 |
| --- | --- | --- |
| `--line-width` | `1px` | 细线 |
| `--line-width-strong` | `2px` | 焦点框 |
| `--rule` | `1px solid #d9d4c7` | 普通分隔线 |
| `--rule-soft` | `1px solid #cfc9bb` | 更浅的分隔线 |
| `--rule-ink` | `1px solid #141413` | 深色分隔线 |
| `--rule-pill` | `1px solid #d6d1c4` | 胶囊描边 |
| `--radius-pill` | `999px` | 胶囊 |
| `--radius-control` | `6px` | 按钮和控件 |

视频面板保持直角，不设圆角变量。

## 关键尺寸

| 变量 | 值 | 用途 |
| --- | --- | --- |
| `--nav-height` | `80px` | 桌面顶栏高度 |
| `--video-height` | `640px` | 桌面首屏视频 |
| `--video-height-narrow` | `420px` | 手机首屏视频 |

首页回传带的尺寸直接写在 `home.css`，没有进基础变量表：带体上下 96px（手机 64px），上排两栏 1.3fr / 0.7fr、间距 64px，入口行 1.2fr / 0.8fr、每行 104px（手机 88px）高。

## 断点

手机断点是 `900px`，写在 `base.css` 的媒体查询里。CSS 变量不能用在媒体查询条件中，所以这个值不进 `tokens.css`。

## 动效

| 变量 | 值 | 用途 |
| --- | --- | --- |
| `--motion-fast` | `160ms` | 悬停、焦点、按钮反馈 |
| `--motion-fade` | `500ms` | 淡入 |
| `--motion-fade-reduced` | `200ms` | 减少动态时只留淡入 |
| `--motion-rise` | `800ms` | 上浮和逐字入场 |
| `--motion-reveal` | `640ms` | 滚动出现的淡入 |
| `--motion-reveal-short` | `520ms` | 滚动出现时的去模糊 |
| `--motion-reveal-distance` | `22px` | 滚动出现的位移 |
| `--motion-stagger` | `24ms` | 标题逐字间隔 |

`data-reveal="row"` 的时长是 560 / 420 / 620ms，位移 14px；`data-reveal="panel"` 是向下 16px、收边 0.992；`data-reveal="fade"` 只淡入。成排条目用 `row`，大面用 `panel`，元信息用 `fade`。

| 缓动变量 | 值 | 用途 |
| --- | --- | --- |
| `--ease-fade` | `cubic-bezier(0.2, 0.7, 0.1, 1)` | 透明度 |
| `--ease-rise` | `cubic-bezier(0.16, 1, 0.3, 1)` | 上浮 |
| `--ease-ui` | `cubic-bezier(0.165, 0.84, 0.44, 1)` | 悬停和焦点 |

动画规则写在 `src/styles/motion.css`。`prefers-reduced-motion: reduce` 时去掉位移和模糊，只保留淡入；视频占位的循环也停掉。

首屏视频的横向拉伸用运行时变量 `--hero-stretch`（0–1），由 `HomePage.jsx` 按滚动写入，不放进基础变量表。它只改 `clip-path`，不改布局尺寸。

顶栏联动用运行时变量 `--hp`（0–1），由 `SiteHeader.jsx` 按滚动写入，480px 内线性走满；`--hp-shift`、`--hp-line`、`--hp-glass`、`--hp-chrome` 在 `base.css` 里从它派生，也不进基础变量表。字标每个字母的退场起点由内联 `--letter-start` 写入。

## 还没定的

- 标题宋体先用系统字体。锁定字形后要自托管中文子集，控制在 50–130 KB。来源：票 I-0061 评论 C-0375。
- Windows 上宋体标题的回退字形还没验证。来源：同上。
- 首屏视频的渐变色属于首页首屏，不进这份基础变量表。来源：地图 I-0058 的覆盖表第 1、2 句。
