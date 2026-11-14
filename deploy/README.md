# 官网下载包发布

官网静态页在本仓库 `site/`，构建产物在 `site/dist/`，部署时放服务器 `/data/www`。路由映射按 D-0097，由上线票 I-0070 落 Caddy。这里的两份是发布用的源：

| 文件 | 用途 |
| --- | --- |
| `Caddyfile` | 服务器上 `/etc/caddy/Caddyfile` 的源。裸域改成静态托管，`upload.` 子域暂回 `ok` |
| `publish.sh` | 重打包客户工作区，传到服务器，按 `.sha256` 复核，写 `customer-kit/release.json` |

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

根路径现在放一个临时的 `ok` 占位页（`/data/www/index.html`），让手册里「站点回 `ok`」的检查继续成立。教程页上线后换掉。

## 每次发布

```bash
AFK_SERVER=dev@<服务器地址> bash deploy/publish.sh
```

脚本会重打包、`scp` 两个文件、在服务器上 `sha256sum -c`，最后打出大小、SHA256 和下载地址。发布成功后它把同一组数字写进 `customer-kit/release.json`，官网下载页从这里读，记得一起提交。

## 验收

```bash
curl -sSI https://afkfactory.dev/downloads/客户工作区-v1.zip | head -1
curl -sSI https://afkfactory.dev/downloads/客户工作区-v1.zip | grep -i cache-control
curl -sS https://afkfactory.dev/downloads/客户工作区-v1.zip | shasum -a 256
```

第一条要 `200`，第二条要 `cache-control: no-cache`，第三条要和 `customer-kit/dist/客户工作区-v1.zip.sha256` 一致。下载文件名带中文，链接要按 UTF-8 编码后使用，浏览器点按钮不用管。

## 为什么下载加 `Cache-Control: no-cache`

下载链接固定为 `.../客户工作区-v1.zip`，内容随每次重打包变。Cloudflare 默认缓存 `.zip`，不声明就会把旧包留给客户，SHA256 对不上。`no-cache` 让边缘每次都回来问源站。

Cloudflare 的 Browser Cache TTL 必须是 0（Respect Existing Headers）。设成 4 小时，Cloudflare 会把源站的 `no-cache` 改成 `max-age=14400`，浏览器 4 小时内不回来问。2026-11-07 按 [#101](https://github.com/Lil-BobCN/grilling-remote/issues/101) 改过；换账号或重建 zone 时要重设。
