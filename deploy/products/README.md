# 客户成品预置环境

> 状态：现行（2026-11-17 写好脚本，本机 Docker 验过；服务器上还没跑）

这里放服务器上装客户成品的脚本：Docker、共享 Postgres 16、成品 helper、Caddy 片段、每晚备份和 systemd timer。决定和目录权限见 `docs/运维手册.md` 第十二节。

## 文件

| 文件 | 干什么 |
| --- | --- |
| `install.sh` | 一次性安装，root 跑，可重复跑。装 Docker、建目录、起 Postgres、加 Caddy include、装 helper 和 timer、写 sudoers |
| `afk-product` | 服务器上的 helper。成品：`product-init`、`product-load`、`product-deploy`、`product-rollback`、`product-backup`、`product-status`；预览：`preview-start`、`preview-stop`、`preview-status`、`preview-sweep` |
| `compose.template.yml` | 一个成品或一套预览一套 Compose 的模板，`product-init`、`preview-start` 复制成 `compose.yml` |
| `caddy/product.caddy` | 成品路由模板，每个成品生成一个文件 |
| `caddy/preview.caddy` | 预览路由模板，Basic Auth 和访问日志只加在预览上 |
| `caddy/not-found.caddy` | 通配兜底，不认识的子域回 404 |
| `backup.sh` | 遍历成品 `pg_dump`，留 7 个日备和 4 个周备，连续两次失败告警 |
| `systemd/` | 每天 3 点备份的 service 和 timer |
| `test/local-test.sh` | 成品、备份和 Caddy 的本机 Docker 集成测试 |
| `test/preview-test.sh` | 预览起停、排队、Basic Auth、种子、sweep 和故障隔离的本机 Docker 集成测试 |

## 本机怎么跑测试

先起 Docker，然后：

```bash
bash deploy/products/test/local-test.sh
```

脚本在仓库下建 `.tmp-products-test-<进程号>/`，起一个临时 Postgres、一个最小 app 容器和一个临时 Caddy 容器，跑完删掉。会拉 `postgres:16`、`nginxinc/nginx-unprivileged:1.27-alpine`、`caddy:2.6.2` 三个镜像。

断言的内容：

- `product-init`：目录、权限、Compose、`.env`、database/role、Caddy 路由；两个软件的 role 互不连通。
- `product-deploy`：本机端口回 200；重复 deploy 不建第二套；容器非 root、不挂 Docker socket、不用 host 网络。
- `product-status --check` 通过；回滚能回到上一版。
- 备份写进备份目录；日备留 7 个、周备留 4 个；第一次失败不告警，连续第二次失败退出非零并打印告警。
- Caddy 能读两个 include 目录；样例成品回 200；未知子域回 404；不带客户端证书握手失败。

跳过 Caddy 那段：`AFK_TEST_NO_CADDY=1 bash deploy/products/test/local-test.sh`。

预览单独跑，起临时 Postgres、临时 Caddy、临时 app 镜像，跑完清理：

```bash
bash deploy/products/test/preview-test.sh
```

断言的内容：

- `preview-start`：目录、权限、Compose、`.env`、Basic Auth、独立 database/role、Caddy 路由和访问日志；空库跑过种子脚本，查得到种子行。
- 无凭据访问预览回 401，带凭据回 200；成品地址同时回 200，互不影响。
- 第二套预览排队，第一套销毁后才起；排队超时退出非零。
- `preview-stop`：容器、独立网络、Caddy 路由、database/role、镜像和目录都没了；重复销毁不报错。
- `preview-sweep`：刚起的不删；满 7 天删；24 小时内有过访问不删，访问和提交都超过 24 小时才删。
- `preview-status --check`：容器在、库在、路由在才通过；容器停了不通过。
- 镜像不存在时 `preview-start` 失败，不留目录、路由和库，成品地址照常。

## 服务器上装（运营者，要 sudo）

在服务器仓库根目录：

```bash
sudo bash deploy/products/install.sh
```

脚本可重复跑。已有的 Postgres 密钥、目录、Caddy include、sudoers 都不覆盖。

装完复核：

```bash
systemctl is-active docker
docker compose version
docker exec afk-products-postgres psql -U postgres -tAc 'select version()'
caddy validate --config /etc/caddy/Caddyfile
systemctl list-timers afk-product-backup.timer --no-pager
sudo afk-product product-status
```

## 装完怎么上一个成品

第一次部署（镜像由 Mac 构建后 `docker save` 传上来，`docker load` 之后）：

