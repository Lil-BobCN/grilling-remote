# 工厂层

调度器、点火、验证、评审、合并、回传拉取和部署脚本放这里。跑在运营者 Mac 上。服务器上的建仓、导入和上传服务在 `backend/`，通知在 `notifier/`，官网在 `site/`。

## 模块

| 文件 | 干什么 | 票 |
| --- | --- | --- |
| `lib/github.mjs` | GitHub REST 客户端 | 基础 |
| `lib/git.mjs` | 本地 git 操作 | 基础 |
| `lib/scaffold.mjs` | 建客户仓和模板应用 | #458（在 `backend/`） |
| `lib/map-issues.mjs` | 按 `map.md` 建地图 issue 和决定票 | #460、#462 |
| `lib/scheduler.mjs` | 30 秒一轮的路由表 | #463、#470 |
| `lib/progress.mjs` | 客户进度转档行 `进度 v1｜…` | #463 |
| `lib/notify.mjs` | 调 `notifier/` 命令行发通知 | #463 |
| `lib/lock.mjs` | 每仓一把文件锁 | #463 |
| `lib/ignition.mjs` | 挑 frontier、贴标签、跑一次 Sandcastle | #464 |
| `lib/sandcastle-runner.mjs` | 默认 runner：装依赖、起容器、收回提交 | #464 |
| `bin/ignite.mjs` | 手工点火一张票，`--dry-run` 打印 prompt 和命令 | #464 |
| `lib/evidence.mjs` | 验证、评审、四样证据、合需求分支 | #465 |
| `lib/finish.mjs` | 收尾评审、`/pr` 四栏、合主干 | #466 |
| `lib/inbox.mjs` | 从服务器拉回传件到 `inbox/` | #459 |
| `lib/deploy.mjs` | 构建镜像、部署、回滚、交付地址 | #468 |
| `bin/deploy.mjs` | 手工部署、回滚、打代码 zip；`finish` 合主干后自动部署并发 zip | #468 |
| `lib/preview.mjs` | 按 PR 起停预览 | #469 |

`lib/scaffold.mjs` 写在 `backend/`，因为建仓和建单在服务器上跑，发布包只装 `backend/`。Mac 侧需要同一份模板时，从 `backend/scaffold/` 读，不复制。

## 点火 runner

默认 runner 的依赖装在 `~/.afkfactory/sandcastle`（`AFK_SANDCASTLE_HOME` 可改），不进客户仓。第一次跑一张票时执行 `npm install @ai-hero/sandcastle@0.12.0 tsx`，之后复用。

镜像名取客户仓 `.sandcastle/.env` 的 `SANDCASTLE_IMAGE`，没有就用 `sandcastle:<仓名>`。本机没有这个镜像时，用 `npx @ai-hero/sandcastle docker build-image --image-name <镜像名>` 建一次。

装依赖和建镜像在 `prepare()` 里跑，不算点火的两分钟回执；只有真正起容器和会话的 `run()` 才计时。prepare 慢不会报「点火超时」。

容器凭证只从 `.sandcastle/.env` 转发，宿主环境变量不进容器。`GH_TOKEN` 也在这个文件里，只给当前客户仓的 issue、PR 和内容权限。

手工点火一张票：

```bash
node factory/bin/ignite.mjs --owner <owner> --repo <repo> --parent <父工单号> --ticket <子票号>
node factory/bin/ignite.mjs ... --dry-run
```

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
