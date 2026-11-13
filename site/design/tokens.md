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

`--muted-strong` 比草图的 `#8a867c` 深一档。草图的灰在暖白纸上只有 3.1:1，小字达不到 4.5:1。改后是 4.9:1。

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

## 断点

手机断点是 `900px`，写在 `base.css` 的媒体查询里。CSS 变量不能用在媒体查询条件中，所以这个值不进 `tokens.css`。

## 动效

| 变量 | 值 | 用途 |
| --- | --- | --- |
| `--motion-fast` | `160ms` | 悬停、焦点、按钮反馈 |
| `--motion-fade` | `500ms` | 淡入 |
| `--motion-fade-reduced` | `200ms` | 减少动态时只留淡入 |
| `--motion-rise` | `800ms` | 上浮和逐字入场 |
| `--motion-morph` | `520ms` | 顶栏字标从全称收成 `AF` |
| `--motion-reveal` | `700ms` | 滚动出现的位移和淡入 |
| `--motion-reveal-short` | `450ms` | 滚动出现时的去模糊 |
| `--motion-reveal-distance` | `18px` | 滚动出现的位移 |
| `--motion-stagger` | `24ms` | 标题逐字间隔 |

| 缓动变量 | 值 | 用途 |
| --- | --- | --- |
| `--ease-fade` | `cubic-bezier(0.2, 0.7, 0.1, 1)` | 透明度 |
| `--ease-rise` | `cubic-bezier(0.16, 1, 0.3, 1)` | 上浮 |
| `--ease-ui` | `cubic-bezier(0.165, 0.84, 0.44, 1)` | 悬停和焦点 |

动画规则写在 `src/styles/motion.css`。`prefers-reduced-motion: reduce` 时去掉位移和模糊，只保留淡入；视频占位的循环也停掉。

## 还没定的

- 标题宋体先用系统字体。锁定字形后要自托管中文子集，控制在 50–130 KB。来源：票 I-0061 评论 C-0375。
- Windows 上宋体标题的回退字形还没验证。来源：同上。
- 首屏视频的渐变色属于首页首屏，不进这份基础变量表。来源：地图 I-0058 的覆盖表第 1、2 句。