```bash
sudo afk-product product-load /tmp/<镜像>.tar
sudo afk-product product-init <客户简称>-<软件简称>.afkfactory.space --image <镜像:tag>
sudo afk-product product-deploy <客户简称>-<软件简称>.afkfactory.space
```

`product-load` 只跑 `docker load -i`，成功后打印镜像 tag；失败退出非零。Mac 侧部署脚本会自动调它。

之后换版本只跑 `product-deploy ... --image <新镜像:tag>`。回滚跑 `product-rollback <地址>`，指回上一版，不用等人点头。服务器留最近 3 个版本。

`product-init` 做这些事：

1. 建 `/data/products/<地址>/`、`data/`、`releases/`。
2. 从 9100 起挑第一个空闲端口，记进 `.env`。
3. 生成数据库密码和应用密钥，写 `.env`（600 root）。
4. 建 database 和 role，role 只能连自己的库；共享 Postgres 接进这个成品的独立网络。
5. 写 `/etc/caddy/products/<地址>.caddy`，校验后 reload。

## Mac 侧部署脚本

合主干后自动部署、手工回滚和默认交付的代码 zip 在 `factory/`：

```bash
node factory/bin/deploy.mjs deploy --repo-dir <仓库目录> --customer <客户简称> --product <软件简称> --order <订单号> --version <版本>
node factory/bin/deploy.mjs rollback --address <交付地址>
node factory/bin/deploy.mjs zip --repo-dir <仓库目录> --ref <提交> --address <交付地址> --version <版本>
```

`deploy` 在 Mac 上构建 `linux/amd64` 镜像，`scp` 传到源站，调 `product-load` 和 `product-deploy`，最后走 `https://<地址>/` 健康检查。失败整套重试一次，两次都失败保留上一版并发「出事」通知。合主干后 `factory/bin/finish.mjs` 默认自动调用它，`--no-deploy` 可关。默认 `AFK_SERVER=dev@<服务器>`，其余外部命令的覆盖方式见 `factory/bin/deploy.mjs` 头部注释。

## 预览环境

有界面的票在 D3 验证时起一套预览，地址 `<客户简称>-<软件简称>-pr<PR号>.afkfactory.space`，Basic Auth，只给验证队和运营者看。没有界面的票不建预览，约定见 `factory/agents/verify.md`。

服务器上：

```bash
sudo afk-product preview-start <地址> <镜像:tag> --seed 'npm run db:seed' --commit-at <PR head 提交时间>
sudo afk-product preview-stop <地址>
sudo afk-product preview-status [--check]
sudo afk-product preview-sweep
```

`preview-start` 做这些事：

1. 等预览名额。全局最多 1 套，第二套排队，先来先起；默认最多等 3600 秒，`AFK_PREVIEW_QUEUE_TIMEOUT` 可改。
2. 建 `/data/previews/<地址>/`，复制 Compose 模板，生成 `.env`（600 root），从 19200 起挑端口。
3. 建独立 database 和 role，名字都是 `preview_<地址 slug>`（最多 63 字符）。
4. 随机生成 Basic Auth 用户名和密码，哈希写进 `/etc/caddy/previews/<地址>.caddy`，reload Caddy。
5. 起容器，等本机端口应答，再跑 `--seed` 给的命令（在 app 容器里 `sh -c`，能读 `DATABASE_URL`）。
6. 打印 `AFK_PREVIEW user=...`、`password=...`、`env=...` 几行，给 Mac 侧写凭据文件。

预览和成品共用同一个 Postgres、Caddy、证书和 helper。预览容器限额、非 root、不挂 Docker socket，和成品一样；网络是独立的。

`preview-stop` 删容器、独立网络、Caddy 路由、database/role、镜像和预览目录，重复调用不报错。`preview-sweep` 按「24 小时无新提交且无访问」或「满 7 天」销毁，访问时间取 `/var/log/caddy/previews/<地址>.log` 的修改时间；记录的最后提交时间由 `--commit-at` 更新。PR 有新提交但没重建时，helper 看不到这些提交，调度器侧要用 `sweepPreviews` 按 GitHub 上的真实提交时间判断。`preview-status --check` 在容器、库、路由任一缺失时退出非零。

Mac 侧编排在 `factory/lib/preview.mjs`，命令行入口在 `factory/bin/preview.mjs`：

```bash
node factory/bin/preview.mjs start --address <地址> --image <镜像:tag> --seed 'npm run db:seed'
node factory/bin/preview.mjs stop --address <地址>
node factory/bin/preview.mjs sweep --once
```

