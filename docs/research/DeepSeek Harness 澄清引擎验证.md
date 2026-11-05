# DeepSeek Harness 能不能当客户澄清引擎

> 对应 Issue #18。实测版本 `0.2.1-rc.5`，模型 `deepseek-official/deepseek-flash`，reasoning effort 用默认的 high。测试日期 2026-11-05。
> 标注：【实测】本次跑出来的数；【文档】dsh 包内说明或源码；【未验证】没有测到。

## 结论

能当澄清引擎，前提是一客户一进程。工具可以收窄到 `skill` 和 `write` 两个，创造模式和权限选择器可以删掉，写入能挡在会话工作区外。dsh 本身没有客户登录，也没有多租户隔离。一个网页实例下，任何拿到链接的浏览器都是 owner，能看到并读取全部会话。

## 六问答案

| 问题 | 答案 | 依据 | 实测次数 |
| --- | --- | --- | --- |
| 只给读写文件工具，不给 shell | 能。客户预设只挂 `tool-fs` 和 `tool-skill`，会话工具表只剩 `skill`、`write` | 自定义 preset；`request/header` 事件 | 7 次会话 |
| 写入限定一个目录 | 只能限到会话工作区加系统临时目录。`/tmp` 始终可写，严格一个目录做不到 | `dsh-sandbox` 的 `writableRoots()`；4 个路径写入 | 1 次，4 个路径 |
| 多客户隔离、登录 | 不能。没有客户登录；一个进程令牌，两个浏览器都是 owner，B 能列出并读到 A 的会话 | 两个 cookie 实测；`dsh-client-connection` 文档 | 2 个浏览器，1 次跨会话读取 |
| 创造模式在客户会话里关掉 | 能。删掉 `preset-cordis` 后 `agentPresets/list` 只剩 `clarify` | 配置加 Remote 返回 | 1 次 |
| 固定批准策略 | 能。删掉 `permission` 预设服务，`approval.policy` 固定为 `never`，运行时上下文明确禁止提权 | 配置；运行时上下文；2 次写入尝试 | 2 次 |
| 联网查事实要不要官方 key | 要。搜索复用 DeepSeek 账号或 `DEEPSEEK_API_KEY`。缺 key 返回结构化错误，有 key 返回来源 | 包文档；缺 key 和有 key 各跑 1 次 | 2 次 |
| 一轮题要等多久 | 29.2 秒、52.0 秒、46.8 秒，平均 42.7 秒 | 网页 API 实测，3 个不同场景 | 3 次 |
| 一页原型要等多久 | 218.2 秒（1399 行）和 109.7 秒（374 行）。页越大越慢 | 网页 API 实测 | 2 次 |
| 原文 grilling 直接放进技能目录 | 能。复制 `SKILL.md` 后技能目录出现 `grilling`，模型调用 `skill` 并按原文格式出题 | 技能目录消息；3 次调用 | 3 次 |

## 环境与预设

实验目录独立于本机 `~/.dsh`：

```sh
export DSH_HOME="$PWD/.research/dsh-home"
export DSH_AGENTS_HOME="$PWD/.research/agents-home"
dsh --profile customerweb --from-default-profile web
```

客户预设只留写文件和技能：

```yaml
- id: agent-preset-registry
  config:
    default: clarify

- id: preset-cordis
  disabled: true
- id: preset-ptc
  disabled: true
- id: preset-minimal
  disabled: true
- id: preset-standard
  disabled: true

- id: permission
  disabled: true
- id: approval
  config:
    policy: never
- id: sandbox-policy
  config:
    mode: workspace-write
    workspaceRoot: /绝对路径/客户目录

- insert:
    - id: preset-clarify
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: clarify
        name: 客户澄清
        plugins:
          - id: persona
            name: '@deepseek-ai/dsh-persona'
          - id: tool-fs
            name: '@deepseek-ai/dsh-tool-fs'
            config:
              read: false
              readImage: false
              edit: false
              write: true
          - id: skill-filesystem
            name: '@deepseek-ai/dsh-skill-filesystem'
          - id: tool-skill
            name: '@deepseek-ai/dsh-tool-skill'
```

