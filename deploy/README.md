# 官网下载包发布

官网静态页在本仓库 `site/`，构建产物在 `site/dist/`，部署时放服务器 `/data/www`。路由映射按 D-0097，2026-11-15 随 I-0086 上线落到 Caddy（I-0070 当时暂缓）。

客户入口是 `https://afkfactory.space/`；`afkfactory.dev` 保留兼容。`deploy/Caddyfile` 的裸域块同时匹配两个域名，站点和 API 共用。

这里的文件是发布和运维用的源：

| 文件 | 用途 |
| --- | --- |
| `Caddyfile` | 服务器上 `/etc/caddy/Caddyfile` 的源。裸域出官网页面和账号区，`upload.` 子域回 `ok` |
| `site-publish.sh` | 构建 `site/`，同步到服务器 `/data/www` |
| `publish.sh` | 重打包客户工作区，传到服务器，按 `.sha256` 复核，写 `customer-kit/release.json` |
| `ops-dates.json` | 到期表和提前提醒天数，巡检脚本读这份；说明见 `docs/服务器操作手册.md` 第十一节 |
| `backend/` | 后端 Node 服务的占位程序、systemd 单元、安装/发布/回滚/巡检脚本。真实服务源在仓库根 `backend/`。说明见 `docs/后端服务部署.md` 和 `docs/后端服务实现.md` |

## 一次性设置（要 sudo 密码，运营者跑）

在仓库根目录跑：

```bash
sudo mkdir -p /data/www/downloads
sudo chown -R dev:dev /data/www
sudo install -m 644 deploy/Caddyfile /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddyfile 现在要求客户端证书。第一次装之前，先把 AOP CA 证书放到 `/etc/caddy/certs/aop-ca.pem`，再跑 `caddy validate`。CA 和客户端证书怎么生成、怎么换，见 `docs/服务器操作手册.md` 的「源站 mTLS」一节。

`/data/www` 给 `dev`，上传时才不用 sudo。目录默认 755，`caddy` 用户读得到。Caddy 配置改了以后每次都跑 `validate` 和 `reload`，不重启服务。

根路径现在放的是正式官网首页。2026-11-15 前的临时 `ok` 占位页已被替换，手册里「站点回 `ok`」的检查改成看首页标题或 `/app/api/health`。

## 官网发布

```bash
AFK_SERVER=dev@<服务器地址> bash deploy/site-publish.sh
```

脚本在 `site/` 跑 `npm ci` 和 `npm run build`，再把 `site/dist/` 同步到 `/data/www`。同步时排除 `/downloads`，客户包不会被删。

Caddyfile 改过时，还要在服务器上换配置：

```bash
sudo install -m 644 /tmp/Caddyfile /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

## 客户包发布

```bash
AFK_SERVER=dev@<服务器地址> bash deploy/publish.sh
```

脚本会重打包、`scp` 两个文件、在服务器上 `sha256sum -c`，最后打出大小、SHA256 和下载地址。发布成功后它把同一组数字写进 `customer-kit/release.json`，官网下载页从这里读，记得一起提交。

## 验收

```bash
curl -sSI https://afkfactory.space/downloads/客户工作区-v1.zip | head -1
curl -sSI https://afkfactory.space/downloads/客户工作区-v1.zip | grep -i cache-control
curl -sS https://afkfactory.space/downloads/客户工作区-v1.zip | shasum -a 256
```

第一条要 `200`，第二条要 `cache-control: no-cache`，第三条要和 `customer-kit/dist/客户工作区-v1.zip.sha256` 一致。下载文件名带中文，链接要按 UTF-8 编码后使用，浏览器点按钮不用管。旧域名 `afkfactory.dev` 也能用，但内地线路会被干扰，验收以 `.space` 为准。

## 为什么下载加 `Cache-Control: no-cache`

下载链接固定为 `.../客户工作区-v1.zip`，内容随每次重打包变。Cloudflare 默认缓存 `.zip`，不声明就会把旧包留给客户，SHA256 对不上。`no-cache` 让边缘每次都回来问源站。

Cloudflare 两个 zone 的 Browser Cache TTL 都必须是 0（Respect Existing Headers）。设成 4 小时，Cloudflare 会把源站的 `no-cache` 改成 `max-age=14400`，浏览器 4 小时内不回来问。2026-11-07 按 [#101](https://github.com/Lil-BobCN/grilling-remote/issues/101) 改过；换账号或重建 zone 时要重设。

## 后端服务

`deploy/backend/` 是后端 Node 服务的部署路径：占位程序、systemd 单元、环境文件样例，加上安装、打包、发布、回滚、巡检五个脚本。真实服务源在本仓库 `backend/`，打包用 `bash deploy/backend/package.sh backend <版本>`。怎么装、怎么发布、怎么回滚、怎么看日志，写在 `docs/后端服务部署.md`；接口和上传判序在 `docs/后端服务实现.md`。

Caddyfile 里的 `/app/api/*` 已经反代到 `127.0.0.1:8787`。服务没起时这部分回 502，静态页和下载不受影响。

## 客户成品部署（2026-11-16 定，脚本未实现）

客户成品也放这台服务器，一个软件一个 Docker Compose。完整定义见 `docs/服务器操作手册.md` 第十二节。这里只记部署路径，脚本归 to-spec。

| 路径 | 放什么 |
| --- | --- |
| `/data/products/<交付地址>/compose.yml` | 一个软件的栈，600 root |
| `/data/products/<交付地址>/.env` | 镜像 tag、数据库密码、应用密钥，600 root |
| `/data/products/<交付地址>/data/` | 这个软件的上传文件和持久文件 |
| `/data/products/<交付地址>/releases/` | 最近三个版本的 tag 和 compose 记录 |
| `/data/products/postgres/` | 共享 Postgres 16 的数据卷和总钥匙 |
| `/data/products/backups/` | `pg_dump` 暂存，同步到 Mac 后删 |
| `/etc/caddy/products/<交付地址>.caddy` | 这个软件的 Caddy 路由 |
| `/usr/local/sbin/afk-product` | 部署、回滚和 `pg_dump` 的固定 helper；sudo 白名单只加这一条 |

一次性安装、构建、密钥、回滚、备份和巡检按手册第十二节。`deploy/Caddyfile` 和 `deploy/ops-dates.json` 等签完新 Origin CA、装好 Docker 后再改，不在本票改。
