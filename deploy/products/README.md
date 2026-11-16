# 客户成品预置环境

> 状态：现行（2026-11-17 写好脚本，本机 Docker 验过；服务器上还没跑）

这里放服务器上装客户成品的脚本：Docker、共享 Postgres 16、成品 helper、Caddy 片段、每晚备份和 systemd timer。决定和目录权限见 `docs/运维手册.md` 第十二节。

## 文件

| 文件 | 干什么 |
| --- | --- |
| `install.sh` | 一次性安装，root 跑，可重复跑。装 Docker、建目录、起 Postgres、加 Caddy include、装 helper 和 timer、写 sudoers |
| `afk-product` | 服务器上的 helper。`product-init`、`product-deploy`、`product-rollback`、`product-backup`、`product-status` |
| `compose.template.yml` | 一个成品一套 Compose 的模板，`product-init` 复制成 `compose.yml` |
| `caddy/product.caddy` | 成品路由模板，每个成品生成一个文件 |
| `caddy/preview.caddy` | 预览路由模板，Basic Auth 只加在预览上 |
| `caddy/not-found.caddy` | 通配兜底，不认识的子域回 404 |
| `backup.sh` | 遍历成品 `pg_dump`，留 7 个日备和 4 个周备，连续两次失败告警 |
| `systemd/` | 每天 3 点备份的 service 和 timer |
| `test/local-test.sh` | 本机 Docker 集成测试 |

## 本机怎么跑测试

先起 Docker，然后：

```bash
bash deploy/products/test/local-test.sh
```

脚本在仓库下建 `.tmp-products-test/`，起一个临时 Postgres、一个最小 app 容器和一个临时 Caddy 容器，跑完删掉。会拉 `postgres:16`、`nginxinc/nginx-unprivileged:1.27-alpine`、`caddy:2.6.2` 三个镜像。

断言的内容：

- `product-init`：目录、权限、Compose、`.env`、database/role、Caddy 路由；两个软件的 role 互不连通。
- `product-deploy`：本机端口回 200；重复 deploy 不建第二套；容器非 root、不挂 Docker socket、不用 host 网络。
- `product-status --check` 通过；回滚能回到上一版。
- 备份写进备份目录；日备留 7 个、周备留 4 个；第一次失败不告警，连续第二次失败退出非零并打印告警。
- Caddy 能读两个 include 目录；样例成品回 200；未知子域回 404；不带客户端证书握手失败。

跳过 Caddy 那段：`AFK_TEST_NO_CADDY=1 bash deploy/products/test/local-test.sh`。

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
sudo afk-product product-init <客户简称>-<软件简称>.afkfactory.space --image <镜像:tag>
sudo afk-product product-deploy <客户简称>-<软件简称>.afkfactory.space
```

之后换版本只跑 `product-deploy ... --image <新镜像:tag>`。回滚跑 `product-rollback <地址>`，指回上一版，不用等人点头。服务器留最近 3 个版本。

`product-init` 做这些事：

1. 建 `/data/products/<地址>/`、`data/`、`releases/`。
2. 从 9100 起挑第一个空闲端口，记进 `.env`。
3. 生成数据库密码和应用密钥，写 `.env`（600 root）。
4. 建 database 和 role，role 只能连自己的库；共享 Postgres 接进这个成品的独立网络。
5. 写 `/etc/caddy/products/<地址>.caddy`，校验后 reload。

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

`AFK_PRODUCTS_ROOT`、`AFK_PREVIEWS_ROOT`、`AFK_CADDY_PRODUCTS`、`AFK_CADDY_PREVIEWS`、`AFK_BACKUP_DIR`、`AFK_PG_ENV`、`AFK_PG_CONTAINER`、`AFK_PG_DATA_DIR`、`AFK_PG_DATA_MODE`、`AFK_PG_UID`、`AFK_PORT_START`、`AFK_NETWORK_PREFIX`、`AFK_TEMPLATE_DIR`、`AFK_APP_UID`、`AFK_APP_GID`、`AFK_APP_INTERNAL_PORT`、`AFK_UPSTREAM_HOST`、`AFK_CADDY_RELOAD`、`AFK_DOCKER`、`AFK_TODAY`、`AFK_DAILY_KEEP`、`AFK_WEEKLY_KEEP`。