## 工具表

网页会话的 `request/header` 只声明两个工具：

```
skill, write
```

没有 `bash`、`read`、`glob`、`grep`、`web_search`、`subagent`。之前本机日志里一轮 37 次 bash 的情况，在这套预设下不会出现，因为 bash 工具根本没有加载。

`tool-fs` 的开关可以单独关。`read: false` 时模型读不到宿主文件，`write` 仍能创建新文件。代价是改已有原型只能整页重写，不能读出来再改。

## 写入边界

一次任务里连写四个路径，结果：

| 目标 | 结果 |
| --- | --- |
| 会话工作区 `inside.txt` | 成功 |
| 工作区上一级 `../outside.txt` | 拒绝：`[sandbox: file access denied under workspace-write mode]` |
| `/tmp/dsh-tmp-test.txt` | 成功 |
| `~/Desktop/dsh-escape.txt` | 拒绝 |

临时目录可写来自 `dsh-sandbox` 的 `writableRoots()`，固定包含 `/tmp` 和 `os.tmpdir()`，没有配置项能关。要严格只留一个目录，得上容器或在部署层改这个函数。【文档】

写入边界跟会话的 `cwd` 走，不跟进程启动目录走。网页 UI 默认让用户选工作区，所以部署时要固定客户目录，或者用 API 创建会话时写死 `cwd`。

## 多客户与登录

网页没有客户账号。启动时打印一条带 token 的 URL，浏览器打开后换成签名 cookie。任何拿到这条 URL 的浏览器都拿到 owner 身份。【文档】

实测两个独立的 cookie 罐：

- 浏览器 A 用 `session/create` 建了一个会话。
- 浏览器 B 调 `session/list`，列表里有 A 的会话，也有同一 `DSH_HOME` 下以前 headless 跑出来的会话。
- 浏览器 B 调 `session/page`，读到了 A 的完整提问和回答。

所以多客户不能共用一个网页进程。可行做法是一客户一个进程、一个独立 `DSH_HOME`、一个端口，前面加网关做身份和路由。dsh 自己不提供这层。

DeepSeek 账号登录是给模型凭据用的，不是客户身份。它不影响会话可见性。

## 创造模式与批准策略

删掉 `preset-cordis` 后，`agentPresets/list` 返回：

```json
{"presets":[{"id":"clarify","name":"客户澄清","description":"只提问和写原型页，不能执行命令或读宿主文件","order":1,"isDefault":true}]}
```

创造入口只在 `cordis` 预设存在时提供，所以列表里没有它，入口不可用。【文档】

停用 `permission` 预设服务后，会话投影里没有 `permissions` 键，客户端不显示权限控件和 `/permission` 选择器，`DSH_PERMISSION_MODE` 也不再被 UI 改写。【文档】

`approval.policy: never` 的效果写在运行时上下文里：

```
Approval prompts are disabled in this session: actions that require approval
are rejected automatically — do not request sandbox escalation (do not set
`sandbox_permissions`).
```

两次让模型往桌面写文件，第一次都被沙箱拒绝；第二次要求它带 `sandbox_permissions` 重试，模型读到上面的说明后拒绝发起调用。批准层没有真正收到第二次请求，这是模型行为，不是机制验证。机制上 `never` 在分发前就拒绝，见 `dsh-user-approval` 文档。【文档】

注意：`danger-full-access` 预设会同时把沙箱改成全开、审批改成 `never`。所以只删权限选择器还不够，预设表里那条也要一起去掉，或者整张表只留 `workspace-write`。

## 联网搜索

没有 key 时，`web_search` 返回：

```
DeepSeek search has no API key for "DSH_SEARCH_KEY_MISSING"; store it through
the credentials service (the web Models page writes it), export it in the
launching environment, or set a literal "apiKey" in the web-search-deepseek
config; a conversation using a DeepSeek Account model searches with the account
sign-in instead
```

