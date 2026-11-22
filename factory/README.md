# 工厂层

调度器、点火、验证、评审、合并、回传拉取和部署脚本放这里。跑在运营者 Mac 上。服务器上的建仓、导入和上传服务在 `backend/`，通知在 `notifier/`，官网在 `site/`。

## 模块

| 文件 | 干什么 | 票 |
| --- | --- | --- |
| `lib/github.mjs` | GitHub REST 客户端 | 基础 |
| `lib/git.mjs` | 本地 git 操作 | 基础 |
| `lib/config.mjs` | 启动配置：读 env 文件、校验键、解析 helper 和模型 | I-0212 |
| `lib/scaffold.mjs` | 建客户仓和模板应用 | #458（在 `backend/`） |
| `lib/map-issues.mjs` | 按 `map.md` 建地图 issue 和决定票 | #460、#462 |
| `lib/scheduler.mjs` | 30 秒一轮的路由表 | #463、#470 |
| `lib/scheduler-jobs.mjs` | 调度器的默认实现：叫补缺口、叫拆票、建修复子票、读待答问题、读昨日合并、每日 preview-sweep | #457、#477 |
| `bin/scheduler.mjs` | 调度器命令行：`--once`、`--loop`、`--dry-run`；每轮输出 `executed` 和错误，`--loop` 写 JSONL | #463、#479 |
| `bin/status.mjs` | 汇总父工单、子票、最新 trail、PR、正在跑的 job 和最后错误 | #479 |
| `bin/gate.mjs` | `answer` 追加 gate 答行，给控制台用 | #479 |
| `lib/progress.mjs` | 客户进度转档行 `进度 v1｜…` | #463 |
| `lib/notify.mjs` | 调 `notifier/` 命令行发通知 | #463 |
| `lib/lock.mjs` | 每仓一把文件锁 | #463 |
| `lib/ignition.mjs` | 挑 frontier、贴标签、跑一次 Sandcastle | #464 |
| `lib/sandcastle-runner.mjs` | 默认 runner：装依赖、起容器、收回提交 | #464 |
| `bin/ignite.mjs` | 手工点火一张票，`--dry-run` 打印 prompt 和命令 | #464 |
| `lib/evidence.mjs` | 验证、评审、四样证据、合需求分支 | #465 |
| `lib/pipeline.mjs` | D3/D4/D5 一条流水线：点火完成后补验证评审，再合需求分支 | #478 |
| `lib/audit-agents.mjs` | 验证和评审 agent 的 `AFK_VERDICT` 解析、写 `.audit` trail | #457 |
| `lib/helper.mjs` | `gh` 和 `afk-product` 的公共命令入口 | #457 |
| `bin/audit-cli.mjs` | verify/review 两个 CLI 共用的参数解析和输出 | #457 |
| `bin/verify.mjs` | 跑一次验证 agent，写 `phase=verify` 和 `phase=test` 行 | #457 |
| `bin/review.mjs` | 跑一次评审 agent，写 `phase=review` 行 | #457 |
| `lib/stall.mjs` | 停法判据：三圈没进展、同类问题跨票两次 | #457 |
| `lib/finish.mjs` | 收尾评审、`/pr` 四栏、合主干 | #466 |
| `lib/inbox.mjs` | 从服务器拉回传件到 `inbox/` | #459 |
| `lib/deploy.mjs` | 构建镜像、部署、回滚、交付地址 | #468 |
| `bin/deploy.mjs` | 手工部署、回滚、打代码 zip；`finish` 合主干后自动部署并发 zip | #468 |
| `lib/preview.mjs` | 按 PR 起停预览 | #469 |

`lib/scaffold.mjs` 写在 `backend/`，因为建仓和建单在服务器上跑，发布包只装 `backend/`。Mac 侧需要同一份模板时，从 `backend/scaffold/` 读，不复制。

## 点火 runner

默认 runner 的依赖装在 `~/.afkfactory/sandcastle`（`AFK_SANDCASTLE_HOME` 可改），不进客户仓。第一次跑一张票时执行 `npm install @ai-hero/sandcastle@0.12.0 tsx`，之后复用。

镜像名取客户仓 `.sandcastle/.env` 的 `SANDCASTLE_IMAGE`，没写就用 `sandcastle:<仓名>`。
实际镜像名带内容哈希，比如 `sandcastle:demo-a1b2c3d4e5f6`。
哈希算实际 Dockerfile 的内容和模板 `backend/scaffold/.sandcastle/Dockerfile`。
模板改了，下一次点火自动换 tag 并重建。

默认镜像只用工厂模板 `backend/scaffold/.sandcastle/Dockerfile`，构建上下文是模板所在目录。
客户仓里的 `.sandcastle/Dockerfile` 不参与默认构建，建仓时复制的那份只是历史副本。
要用客户仓自己的 Dockerfile，显式传 `--dockerfile <相对客户仓的路径>`，构建上下文变成仓根。
构建用本机 `docker build`，把宿主 UID/GID 作为 `AGENT_UID`、`AGENT_GID` 传进去。
真的构建过之后跑一次冒烟：以宿主 UID/GID 起容器，检查 `/home/agent` 可写、能写全局 git 配置。
冒烟不过直接报错，带镜像名和输出尾部。
不再需要人工 `docker tag`。

