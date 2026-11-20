#!/usr/bin/env bash
# 本机 Docker 集成测试：成品预置环境的 helper、备份和 Caddy 片段。
#
#   bash deploy/products/test/local-test.sh
#
# 用临时目录和临时容器，跑完删掉。需要本机 Docker 和 docker compose。
# 不碰服务器，不改 /data，不读真实密钥。
#
# 可选环境变量：
#   AFK_TEST_KEEP=1     跑完不删临时目录，方便看现场
#   AFK_TEST_NO_CADDY=1 跳过 Caddy 容器那段

set -uo pipefail

REPO=$(cd -- "$(dirname -- "$0")/../../.." && pwd)
PRODUCTS=$REPO/deploy/products
HELPER=$PRODUCTS/afk-product
BACKUP=$PRODUCTS/backup.sh
COMPOSE_TEMPLATE=$PRODUCTS/compose.template.yml
APP_IMAGE=${AFK_TEST_APP_IMAGE:-nginxinc/nginx-unprivileged:1.27-alpine}
APP_UID=101
APP_GID=101
APP_INTERNAL_PORT=8080
PG_IMAGE=${AFK_TEST_PG_IMAGE:-postgres:16}
CADDY_IMAGE=${AFK_TEST_CADDY_IMAGE:-caddy:2.6.2}

TMP=${AFK_TEST_TMP:-$REPO/.tmp-products-test-$$}
PG_NAME="afk-test-pg-$$"
CADDY_NAME="afk-test-caddy-$$"
NET_PREFIX="afk-test-$$-"
ADDR="acme-shop-$RANDOM.afkfactory.space"
SLUG=$(printf '%s' "$ADDR" | sed 's/[^a-z0-9]/_/g')
NET="${NET_PREFIX}${SLUG}"
PORT_START=${AFK_TEST_PORT_START:-19100}
CADDY_HOST_PORT=${AFK_TEST_CADDY_PORT:-18443}

PASS=0
FAILED=0

ok() { PASS=$((PASS + 1)); printf '通过  %s\n' "$*"; }
bad() { FAILED=$((FAILED + 1)); printf '失败  %s\n' "$*" >&2; }
note() { printf '      %s\n' "$*"; }

assert_eq() { # 期望 实际 说明
  if [[ $1 == "$2" ]]; then ok "$3"; else bad "$3（期望 $1，实际 $2）"; fi
}

assert_contains() { # 文件 文本 说明
  if grep -qF -- "$2" "$1" 2>/dev/null; then ok "$3"; else bad "$3（$1 里没有 $2）"; fi
}

assert_not_contains() { # 文件 文本 说明
  if grep -qF -- "$2" "$1" 2>/dev/null; then bad "$3（$1 里有 $2）"; else ok "$3"; fi
}

file_mode() {
  if stat -c '%a' "$1" >/dev/null 2>&1; then
    stat -c '%a' "$1"
  else
    stat -f '%Lp' "$1"
  fi
}

assert_mode() { # 路径 权限 说明
  if [[ ! -e $1 ]]; then bad "$3（$1 不存在）"; return; fi
  local got
  got=$(file_mode "$1")
  if [[ $got == "$2" ]]; then ok "$3"; else bad "$3（期望 ${2}，实际 ${got}）"; fi
}

assert_file() { # 路径 说明
  if [[ -f $1 ]]; then ok "$2"; else bad "$2（$1 不存在）"; fi
}

assert_dir() { # 路径 说明
  if [[ -d $1 ]]; then ok "$2"; else bad "$2（$1 不存在）"; fi
}

env_get() { # 文件 键
  sed -n "s/^$2=//p" "$1" 2>/dev/null | tail -1
}

psql_super() { # SQL
  docker exec -e PGPASSWORD="$PG_PW" "$PG_NAME" psql -U postgres -tAc "$1" 2>/dev/null
}

