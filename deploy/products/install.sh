#!/usr/bin/env bash
# 客户成品预置环境的一次性安装。用 root 跑，可重复跑：
#
#   sudo bash deploy/products/install.sh
#
# 做这些事：
#   1. 检查 Docker Engine 和 Compose；没装就按 Docker 官方 apt 源装。
#   2. 建 /data/products/、/data/previews/、/etc/caddy/products/、/etc/caddy/previews/。
#   3. 起共享 Postgres 16（不发布端口，数据在 /data/products/postgres/，总钥匙 600 root）。
#   4. 在 /etc/caddy/Caddyfile 末尾追加两个 include（已有就跳过），校验后 reload。
#   5. 装 afk-product、备份脚本和模板到 /usr/local/{sbin,share}。
#   6. 装每天 3 点的 systemd timer。
#   7. sudoers 只加 afk-product 一条，dev 不进 docker 组。
#
# 已有目录、密钥、Caddyfile 里的 include 都不覆盖。
# 不在服务器上跑 DNS、证书和 Cloudflare 设置，那几步留给运营者，见 README。

set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "要用 root 跑：sudo bash $0" >&2
  exit 1
fi

HERE=$(cd -- "$(dirname -- "$0")" && pwd)
PRODUCTS_ROOT=${AFK_PRODUCTS_ROOT:-/data/products}
PREVIEWS_ROOT=${AFK_PREVIEWS_ROOT:-/data/previews}
BACKUP_DIR=${AFK_BACKUP_DIR:-$PRODUCTS_ROOT/backups}
CADDY_PRODUCTS=${AFK_CADDY_PRODUCTS:-/etc/caddy/products}
CADDY_PREVIEWS=${AFK_CADDY_PREVIEWS:-/etc/caddy/previews}
CADDYFILE=${AFK_CADDYFILE:-/etc/caddy/Caddyfile}
PG_CONTAINER=${AFK_PG_CONTAINER:-afk-products-postgres}
PG_IMAGE=${AFK_PG_IMAGE:-postgres:16}
PG_UID=${AFK_PG_UID:-999}
PG_DATA_DIR=${AFK_PG_DATA_DIR:-$PRODUCTS_ROOT/postgres/data}
PG_DATA_MODE=${AFK_PG_DATA_MODE:-700}
SUDO_USER_NAME=${AFK_SUDO_USER:-dev}
SUDO_FILE=/etc/sudoers.d/afk-product
SHARE_DIR=/usr/local/share/afk-product

log() { printf '%s\n' "$*"; }
die() { printf '%s\n' "$*" >&2; exit 1; }

for file in compose.template.yml afk-product backup.sh \
  caddy/product.caddy caddy/preview.caddy caddy/not-found.caddy \
  systemd/afk-product-backup.service systemd/afk-product-backup.timer; do
  [[ -f $HERE/$file ]] || die "缺文件：$HERE/$file"
done

# ---------------------------------------------------------------- Docker

install_docker() {
  command -v apt-get >/dev/null 2>&1 || die "没有 apt-get；这台机器不是 Ubuntu/Debian，按 Docker 文档手动装"
  # shellcheck disable=SC1091
  . /etc/os-release
  local distro=${ID:-ubuntu} codename=${VERSION_CODENAME:?读不到 VERSION_CODENAME}
  [[ $distro == ubuntu || $distro == debian ]] || die "不认识的发行版：$distro"

  log "装 Docker Engine 和 Compose 插件（Docker 官方 apt 源）"
  apt-get update
  apt-get install -y ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/$distro/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/%s %s stable\n' \
    "$(dpkg --print-architecture)" "$distro" "$codename" >/etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
}

log "== Docker"
if ! command -v docker >/dev/null 2>&1; then
  install_docker
else
  if ! docker compose version >/dev/null 2>&1; then
    log "Docker 在，但缺 Compose 插件，按官方源补装"
    install_docker
  fi
fi
systemctl enable --now docker
docker info >/dev/null 2>&1 || die "Docker 起不来，看 journalctl -u docker"
log "Docker $(docker version --format '{{.Server.Version}}')，Compose $(docker compose version --short 2>/dev/null || docker compose version)"

# ---------------------------------------------------------------- 目录

log "== 目录"
install -d -m 755 -o root -g root "$PRODUCTS_ROOT" "$PREVIEWS_ROOT"
install -d -m 700 -o root -g root "$PRODUCTS_ROOT/postgres" "$BACKUP_DIR"
install -d -m 755 -o root -g root "$CADDY_PRODUCTS" "$CADDY_PREVIEWS"
install -d -m 700 "$PG_DATA_DIR"
chown "$PG_UID:$PG_UID" "$PG_DATA_DIR"
chmod "$PG_DATA_MODE" "$PG_DATA_DIR"
log "目录建好：${PRODUCTS_ROOT}、${PREVIEWS_ROOT}、${CADDY_PRODUCTS}、${CADDY_PREVIEWS}"

# ---------------------------------------------------------------- 共享 Postgres

log "== 共享 Postgres 16"
PG_ENV=$PRODUCTS_ROOT/postgres/.env
if [[ -f $PG_ENV ]]; then
  log "$PG_ENV 已存在，密钥不动"
else
  pg_pass=$(openssl rand -hex 24)
  cat >"$PG_ENV" <<EOF
POSTGRES_USER=postgres
POSTGRES_PASSWORD=$pg_pass
POSTGRES_DB=postgres
AFK_PG_SUPERUSER=postgres
AFK_PG_SUPERUSER_PASSWORD=$pg_pass
EOF
  chmod 600 "$PG_ENV"
  chown root:root "$PG_ENV"
  log "写 ${PG_ENV}（600 root）"
