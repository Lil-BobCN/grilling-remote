2026-11-07：按 docs/客户工作区方案.md 更新，改了标题和简介、目录表、打包、没测到的项、还没定的、相关票。装配提示词流程换成工作区 zip。`package/` 已换成新摆法，`setup` 和 `ask-matt` 已删。构建脚本和 `manifest.json` 已改，在本机构建并解压核对过。

# 客户工作区包（#23）

一句话：给非技术客户用的 DeepSeek Harness 工作区 zip。解压后根目录就是工作区，客户用 dsh 打开，说「开始需求澄清」就开始。技能在 `.dsh/skills/`。`AGENTS.md` 是成品。本地 Markdown 追踪器的两份文件在 `docs/agents/`，已预生成。没有装配提示词。

## 目录

`package/` 已在 2026-11-07 换成新摆法，下表按现状写。`build.sh`、`manifest.json` 和包内 `技能清单.md` 已在 2026-11-07 按方案第五节改完。

| 路径 | 是什么 |
| --- | --- |
| `package/` | 打进 zip 的内容，和 zip 根目录一模一样，原样打包 |
| `package/.dsh/skills/` | 九个技能：`grilling`、`domain-modeling`、`wayfinder`、`prototype`、`research`、`wait-what`、`next`、`map-gate`、`wrap-up` |
| `package/AGENTS.md` | 成品，标题下有一行 `工作区版本：v1（构建日期）` |
| `package/docs/agents/` | `issue-tracker.md` 和 `domain.md`，预生成，构建时不跑 `setup` |
| `package/README.txt` | zip 里的客户说明，写解压和打开三步 |
| `package/技能清单.md` | 由 `build.sh` 从 `manifest.json` 生成，每次构建重写 |
| `package/NOTICE.md`、`package/LICENSE` | 上游来源和改动，许可证 |
| `manifest.json` | 技能清单数据源，生成包内 `技能清单.md` 和官网清单。放在 `customer-kit/` 根目录（2026-11-07 定） |
| `prompts/01-装配提示词.txt` | 提示词①，已作废。文件留在仓库，不进包 |
| `prompts/02-启动提示词.txt` | 提示词②，只剩两句：第一次说「开始需求澄清」，之后复制收尾给的一行，形如「继续：tanxin-yuyue 01 空档怎么放」。已在 2026-11-07 改成这两句 |
| `安装步骤.md` | 客服带装清单，含每步的失败信号 |
| `测试记录.md` | 2026-11-05 和 2026-11-07 的实测结果、没测到的项 |
| `build.sh` | 打 `dist/客户工作区-v1.zip`，包名从 `manifest.json` 的版本号读，直接打 `package/`，不套层 |
| `dist/` | 生成物，不进 git |

## 打包

下面是 2026-11-07 改完后的做法，依据方案第五节。

```bash
bash customer-kit/build.sh
```

产物：`customer-kit/dist/客户工作区-v1.zip`，同目录还有 `.sha256` 校验文件。发布时两个一起上传。包名从版本号读。

zip 直接打 `package/`，不套外层文件夹，解压后根目录就是工作区。要带上隐藏目录 `.dsh`，排除 `.DS_Store`。包内 `技能清单.md` 和官网清单，都由 `manifest.json` 生成。改 `package/` 后必须重打。重新构建会生成新的校验值。

改版本号或日期时，要同时改三处：`manifest.json`、`package/AGENTS.md` 第 3 行、`package/README.txt` 前两行。`build.sh` 只用 `manifest.json` 生成包名和 `技能清单.md`，不会改另外两处。

2026-11-07 已改：`build.sh` 用 `jq` 读 `manifest.json` 的版本号，包名 `客户工作区-v1`，zip 不套层。构建时重写 `package/技能清单.md`。本机构建一次，解压到空目录核对过：根目录有 `AGENTS.md` 和 `.dsh`，技能 9 个，无 `.DS_Store`，`shasum -c` 通过。Mac 和 Windows 右键压缩是否带上隐藏目录，仍未测。

## 这版测过什么

以下是旧流程（提示词①装配）的实测，属于历史。新流程的验收项见方案第十节。

2026-11-07 #26 用 headless 把客户包 v1 跑了 18 行（第 17 项拆成 17、17b）：12 项通过，3 项部分通过，1 项没测到，1 项作废，1 项另测。收尾漏 `next`、小需求漏子代理复核，按 #95 改。桌面版卡片、客户机联网、自然压缩没测。结果见 `测试记录.md`。

2026-11-05，macOS Apple 芯片，空文件夹，本机 dsh 0.2.1-rc.5，按提示词①从头走了一遍：

- 八个技能落到 `.dsh/skills/`，dsh 能发现。
- `AGENTS.md` 写进根目录。重开新会话能读到；重跑提示词①不会覆盖。
- `docs/agents/issue-tracker.md` 和 `domain.md` 写好。
- `.scratch/` 建好。
- 模型目录里有 7 个技能；官网包的 `wait-what` 允许模型自动调用，本机自用副本不动。

细节和没测到的项见 `测试记录.md`。Windows 没机器，未验证。`workspace-write` 沙箱没测到，测试时这台机器的沙箱后端坏了，用了 `danger-full-access`。Linux 不支持。

新流程没测到的项（方案第十二节）：

- Mac 和 Windows 右键压缩是否带上隐藏的 `.scratch/` 和 `.dsh`：未验证，归 #36。
- Windows 解压、中文路径、`.dsh` 被隐藏时 dsh 是否正常：未验证，归 #36。
- 客户机的 dsh 是否有 `subagent` 和 `subagent_fork`：归 `安装步骤.md` 的首单实测。

## 还没定的

- `AGENTS.md`（成品，原 `AGENTS-TEMPLATE.md`）和提示词②由 #25 定稿（2026-11-05）。之后提示词②只剩两句。`AGENTS.md` 已在 2026-11-07 照 #44 第 5 条和方案改完，2026-11-07 已在本机打过一次包，发布归 #35。
- 客户侧查漏由 `map-gate` 和 `wrap-up` 起子代理做，起不来就自己重读文件。客户机上起不起得来，归 `安装步骤.md` 的首单实测。效果：本机 #26 实测 `wrap-up` 起了子代理，小需求收尾没起，规则已按 #95 改成可检查的一步。
- `setup` 和 `ask-matt` 不进客户包。两个技能已直接删除，不留备份，git 历史里能找回（方案第十三节第 1 项）。`AGENTS.md` 里提到 `ask-matt` 的两处，已改成运营者自己处理，你不做（第 5 项）。回传后能不能 `to-spec`，由运营者在本机问。
- 两个需求合成一个软件的规则，待定（第 2 项）。整包大小上限先写 50 MB（第 4 项，Cloudflare 免费版单次 100 MB，留余量）。对话记录 v1 不回（第 3 项）。
- 教程页、截图、启动句两句怎么放，归 #31。「第一次对话会遇到什么」一节已在 #58 出样品，归 #31 并入整页。

## 上游更新

技能基底是 `mattpocock/skills` 的 `main`，取用于 2026-11-05。更新时按 `package/NOTICE.md` 的改动清单重做，不要直接覆盖客户模式的那几段。

## 相关票

- #23 本票
- #25 AGENTS.md 与提示词②
- #26 实测提示词
- #31 教程页
- #24 进度回传
- #35 官网发布
- #36 安装实测
- #44 客户包收尾
- #58 第一次对话