不是 401。0.2.1-rc.5 把缺凭据做成了结构化错误。社区说的 401 可能是中转站 key：聊天走中转站能跑，搜索仍发到 `https://api.deepseek.com/anthropic/v1`，中转站 key 在官方端点无效。这属于推测，没复现。搜索端点可以用 `$DEEPSEEK_SEARCH_BASE_URL` 单独改。

有 key 时同一条查询返回 8 条来源，模型能引用 URL。

## 耗时

网页 API 路径实测，从发送 prompt 到 `turn/end`：

| 任务 | 耗时 | 输出 token | 产物 |
| --- | --- | --- | --- |
| 一轮题，烧烤点单系统 | 29.2 秒 | 4,211 | 8 题 |
| 一轮题，生鲜储值 | 52.0 秒 | 6,865 | 9 题 |
| 一轮题，生鲜储值 | 46.8 秒 | 6,458 | 9 题 |
| 一页原型，不限行数 | 218.2 秒 | 46,624 | 1,399 行，45.8 KB |
| 一页原型，限 400 行 | 109.7 秒 | 23,022 | 374 行，24.7 KB |

模型输出速度约每秒 210 token。等待时间基本由输出长度决定，题越多、页越大越慢。首 token 时间没有测到，会话日志只记消息提交时间，不记 token 到达时间。【未验证】

现有两次出卡片 7.6 秒和 9.3 秒，和这里的一轮题不在一个量级。两者输入和产物不同，不能直接比。

## 原文 grilling 技能

把 `~/.dsh/skills/grilling` 整个复制到 `$DSH_AGENTS_HOME/skills/grilling`，不用改 frontmatter。技能目录消息里出现：

```
- `grilling`: Grill the user relentlessly about a plan, decision, or idea.
```

三次任务里模型都调用了 `skill`，并按原文的 `❓ **Q1**` / `➡️` 格式出题，一次问完一轮。原文可以直接用。【实测】

有一处不匹配：原文要求“查事实派子 agent”，客户预设里没有 `subagent`，也没有 `web_search`。模型只能明说“拿不到工作区材料”，然后基于描述推荐。要让它查事实，得补 `tool-web` 和搜索 key，或者由前端把资料喂进对话。

## 建议

1. 一客户一进程，独立 `DSH_HOME` 和端口，网关负责身份。不要多客户共用一个网页实例。
2. 客户预设只挂 `tool-fs`（只开 `write`）、`skill-filesystem`、`tool-skill`。不要 `read`、`edit`、`bash`、`web`。
3. 删 `preset-cordis`、`preset-ptc`、`preset-minimal`、`preset-standard`，删 `permission`，`approval.policy` 设 `never`。
4. 会话 `cwd` 固定到专用目录，别让客户选工作区。
5. 原型页加行数上限。本次不限行数 218 秒，限 400 行的一版 110 秒，提示词不同，只能当方向。
6. 需要查事实时给 `tool-web` 和官方 key；只给中转站 key 会在搜索端点失败。

## 没验证

- 首 token 时间和真流式首字。
- 网页 UI 上创造入口确实变灰。只验了预设列表和文档条件。
- 关掉 `plugin-manager` 后的前端表现。本次只删了创造预设，插件管理页仍在。
- 一客户一进程的实际部署和网关方案。
- 多轮对话后上下文变长对耗时的影响。
- 只用一台 Mac、一条网络，样本 2 到 3 次。

## 复现

```sh
export DSH_HOME="$PWD/.research/dsh-home"
export DSH_AGENTS_HOME="$PWD/.research/agents-home"
export DEEPSEEK_API_KEY=...

dsh --profile customerweb --no-open --port 3099
# 用启动行里的 token URL 换 cookie，再调 /api/session/create、/api/session/prompt
```

会话日志在 `$DSH_HOME/sessions/<工作区编码>/<会话 id>/session.v4.jsonl.zstd`。工具表和耗时都可以从日志里读：

```sh
zstd -dc session.v4.jsonl.zstd | jq -r 'select(.type=="request/header") | [.data.header.tools[].name] | join(", ")'
```
