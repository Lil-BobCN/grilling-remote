# #27 单文件原型样品

回答 [客户要看原型时在本机怎么出：单个 HTML 能不能撑住](https://github.com/Lil-BobCN/grilling-remote/issues/27) 的问题：客户在本机只靠一个 HTML 文件，能不能撑住「流程演示」和「三个版本对比」两种问法。

运营者看过两个样品，判「看得懂」。这是 throwaway 原型，不是产品代码。

## 怎么开

双击对应 HTML。Chrome、Safari、Edge 都行。零依赖、零构建、零网络。

- `flow-demo.html`：流程演示。
- `ui-versions.html`：三个版本对比。

## 两个样品

| 文件 | 行数 | 内容 |
| --- | --- | --- |
| `flow-demo.html` | 249 | 纯状态脚本 + 当前状态 + 10 个自由按钮 + 3 个场景。第二个场景演示「备货中取消被挡住」。 |
| `ui-versions.html` | 191 | A 单列、B 左右分栏、C 小票式。底部浮动条和 ← → 切换，地址记住版本。 |

共同限制：单文件、内联 CSS 和 JS、不引网络、不用框架、假数据、400 行以内。

## 证据

- Chrome 156 无头自测 17 项全过：场景走通、非法动作不改状态、A/B/C 切换和绕回、地址记住版本、1024 和 375 宽无横向滚动、控制台 0 报错。
- 初稿生成：流程 243 行 / 25 秒，版本 191 行 / 27 秒；流程补一行结果提示后定稿 249 行。参考值是 109.7 秒 / 374 行。
- 截图在 `screenshots/`：`flow-blocked.png` 是被挡住的状态，`A/B/C.png` 是三个版本，`flow-mobile.png` 和 `ui-B-mobile.png` 是窄屏。

## 不做什么

- 不连后台，不发请求，不存数据。
- 不放进客户包，不替换 `prototype/index.html`。
- 不做成产品页面。

## 关联

- 票：[客户要看原型时在本机怎么出：单个 HTML 能不能撑住](https://github.com/Lil-BobCN/grilling-remote/issues/27)
- 地图：[地图：客户需求 → 自动软件工厂](https://github.com/Lil-BobCN/grilling-remote/issues/1)
- 决定：单文件 HTML 够用，400 行上限保留。
