2026-11-14：按 I-0077 重打包。包内技能是 I-0080 换好的七个上游原版，包内 `AGENTS.md` 和追踪器文档按 I-0081 改完；`manifest.json` 日期改 2026-11-14；构建通过，结果记在 `测试记录.md`。版本仍是 v1，下载链接不变。

2026-11-07：按 docs/客户工作区方案.md 更新，改了标题和简介、目录表、打包、没测到的项、还没定的、相关票。装配提示词流程换成工作区 zip。`package/` 已换成新摆法，`setup` 和 `ask-matt` 已删。构建脚本和 `manifest.json` 已改，在本机构建并解压核对过。

# 客户工作区包（#23）

一句话：给非技术客户用的 DeepSeek Harness 工作区 zip。解压后根目录就是工作区，客户用 dsh 打开，说「开始需求澄清」就开始。技能在 `.dsh/skills/`，七个，全部照上游 `mattpocock/skills` 提交 `5863806` 原样装；只删 `wayfinder` 和 `grill-with-docs` 的 `disable-model-invocation: true`。`AGENTS.md` 是成品，`docs/agents/` 两份追踪器文档已预生成。没有装配提示词。

## 目录

| 路径 | 是什么 |
| --- | --- |
| `package/` | 打进 zip 的内容，和 zip 根目录一模一样，原样打包 |
| `package/.dsh/skills/` | 七个技能：`grilling`、`domain-modeling`、`grill-with-docs`、`wayfinder`、`prototype`、`research`、`wait-what`。全部照上游原版，只删两个技能里的 `disable-model-invocation: true` |
| `package/AGENTS.md` | 成品，标题下有一行 `工作区版本：v1（2026-11-14）` |
| `package/docs/agents/` | `issue-tracker.md` 和 `domain.md`，预生成，构建时不跑 `setup` |
| `package/README.txt` | zip 里的客户说明，写解压和打开步骤，另有模型 key 放在哪 |
| `package/技能清单.md` | 由 `build.sh` 从 `manifest.json` 生成，每次构建重写 |
| `package/NOTICE.md`、`package/LICENSE` | 上游来源和改动，许可证 |
| `manifest.json` | 技能清单数据源，生成包内 `技能清单.md` 和官网清单。放在 `customer-kit/` 根目录 |
| `prompts/01-装配提示词.txt` | 提示词①，已作废。文件留在仓库，不进包 |
| `prompts/02-启动提示词.txt` | 提示词②，只剩两句：第一次说「开始需求澄清」，之后复制收尾给的一行，形如「继续：tanxin-yuyue 01 空档怎么放」 |
| `安装步骤.md` | 客服带装清单，含每步的失败信号和首单实测 |
| `测试记录.md` | 实测结果、没测到的项、每次重打包的构建记录 |
| `build.sh` | 打 `dist/客户工作区-v1.zip`，包名从 `manifest.json` 的版本号读，直接打 `package/`，不套层 |
| `dist/` | 生成物，不进 git |

## 打包

```bash
bash customer-kit/build.sh
```

产物：`customer-kit/dist/客户工作区-v1.zip`，同目录还有 `.sha256` 校验文件。发布时两个一起上传。包名从版本号读。

版本号现在固定 `v1`。官网下载链接 `https://afkfactory.dev/downloads/客户工作区-v1.zip` 不随内容变，每次重打只改日期；同一天重打用 SHA256 区分。要换成新版本号，得同时改官网下载页和所有写死 v1 的链接，归官网整站（I-0026）。

zip 直接打 `package/`，不套外层文件夹，解压后根目录就是工作区。要带上隐藏目录 `.dsh`，排除 `.DS_Store`。包内 `技能清单.md` 和官网清单，都由 `manifest.json` 生成。改 `package/` 后必须重打。重新构建会生成新的校验值。

打包用 `python3` 的 `zipfile`，不用系统的 `zip`。系统的 zip 3.0 给中文文件名不打 UTF-8 标记，Windows 自带解压会按本地代码页读，`技能清单.md` 显示成乱码。`build.sh` 现在依赖 `jq` 和 `python3`。

包内时间戳固定成 `manifest.json` 的日期。同一份内容连打两次，SHA256 一样。

改版本号或日期时，要同时改三处：`manifest.json`、`package/AGENTS.md` 第 3 行、`package/README.txt` 前两行。`build.sh` 只用 `manifest.json` 生成包名和 `技能清单.md`，不会改另外两处。

发布用 `deploy/publish.sh`，需要服务器地址和私钥，由运营者跑。发布成功后，脚本把版本、日期、文件名、大小、SHA256 写进 `customer-kit/release.json`。官网下载页读这份记录，页面数字和服务器上的文件始终一致。文件要一起提交。

2026-11-07 已改：`build.sh` 用 `jq` 读 `manifest.json` 的版本号，包名 `客户工作区-v1`，zip 不套层。构建时重写 `package/技能清单.md`。本机构建一次，解压到空目录核对过：根目录有 `AGENTS.md` 和 `.dsh`，技能 9 个，无 `.DS_Store`，`shasum -c` 通过。Mac 和 Windows 右键压缩是否带上隐藏目录，仍未测。

```bash
AFK_SERVER=dev@<服务器地址> bash deploy/publish.sh
```

脚本会重打包、上传、在服务器上核对 SHA256。I-0077 只在本机构建并记录 SHA256，没有上传。

### 构建记录

2026-11-07 的记录是历史；当前包以 2026-11-14 的构建记录为准。

