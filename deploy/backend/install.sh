#!/usr/bin/env bash
# 一次性安装：建服务用户、数据目录、环境文件、systemd 单元，装回传件拉取 helper
# 和 sudoers 规则，换 Caddy 配置。用 root 跑。安装完还不能启动服务，先要有第一版发布。
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
IMPORT_SERVICE_FILE=$HERE/afk-import.service
IMPORT_TIMER_FILE=$HERE/afk-import.timer
UPLOAD_HELPER=$HERE/afk-uploads
ENV_EXAMPLE=$HERE/app.env.example
SUDO_USER_NAME=${AFK_SUDO_USER:-dev}
UPLOAD_SUDO_FILE=/etc/sudoers.d/afk-uploads

for file in "$CADDYFILE" "$SERVICE_FILE" "$IMPORT_SERVICE_FILE" "$IMPORT_TIMER_FILE" "$UPLOAD_HELPER" "$ENV_EXAMPLE" "$HERE/../lib/health.sh" "$HERE/../lib/fingerprint.sh"; do
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
  echo "写入 /etc/afkapp/app.env，记得填 GITHUB_TOKEN、GITHUB_ADMIN_TOKEN、GITHUB_OWNER、SESSION_SECRET 和客户邮件 SMTP"
fi

echo "== systemd 单元"
install -m 644 -o root -g root "$SERVICE_FILE" /etc/systemd/system/afkapp.service
install -m 644 -o root -g root "$IMPORT_SERVICE_FILE" /etc/systemd/system/afk-import.service
install -m 644 -o root -g root "$IMPORT_TIMER_FILE" /etc/systemd/system/afk-import.timer
systemctl daemon-reload
systemctl enable afk-import.timer
echo "装好 afkapp.service 和 afk-import.timer；afkapp 还没 enable，等第一版发布"
echo "第一版发布后启动导入定时器：systemctl start afk-import.timer"

echo "== 运维脚本"
# 这里只在装机时跑。以后改这些脚本，按 docs/后端服务.md 的「发布」一节换 /data/app/bin/ 里的旧版。
install -d -m 755 /data/app/bin
for script in deploy.sh rollback.sh check.sh; do
  install -m 755 -o root -g root "$HERE/$script" "/data/app/bin/$script"
done
for lib in health.sh fingerprint.sh; do
  install -m 644 -o root -g root "$HERE/../lib/$lib" "/data/app/bin/$lib"
done
echo "脚本和共享库放到了 /data/app/bin/"

echo "== 回传件拉取 helper"
install -m 755 -o root -g root "$UPLOAD_HELPER" /usr/local/sbin/afk-uploads
echo "装好 /usr/local/sbin/afk-uploads（list、cat、rm、cat-customers、send-delivery-mail）"

if [[ -f $UPLOAD_SUDO_FILE ]]; then
  echo "$UPLOAD_SUDO_FILE 已存在，不覆盖"
else
  printf '%s ALL=(root) NOPASSWD: /usr/local/sbin/afk-uploads *\n' "$SUDO_USER_NAME" >"$UPLOAD_SUDO_FILE"
  chmod 440 "$UPLOAD_SUDO_FILE"
  if ! visudo -cf "$UPLOAD_SUDO_FILE"; then
    rm -f "$UPLOAD_SUDO_FILE"
    echo "sudoers 校验不过，已删掉新文件" >&2
    exit 1
  fi
  echo "只加了这一条：$SUDO_USER_NAME 能免密跑 /usr/local/sbin/afk-uploads"
fi

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

1. 填 /etc/afkapp/app.env 里的密钥：GITHUB_TOKEN、GITHUB_ADMIN_TOKEN、GITHUB_OWNER、SESSION_SECRET 和客户邮件 SMTP，权限保持 600 root:root。
2. 把第一版发布包传上去，用 deploy/backend/deploy.sh 发布。
3. 发布成功后跑 deploy/backend/check.sh 复核，再 systemctl start afk-import.timer。
4. Mac 上跑拉取桥时用 dev 账号，afk-uploads 已免密；客户表也走它同步。
5. 部署脚本发「待客户验收」邮件也走 afk-uploads send-delivery-mail，不用另加 sudoers；
   它读 /data/customers/orders/ 的订单、客户表和 /etc/afkapp/app.env 的 SMTP 配置。
EOF
