# 2026-11-15 修复复验截图

对应审计 `.impeccable/audit/2026-11-15T06-17-41Z__site.md` 的「修复记录（2026-11-15 第二轮）」。

## 拍摄条件

- 构建：`cd site && npm run build`，`npm run preview -- --port 4174`。
- 浏览器：Chromium，1440×900、390×844。
- 明暗：`prefers-color-scheme` 模拟。
- 语言：`localStorage.afk-lang` 设为 `zh` 或 `en`。
- 长页：截图前撤掉 `js-motion` 并给 `[data-reveal]` 补 `is-revealed`，内容一次显示完；不改源码。
- 账号区：预览环境没有后端，`/app/orders` 显示「账号没打开」错误态。

## 文件

| 文件 | 内容 |
| --- | --- |
| `en-home-1440-light.png` | 英文首页桌面，检查静态 Source Serif 4 子集 |
| `en-home-390-dark.png` | 英文首页手机暗色 |
| `zh-home-1440-light.png` | 中文首页桌面，对照 |
| `zh-home-390-light.png` | 中文首页手机，页脚和「看完整清单」点击区 |
| `zh-tutorial-1440-light.png` | 教程页桌面，检查「卡在这一步」改标签后布局 |
| `zh-tutorial-stuck-1440.png` | 「卡在这一步」块局部 |
| `en-tutorial-390-dark.png` | 教程页手机英文暗色 |
| `en-account-orders-error-1440-light.png` | 订单错误态，视觉不变，语义上多了隐藏 h1 |

## 检查记录

- axe-core 4.10.3：9 条路径，中文 1440 亮色、英文 390 暗色，0 条违规。加载态用延迟的 session 请求另测。
- 点击区：在扩出来的边缘点页脚「下载」跳到 `/download`，点「看完整清单」跳到 `/skills`。
- 字体：中文页 0 个字体请求；英文页只请求 `SourceSerif4-Regular.woff2` 和 `InstrumentSans-Variable.woff2`。
- 英文首页 LCP：Slow 4G + 4 倍 CPU 下 1288–1312 ms，中位数 1292 ms；改前同一环境约 1732 ms。
- `impeccable detect`：6 条路径 URL 扫描 0 条主发现。