- 2026-11-07 第一次构建：`customer-kit/dist/客户工作区-v1.zip`，本机解压到空目录核对过：根目录有 `AGENTS.md` 和 `.dsh`，技能 9 个，无 `.DS_Store`，`shasum -c` 通过。Mac 和 Windows 右键压缩是否带上隐藏目录，仍未测。
- 2026-11-07 第二次构建（#35 发布用，含 #95 改过的客户规则）：`customer-kit/dist/客户工作区-v1.zip`，41461 字节，SHA256 `49d3d89a8ccea55c76c19b84e1fbe6375d33b3d2a2f3fc9922a7533ae97038a6`。20 个文件，`unzip` 和 `ditto` 各解压一次，`diff -r` 与 `package/` 一致，`shasum -c` 通过。`技能清单.md` 带 UTF-8 标记。包内时间戳固定成 `manifest.json` 的日期，同一份内容连打两次，SHA256 一样。
- 2026-11-07 第三次构建（#113 发布用，含 #109 登录后上传说法）：`customer-kit/dist/客户工作区-v1.zip`，41456 字节，SHA256 `ad5931acb522aa41d1a2d99173d8df45a99b5c60a29cc6bcdef44682ecc66105`。20 个文件，`unzip` 和 `ditto` 各解压一次，`diff -r` 与 `package/` 一致，`shasum -c` 通过。包内 `README.txt` 去掉了「Windows 未实机验证」，和官网「只写支持」的口径一致。同一份内容连打两次，SHA256 一样。已发布到 https://afkfactory.dev/downloads/客户工作区-v1.zip；公网取回 41456 字节，SHA256 与 `.sha256` 一致，下载响应头 `cache-control: no-cache`。
- 2026-11-14 I-0077 构建：版本仍是 v1，日期 2026-11-14。包内技能是 I-0080 换好的七个上游原版；本票重打，并核对包内容、版本行和解压结果。构建、解压核对和 SHA256 见 `测试记录.md` 的「2026-11-14 I-0077 包与发布」。没有上传。

## 这版测过什么

2026-11-14 的回归结果见 `测试记录.md` 的「2026-11-14 I-0077 包与发布」。本机核了包内容、上游原版、三处版本行、旧技能引用、构建和解压；客户机没测。

以下是旧流程（提示词①装配）的实测，属于历史。新流程的验收项见方案第十节。

2026-11-07 #26 用 headless 把客户包 v1 跑了 18 行（第 17 项拆成 17、17b）：12 项通过，3 项部分通过，1 项没测到，1 项作废，1 项另测。收尾漏 `next`、小需求漏子代理复核，按 #95 改。桌面版卡片、客户机联网、自然压缩没测。结果见 `测试记录.md`。

2026-11-05，macOS Apple 芯片，空文件夹，本机 dsh 0.2.1-rc.5，按提示词①从头走了一遍：

- 八个技能落到 `.dsh/skills/`，dsh 能发现。
- `AGENTS.md` 写进根目录。重开新会话能读到；重跑提示词①不会覆盖。
- `docs/agents/issue-tracker.md` 和 `domain.md` 写好。
- `.scratch/` 建好。
- 模型目录里有 7 个技能；官网包的 `wait-what` 允许模型自动调用，本机自用副本不动。

细节和没测到的项见 `测试记录.md`。Windows 没机器，未验证。`workspace-write` 沙箱没测到，测试时这台机器的沙箱后端坏了，用了 `danger-full-access`。Linux 不支持。

## 还没定的

- 客户机实测：Windows、`workspace-write` 沙箱、客户机 dsh 有没有 `subagent` 和 `subagent_fork`，都没测。归 `安装步骤.md` 的首单实测。
- Mac 和 Windows 右键压缩是否带上隐藏的 `.scratch/` 和 `.dsh`：未验证；2026-11-07 决定不测（没有对应主机）。
- Windows 解压、中文路径、`.dsh` 被隐藏时 dsh 是否正常：未验证；2026-11-07 决定不测（没有对应主机）。
- 两个需求合成一个软件的规则，待定。实测遇到再定。
- 整包大小上限先写 50 MB（Cloudflare 免费版单次 100 MB，留余量）。对话记录 v1 不回。
- 教程页样品在 `prototype/issue-31/`：`tutorial.html`、`截图清单.md`、`文案.md`。第一次对话那一节已并入整页。

## 已经定的

- 模型 key：客户在 dsh 的 设置 → 模型 里填 DeepSeek API key。步骤在 `安装步骤.md` 的「配模型 key」和包内 `README.txt`。2026-11-13 按 I-0072 补。
- 客户侧查漏不再用 `map-gate` 和 `wrap-up`；小需求收尾仍用子代理复核，起不来写「复核：查过（自查）」。
- `setup` 和 `ask-matt` 不进客户包，两个技能已删除，git 历史里能找回。`AGENTS.md` 里提到 `ask-matt` 的两处已改成「运营者自己处理，你不做」。

## 上游更新

技能基底是 `mattpocock/skills` 的提交 `5863806dd4e15c63174bee4e7515a4256792ecfa`，2026-11-13 取用。七个技能目录逐文件照抄。只删 `wayfinder` 和 `grill-with-docs` 的 `disable-model-invocation: true`，`wait-what` 保持上游原样。

更新时先读 `package/NOTICE.md`，按它复制，不要直接覆盖客户化的 `AGENTS.md`、`docs/agents/` 和 `README.txt`。复制后对上游跑 `diff -r`，只允许这两处开关差异。

## 相关票

- I-0077 06 包与发布（本票）
- I-0080 客户侧技能集回上游原版
- I-0081 客户侧流程第 11 步往后
- 地图 I-0051 客户侧流程 v2

旧票（历史）：#23、#25、#26、#31、#24、#35、#36、#44、#58。
