#!/usr/bin/env bash
# 构建官网并同步到服务器 /data/www。在仓库根目录跑：
#   AFK_SERVER=dev@<服务器地址> bash deploy/site-publish.sh
#
# Caddyfile 改过时，这个脚本不会自动换配置。换配置要 sudo，按脚本结尾的提示手动跑。

set -euo pipefail

SERVER=${AFK_SERVER:?用法：AFK_SERVER=dev@<服务器地址> bash deploy/site-publish.sh}
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

cd "$ROOT/site"
npm ci --no-audit --no-fund
npm run build
cd "$ROOT"

# /downloads 是客户包目录，由 deploy/publish.sh 管，同步时不能删。
rsync -az --delete --exclude '/downloads' site/dist/ "$SERVER:/data/www/"

echo "同步完成：$SERVER:/data/www"
echo "Caddyfile 改过时，还要在服务器上换配置："
echo "  sudo install -m 644 /tmp/Caddyfile /etc/caddy/Caddyfile"
echo "  sudo caddy validate --config /etc/caddy/Caddyfile"
echo "  sudo systemctl reload caddy"
