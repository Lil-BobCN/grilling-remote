---
name: afkfactory 官网
description: 客户工作区的纸面操作台：暖白纸、墨线、宋体标题，不用卡片。
colors:
  paper: "#f0eee6"
  paper-raised: "#f7f5ef"
  paper-press: "#e6e2d6"
  ink: "#141413"
  ink-soft: "#3d3d3a"
  body: "#4a4843"
  body-soft: "#5c5a54"
  muted: "#6f6b61"
  muted-strong: "#6a665c"
  tan: "#c8b69b"
  slate: "#5f7385"
  slate-text: "color-mix(in srgb, #5f7385 90%, #141413)"
  clay: "#d97757"
  oat: "#e3dacc"
  blue: "#6a9bcc"
  olive: "#788c5d"
  mint: "#bcd1ca"
  on-accent: "#141413"
  surface-warm: "#e9e1d1"
  surface-cool: "#dfe8e3"
  line: "#d9d4c7"
  line-soft: "#cfc9bb"
  line-pill: "#d6d1c4"
  pill-wash: "rgba(255, 255, 255, 0.32)"
  pill-hover: "rgba(20, 20, 19, 0.08)"
  night: "#0b0b0b"
  night-video: "#0b0d0e"
  night-hover: "#2b2a27"
  on-night: "#f7f5ef"
  on-night-soft: "#b8b4aa"
  on-night-chip: "rgba(247, 245, 239, 0.78)"
  on-night-note: "rgba(247, 245, 239, 0.62)"
  night-line: "rgba(247, 245, 239, 0.5)"
typography:
  display:
    fontFamily: "Songti SC, SimSun, Noto Serif SC, serif"
    fontSize: "44px"
    fontWeight: 400
    lineHeight: 1.24
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Songti SC, SimSun, Noto Serif SC, serif"
    fontSize: "38px"
    fontWeight: 400
    lineHeight: 1.28
    letterSpacing: "0em"
  title:
    fontFamily: "Songti SC, SimSun, Noto Serif SC, serif"
    fontSize: "26px"
    fontWeight: 400
    lineHeight: 1.3
    letterSpacing: "0em"
  lead:
    fontFamily: "PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans SC, system-ui, sans-serif"
    fontSize: "16.5px"
    fontWeight: 400
    lineHeight: 1.7
  body:
    fontFamily: "PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans SC, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.7
  label:
    fontFamily: "PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans SC, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  mono:
    fontFamily: "SF Mono, SFMono-Regular, ui-monospace, Menlo, Consolas, Liberation Mono, monospace"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.6
  micro:
    fontFamily: "SF Mono, SFMono-Regular, ui-monospace, Menlo, Consolas, Liberation Mono, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  pill: "999px"
  control: "6px"
  circle: "50%"
spacing:
  space-4: "4px"
  space-6: "6px"
  space-8: "8px"
  space-10: "10px"
  space-12: "12px"
  space-14: "14px"
  space-16: "16px"
  space-18: "18px"
  space-20: "20px"
  space-24: "24px"
  space-28: "28px"
  space-32: "32px"
  space-40: "40px"
  space-48: "48px"
  space-56: "56px"
  space-64: "64px"
  space-80: "80px"
  space-96: "96px"
  space-120: "120px"
  gutter: "64px"
  gutter-narrow: "24px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "0 24px"
    height: "52px"
  button-primary-hover:
    backgroundColor: "{colors.night-hover}"
    textColor: "{colors.paper}"
  button-primary-disabled:
    backgroundColor: "{colors.paper-press}"
    textColor: "{colors.body-soft}"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 24px"
    height: "52px"
  pill:
    backgroundColor: "{colors.pill-wash}"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.pill}"
    padding: "7px 15px"
  pill-hover:
    backgroundColor: "{colors.pill-hover}"
    textColor: "{colors.ink}"
  pill-current:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
  pill-dark:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
  button-download:
    backgroundColor: "{colors.clay}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.control}"
    padding: "0 24px"
    height: "52px"
  input:
    backgroundColor: "{colors.paper-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "48px"
  drop-zone:
    backgroundColor: "{colors.paper-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "32px 20px"
  status-chip:
    backgroundColor: "{colors.paper-raised}"
    textColor: "{colors.body}"
    rounded: "{rounded.pill}"
    padding: "4px 10px"
  status-chip-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
  seal:
    backgroundColor: "color-mix(in srgb, #e3dacc 14%, {colors.surface-warm})"
    textColor: "{colors.clay-text}"
    padding: "10px 18px"