fi

if ! docker inspect "$PG_CONTAINER" >/dev/null 2>&1; then
  docker run -d --name "$PG_CONTAINER" \
    --restart unless-stopped \
    --env-file "$PG_ENV" \
    -v "$PG_DATA_DIR:/var/lib/postgresql/data" \
    "$PG_IMAGE" >/dev/null
  log "起容器 ${PG_CONTAINER}（${PG_IMAGE}，不发布端口）"
else
  if [[ $(docker inspect -f '{{.State.Running}}' "$PG_CONTAINER") != true ]]; then
    docker start "$PG_CONTAINER" >/dev/null
  fi
  log "容器 $PG_CONTAINER 已存在"
fi

i=0
until docker exec "$PG_CONTAINER" pg_isready -U postgres >/dev/null 2>&1; do
  i=$((i + 1))
  [[ $i -lt 60 ]] || die "共享 Postgres 60 秒内没就绪，看 docker logs $PG_CONTAINER"
  sleep 1
done
log "共享 Postgres 就绪"

# ---------------------------------------------------------------- Caddy include

log "== Caddy include"
[[ -f $CADDYFILE ]] || die "找不到 ${CADDYFILE}；先按运维手册第十节装 Caddy"
# 通配兜底先放好，和 include 一起校验、一起 reload。
install -m 644 -o root -g root "$HERE/caddy/not-found.caddy" "$CADDY_PRODUCTS/00-not-found.caddy"
if grep -qF 'import /etc/caddy/products/*.caddy' "$CADDYFILE" \
  && grep -qF 'import /etc/caddy/previews/*.caddy' "$CADDYFILE"; then
  log "$CADDYFILE 已有 include，跳过"
else
  backup="$CADDYFILE.bak.$(date -u +%Y%m%dT%H%M%SZ)"
  cp -a "$CADDYFILE" "$backup"
  printf '\n# 成品和预览路由（deploy/products/install.sh 维护；整份换 Caddyfile 后重跑本脚本）\n' >>"$CADDYFILE"
  cat "$HERE/caddy/main-include.caddy" >>"$CADDYFILE"
  if ! caddy validate --config "$CADDYFILE"; then
    cp -a "$backup" "$CADDYFILE"
    die "Caddy 配置没过校验，已还原旧文件"
  fi
  log "已追加两行 include，旧文件在 $backup"
fi
caddy validate --config "$CADDYFILE" >/dev/null
systemctl reload caddy
log "caddy 已 reload"

# ---------------------------------------------------------------- helper、模板、备份

log "== helper 和模板"
install -m 755 -o root -g root "$HERE/afk-product" /usr/local/sbin/afk-product
install -m 755 -o root -g root "$HERE/backup.sh" /usr/local/sbin/afk-product-backup
install -d -m 755 -o root -g root "$SHARE_DIR" "$SHARE_DIR/caddy"
install -m 644 -o root -g root "$HERE/compose.template.yml" "$SHARE_DIR/compose.template.yml"
install -m 644 -o root -g root "$HERE/caddy/product.caddy" "$SHARE_DIR/caddy/product.caddy"
install -m 644 -o root -g root "$HERE/caddy/preview.caddy" "$SHARE_DIR/caddy/preview.caddy"
log "afk-product、afk-product-backup 和模板装好"

log "== systemd timer"
install -m 644 -o root -g root "$HERE/systemd/afk-product-backup.service" /etc/systemd/system/afk-product-backup.service
install -m 644 -o root -g root "$HERE/systemd/afk-product-backup.timer" /etc/systemd/system/afk-product-backup.timer
systemctl daemon-reload
systemctl enable --now afk-product-backup.timer
log "afk-product-backup.timer 已开，每天 3:00 备份"

# ---------------------------------------------------------------- sudoers

log "== sudoers"
if [[ -f $SUDO_FILE ]]; then
  log "$SUDO_FILE 已存在，不覆盖"
else
  printf '%s ALL=(root) NOPASSWD: /usr/local/sbin/afk-product *\n' "$SUDO_USER_NAME" >"$SUDO_FILE"
  chmod 440 "$SUDO_FILE"
  if ! visudo -cf "$SUDO_FILE"; then
    rm -f "$SUDO_FILE"
    die "sudoers 校验不过，已删掉新文件"
  fi
  log "只加了这一条：$SUDO_USER_NAME 能免密跑 /usr/local/sbin/afk-product"
fi

# ---------------------------------------------------------------- 复核

cat <<EOF

装完了。复核命令：

  systemctl is-active docker
  docker compose version
  docker exec $PG_CONTAINER psql -U postgres -tAc 'select version()'
  caddy validate --config $CADDYFILE
  systemctl list-timers afk-product-backup.timer --no-pager

盘一下现状：

  sudo afk-product product-status

还要运营者手动做的（脚本不做）：

  1. Cloudflare 加 *.afkfactory.space 通配 A 记录，开代理。
  2. 签一张 SAN 为 afkfactory.space、*.afkfactory.space、afkfactory.dev、
     *.afkfactory.dev 的 Origin CA，装到 /etc/caddy/certs/origin.pem 和 origin.key。
  3. 两个 zone 的 SSL/TLS 模式切 Full (strict)。
  4. Mac 上加每晚把 $BACKUP_DIR 和成品 data/ 同步回去的任务，以及每个成品地址的外部探活。
  5. 第一次交付后做一次恢复演练（停 app、drop/create database、psql 恢复、起 app、健康检查）。
EOF
