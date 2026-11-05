# 客户技能包（#23）

一句话：给非技术客户用的 DeepSeek Harness 技能包，解压到工作文件夹的 `.dsh/skills/`，配一份 `AGENTS.md` 和本地 Markdown 追踪器。

## 目录

| 路径 | 是什么 |
| --- | --- |
| `package/` | 打进 zip 的内容，原样复制 |
| `package/skills/` | 八个技能 |
| `package/AGENTS-TEMPLATE.md` | 提示词①复制成客户根目录的 `AGENTS.md` |
| `package/README.txt` | zip 里的客户说明 |
| `package/NOTICE.md` | 上游来源和改动 |
| `prompts/01-装配提示词.txt` | 提示词①，官网原文，直接复制给客户 |
| `prompts/02-启动提示词.txt` | 提示词②，首次“开始需求澄清”，续做“继续” |
| `安装步骤.md` | 客服带装清单，含每步的失败信号 |
| `测试记录.md` | 2026-11-05 的实测结果、没测到的项 |
| `build.sh` | 打 `dist/grilling-skills-v1.zip` |
| `dist/` | 生成物，不进 git |

## 打包

```bash
bash customer-kit/build.sh
```

产物：`customer-kit/dist/grilling-skills-v1.zip`，同目录还有 `.sha256` 校验文件。发布时两个一起上传。

zip 根目录是 `grilling-skills-v1/`，和提示词①里的路径一致。改 `package/` 后必须重打。重新构建会生成新的校验值。

## 这版测过什么

2026-11-05，macOS Apple 芯片，空文件夹，本机 dsh 0.2.1-rc.5，按提示词①从头走了一遍：

- 八个技能落到 `.dsh/skills/`，dsh 能发现。
- `AGENTS.md` 写进根目录。重开新会话能读到；重跑提示词①不会覆盖。
- `docs/agents/issue-tracker.md` 和 `domain.md` 写好。
- `.scratch/` 建好。
- 模型目录里有 7 个技能；官网包的 `wait-what` 允许模型自动调用，本机自用副本不动。

细节和没测到的项见 `测试记录.md`。Windows 没机器，未验证。`workspace-write` 沙箱没测到，测试时这台机器的沙箱后端坏了，用了 `danger-full-access`。Linux 不支持。

## 还没定的

- `AGENTS-TEMPLATE.md` 和提示词②由 #25 定稿（2026-11-05），改完要重打包，发布归 #35。
- 客户侧查漏用 `subagent_fork`，读对话和文件。客户机上起不起得来、效果怎么样，归 #26。
- `ask-matt` 的调用方式本版定了：删掉 `disable-model-invocation`，模型可以自动路由，客户也可以输入 `/ask-matt`。运营者要改回人工输入，就加回那一行。
- 教程页、截图、两条提示词怎么放，归 #31。

## 上游更新

技能基底是 `mattpocock/skills` 的 `main`，取用于 2026-11-05。更新时按 `package/NOTICE.md` 的改动清单重做，不要直接覆盖客户模式的那几段。

## 相关票

- #23 本票
- #25 AGENTS.md 与提示词②
- #26 实测提示词
- #31 教程页
- #24 进度回传