cleanup() {
  if [[ ${AFK_TEST_KEEP:-0} == 1 ]]; then
    printf '\n保留现场：%s\n' "$TMP"
    return
  fi
  docker rm -f "$CADDY_NAME" >/dev/null 2>&1 || true
  if [[ -d $TMP/products ]]; then
    for d in "$TMP"/products/*/; do
      [[ -f $d/.env ]] || continue
      local slug
      slug=$(basename "$d" | sed 's/[^a-z0-9]/_/g')
      docker rm -f "$(docker ps -aq --filter "label=com.docker.compose.project=$slug")" >/dev/null 2>&1 || true
    done
  fi
  docker rm -f "$PG_NAME" >/dev/null 2>&1 || true
  # 每个成品的独立网络都删，包括隔离测试建的第二个；共享 Postgres 还挂着时先摘掉。
  if [[ -d $TMP/products ]]; then
    local d net
    for d in "$TMP"/products/*/; do
      [[ -f $d/.env ]] || continue
      net=$(env_get "$d/.env" APP_NETWORK)
      [[ -n $net ]] || continue
      docker network disconnect "$net" "$PG_NAME" >/dev/null 2>&1 || true
      docker network rm "$net" >/dev/null 2>&1 || true
    done
  fi
  docker network rm "$NET" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

run_test() {
  local name=$1
  shift
  printf '\n== %s\n' "$name"
  "$@"
}

# ---------------------------------------------------------------- 0. 静态检查

test_static() {
  if bash -n "$PRODUCTS/install.sh"; then ok "install.sh 语法通过"; else bad "install.sh 语法错误"; fi
  if bash -n "$HELPER"; then ok "afk-product 语法通过"; else bad "afk-product 语法错误"; fi
  if bash -n "$BACKUP"; then ok "backup.sh 语法通过"; else bad "backup.sh 语法错误"; fi

  assert_contains "$PRODUCTS/caddy/main-include.caddy" 'import /etc/caddy/products/*.caddy' "主配置片段有成品 include"
  assert_contains "$PRODUCTS/caddy/main-include.caddy" 'import /etc/caddy/previews/*.caddy' "主配置片段有预览 include"
  assert_contains "$PRODUCTS/caddy/not-found.caddy" 'respond 404' "兜底片段回 404"
  assert_contains "$PRODUCTS/systemd/afk-product-backup.timer" 'OnCalendar=*-*-* 03:00:00' "timer 定在 3 点"
  assert_contains "$PRODUCTS/install.sh" 'NOPASSWD: /usr/local/sbin/afk-product *' "sudoers 只放 afk-product 一条"
  assert_contains "$PRODUCTS/install.sh" 'AFK_PG_IMAGE:-postgres:16' "默认用 Postgres 16"
}

# ---------------------------------------------------------------- 准备

prepare() {
  for f in "$HELPER" "$BACKUP" "$COMPOSE_TEMPLATE"; do
    if [[ ! -f $f ]]; then bad "缺文件 $f"; return 1; fi
  done
  if ! docker info >/dev/null 2>&1; then bad "Docker 没在跑"; return 1; fi

  rm -rf "$TMP"
  mkdir -p "$TMP/products/postgres" "$TMP/products/backups" "$TMP/previews" \
    "$TMP/caddy/products" "$TMP/caddy/previews" "$TMP/pgdata"
  chmod 777 "$TMP/pgdata"

  PG_PW=$(openssl rand -hex 16)
  cat >"$TMP/products/postgres/.env" <<EOF
POSTGRES_USER=postgres
POSTGRES_PASSWORD=$PG_PW
POSTGRES_DB=postgres
AFK_PG_SUPERUSER=postgres
AFK_PG_SUPERUSER_PASSWORD=$PG_PW
EOF
  chmod 600 "$TMP/products/postgres/.env"

  docker run -d --name "$PG_NAME" \
    --env-file "$TMP/products/postgres/.env" \
    -v "$TMP/pgdata:/var/lib/postgresql/data" \
    "$PG_IMAGE" >/dev/null || { bad "Postgres 容器起不来"; return 1; }

  local i
  for i in $(seq 1 60); do
    if docker exec "$PG_NAME" pg_isready -U postgres >/dev/null 2>&1; then break; fi
    sleep 1
  done
  if docker exec "$PG_NAME" pg_isready -U postgres >/dev/null 2>&1; then
    ok "共享 Postgres 起来了"
  else
    bad "共享 Postgres 60 秒内没就绪"
    docker logs --tail 20 "$PG_NAME" >&2 || true
    return 1
  fi
}

export_env() {
  export AFK_PRODUCTS_ROOT="$TMP/products"
  export AFK_PREVIEWS_ROOT="$TMP/previews"
  export AFK_CADDY_PRODUCTS="$TMP/caddy/products"
  export AFK_CADDY_PREVIEWS="$TMP/caddy/previews"
  export AFK_BACKUP_DIR="$TMP/products/backups"
  export AFK_PG_ENV="$TMP/products/postgres/.env"
  export AFK_PG_CONTAINER="$PG_NAME"
  export AFK_PG_DATA_DIR="$TMP/pgdata"
  export AFK_PG_DATA_MODE=777
  export AFK_NETWORK_PREFIX="$NET_PREFIX"
  export AFK_PORT_START="$PORT_START"
  export AFK_TEMPLATE_DIR="$PRODUCTS"
  export AFK_APP_UID="$APP_UID"
  export AFK_APP_GID="$APP_GID"
  export AFK_APP_INTERNAL_PORT="$APP_INTERNAL_PORT"
  export AFK_UPSTREAM_HOST="$SLUG-app-1"
  export AFK_CADDY_RELOAD=never
  export AFK_DOCKER=docker
  export AFK_BACKUP_SCRIPT="$BACKUP"
}

# ---------------------------------------------------------------- 1. product-init

test_init() {
  if bash "$HELPER" product-init "$ADDR" --image "$APP_IMAGE"; then
    ok "product-init 退出 0"
  else
    bad "product-init 失败"
    return
  fi

  local dir=$TMP/products/$ADDR
  local env=$dir/.env
  local compose=$dir/compose.yml

  assert_dir "$dir" "成品目录建好"
  assert_dir "$dir/data" "data 目录建好"
  assert_dir "$dir/releases" "releases 目录建好"
  assert_file "$compose" "compose.yml 建好"
  assert_file "$env" ".env 建好"
  assert_mode "$env" 600 ".env 是 600"
  assert_mode "$compose" 600 "compose.yml 是 600"
  assert_mode "$dir/releases" 700 "releases 是 700"
  assert_file "$TMP/caddy/products/$ADDR.caddy" "Caddy 路由写好"

  assert_contains "$compose" 'mem_limit: 512m' "compose 内存上限 512m"
  assert_contains "$compose" 'cpus: 0.5' "compose CPU 上限 0.5"
  assert_contains "$compose" 'pids_limit: 256' "compose pids 上限 256"
  assert_contains "$compose" '127.0.0.1:${PORT}:' "compose 只绑回环"
  assert_not_contains "$compose" '/var/run/docker.sock' "compose 不挂 Docker socket"
  assert_not_contains "$compose" 'network_mode: host' "compose 不用 host 网络"

  local port db_name db_user db_pass app_key admin_pass admin_path admin_phrase session_secret image network
  port=$(env_get "$env" PORT)
  db_name=$(env_get "$env" DB_NAME)
  db_user=$(env_get "$env" DB_USER)
  db_pass=$(env_get "$env" DB_PASSWORD)
  app_key=$(env_get "$env" APP_KEY)
  admin_pass=$(env_get "$env" ADMIN_PASSWORD)
  admin_path=$(env_get "$env" ADMIN_PATH)
  admin_phrase=$(env_get "$env" ADMIN_PASSPHRASE)
  session_secret=$(env_get "$env" SESSION_SECRET)
  image=$(env_get "$env" IMAGE)
  network=$(env_get "$env" APP_NETWORK)

  if [[ $port =~ ^[0-9]+$ ]] && ((port >= PORT_START && port < PORT_START + 500)); then
    ok ".env 记的端口 $port 在 ${PORT_START} 起的范围里"
  else
    bad ".env 端口不对（${port}，期望 ${PORT_START} 起、500 个以内）"
  fi
  assert_eq "$SLUG" "$db_name" ".env 的 DB_NAME 用地址生成的 slug"
  assert_eq "$SLUG" "$db_user" ".env 的 DB_USER 和 DB_NAME 一致"
  assert_eq "$APP_IMAGE" "$image" ".env 记下镜像"
  assert_eq "$NET" "$network" ".env 记下独立网络"
  if [[ ${#db_pass} -ge 32 && ${#app_key} -ge 32 ]]; then
    ok "数据库密码和应用密钥是随机长串"
  else
    bad "数据库密码或应用密钥太短"
  fi
  if [[ $admin_pass =~ ^[0-9a-f]{48}$ ]]; then
    ok "后台口令 ADMIN_PASSWORD 是随机 hex"
  else
    bad "后台口令 ADMIN_PASSWORD 缺失或格式不对（${admin_pass}）"
  fi
  if [[ $admin_path =~ ^/t/[0-9a-f]{24}$ ]]; then
    ok "管理路径 ADMIN_PATH 是 /t/ 加随机 hex"
  else
    bad "管理路径 ADMIN_PATH 缺失或格式不对（${admin_path}）"
  fi
  if [[ $admin_phrase =~ ^[0-9a-f]{48}$ ]]; then
    ok "管理口令 ADMIN_PASSPHRASE 是随机 hex"
  else
    bad "管理口令 ADMIN_PASSPHRASE 缺失或格式不对（${admin_phrase}）"
  fi
  if [[ $session_secret =~ ^[0-9a-f]{64}$ ]]; then
    ok "会话密钥 SESSION_SECRET 是随机 hex"
  else
    bad "会话密钥 SESSION_SECRET 缺失或格式不对（${session_secret}）"
  fi

  assert_contains "$TMP/caddy/products/$ADDR.caddy" "$ADDR" "Caddy 路由写的是交付地址"
  assert_contains "$TMP/caddy/products/$ADDR.caddy" "reverse_proxy $SLUG-app-1:$APP_INTERNAL_PORT" "Caddy 反代到本机端口"

  assert_eq 1 "$(psql_super "SELECT 1 FROM pg_database WHERE datname='$db_name'")" "database 建好"
  assert_eq 1 "$(psql_super "SELECT 1 FROM pg_roles WHERE rolname='$db_user'")" "role 建好"

  local own
  own=$(docker exec -e PGPASSWORD="$db_pass" "$PG_NAME" psql -U "$db_user" -d "$db_name" -tAc 'SELECT 1' 2>/dev/null)
  assert_eq 1 "$own" "role 能连自己的库"
  if docker exec -e PGPASSWORD="$db_pass" "$PG_NAME" psql -U "$db_user" -d postgres -tAc 'SELECT 1' >/dev/null 2>&1; then
    bad "role 能连 postgres 库，应该不行"
  else
    ok "role 连不了别的库"
  fi

  if docker inspect -f '{{json .NetworkSettings.Networks}}' "$PG_NAME" | grep -q "\"$network\""; then
    ok "共享 Postgres 接进成品网络"
  else
    bad "共享 Postgres 没接进成品网络"
  fi

  local before
  before=$(cat "$env")
  if bash "$HELPER" product-init "$ADDR" --image "$APP_IMAGE" >/dev/null; then
    ok "重复 product-init 退出 0"
  else
    bad "重复 product-init 失败"
  fi
  assert_eq "$before" "$(cat "$env")" "重复 product-init 不改密钥、端口和镜像"

  # 旧版 .env 没有管理相关键：再跑 init 要补上，其他键一个不动。
  local before_legacy after_without
  grep -vE '^(ADMIN_PASSWORD|ADMIN_PATH|ADMIN_PASSPHRASE|SESSION_SECRET)=' "$env" >"$TMP/legacy.env"
  cat "$TMP/legacy.env" >"$env"
  rm -f "$TMP/legacy.env"
  before_legacy=$(cat "$env")
  if bash "$HELPER" product-init "$ADDR" --image "$APP_IMAGE" >/dev/null; then
    ok "缺管理相关键时 product-init 退出 0"
  else
    bad "缺管理相关键时 product-init 失败"
  fi
  local admin_filled path_filled phrase_filled secret_filled
  admin_filled=$(env_get "$env" ADMIN_PASSWORD)
  path_filled=$(env_get "$env" ADMIN_PATH)
  phrase_filled=$(env_get "$env" ADMIN_PASSPHRASE)
  secret_filled=$(env_get "$env" SESSION_SECRET)
  if [[ $admin_filled =~ ^[0-9a-f]{48}$ ]]; then
    ok "已有 .env 缺键时补上 ADMIN_PASSWORD"
  else
    bad "已有 .env 缺键时没补上 ADMIN_PASSWORD（${admin_filled}）"
  fi
  if [[ $path_filled =~ ^/t/[0-9a-f]{24}$ ]]; then
    ok "已有 .env 缺键时补上 ADMIN_PATH"
  else
    bad "已有 .env 缺键时没补上 ADMIN_PATH（${path_filled}）"
  fi
  if [[ $phrase_filled =~ ^[0-9a-f]{48}$ ]]; then
    ok "已有 .env 缺键时补上 ADMIN_PASSPHRASE"
  else
    bad "已有 .env 缺键时没补上 ADMIN_PASSPHRASE（${phrase_filled}）"
  fi
  if [[ $secret_filled =~ ^[0-9a-f]{64}$ ]]; then
    ok "已有 .env 缺键时补上 SESSION_SECRET"
  else
    bad "已有 .env 缺键时没补上 SESSION_SECRET（${secret_filled}）"
  fi
  after_without=$(grep -vE '^(ADMIN_PASSWORD|ADMIN_PATH|ADMIN_PASSPHRASE|SESSION_SECRET)=' "$env")
  assert_eq "$before_legacy" "$after_without" "补管理相关键不改其他键"
  assert_mode "$env" 600 "补键后 .env 还是 600"
}

# ---------------------------------------------------------------- 1b. 两个软件互相隔离

test_isolation() {
  local addr2="other-shop-$RANDOM.afkfactory.space"
  if bash "$HELPER" product-init "$addr2" --image "$APP_IMAGE" >/dev/null; then
    ok "第二个软件 init 退出 0"
  else
    bad "第二个软件 init 失败"
    return
  fi

  local env2=$TMP/products/$addr2/.env
  local port1 port2 db1 db2 user1 user2 pass1 pass2 admin1 admin2
  port1=$(env_get "$TMP/products/$ADDR/.env" PORT)
  port2=$(env_get "$env2" PORT)
  db1=$(env_get "$TMP/products/$ADDR/.env" DB_NAME)
  db2=$(env_get "$env2" DB_NAME)
  user1=$(env_get "$TMP/products/$ADDR/.env" DB_USER)
  user2=$(env_get "$env2" DB_USER)
  pass1=$(env_get "$TMP/products/$ADDR/.env" DB_PASSWORD)
  pass2=$(env_get "$env2" DB_PASSWORD)
  admin1=$(env_get "$TMP/products/$ADDR/.env" ADMIN_PASSWORD)
  admin2=$(env_get "$env2" ADMIN_PASSWORD)

  if [[ -n $admin1 && -n $admin2 && $admin1 != "$admin2" ]]; then
    ok "两个软件的后台口令各不相同"
  else
    bad "两个软件的后台口令为空或相同"
  fi

  if [[ $port2 =~ ^[0-9]+$ ]] && ((port2 >= PORT_START && port2 < PORT_START + 500)) \
    && [[ $port2 != "$port1" ]]; then
    ok "第二个软件拿到另一个端口（${port2}）"
  else
    bad "第二个软件端口不对（第一个 ${port1}，第二个 ${port2}）"
  fi
  if docker exec -e PGPASSWORD="$pass2" "$PG_NAME" psql -U "$user2" -d "$db1" -tAc 'SELECT 1' >/dev/null 2>&1; then
    bad "第二个软件的 role 能连第一个软件的库"
  else
    ok "第二个软件的 role 连不了第一个软件的库"
  fi
  if docker exec -e PGPASSWORD="$pass1" "$PG_NAME" psql -U "$user1" -d "$db2" -tAc 'SELECT 1' >/dev/null 2>&1; then
    bad "第一个软件的 role 能连第二个软件的库"
  else
    ok "第一个软件的 role 连不了第二个软件的库"
  fi
}

# ---------------------------------------------------------------- 2. product-deploy

test_deploy() {
  local dir=$TMP/products/$ADDR
  local env=$dir/.env
  local port
  port=$(env_get "$env" PORT)

  if bash "$HELPER" product-deploy "$ADDR"; then
    ok "product-deploy 退出 0"
  else
    bad "product-deploy 失败"
    return
  fi

  local code
  code=$(curl -s -o /dev/null --max-time 5 -w '%{http_code}' "http://127.0.0.1:$port/")
  assert_eq 200 "$code" "部署后成品端口回 200"

  local ids first_id
  ids=$(docker ps -q --filter "label=com.docker.compose.project=$SLUG")
  first_id=$ids
  assert_eq 1 "$(printf '%s\n' "$ids" | grep -c .)" "只起了一个 app 容器"
  assert_eq 1 "$(docker ps -aq --filter "label=com.docker.compose.project=$SLUG" | grep -c .)" "没有残留的第二套容器"

  local user
  user=$(docker inspect -f '{{.Config.User}}' "$first_id")
  if [[ -n $user && $user != "0" && $user != "0:0" && $user != root* ]]; then
    ok "容器不是 root 跑（user=${user}）"
  else
    bad "容器用户是 root（user=${user}）"
  fi
  assert_eq 101 "$(docker exec "$first_id" id -u)" "容器内 uid 是 101"
  assert_eq "$(env_get "$env" ADMIN_PASSWORD)" "$(docker exec "$first_id" printenv ADMIN_PASSWORD)" \
    "容器里能读到 ADMIN_PASSWORD"
  assert_eq "$(env_get "$env" ADMIN_PATH)" "$(docker exec "$first_id" printenv ADMIN_PATH)" \
    "容器里能读到 ADMIN_PATH"
  assert_eq "$(env_get "$env" ADMIN_PASSPHRASE)" "$(docker exec "$first_id" printenv ADMIN_PASSPHRASE)" \
    "容器里能读到 ADMIN_PASSPHRASE"
  assert_eq "$(env_get "$env" SESSION_SECRET)" "$(docker exec "$first_id" printenv SESSION_SECRET)" \
    "容器里能读到 SESSION_SECRET"

  if docker inspect -f '{{json .Mounts}}' "$first_id" | grep -q 'docker.sock'; then
    bad "容器挂了 Docker socket"
  else
    ok "容器没挂 Docker socket"
  fi
  if docker inspect -f '{{.HostConfig.NetworkMode}}' "$first_id" | grep -q '^host$'; then
    bad "容器用了 host 网络"
  else
    ok "容器不用 host 网络"
  fi
  assert_contains "$dir/compose.yml" 'mem_limit: 512m' "资源上限仍写在 compose 里"

  sleep 1
  if bash "$HELPER" product-deploy "$ADDR"; then
    ok "重复 deploy 退出 0"
  else
    bad "重复 deploy 失败"
  fi
  ids=$(docker ps -q --filter "label=com.docker.compose.project=$SLUG")
  assert_eq "$first_id" "$ids" "重复 deploy 没重建容器"
  assert_eq 1 "$(printf '%s\n' "$ids" | grep -c .)" "重复 deploy 后仍只有一套"

  # 坏镜像：先像部署脚本那样跑 product-init 换镜像，再 deploy。健康检查失败要退回上一版，
  # .env 和 product-status 都不能停在新镜像。
  local bad_image="afk-test-bad-$$:latest"
  local bad_dir
  bad_dir=$(mktemp -d "$TMP/bad-image.XXXXXX")
  cat >"$bad_dir/Dockerfile" <<EOF
FROM $APP_IMAGE
ENTRYPOINT ["/bin/sh", "-c", "exit 1"]
EOF
  if docker build -q -t "$bad_image" "$bad_dir" >/dev/null 2>&1; then
    ok "坏镜像构建好"
  else
    bad "坏镜像构建失败"
  fi
  bash "$HELPER" product-init "$ADDR" --image "$bad_image" >/dev/null 2>&1 || true
  assert_eq "$APP_IMAGE" "$(env_get "$env" IMAGE)" "product-init 换镜像不改已有 .env"
  if bash "$HELPER" product-deploy "$ADDR" --image "$bad_image" >/dev/null 2>&1; then
    bad "坏镜像 deploy 应该失败"
  else
    ok "坏镜像 deploy 退出非零"
  fi
  code=$(curl -s -o /dev/null --max-time 5 -w '%{http_code}' "http://127.0.0.1:$port/")
  assert_eq 200 "$code" "坏镜像部署失败后原地址仍回 200"
  assert_eq "$APP_IMAGE" "$(env_get "$env" IMAGE)" "坏镜像部署失败后 .env 还是上一版"
  local status_after_bad
  status_after_bad=$(bash "$HELPER" product-status "$ADDR")
  if printf '%s' "$status_after_bad" | grep -qF "镜像 $APP_IMAGE"; then
    ok "product-status 的镜像还是上一版"
  else
    bad "product-status 的镜像不是上一版（$status_after_bad）"
  fi
  docker rmi -f "$bad_image" >/dev/null 2>&1 || true
  rm -rf "$bad_dir"

  local status
  if status=$(bash "$HELPER" product-status); then
    ok "product-status 退出 0"
  else
    bad "product-status 失败"
  fi
  if printf '%s' "$status" | grep -q "本机 HTTP 200"; then
    ok "product-status 报本机 HTTP 200"
  else
    bad "product-status 没报 HTTP 200"
  fi
  if printf '%s' "$status" | grep -qF "$env 的 ADMIN_PASSWORD"; then
    ok "product-status 提示后台口令位置"
  else
    bad "product-status 没提示后台口令位置"
  fi
  if printf '%s' "$status" | grep -qF "$(env_get "$env" ADMIN_PASSWORD)"; then
    bad "product-status 打印了后台口令的值"
  else
    ok "product-status 不打印后台口令的值"
  fi
  if bash "$HELPER" product-status --check >/dev/null; then
    ok "product-status --check 通过"
  else
    bad "product-status --check 不通过"
  fi

  if bash "$HELPER" product-rollback "$ADDR"; then
    ok "product-rollback 退出 0"
  else
    bad "product-rollback 失败"
  fi
  code=$(curl -s -o /dev/null --max-time 5 -w '%{http_code}' "http://127.0.0.1:$port/")
  assert_eq 200 "$code" "回滚后端口回 200"
}

# ---------------------------------------------------------------- 3. 备份

run_backup() { # 日期 [额外参数]
  local day=$1
  shift || true
  AFK_TODAY=$day bash "$BACKUP" "$@"
}

daily_count() {
  ls -1 "$TMP/products/backups/$ADDR"/*.sql.gz 2>/dev/null | wc -l | tr -d ' '
}

weekly_count() {
  ls -1 "$TMP/products/backups/$ADDR/weekly"/*.sql.gz 2>/dev/null | wc -l | tr -d ' '
}

test_backup() {
  [[ -f $BACKUP ]] || { bad "缺 $BACKUP"; return; }

  local out
  if AFK_TODAY=2026-11-16 bash "$HELPER" product-backup "$ADDR" >/dev/null 2>&1; then
    ok "helper 的 product-backup 转发到 backup.sh"
  else
    bad "helper 的 product-backup 没跑通"
  fi

  if out=$(run_backup 2026-11-17 2>&1); then
    ok "第一次备份退出 0"
  else
    bad "第一次备份失败：$out"
    return
  fi
  local dump=$TMP/products/backups/$ADDR/2026-11-17.sql.gz
  assert_file "$dump" "备份文件按日期写进备份目录"
  assert_mode "$dump" 600 "备份文件是 600"
  if gzip -t "$dump" 2>/dev/null; then ok "备份是完整 gzip"; else bad "gzip 校验不过"; fi
  if gzip -dc "$dump" 2>/dev/null | grep -q 'PostgreSQL database dump'; then
    ok "备份内容是 pg_dump"
  else
    bad "备份内容不像 pg_dump"
  fi
  if printf '%s' "$out" | grep -q '待同步'; then
    ok "打出了同步到 Mac 的接口"
  else
    bad "没打印待同步目录"
  fi

  local day
  for day in 2026-11-18 2026-11-19 2026-11-20 2026-11-21 2026-11-22 2026-11-23 2026-11-24 \
    2026-11-25 2026-11-26 2026-11-27 2026-11-28 2026-11-29 2026-11-30; do
    run_backup "$day" >/dev/null 2>&1 || bad "备份 $day 失败"
  done
  assert_eq 7 "$(daily_count)" "日备只留 7 个"
  assert_file "$TMP/products/backups/$ADDR/2026-11-24.sql.gz" "留下最近第 7 天"
  if [[ -f $TMP/products/backups/$ADDR/2026-11-23.sql.gz ]]; then
    bad "第 8 天前的日备没删"
  else
    ok "第 8 天前的日备删了"
  fi
  assert_eq 3 "$(weekly_count)" "三个 ISO 周各留一个周备"

  for day in 2026-12-06 2026-12-13 2026-12-20; do
    run_backup "$day" >/dev/null 2>&1 || bad "备份 $day 失败"
  done
  assert_eq 4 "$(weekly_count)" "周备只留 4 个"
  if [[ -f $TMP/products/backups/$ADDR/weekly/2026-W47.sql.gz ]]; then
    bad "最老的周备没删"
  else
    ok "最老的周备删了"
  fi
  assert_file "$TMP/products/backups/$ADDR/weekly/2026-W51.sql.gz" "保留最近的周备"

  docker stop "$PG_NAME" >/dev/null
  if out=$(run_backup 2026-12-21 2>&1); then
    ok "第一次失败退出 0（按约定不告警）"
  else
    bad "第一次失败就退出非零了"
  fi
  if printf '%s' "$out" | grep -q '告警：'; then
    bad "第一次失败就告警了"
  else
    ok "第一次失败不告警"
  fi

  if out=$(run_backup 2026-12-21 2>&1); then
    bad "连续第二次失败居然退出 0"
  else
    ok "连续第二次失败退出非零"
  fi
  if printf '%s' "$out" | grep -q '告警：'; then
    ok "连续第二次失败打印告警"
  else
    bad "连续第二次失败没打印告警"
  fi
}

# ---------------------------------------------------------------- 4. Caddy include

make_test_certs() {
  local dir=$TMP/certs
  mkdir -p "$dir"
  openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj '/CN=afk test AOP CA' \
    -addext 'basicConstraints=critical,CA:TRUE' \
    -keyout "$dir/aop-ca.key" -out "$dir/aop-ca.pem" >/dev/null 2>&1
  openssl req -newkey rsa:2048 -nodes -subj '/CN=afkfactory.space' \
    -keyout "$dir/origin.key" -out "$dir/origin.csr" >/dev/null 2>&1
  printf 'subjectAltName=DNS:afkfactory.space,DNS:*.afkfactory.space,DNS:afkfactory.dev,DNS:*.afkfactory.dev\n' \
    >"$dir/origin.ext"
  openssl x509 -req -in "$dir/origin.csr" -CA "$dir/aop-ca.pem" -CAkey "$dir/aop-ca.key" \
    -CAcreateserial -days 2 -extfile "$dir/origin.ext" -out "$dir/origin.pem" >/dev/null 2>&1
  openssl req -newkey rsa:2048 -nodes -subj '/CN=curl-client' \
    -keyout "$dir/client.key" -out "$dir/client.csr" >/dev/null 2>&1
  openssl x509 -req -in "$dir/client.csr" -CA "$dir/aop-ca.pem" -CAkey "$dir/aop-ca.key" \
    -CAcreateserial -days 2 -out "$dir/client.pem" >/dev/null 2>&1
  chmod 644 "$dir"/*.pem
}

run_with_timeout() { # 秒数 命令…
  local seconds=$1
  shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "$seconds" "$@"
  else
    # macOS 没有 timeout；alarm 跨 exec 保留，够杀掉挂住的 docker 客户端。
    perl -e 'alarm shift; exec @ARGV' "$seconds" "$@"
  fi
}

caddy_curl() { # 主机 路径
  curl -sk --max-time 5 \
    --cert "$TMP/certs/client.pem" --key "$TMP/certs/client.key" \
    --resolve "$1:$CADDY_HOST_PORT:127.0.0.1" \
    -o /dev/null -w '%{http_code}' "https://$1:$CADDY_HOST_PORT$2"
}

test_caddy() {
  if [[ ${AFK_TEST_NO_CADDY:-0} == 1 ]]; then
    note "按 AFK_TEST_NO_CADDY=1 跳过"
    return
  fi
  if ! docker image inspect "$CADDY_IMAGE" >/dev/null 2>&1; then
    if ! run_with_timeout 180 docker pull "$CADDY_IMAGE" >/dev/null 2>&1; then
      note "拉不到 ${CADDY_IMAGE}，跳过 Caddy 运行测试"
      return
    fi
  fi

  make_test_certs
  mkdir -p "$TMP/caddy/data" "$TMP/caddy/config" "$TMP/caddy/logs"
  # install.sh 会把这个兜底片段装进 include 目录，测试里手动放一份。
  cp "$PRODUCTS/caddy/not-found.caddy" "$TMP/caddy/products/00-not-found.caddy"
  assert_file "$TMP/caddy/products/00-not-found.caddy" "通配兜底片段进了 include 目录"

  # 主 Caddyfile + 两行 include + 全局 default_sni（本机按端口访问用）。
  {
    printf '{\n\tdefault_sni %s\n}\n\n' "$ADDR"
    cat "$REPO/deploy/Caddyfile"
    printf '\nimport /etc/caddy/products/*.caddy\nimport /etc/caddy/previews/*.caddy\n'
  } >"$TMP/caddy/Caddyfile"

  # 预览模板也渲染一份，确认 Basic Auth 语法能过校验。
  local hash preview_addr
  hash=$(run_with_timeout 60 docker run --rm "$CADDY_IMAGE" caddy hash-password --plaintext tester 2>/dev/null)
  preview_addr="preview-$RANDOM.afkfactory.space"
  sed -e "s|__ADDRESS__|$preview_addr|g" \
    -e "s|__BASIC_AUTH_USER__|tester|g" \
    -e "s|__BASIC_AUTH_HASH__|$hash|g" \
    -e "s|__ACCESS_LOG__|$TMP/caddy/logs/$preview_addr.log|g" \
    -e "s|__UPSTREAM__|$SLUG-app-1:$APP_INTERNAL_PORT|g" \
    "$PRODUCTS/caddy/preview.caddy" >"$TMP/caddy/previews/$preview_addr.caddy"
  assert_contains "$TMP/caddy/previews/$preview_addr.caddy" 'basicauth' "预览模板带 Basic Auth"

  local mount_opts=(
    -v "$TMP/caddy/Caddyfile:/etc/caddy/Caddyfile:ro"
    -v "$TMP/caddy/products:/etc/caddy/products:ro"
    -v "$TMP/caddy/previews:/etc/caddy/previews:ro"
    -v "$TMP/caddy/logs:$TMP/caddy/logs"
    -v "$TMP/certs:/etc/caddy/certs:ro"
    -v "$TMP/caddy/data:/data"
    -v "$TMP/caddy/config:/config"
  )

  if run_with_timeout 60 docker run --rm "${mount_opts[@]}" "$CADDY_IMAGE" \
    caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
    ok "Caddy 能读主配置和两个 include 目录"
  else
    bad "Caddy 校验不过"
    run_with_timeout 60 docker run --rm "${mount_opts[@]}" "$CADDY_IMAGE" \
      caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1 | tail -10 >&2
    return
  fi

  if ! run_with_timeout 60 docker run -d --name "$CADDY_NAME" --network "$NET" \
    -p "127.0.0.1:$CADDY_HOST_PORT:443" "${mount_opts[@]}" \
    "$CADDY_IMAGE" caddy run --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null; then
    bad "Caddy 容器起不来"
    docker rm -f "$CADDY_NAME" >/dev/null 2>&1 || true
    return
  fi

  local i=0 code
  while [[ $i -lt 30 ]]; do
    code=$(caddy_curl "$ADDR" / || true)
    [[ $code == 200 ]] && break
    i=$((i + 1))
    sleep 1
  done
  assert_eq 200 "$code" "样例成品地址经 Caddy 回 200"

  local unknown="nobody-$RANDOM.afkfactory.space"
  code=$(caddy_curl "$unknown" / || true)
  assert_eq 404 "$code" "不认识的子域回 404"

  if curl -sk --max-time 5 --resolve "$ADDR:$CADDY_HOST_PORT:127.0.0.1" \
    -o /dev/null "https://$ADDR:$CADDY_HOST_PORT/" >/dev/null 2>&1; then
    bad "不带客户端证书也能连上，AOP 没生效"
  else
    ok "不带客户端证书握手失败（AOP 生效）"
  fi

  if [[ $code != 404 ]]; then
    docker logs --tail 20 "$CADDY_NAME" >&2 || true
  fi
}

# ---------------------------------------------------------------- main

run_test "静态检查" test_static
run_test prepare prepare || true
export_env
run_test "product-init" test_init
run_test "product-deploy" test_deploy
run_test "两个软件隔离" test_isolation
run_test "backup" test_backup
run_test "caddy" test_caddy

printf '\n%d 项通过，%d 项失败\n' "$PASS" "$FAILED"
[[ $FAILED -eq 0 ]]