装依赖和建镜像在 `prepare()` 里跑，不算点火的两分钟回执；只有真正起容器和会话的 `run()` 才计时。prepare 慢不会报「点火超时」。

容器凭证只从 `.sandcastle/.env` 转发，宿主环境变量不进容器。onboarding 用 GitHub App 按当前客户仓换 1 小时 `GH_TOKEN`，权限是 Issues、Pull requests、Contents、Workflows 读写，写进这个文件，权限 600。

新客户仓第一次点火前跑一次 onboarding，生成或补齐 `.sandcastle/.env`：

```sh
node factory/bin/repo-env.mjs ensure --repo-dir <客户仓> --owner <owner> --repo <repo>
```

命令从 `~/.afkfactory/env` 读 App 配置，`AFK_ENV_FILE` 可以换文件路径。点火时还会再补一次过期 token 并检查缺键。

手工点火一张票：

```bash
node factory/bin/ignite.mjs --owner <owner> --repo <repo> --parent <父工单号> --ticket <子票号>
node factory/bin/ignite.mjs ... --dry-run
node factory/bin/ignite.mjs ... --dockerfile <相对客户仓的路径>   # 可选，context 改成仓根
```

## Mac 常驻

`factory/bin/install-launchd.mjs` 把两个 launchd 任务装到运营者 Mac。安装会写 plist 和 wrapper，调 `launchctl` 加载，再检查任务真的起来了。退出码 0 才算装好。

| Label | 跑什么 | 日志 |
| --- | --- | --- |
| `com.afkfactory.pull-inbox` | 每 5 分钟跑一次 `factory/bin/pull-inbox.mjs` | `~/.afkfactory/logs/pull-inbox.log` |
| `com.afkfactory.scheduler` | 常驻 `factory/bin/scheduler.mjs --loop`，异常退出由 launchd 拉起 | `~/.afkfactory/logs/scheduler.log`；每轮另写 `~/.afkfactory/logs/scheduler-runs.jsonl` |

安装：

```bash
node factory/bin/install-launchd.mjs --repo-root <仓库路径>
```

装完复查：

```bash
node factory/bin/install-launchd.mjs --verify
```

`--verify` 只读，检查 plist 在不在、`launchctl print` 能不能看到任务、scheduler 的进程还在不在、pull-inbox 上次退出码，以及有没有 launchd 之外的调度器进程。缺一项就列出任务名，退出码非零。

重装直接再跑一次安装。脚本先 `bootout` 旧任务，再 `bootstrap` 新 plist。

卸载或回滚：先卸两个任务，再删 plist 和 wrapper。日志留在 `~/.afkfactory/logs`，方便查上次为什么退出。

```bash
launchctl bootout gui/$(id -u)/com.afkfactory.scheduler
launchctl bootout gui/$(id -u)/com.afkfactory.pull-inbox
rm -f ~/Library/LaunchAgents/com.afkfactory.scheduler.plist \
      ~/Library/LaunchAgents/com.afkfactory.pull-inbox.plist
rm -f ~/.afkfactory/bin/run-scheduler.sh ~/.afkfactory/bin/run-pull-inbox.sh
```

安装检查不过时，`install-launchd.mjs` 会自己 bootout 新任务；手工回滚就是上面四条。

常驻只用 launchd 这一条路。不要再用 `nohup` 手工起一份调度器，两份同时跑会重复点火。

两个 wrapper 都 source `~/.afkfactory/env`。env 文件路径可用 `AFK_ENV_FILE` 换。需要的键：

- `AFK_SERVER`（或写完整命令的 `AFK_HELPER`）
- `AFK_SSH_KEY`
- `GITHUB_OWNER`
- `GITHUB_TOKEN`
- `ANTHROPIC_MODEL`（或 `AFK_AGENT_MODEL`）

控制面 `GITHUB_TOKEN` 用细粒度 PAT，只选需要的仓，Issues、Pull requests、Contents 读写；容器里的 `GH_TOKEN` 由 GitHub App 按仓换 1 小时 token，两者分开。token 不写进 plist。

调度器启动时自检这些键，探测一次模型，并校验 `customers.json` 的形状。缺键或格式错就退出，错误里写键名和查过的文件。运行中每轮看 `customers.json` 的 mtime，变了就重读并重新校验；形状不对当轮报错，不沿用旧表。

调度器状态只在 GitHub。进程重启后按标签和阻塞边重新推导，不重复点火。

## 约定

- Node 26，ESM。不引第三方依赖，和 `backend/` 一致。
- 测试用 `node:test`，在 `factory/` 下跑 `npm test`。
- GitHub 调用走 `lib/github.mjs`；测试用 `test/fake-github.mjs` 起本地假服务，不碰真 GitHub。
- Git 操作走 `lib/git.mjs`；测试用临时目录和本地裸仓。
- 外部命令（`gh`、`docker`、`claude`、`ssh`）由调用方注入一个函数，测试换成假的，不跑网络和容器。
- 状态只从 GitHub 读，不另存进度文件。同一条规则要能重启后重新推导。
- 日志一行一条 JSON，字段 `ts`、`level`、`msg`，再加事件自己的字段。

## 测试

```bash
cd factory
npm test
```

`test/fake-github.mjs` 支持建仓、删仓、标签、工单、评论、子票、阻塞边、PR 和合并。用法见 `test/github.test.mjs`。