---

# Design System: afkfactory 官网

## Overview

**Creative North Star: "纸面操作台"**

afkfactory 官网是客户交回工作区的操作台。客户从微信点开链接，下载工作区，按三步装好，和 agent（客户电脑上的智能体）说清需求，做完把整包传回来，再在订单页看进度。公开页是首页、下载、技能清单、教程；账号区是登录、上传、订单列表和订单详情。读者是不懂技术的客户，手机和电脑都会用。

页面的骨架只有三样：暖白纸、1px 墨线、宋体标题。底色是纸，分隔是 1px 细线，标题是宋体，正文是苹方，版本、哈希、时间、单号用等宽。没有卡片墙，没有阴影，没有第二种强调色。夜黑只出现在整段转折处：首页的三步装法和回传带。

**Key Characteristics:**
- 纸色打底，细线分栏，页面不用卡片和阴影。
- 宋体只做标题，苹方做正文，等宽只给可核对的数据。
- 暖棕和蓝灰是信号，面积很小，不铺满任何一块。
- 夜黑带只包整段内容，不包单张卡片。
- 焦点、错误、分支状态同时用文字和形状说明，不只靠颜色。

## Colors

暖白纸上的墨，加两枚小信号。颜色负责分级和状态，不负责装饰。

### Primary
- **墨黑 Ink** (#141413): 正文、标题、主按钮、已完成节点和已完成进度段。纸上的对比度 15.87:1。主按钮悬停到夜黑抬一档 (#2b2a27)。

### Secondary
- **夜黑 Night** (#0b0b0b): 整段深色带和首屏视频面板的底。带上的主字用暖白纸色 (#f7f5ef，18.05:1)，段落用 (#b8b4aa，9.51:1)。视频面板底色比夜黑略偏蓝 (#0b0d0e)。

### Tertiary
- **暖棕 Tan** (#c8b69b): 保留作暖色基色，落在落款章的混色和旧版编号底；新的强调色见下一节。
- **蓝灰 Slate** (#5f7385): 2px 焦点框和订单当前进度段。它当文字时压深到 `--slate-text` (#586a7a，4.81:1)；原色在纸上只有 4.23:1，不能当正文。

### Accent
2026-11-14 运营者要求下载页和技能清单页更接近 Anthropic 官网的纸面配色，在暖棕和蓝灰之外加入一组低饱和强调色。它们只做色块、编号和小面积标记，不换纸底，也不铺满整页。

- **陶土 Clay** (#d97757): 下载页和首页首屏的下载按钮、首页三步的第一个编号、技能页第一组序号、暖色块的顶线。按钮上的字用深墨 `--on-accent`。
- **燕麦 Oat** (#e3dacc): 暖色面（`--surface-warm`）的基色和落款章底。
- **天蓝 Blue / 橄榄 Olive / 薄荷 Mint**: 技能页三组序号、细线和 5% 色纸底，哈希校验块、首页三步编号和教程「卡住了」块。每组只落一种颜色，不叠用。
- **教程页的阶段色**: 教程按三段走，01–03 安装用陶土、04 第一次对话用天蓝、05 回传用橄榄，「卡住了」回到陶土。段与段之间用 1px 阶段色线分开，整段的底色再切一次；大号步骤号、小节号、「你要做」标签、引文左边线和目录序号跟阶段走。标题第二行用陶土文字色，正文仍是墨色。
- **带色纸面**: `--surface-warm` 亮模式 #e9e1d1，暗模式 #2a2521；`--surface-cool` 亮模式 #dfe8e3，暗模式 #1f2824。面内的字仍用 `--ink` 和 `--body`，随明暗模式翻转。
- **色块上的字**: 亮色块一律用 `--on-accent` (#141413)，不跟着夜间模式变白。

### Night Mode
夜间模式把纸和墨对调：纸 #141413，抬起的纸 #1f1e1d，压下的纸 #30302e，墨 #faf9f5，正文 #c9c6bd。暖棕、蓝灰和强调色保留；带色纸面换成深色版本。切换在顶栏右侧，先读 `localStorage`，再跟系统 `prefers-color-scheme`；HTML 在样式前设置 `data-theme`，避免闪白。

### Neutral
- **暖白纸 Paper** (#f0eee6): 全站底色，公开页和账号区一致。不换纯白。
- **抬起的纸 Paper Raised** (#f7f5ef): 输入框、文件行、拖放区、状态标签、当前档提醒、首屏按钮。
- **压下的纸 Paper Press** (#e6e2d6): 悬停、禁用、错误块和拖放区的按下态。
- **墨灰阶**: `--ink-soft` (#3d3d3a，9.38:1) 用于胶囊文字；`--body` (#4a4843，7.86:1) 用于说明；`--body-soft` (#5c5a54，5.94:1) 用于段落；`--muted` (#6f6b61，4.57:1) 用于元信息；`--muted-strong` (#6a665c，4.93:1) 用于等宽小字。
- **细线**: `--line` (#d9d4c7) 做普通分隔；`--line-soft` (#cfc9bb) 做更浅的线；`--line-pill` (#d6d1c4) 做胶囊描边。
- **胶囊底**: `--pill-wash` (rgba(255, 255, 255, 0.32)) 是常态，`--pill-hover` (rgba(20, 20, 19, 0.08)) 是悬停铺色。
- **夜上的字**: `--on-night-chip` (rgba(247, 245, 239, 0.78)) 用于小标签，`--on-night-note` (rgba(247, 245, 239, 0.62)) 用于注释，`--night-line` (rgba(247, 245, 239, 0.5)) 做描边。

### Named Rules
**The Paper Ground Rule.** 页面底色只用纸色。纸色已经是最亮的一层，不再换纯白，也不在纸面上铺装饰渐变。

**The Paper-and-Accent Rule.** 页面底色只用纸色。强调色只做色块、编号、细线和主按钮，不换掉纸底，不铺装饰渐变。新颜色先回方向契约，不从截图里吸。

**The Muted Accent Rule.** 强调色低饱和、面积小。暖色面只给同一种重复用途（例如教程每一步的「卡住了」块），不在一页并置多种暖色面；同一页最多三种强调色。色块上的字用 `--on-accent`，不跟明暗模式翻转。

## Typography

**Display Font:** Songti SC（回退 SimSun → Noto Serif SC → serif）
**Body Font:** PingFang SC（回退 Hiragino Sans GB → Microsoft YaHei → Noto Sans SC → system-ui）
**Label/Mono Font:** SF Mono（回退 SFMono-Regular → ui-monospace → Menlo → Consolas）

**Character:** 宋体撑标题，苹方走正文，等宽只给可核对的数据。三种字各做一件事，不互相越界。

### Hierarchy
- **Display** (400, 44px, 1.24, -0.02em): 页面主标题，最大 900px 宽。首页首屏同字号，字距归零。手机上 32px。
- **Headline** (400, 38px, 1.28): 区块标题，用于首页的三段和夜黑带的小标题。手机上 30–32px。夜黑带左段的主句抬到 Display 字号，右段降到 26px 做副题。
- **Title** (400, 26px, 1.3): 步骤标题、表单标题、当前档标题。订单行标题 21px，详情档标题 23px。
- **Lead** (400, 16.5px, 1.65–1.7): 标题下的一句说明，最宽 640px。手机上 16px。
- **Body** (400, 15px, 1.6–1.75): 正文和说明，最宽 640–760px。中文正文按 1.7 左右排版。
- **Label** (400–600, 14px, 1.4–1.5): 导航、页脚、按钮、状态标签。手机上胶囊降到 12.5px。
- **Mono** (400, 12.5px, 1.5–1.65, tabular-nums): 版本、日期、大小、SHA、单号、轮次、百分比。技能名也用等宽，因为它是路径里的标识。
- **Micro** (400, 12px, 1.4–1.5): 页脚版本、索引号、等宽小字。

标题里的 `<b>` 用 700，宋体的粗细对比就是强调。正文不用 700，靠位置和留白分级。字距：标题 -0.02em 到 0；字标 0.16em；小号等宽标签 0.04–0.08em；落款章 0.14em 和 0.34em。正文字距保持 0。

### Named Rules
**The Serif-Heading Rule.** 标题用宋体，正文用苹方。等宽不写句子，只写可核对的值和标识。

**The Data Is Mono Rule.** 版本、日期、大小、SHA、单号、轮次、百分比一律等宽，数字用 tabular-nums。读者要能一眼比对。

**The Measure Rule.** 说明段最宽 640px，正文栏最宽 760px，教程正文最宽 840px。超过就断行，不拉满通栏。

标题现在走系统宋体栈。锁定字形后自托管中文子集，控制 50–130 KB。Windows 上的回退字形还没验证，见 `site/design/tokens.md` 的「还没定的」。

## Layout

页面是通栏的，没有居中的最大宽度壳。内容靠页边距 `--gutter`（桌面 64px，手机 24px）退让；整段背景可以铺满视口。

- **顶栏**: 高 80px，三列网格：左三枚导航胶囊，中字标，右四枚：明暗切换、登录、我的订单、上传工作区。桌面吸附在顶部；向下滚 480px 内，FACTORY 从右往左依次退场，AFK 滑到中间；一条细线从中间向两侧展开，胶囊的底和描边退掉，顶栏变成磨砂纸玻璃。页面加载时胶囊和字标字母依次落位。手机不吸附，导航换成三行。
- **页面壳**: `.page` 上 96px、下 120px，左右 `--gutter`。页头放宋体标题和一句说明，下面一条 1px 细线；`.page-body` 再下 32px。账号区上边距收到 40px，登录页 48px，上传和教程页从 80px 起。
- **页头变体**: 下载页和技能清单页去掉页头细线，让标题直接接到文件区或清单；文件区和清单的顶线改用 1px 墨线。
- **分栏**: 首页首屏 1.35fr / 0.65fr，间距 64px；三理由 1.05fr / 0.95fr；技能 0.9fr / 1.1fr。上传页 1.45fr / 0.55fr，间距 80px。登录页 1fr / 360–460px，间距 48–96px，中间一条竖线。订单详情 1fr / 300px，间距 48px，右栏桌面吸附在 104px。教程 190px / 1fr，间距 80px，目录吸附在顶栏下方。
- **首页回传带**: 夜黑整段，顶上一条 1px 夜线，上下 96px（手机 64px）。上排两栏 1.3fr / 0.7fr，间距 64px，底对齐：左栏「做完了，传回来。」用 Display 两行，右栏「进度随时看。」降到 26px。下排两个入口横跨整行，1.2fr / 0.8fr，上下各一条 1px 夜线，中间一条竖线；每行桌面 104px、手机 88px 高，26px 标签，箭头在右。左入口箭头用陶土色。
- **节奏**: 大段之间 96px，夜黑带上下 96px（手机 64px），页头下 32px，段落之间 8–20px。组内紧，组间松。
- **断点**: 1100px 收窄分栏和间距；900px 是主手机断点，顶栏改为静态，所有双栏改单栏，公开页上下留白改成 56/64，账号区再收，标题 32px，首屏视频 420px；720px 订单五档改成竖排；520px 处理小屏账号行和标题断句；360px 教程标题降到 28px。900px 写在 `base.css`，其余写在各自页面样式里。
- **触控**: 手机上胶囊、按钮、页脚链接、文件操作都不小于 44px；主按钮在手机上可以拉满一行。

### 素材现状
仓库没有上线的位图。favicon 是 `site/public/favicon.svg` 的 AF 字标。首屏视频是 `home.css` 里的 CSS 渐变占位，带 18 秒缓慢漂移；真实素材未到，别把它当已交付的影像。标题宋体走系统字体栈，自托管子集未做。没有真实客户 logo、评价、案例或性能数字，页面不补假图。

### Named Rules
**The Gutter Rule.** 背景可以通栏，文字不行。任何正文离视口边缘不少于 64px，手机不少于 24px。

## Elevation & Depth

这套系统是平的。全站没有投影，没有抬起的卡片。层级只靠三种东西：纸色的三层（纸、抬起的纸、压下的纸）、1px 细线的分组、夜黑带隔开整段内容。顶栏滚动后变成磨砂纸玻璃（96% 纸色、22px 模糊、1.45 饱和度，滚动 24px 内收满；顶边 1px 高光），这是唯一使用 backdrop-filter 的地方。

`box-shadow` 只在两处出现：订单分支段的斜线填充上加 `inset 0 0 0 1px #141413`，给条纹封边；顶栏玻璃下沿加一层 24px 柔和阴影，托住磨砂面。两者都不承担卡片深度。

### Named Rules
**The Flat-By-Default Rule.** 表面默认平放。要分组用细线和纸色阶，要强调用字重和面积。不要加投影、浮起的卡片或第二层边框。

**The Night Band Rule.** 夜黑带只包整段内容（首页三步、首页回传带、首屏视频面板），不包单张卡片。带上的文字用 `on-night` 系列，焦点框换成纸色。按钮悬停用的 `--night-hover` 是状态，不铺成面。

## Shapes

圆角只有三档：胶囊 999px，控件 6px，进度点 50% 正圆。首屏视频面板、黑色带、页面分栏保持直角。订单进度用 34px 正圆和 1px 连线；斜线填充只表示分支状态（校验未通过、已驳回）。

落款章是一个例外的小形状：矩形，1px 内框加 1px 外框（偏移 2px），燕麦 14% 混暖色面作底，文字和边框用陶土文字色，整体旋转 -2.5 度。它只出现在下载页文件区右下，不复制到别的页面。

虚线有两种用途：拖放区的边界和待处理或分支状态的边框（校验未通过、驳回、当前档提醒）；此外只做元信息上方的软分隔。虚线的意思是「这里还没定，或要你处理」。

### Named Rules
**The Radius Ladder Rule.** 圆角只有三档：胶囊 999px、控件 6px、进度点 50% 正圆。视频、大面、整段背景保持直角。

**The Square Media Rule.** 全幅媒体不切圆角，不加黑边。首屏视频从页面里长出来，四角是直角。

## Components

### Buttons
公开页的主下载按钮用陶土实心、深墨字，悬停加深到 `--clay-deep`；账号区和其余主按钮用墨黑实心、纸色字，控件圆角 6px，高 52px，左右 24px，16px / 600。悬停到 `--night-hover`，按下缩到 0.99。禁用时底色换成 `--paper-press`，字用 `--body-soft`，光标 not-allowed。账号区主按钮高 48px，成功后动作 48px。

次级按钮透明，1px `--line-soft` 描边，悬停描边转墨黑。文字动作是 14–16px 下划线，偏移 4px，最小高度 44px。站点主链接悬停转 `--slate-text`；账号区的次级动作转墨黑或 `--body-soft`。夜黑带上的入口用整行台账，不套按钮；带内确有按钮时用纸色底、墨色字，次按钮透明、`--night-line` 描边。

### Chips and Status
状态标签是胶囊，4px 10px，12px / 600。默认 `paper-raised` 底、`--body` 字；当前态墨黑底、纸色字；提醒态墨黑虚线描边、透明底；完成态去掉底色，`--muted` 字。轮次徽章是更小的实心胶囊，10.5px 等宽，写「第 2 轮」。分支徽章用虚线描边，9.5px 等宽。

### Inputs and Forms
输入框高 48px，`paper-raised` 底，1px `--muted-strong` 描边，6px 圆角，左右 14px，16px 字。悬停描边到 `--ink-soft`；聚焦描边转墨黑，底色换回纸色。标签 14px / 600，放在输入框上方 8px。

错误块是墨黑 1px 描边加 `paper-press` 底，文字用墨黑，不用红色。错误文字写清出了什么事、下一步做什么。禁用按钮不隐藏，改成 `paper-press` 底和 `body-soft` 字。

登录页两栏，中间一条竖线。上传页的账号条是 40px 方形字标加名字和邮箱，退出是下划线文字。复选框 20px，accent-color 用墨黑。隐私提示用上下两条细线包住，不套卡片。

文件表是两列定义表：170px 标签加 1fr 等宽值，行间 1px 细线。下载页的数据表是 76px 标签加 1fr 等宽值。上传成功的回执是 64px 标签加 1fr。订单列表一行四列：1fr 主信息、152px 五段进度、236px 状态、16px 箭头；手机上改单列。

### States
悬停用 160ms 的底色和描边变化：按钮变深，文字动作转蓝灰，列表行出下划线并让箭头右移 4px，回传带的整行入口下划线从左展开、箭头右移 6px。焦点统一 2px 蓝灰、偏移 3px，夜黑上换纸色。

禁用不隐藏。主按钮换成 `paper-press` 底和 `body-soft` 字；账号区按钮降到 55% 不透明度并显示等待光标；上传中的按钮写「上传中…」，旁边提示「正在上传，别关页面」。

加载用真实进度，不用转圈。上传是 2px 墨黑横条加等宽百分比；订单列表是纸色骨架行，1.6 秒呼吸；账号检查是「正在确认登录状态…」文字。

错误块是墨黑 1px 描边，`paper-raised` 或 `paper-press` 底，文字用墨黑。块里写清出了什么事、下一步做什么，并带重试或客服入口。不用红色。

空状态是一段带墨线顶边的说明：宋体小标题、正文、一个动作。没有插画，也没有假数据。

成功状态把表单换成结果：宋体「传上来了。」、一句说明、64px 标签的文件回执、主按钮「看订单进度」、次按钮「再传一个」。焦点移到成功面板。

### Navigation
桌面顶栏三列：左三枚胶囊，中字标，右四枚（明暗切换、登录、我的订单、上传工作区）。字标 20px / 700，字距 0.16em。胶囊 7px 15px，约 31px 高，1px `--line-pill` 描边，`--pill-wash` 底，悬停时深色从中间铺满。当前页和「上传工作区」在亮模式是墨黑实心、纸色字；夜间模式换成陶土底、深墨字。

滚动时顶栏变成磨砂纸玻璃，FACTORY 从右往左逐个退场，AFK 滑到中间，胶囊退掉底和描边，只留文字。停下后悬停，胶囊重新长回来。手机上顶栏不吸附，字标第一行，右侧动作第二行，左侧导航第三行占满宽；胶囊最小高度 44px。

### Page Shell
页面壳是 `main.page`：上 96px、下 120px、左右 64px 留白。页头是 44px 宋体标题、640px 宽的说明、下面一条 1px 细线；正文从页头下 32px 开始。下载和技能页去掉这条线，用文件区或清单的 1px 墨线接住标题。手机上留白改 56 / 24 / 64，标题 32px。

### File Ledger
文件台账是「文件名加数据行」的竖排记录，不是卡片。下载页文件名用 26px 等宽字，右侧数据行 76px 标签加等宽值，行间细线；右下盖「已备好」落款章。上传页选好的文件是一行：34px ZIP 徽章、文件名 15px / 600、体积 12.5px 等宽、右侧「换一个」按钮。技能清单是 44px 索引、170px 等宽技能名、1fr 说明。上传成功的回执是 64px 标签加 1fr。

### Drop Zone
拖放区最小高 208px，1px 虚线 `--line-soft`，6px 圆角，`paper-raised` 底，内容居中。悬停或拖入时描边转墨黑，底色转 `paper-press`。里面是 44px 方形 ZIP 标记、18px / 600 标题、15px 说明、12.5px 等宽上限。手机上最小高 180px，内边距收到 24 / 16。

### Progress Rail
列表里的五档是五段 5px 高的横条，间距 3px：已完成墨黑，当前蓝灰，未到 `--line`，分支状态用 45 度斜线加 1px 墨黑内描边。详情里的五档是五列，34px 圆点加 1px 连线：已完成墨黑实心加内联 SVG 勾，当前 2px 墨黑圆圈加序号，分支虚线圆圈，未到 1px 灰圈。日期用 11px 等宽。720px 以下改成竖排，圆点在左，文字在右。

### Tutorial Page
教程页用整段底色分段，像翻页一样换背景：01–03 是纸色，04 和 05 铺一整段夜黑，结尾「卡住了」回到纸色。底色是段落背后的伪元素，用负边距铺到视口两边，正文宽度和页边距都不动；带和带直接相接，第一段带前面留 96px 纸色空档，两段夜黑带之间只留一条分隔线。夜黑带里的字整段换成 `on-night` 系列，细线、虚线、悬停和焦点框跟着换。左目录浮在带上时逐项换字色，当前项左侧一条 2px 阶段色短杠。第 4 节里的「实际只做三件事」在夜黑上改用透明白块，三个编号沿用首页的陶土、燕麦、薄荷色块。「卡在这一步？」只留上下两条陶土虚线，不铺底色。文件树是抬起的纸加陶土高亮；说话气泡里「你发的那一句」用陶土底和深墨字。

### Seal
落款章只用在下载页。12px 等宽字，字距 0.14em；中间「已备好」用 15px 宋体，字距 0.34em；内框和文字用陶土文字色，外框陶土 42% 透明，偏移 2px；底是 14% 燕麦混暖色面；整体旋转 -2.5 度。版本和日期必须和数据行一致。

### Motion
首屏只有一段编排好的入场：标题逐字落位，视频面板随后展开，说明、版本和画面里的文字依次落定（延迟 60–540ms）。逐字间隔 24ms，淡入 500ms，上浮 800ms，缓动 `--ease-rise`。页面加载时，顶栏胶囊依次落位（520ms、间隔 50ms），字标字母逐字上浮（620ms、间隔 26ms）。

滚动出现给元素加 `data-reveal`，进入视口后加 `is-revealed`，只播一次：默认块淡入 640ms、去模糊 520ms、上移 760ms / 22px；成排条目用 `data-reveal="row"`（560/420/620ms、14px）；大面用 `data-reveal="panel"`（下 16px、收边 0.992）；元信息用 `data-reveal="fade"`。默认内容可见；`js-motion` 只在脚本接上后收起，2.5 秒没接上就撤掉。

顶栏联动用 `--hp`（0–1），在 480px 滚动内线性走到 1。FACTORY 的每个字母按序号从右往左退场（起点 0.12–0.51），AFK 从 0.55 起滑到中间；玻璃在 24px 内收满。首屏视频的横向拉伸用 `--hero-stretch`（0–1），只改 `clip-path`，不改布局尺寸。

状态反馈一律 160ms，缓动 `--ease-ui`。胶囊悬停从中间铺开，按下缩到 97%；按钮按下缩到 0.98–0.99。视频占位的渐变每 18 秒缓慢漂移，离开视口暂停。

`prefers-reduced-motion: reduce` 时去掉位移、模糊、顶栏联动和逐字入场，只留 200–500ms 淡入；视频直接满宽，渐变停止循环。

### Accessibility Floor
- 正文和说明在纸上的对比度不低于 4.5:1：`--body` 7.86:1，`--body-soft` 5.94:1，`--muted` 4.57:1，`--muted-strong` 4.93:1。`--slate` 原色 4.23:1，只做焦点框和图形；当文字用 `--slate-text`（4.81:1）。
- 夜黑带上的字：`--on-night` 18.05:1，`--on-night-soft` 9.51:1，78% 小标签 11.03:1，62% 注释 7.16:1。
- 焦点框是 2px `--slate`，偏移 3px；夜黑带和视频里换成纸色。键盘能从「跳到正文」开始走完每页。
- 手机上所有可点目标不小于 44×44px；正文里的行内链接按 WCAG 2.5.8 的行内例外处理。
- 错误、成功、分支状态都有文字，不只靠颜色。订单分支的斜线填充是额外的非颜色提示。
- 动效遵守 reduced motion；不支持的浏览器直接显示内容，不留空白。

### Named Rules
**The 44px Rule.** 手机上的可点目标不小于 44×44px。行内链接按 WCAG 2.5.8 的例外处理。

**The Status-in-Words Rule.** 状态先写文字，再用形状和颜色补充。只换颜色不加字，算缺陷。

## Do's and Don'ts

### Do:
- **Do** 从纸色底、墨色字、宋体标题、一句说明、1px 细线开始一页。
- **Do** 用细线和纸色阶分组；通栏背景可以换纸色或夜黑，文字仍留页边距。
- **Do** 把版本、日期、大小、SHA、单号、轮次、百分比写成等宽，数字用 tabular-nums。
- **Do** 把暖棕和蓝灰留在小面积信号上：编号、落款、圆点、焦点、当前进度、链接悬停。
- **Do** 用夜黑带隔开整段转折，带上的焦点框换成纸色。
- **Do** 状态先写文字，再用形状和颜色补充；错误写清发生了什么、下一步做什么。
- **Do** 保持 44px 触控、2px 焦点框、4.5:1 正文对比度。

### Don't:
- **Don't** 把页面做成卡片墙。容器只服务单件事：拖放区、文件行、当前档提醒、表单面板。
- **Don't** 用投影或浮起效果做层级；分支斜线段的 1px 内描边是描边，不是阴影。
- **Don't** 新增色相或从截图里吸色。色板只有纸、墨、暖棕、蓝灰、夜黑和暖灰阶。
- **Don't** 给全幅视频、黑底带或页面大面切圆角。圆角只有胶囊和 6px 控件。
- **Don't** 用 `--slate` 原色写正文或小字；当文字用 `--slate-text`。
- **Don't** 在标题上加减眉题（kicker / eyebrow）。小号字距可以标列表、目录、状态和编号，不放在标题上方充场面。
- **Don't** 把 01 / 02 / 03 当章节装饰。编号只给必须按顺序走的流程：安装三步、教程五步、订单五档。
- **Don't** 用 emoji、图标字体或 Unicode 符号搭一套图标；现有 `→` 和 `←` 是文字标点，勾和眼睛是内联 SVG。
- **Don't** 用等宽字写句子。等宽只给数据、版本、哈希、编号和标识。
- **Don't** 在纸面上铺装饰渐变。唯一的渐变在首屏视频占位里。
- **Don't** 把当前系统宋体栈当最终字形。锁定字形后自托管中文子集，Windows 回退要复验。