默认调本机 `afk-product`；跨机器用 `AFK_SSH_TARGET='dev@<服务器>'` 走 ssh 加 sudo，或用 `AFK_HELPER` 指定命令前缀。凭据写到 Mac 的 `private/预览/<地址>.env`，`AFK_LOCAL_PREVIEW_DIR` 可改目录。

## 备份

`afk-product-backup` 每天 3:00 由 timer 跑，也可以 `sudo afk-product product-backup [<地址>]` 手动跑。

- dump 到 `/data/products/backups/<地址>/<日期>.sql.gz`；每个 ISO 周的第一份备份另存一份到 `weekly/<ISO 周>.sql.gz`。
- 日备留 7 个，周备留 4 个。
- 第一次失败只记数，不告警。连续第二次失败打印 `告警：`，以退出码 2 结束。
- systemd 把失败的 service 标成 failed，`systemctl --failed` 能看到。
- 同步到 Mac 只定义接口：脚本打印待同步目录并写 `/data/products/backups/.sync-pending`，不发网络请求。Mac 上用 rsync 拉走，同步任务另行配置。

## 安全边界

- `dev` 不进 `docker` 组。sudoers 只加一条：`dev ALL=(root) NOPASSWD: /usr/local/sbin/afk-product *`。
- app 容器非 root、不挂 Docker socket、不用 host 网络，只把端口绑在 `127.0.0.1`。
- 每个容器的上限：内存 512 MiB、CPU 0.5、pids 256。
- 共享 Postgres 不发布端口，总钥匙只在 `/data/products/postgres/.env`（600 root），不进 app 容器。
- 每个软件一个 bridge 网络，共享 Postgres 接进每个网络；app 之间没有共同网络，不能互访。

## Caddy include

`deploy/Caddyfile` 的现有规则没改。`install.sh` 在服务器 `/etc/caddy/Caddyfile` 末尾追加两行：

```caddyfile
import /etc/caddy/products/*.caddy
import /etc/caddy/previews/*.caddy
```

以后整份换 `/etc/caddy/Caddyfile`（比如按 `deploy/Caddyfile` 重装），重跑一次 `install.sh` 就会补回这两行。重复跑不会重复加。

不认识的子域由 `caddy/not-found.caddy` 里的 `*.afkfactory.space` 兜底回 404。Caddy 先匹配具体主机再匹配通配，已配好的成品地址不受影响。

## 脚本不做的步骤

这几步要运营者在 Cloudflare、证书和 Mac 上做：

1. Cloudflare 加 `*.afkfactory.space` 通配 A 记录，指向源站，开代理。
2. 签一张 SAN 为 `afkfactory.space`、`*.afkfactory.space`、`afkfactory.dev`、`*.afkfactory.dev` 的 Origin CA，装到 `/etc/caddy/certs/origin.pem` 和 `origin.key`；把到期日补进 `deploy/ops-dates.json`。
3. 两个 zone 的 SSL/TLS 模式切 Full (strict)。
4. Mac 上加每晚把 `/data/products/backups/` 和每个成品 `data/` 同步回去的任务，以及每个成品地址的外部探活。
5. 第一次交付后做一次恢复演练，之后每半年一次。

## 本机测试用的覆盖变量

helper、备份脚本和 `install.sh` 的路径都能用环境变量覆盖，测试靠这个不碰 `/data`：

`AFK_PRODUCTS_ROOT`、`AFK_PREVIEWS_ROOT`、`AFK_CADDY_PRODUCTS`、`AFK_CADDY_PREVIEWS`、`AFK_CADDY_LOG_DIR`、`AFK_BACKUP_DIR`、`AFK_PG_ENV`、`AFK_PG_CONTAINER`、`AFK_PG_DATA_DIR`、`AFK_PG_DATA_MODE`、`AFK_PG_UID`、`AFK_PORT_START`、`AFK_PREVIEW_PORT_START`、`AFK_NETWORK_PREFIX`、`AFK_TEMPLATE_DIR`、`AFK_APP_UID`、`AFK_APP_GID`、`AFK_APP_INTERNAL_PORT`、`AFK_UPSTREAM_HOST`、`AFK_CADDY_RELOAD`、`AFK_DOCKER`、`AFK_TODAY`、`AFK_DAILY_KEEP`、`AFK_WEEKLY_KEEP`、`AFK_CADDY_IMAGE`、`AFK_CADDY_BIN`、`AFK_CADDY_USER`、`AFK_PREVIEW_QUEUE_TIMEOUT`、`AFK_PREVIEW_QUEUE_POLL`、`AFK_PREVIEW_LOCK_TIMEOUT`、`AFK_NOW`。
