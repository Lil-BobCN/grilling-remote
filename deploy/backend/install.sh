#!/usr/bin/env bash
# 一次性安装：建服务用户、数据目录、环境文件、systemd 单元，换 Caddy 配置。
# 用 root 跑。安装完还不能启动服务，先要有第一版发布。
#
#   sudo bash deploy/backend/install.sh
#
# 脚本可以重复跑：已有的用户、目录、环境文件都不覆盖。

set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "要用 root 跑：sudo bash $0" >&2
  exit 1
fi

HERE=$(cd -- "$(dirname -- "$0")" && pwd)
CADDYFILE=${CADDYFILE:-$HERE/../Caddyfile}
SERVICE_FILE=$HERE/afkapp.service
ENV_EXAMPLE=$HERE/app.env.example

for file in "$CADDYFILE" "$SERVICE_FILE" "$ENV_EXAMPLE"; do
  [[ -f $file ]] || { echo "缺文件：$file" >&2; exit 1; }
done

echo "== 服务用户"
if id afkapp >/dev/null 2>&1; then
  echo "afkapp 已存在，跳过"
else
  adduser --system --group --home /home/afkapp --shell /usr/sbin/nologin afkapp
  install -d -m 750 -o afkapp -g afkapp /home/afkapp
  echo "建好 afkapp"
fi

echo "== 目录"
install -d -m 755 /data/app /data/app/releases
chown root:root /data/app /data/app/releases
install -d -m 700 -o afkapp -g afkapp /data/customers /data/uploads
chown afkapp:afkapp /data/customers /data/uploads
chmod 700 /data/customers /data/uploads
install -d -m 750 /etc/afkapp
chown root:root /etc/afkapp
chmod 750 /etc/afkapp

echo "== 环境文件"
if [[ -f /etc/afkapp/app.env ]]; then
  echo "/etc/afkapp/app.env 已存在，没覆盖"
else
  install -m 600 -o root -g root "$ENV_EXAMPLE" /etc/afkapp/app.env
  echo "写入 /etc/afkapp/app.env，记得填 GITHUB_TOKEN、SMTP_PASSWORD、SESSION_SECRET"
fi

echo "== systemd 单元"
install -m 644 -o root -g root "$SERVICE_FILE" /etc/systemd/system/afkapp.service
systemctl daemon-reload
echo "装好 afkapp.service，还没 enable，等第一版发布"

echo "== 运维脚本"
# 这里只在装机时跑。以后改这三个脚本，按 docs/后端服务部署.md 的「发布」一节换 /data/app/bin/ 里的旧版。
install -d -m 755 /data/app/bin
for script in deploy.sh rollback.sh check.sh; do
  install -m 755 -o root -g root "$HERE/$script" "/data/app/bin/$script"
done
echo "脚本放到了 /data/app/bin/"

echo "== Caddy"
backup=/etc/caddy/Caddyfile.bak.$(date -u +%Y%m%dT%H%M%SZ)
cp -a /etc/caddy/Caddyfile "$backup"
install -m 644 -o root -g root "$CADDYFILE" /etc/caddy/Caddyfile
if ! caddy validate --config /etc/caddy/Caddyfile; then
  echo "Caddy 配置没过校验，已还原旧文件" >&2
  cp -a "$backup" /etc/caddy/Caddyfile
  exit 1
fi
systemctl reload caddy
echo "Caddy 已换，旧文件在 $backup"

cat <<'EOF'

装完了。下一步：

1. 填 /etc/afkapp/app.env 里的三项密钥，权限保持 600 root:root。
2. 把第一版发布包传上去，用 deploy/backend/deploy.sh 发布。
3. 发布成功后跑 deploy/backend/check.sh 复核。
EOF
