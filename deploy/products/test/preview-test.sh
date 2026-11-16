#!/usr/bin/env bash
# 预览环境的本机 Docker 集成测试：helper 的 preview-start/stop/status/sweep。
#
#   bash deploy/products/test/preview-test.sh
#
# 用临时目录、临时 Postgres、临时 Caddy 和临时镜像，跑完删掉。
# 不碰服务器，不改 /data，不读真实密钥，不碰真 GitHub。
#
# 可选环境变量：
#   AFK_TEST_KEEP=1        跑完不删临时目录，方便看现场
#   AFK_TEST_NO_CADDY=1    跳过 Caddy 容器那段（鉴权、路由和 404 断言会跳过）

set -uo pipefail

REPO=$(cd -- "$(dirname -- "$0")/../../.." && pwd)
PRODUCTS=$REPO/deploy/products
HELPER=$PRODUCTS/afk-product
TMP=${AFK_TEST_TMP:-$REPO/.tmp-preview-test-$$}
APP_DOCKERFILE_DIR=$TMP/app
PRODUCT_IMAGE=${AFK_TEST_APP_IMAGE:-nginxinc/nginx-unprivileged:1.27-alpine}
PG_IMAGE=${AFK_TEST_PG_IMAGE:-postgres:16}
CADDY_IMAGE=${AFK_TEST_CADDY_IMAGE:-caddy:2.6.2}
BASE_IMAGE=${AFK_TEST_PREVIEW_BASE:-alpine:3.20}

PG_NAME="afk-preview-pg-$$"
CADDY_NAME="afk-preview-caddy-$$"
NET_PREFIX="afk-preview-$$-"
CUST="acme$RANDOM"
PRODUCT_ADDR="$CUST-shop-$RANDOM.afkfactory.space"
PREVIEW_A="$CUST-shop-pr77.afkfactory.space"
PREVIEW_B="$CUST-shop-pr78.afkfactory.space"
PREVIEW_C="$CUST-shop-pr79.afkfactory.space"
PREVIEW_D="$CUST-shop-pr80.afkfactory.space"
PREVIEW_E="$CUST-shop-pr81.afkfactory.space"
PREVIEW_F="$CUST-shop-pr82.afkfactory.space"
IMG_A="afk-preview-test-$RANDOM-a:local"
IMG_B="afk-preview-test-$RANDOM-b:local"
IMG_C="afk-preview-test-$RANDOM-c:local"
IMG_D="afk-preview-test-$RANDOM-d:local"
IMG_E="afk-preview-test-$RANDOM-e:local"
IMG_F="afk-preview-test-$RANDOM-f:local"
IMG_MISSING="afk-preview-test-$RANDOM-missing:local"
PRODUCT_SLUG=$(printf '%s' "$PRODUCT_ADDR" | sed 's/[^a-z0-9]/_/g')
PORT_START=${AFK_TEST_PORT_START:-19100}
PREVIEW_PORT_START=${AFK_TEST_PREVIEW_PORT_START:-19300}
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

assert_file() { # 路径 说明
  if [[ -f $1 ]]; then ok "$2"; else bad "$2（$1 不存在）"; fi
}

assert_dir() { # 路径 说明
  if [[ -d $1 ]]; then ok "$2"; else bad "$2（$1 不存在）"; fi
}

assert_absent() { # 路径 说明
  if [[ -e $1 ]]; then bad "$2（$1 还在）"; else ok "$2"; fi
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

env_get() { # 文件 键
  sed -n "s/^$2=//p" "$1" 2>/dev/null | tail -1
}

env_set() { # 文件 键 值
  local file=$1 key=$2 value=$3 tmp="$1.tmp.$$"
  awk -v k="$key" -v v="$value" '
    BEGIN { done = 0 }
    index($0, k "=") == 1 { print k "=" v; done = 1; next }
    { print }
    END { if (!done) print k "=" v }
  ' "$file" >"$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$file"
}

slug_of() { printf '%s' "$1" | sed 's/[^a-z0-9]/_/g'; }

psql_super() { # SQL
  docker exec -e PGPASSWORD="$PG_PW" "$PG_NAME" psql -U postgres -tAc "$1" 2>/dev/null
}

psql_db() { # 库名 SQL
  docker exec -e PGPASSWORD="$PG_PW" "$PG_NAME" psql -U postgres -d "$1" -tAc "$2" 2>/dev/null
}

now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }

iso_days_ago() { # 天数
  if date -u -d '1 day ago' +%s >/dev/null 2>&1; then
    date -u -d "$1 days ago" +%Y-%m-%dT%H:%M:%SZ
  else
    date -u -v-"$1"d +%Y-%m-%dT%H:%M:%SZ
  fi
}

iso_hours_ago() { # 小时数
  if date -u -d '1 hour ago' +%s >/dev/null 2>&1; then
    date -u -d "$1 hours ago" +%Y-%m-%dT%H:%M:%SZ
  else
    date -u -v-"$1"H +%Y-%m-%dT%H:%M:%SZ
  fi
}

touch_epoch() { # 文件 epoch
  perl -e 'utime $ARGV[1], $ARGV[1], $ARGV[0] or die "utime: $!"' "$1" "$2"
}

compose_containers() { # 地址
  local slug
  slug=$(slug_of "$1")
  docker ps -q --filter "label=com.docker.compose.project=$slug"
}

compose_all_containers() { # 地址
  local slug
  slug=$(slug_of "$1")
  docker ps -aq --filter "label=com.docker.compose.project=$slug"
}

wait_http_code() { # 端口 期望 秒数
  local port=$1 want=$2 limit=${3:-30} i=0 code=''
  while [[ $i -lt $limit ]]; do
    code=$(curl -s -o /dev/null --max-time 2 -w '%{http_code}' "http://127.0.0.1:$port/" 2>/dev/null || true)
    [[ $code == "$want" ]] && { printf '%s' "$code"; return 0; }
    i=$((i + 1))
    sleep 1
  done
  printf '%s' "$code"
  return 1
}

cleanup() {
  local addr
  if [[ ${AFK_TEST_KEEP:-0} == 1 ]]; then
    printf '\n保留现场：%s\n' "$TMP"
    return
  fi
  docker rm -f "$CADDY_NAME" >/dev/null 2>&1 || true
  for addr in "$PRODUCT_ADDR" "$PREVIEW_A" "$PREVIEW_B" "$PREVIEW_C" "$PREVIEW_D" "$PREVIEW_E" "$PREVIEW_F"; do
    docker ps -aq --filter "label=com.docker.compose.project=$(slug_of "$addr")" | xargs -r docker rm -f >/dev/null 2>&1 || true
    docker network rm "${NET_PREFIX}$(slug_of "$addr")" >/dev/null 2>&1 || true
  done
  docker rm -f "$PG_NAME" >/dev/null 2>&1 || true
  docker network rm "${NET_PREFIX}$(slug_of "$PRODUCT_ADDR")" >/dev/null 2>&1 || true
  docker rmi "$IMG_A" "$IMG_B" "$IMG_C" "$IMG_D" "$IMG_E" "$IMG_F" >/dev/null 2>&1 || true
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
  if bash -n "$HELPER"; then ok "afk-product 语法通过"; else bad "afk-product 语法错误"; fi
  assert_contains "$PRODUCTS/caddy/preview.caddy" '__BASIC_AUTH_USER__' "预览模板有 Basic Auth 用户名占位"
  assert_contains "$PRODUCTS/caddy/preview.caddy" '__BASIC_AUTH_HASH__' "预览模板有 Basic Auth 哈希占位"
  assert_contains "$PRODUCTS/caddy/preview.caddy" '__ACCESS_LOG__' "预览模板有访问日志路径占位"
  assert_contains "$PRODUCTS/caddy/preview.caddy" 'basicauth' "预览模板用 Basic Auth"
}

# ---------------------------------------------------------------- 准备

start_pg() { # Docker Desktop 偶尔会把刚起的容器收掉，重试一次
  docker rm -f "$PG_NAME" >/dev/null 2>&1 || true
  docker run -d --name "$PG_NAME" \
    --env-file "$TMP/products/postgres/.env" \
    -v "$TMP/pgdata:/var/lib/postgresql/data" \
    "$PG_IMAGE" >/dev/null || return 1
  local i state
  for i in $(seq 1 60); do
    docker exec "$PG_NAME" pg_isready -U postgres >/dev/null 2>&1 && return 0
    state=$(docker inspect -f '{{.State.Status}}' "$PG_NAME" 2>/dev/null || true)
    [[ $state == running ]] || return 1
    sleep 1
  done
  return 1
}

prepare() {
  for f in "$HELPER" "$PRODUCTS/compose.template.yml" "$PRODUCTS/caddy/preview.caddy" "$REPO/deploy/Caddyfile"; do
    if [[ ! -f $f ]]; then bad "缺文件 $f"; return 1; fi
  done
  if ! docker info >/dev/null 2>&1; then bad "Docker 没在跑"; return 1; fi

  rm -rf "$TMP"
  mkdir -p "$TMP/products/postgres" "$TMP/products/backups" "$TMP/previews" \
    "$TMP/caddy/products" "$TMP/caddy/previews" "$TMP/caddy/logs" \
    "$TMP/pgdata" "$TMP/app"
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

  if start_pg || start_pg; then
    ok "共享 Postgres 起来了"
  else
    bad "共享 Postgres 60 秒内没就绪"
    docker logs --tail 20 "$PG_NAME" >&2 || true
    return 1
  fi

  cat >"$APP_DOCKERFILE_DIR/Dockerfile" <<EOF
FROM $BASE_IMAGE
RUN apk add --no-cache postgresql-client busybox-extras \\
 && mkdir -p /www /app && printf 'ok\\n' > /www/index.html \\
 && adduser -D -u 101 app && chown -R 101:101 /www
COPY seed.sql /app/seed.sql
RUN chmod 644 /app/seed.sql
USER 101:101
CMD ["httpd", "-f", "-p", "8080", "-h", "/www"]
EOF
  cat >"$APP_DOCKERFILE_DIR/seed.sql" <<'EOF'
CREATE TABLE seed_items (id integer PRIMARY KEY, name text NOT NULL);
INSERT INTO seed_items (id, name) VALUES (1, 'seed-row');
EOF
  if docker build -q -t "$IMG_A" "$APP_DOCKERFILE_DIR" >/dev/null 2>&1; then
    ok "测试 app 镜像构建好了"
  else
    bad "测试 app 镜像构建失败"
    docker build -t "$IMG_A" "$APP_DOCKERFILE_DIR" 2>&1 | tail -10 >&2
    return 1
  fi
  docker tag "$IMG_A" "$IMG_B"
  docker tag "$IMG_A" "$IMG_C"
  docker tag "$IMG_A" "$IMG_D"
  docker tag "$IMG_A" "$IMG_E"
  docker tag "$IMG_A" "$IMG_F"
}

export_env() {
  export AFK_PRODUCTS_ROOT="$TMP/products"
  export AFK_PREVIEWS_ROOT="$TMP/previews"
  export AFK_CADDY_PRODUCTS="$TMP/caddy/products"
  export AFK_CADDY_PREVIEWS="$TMP/caddy/previews"
  export AFK_CADDY_LOG_DIR="$TMP/caddy/logs"
  export AFK_BACKUP_DIR="$TMP/products/backups"
  export AFK_PG_ENV="$TMP/products/postgres/.env"
  export AFK_PG_CONTAINER="$PG_NAME"
  export AFK_NETWORK_PREFIX="$NET_PREFIX"
  export AFK_PORT_START="$PORT_START"
  export AFK_PREVIEW_PORT_START="$PREVIEW_PORT_START"
  export AFK_TEMPLATE_DIR="$PRODUCTS"
  export AFK_APP_UID=101
  export AFK_APP_GID=101
  export AFK_APP_INTERNAL_PORT=8080
  export AFK_CADDY_RELOAD=never
  export AFK_DOCKER=docker
  export AFK_CADDY_IMAGE="$CADDY_IMAGE"
  export AFK_PREVIEW_QUEUE_TIMEOUT=120
  export AFK_PREVIEW_QUEUE_POLL=1
  export AFK_PREVIEW_LOCK_TIMEOUT=60
  SEED='psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /app/seed.sql'
}

product_helper() {
  AFK_UPSTREAM_HOST="$PRODUCT_SLUG-app-1" bash "$HELPER" "$@"
}

preview_helper() { # 地址 参数...
  local address=$1
  shift
  local slug
  slug=$(slug_of "$address")
  AFK_UPSTREAM_HOST="$slug-app-1" bash "$HELPER" "$@"
}

# ---------------------------------------------------------------- 1. 成品基线

test_product() {
  if product_helper product-init "$PRODUCT_ADDR" --image "$PRODUCT_IMAGE" >/dev/null; then
    ok "成品 init 退出 0"
  else
    bad "成品 init 失败"
    return 1
  fi
  if product_helper product-deploy "$PRODUCT_ADDR" >/dev/null; then
    ok "成品 deploy 退出 0"
  else
    bad "成品 deploy 失败"
    return 1
  fi
  local port
  port=$(env_get "$TMP/products/$PRODUCT_ADDR/.env" PORT)
  assert_eq 200 "$(wait_http_code "$port" 200 30)" "成品本机端口回 200"
}

# ---------------------------------------------------------------- 2. Caddy 基线

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

caddy_curl() { # 主机 路径 [用户名:密码]
  local host=$1 path=$2 creds=${3:-}
  local auth=()
  [[ -n $creds ]] && auth=(-u "$creds")
  curl -sk --max-time 5 ${auth[@]+"${auth[@]}"} \
    --cert "$TMP/certs/client.pem" --key "$TMP/certs/client.key" \
    --resolve "$host:$CADDY_HOST_PORT:127.0.0.1" \
    -o /dev/null -w '%{http_code}' "https://$host:$CADDY_HOST_PORT$path"
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

caddy_validate() { # Caddy 挂载参数…
  local name="afk-preview-validate-$$"
  docker rm -f "$name" >/dev/null 2>&1 || true
  run_with_timeout 60 docker run --rm --name "$name" "$@"
  local code=$?
  [[ $code -eq 0 ]] || docker rm -f "$name" >/dev/null 2>&1 || true
  return "$code"
}

caddy_reload() {
  run_with_timeout 60 docker exec "$CADDY_NAME" caddy reload \
    --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1
}

caddy_join() { # 网络名
  docker network connect "$1" "$CADDY_NAME" >/dev/null 2>&1 || true
  caddy_reload
}

test_caddy_start() {
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
  mkdir -p "$TMP/caddy/data" "$TMP/caddy/config"
  cp "$PRODUCTS/caddy/not-found.caddy" "$TMP/caddy/products/00-not-found.caddy"
  {
    printf '{\n\tdefault_sni %s\n}\n\n' "$PRODUCT_ADDR"
    cat "$REPO/deploy/Caddyfile"
    printf '\nimport /etc/caddy/products/*.caddy\nimport /etc/caddy/previews/*.caddy\n'
  } >"$TMP/caddy/Caddyfile"

  local mounts=(
    -v "$TMP/caddy/Caddyfile:/etc/caddy/Caddyfile:ro"
    -v "$TMP/caddy/products:/etc/caddy/products:ro"
    -v "$TMP/caddy/previews:/etc/caddy/previews:ro"
    -v "$TMP/caddy/logs:$TMP/caddy/logs"
    -v "$TMP/certs:/etc/caddy/certs:ro"
    -v "$TMP/caddy/data:/data"
    -v "$TMP/caddy/config:/config"
  )

  if caddy_validate "${mounts[@]}" "$CADDY_IMAGE" \
    caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
    ok "Caddy 能读主配置和两个 include 目录"
  else
    bad "Caddy 校验不过"
    caddy_validate "${mounts[@]}" "$CADDY_IMAGE" \
      caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1 | tail -10 >&2
    return
  fi

  if ! run_with_timeout 60 docker run -d --name "$CADDY_NAME" \
    --network "${NET_PREFIX}$(slug_of "$PRODUCT_ADDR")" \
    -p "127.0.0.1:$CADDY_HOST_PORT:443" "${mounts[@]}" \
    "$CADDY_IMAGE" caddy run --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null; then
    bad "Caddy 容器起不来"
    docker rm -f "$CADDY_NAME" >/dev/null 2>&1 || true
    return
  fi

  local i=0 code
  while [[ $i -lt 30 ]]; do
    code=$(caddy_curl "$PRODUCT_ADDR" / || true)
    [[ $code == 200 ]] && break
    i=$((i + 1))
    sleep 1
  done
  assert_eq 200 "$code" "成品地址经 Caddy 回 200"
}

# ---------------------------------------------------------------- 3. 起第一套预览

test_preview_start() {
  local out
  if out=$(preview_helper "$PREVIEW_A" preview-start "$PREVIEW_A" "$IMG_A" \
    --seed "$SEED" --commit-at "$(now_iso)"); then
    ok "第一套 preview-start 退出 0"
  else
    bad "第一套 preview-start 失败：$out"
    return
  fi

  local dir=$TMP/previews/$PREVIEW_A
  local env=$dir/.env
  local compose=$dir/compose.yml
  assert_dir "$dir" "预览目录建好"
  assert_dir "$dir/data" "预览 data 目录建好"
  assert_file "$compose" "预览 compose.yml 建好"
  assert_file "$env" "预览 .env 建好"
  assert_mode "$env" 600 "预览 .env 是 600"
  assert_mode "$compose" 600 "预览 compose.yml 是 600"
  assert_contains "$compose" 'mem_limit: 512m' "预览内存上限 512m"
  assert_contains "$compose" 'cpus: 0.5' "预览 CPU 上限 0.5"
  assert_contains "$compose" 'pids_limit: 256' "预览 pids 上限 256"
  assert_contains "$compose" '127.0.0.1:${PORT}:' "预览只绑回环"

  local db user pass image port net route slug
  db=$(env_get "$env" DB_NAME)
  user=$(env_get "$env" DB_USER)
  pass=$(env_get "$env" DB_PASSWORD)
  image=$(env_get "$env" IMAGE)
  port=$(env_get "$env" PORT)
  net=$(env_get "$env" APP_NETWORK)
  route=$TMP/caddy/previews/$PREVIEW_A.caddy
  slug=$(slug_of "$PREVIEW_A")

  assert_eq "$IMG_A" "$image" ".env 记下 PR head 镜像"
  if [[ $port =~ ^[0-9]+$ ]] && ((port >= PREVIEW_PORT_START && port < PREVIEW_PORT_START + 500)); then
    ok "预览端口 $port 在 ${PREVIEW_PORT_START} 起的范围里"
  else
    bad "预览端口不对（${port}，期望 ${PREVIEW_PORT_START} 起、500 个以内）"
  fi
  assert_eq "${NET_PREFIX}preview_$(slug_of "$PREVIEW_A")" "$net" "预览有独立网络"
  case $db in
    preview_*) ok "预览用独立 database 名" ;;
    *) bad "预览 database 名不是 preview_ 开头（${db}）" ;;
  esac
  assert_eq "$db" "$user" "预览 role 和 database 同名"
  assert_eq 1 "$(psql_super "SELECT 1 FROM pg_database WHERE datname='$db'")" "预览 database 建好"
  assert_eq 1 "$(psql_super "SELECT 1 FROM pg_roles WHERE rolname='$user'")" "预览 role 建好"
  if docker exec -e PGPASSWORD="$pass" "$PG_NAME" psql -U "$user" -d "$db" -tAc 'SELECT 1' 2>/dev/null | grep -qx 1; then
    ok "预览 role 能连自己的库"
  else
    bad "预览 role 连不了自己的库"
  fi
  if docker exec -e PGPASSWORD="$pass" "$PG_NAME" psql -U "$user" -d postgres -tAc 'SELECT 1' >/dev/null 2>&1; then
    bad "预览 role 能连 postgres 库，应该不行"
  else
    ok "预览 role 连不了别的库"
  fi
  assert_eq 'seed-row' "$(psql_db "$db" 'SELECT name FROM seed_items WHERE id = 1')" "种子脚本跑过，查得到种子数据"
  assert_eq 1 "$(psql_db "$db" "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")" "预览库是新建空库，只有种子建的表"

  local auth_user auth_pass
  auth_user=$(env_get "$env" BASIC_AUTH_USER)
  auth_pass=$(env_get "$env" BASIC_AUTH_PASSWORD)
  if [[ -n $auth_user && -n $auth_pass && ${#auth_pass} -ge 16 ]]; then
    ok "Basic Auth 用户名和密码随机生成"
  else
    bad "Basic Auth 用户名或密码太短"
  fi
  if printf '%s' "$out" | grep -qx "AFK_PREVIEW user=$auth_user"; then
    ok "helper 打印凭据给 Mac 侧"
  else
    bad "helper 没打印 Basic Auth 用户名"
  fi

  assert_file "$route" "预览 Caddy 路由写好"
  assert_contains "$route" 'basicauth' "预览路由带 Basic Auth"
  assert_contains "$route" "$slug-app-1:8080" "预览路由反代到预览容器"
  assert_contains "$route" "$TMP/caddy/logs/$PREVIEW_A.log" "预览路由写访问日志"
  assert_eq 1 "$(compose_containers "$PREVIEW_A" | grep -c .)" "预览 app 容器在跑"

  if docker inspect -f '{{json .NetworkSettings.Networks}}' "$PG_NAME" | grep -q "\"$net\""; then
    ok "共享 Postgres 接进预览网络"
  else
    bad "共享 Postgres 没接进预览网络"
  fi
  if docker inspect -f '{{json .NetworkSettings.Networks}}' "$PG_NAME" | grep -q "${NET_PREFIX}$(slug_of "$PRODUCT_ADDR")\""; then
    ok "预览网络和成品网络是分开的"
  else
    bad "预览网络和成品网络没分开"
  fi

  local code
  code=$(wait_http_code "$port" 200 30)
  assert_eq 200 "$code" "预览本机端口回 200（绕过 Caddy）"

  if [[ ${AFK_TEST_NO_CADDY:-0} == 1 ]]; then
    return
  fi
  caddy_join "$net"
  local i=0
  for i in $(seq 1 20); do
    code=$(caddy_curl "$PREVIEW_A" / || true)
    [[ -n $code && $code != 000 ]] && break
    sleep 1
  done
  assert_eq 401 "$code" "不带凭据访问预览回 401"
  assert_eq 200 "$(caddy_curl "$PREVIEW_A" / "$auth_user:$auth_pass")" "带凭据访问预览回 200"
  assert_file "$TMP/caddy/logs/$PREVIEW_A.log" "Caddy 写了预览访问日志"

  # 验证期间有新提交要重跑：同地址再跑 preview-start，重建这一套，不建第二套。
  if preview_helper "$PREVIEW_A" preview-start "$PREVIEW_A" "$IMG_A" \
    --seed "$SEED" --commit-at "$(now_iso)" >"$TMP/rebuild.log" 2>&1; then
    ok "同名预览重建退出 0"
  else
    bad "同名预览重建失败"
  fi
  assert_eq 1 "$(compose_containers "$PREVIEW_A" | grep -c .)" "重建后仍只有一套容器"
  assert_eq 200 "$(wait_http_code "$port" 200 30)" "重建后本机端口回 200"
  if grep -q "AFK_PREVIEW password=$auth_pass" "$TMP/rebuild.log"; then
    bad "重建没换 Basic Auth 密码"
  else
    ok "重建换了一套 Basic Auth 密码"
  fi
}

# ---------------------------------------------------------------- 4. 第二套排队

test_preview_queue() {
  local log=$TMP/queue-b.log
  (
    AFK_PREVIEW_QUEUE_TIMEOUT=120 AFK_PREVIEW_QUEUE_POLL=1 \
      preview_helper "$PREVIEW_B" preview-start "$PREVIEW_B" "$IMG_B" --seed "$SEED" >"$log" 2>&1
  ) &
  local pid=$!

  sleep 4
  assert_absent "$TMP/previews/$PREVIEW_B" "第二套排队时没建目录"
  assert_absent "$TMP/caddy/previews/$PREVIEW_B.caddy" "第二套排队时没写路由"
  assert_eq 0 "$(compose_containers "$PREVIEW_B" | grep -c .)" "第二套排队时没起容器"
  if grep -q '排队中' "$log"; then ok "第二套打印了排队提示"; else bad "第二套没打印排队提示"; fi

  local out
  if out=$(AFK_PREVIEW_QUEUE_TIMEOUT=2 AFK_PREVIEW_QUEUE_POLL=1 \
    preview_helper "$PREVIEW_F" preview-start "$PREVIEW_F" "$IMG_E" --seed "$SEED" 2>&1); then
    bad "排队超时居然退出 0"
  else
    ok "排队超时退出非零"
  fi
  if printf '%s' "$out" | grep -q '排队超时'; then ok "排队超时打印原因"; else bad "排队超时没打印原因"; fi
  assert_absent "$TMP/previews/$PREVIEW_F" "排队超时的预览没建目录"

  docker network disconnect "${NET_PREFIX}preview_$(slug_of "$PREVIEW_A")" "$CADDY_NAME" >/dev/null 2>&1 || true
  if preview_helper "$PREVIEW_A" preview-stop "$PREVIEW_A" >/dev/null; then
    ok "第一套销毁退出 0"
  else
    bad "第一套销毁失败"
  fi
  assert_absent "$TMP/caddy/previews/$PREVIEW_A.caddy" "第一套销毁后 Caddy 路由没了"
  assert_eq 0 "$(compose_all_containers "$PREVIEW_A" | grep -c .)" "第一套销毁后容器没了"
  if docker image inspect "$IMG_A" >/dev/null 2>&1; then bad "第一套销毁后镜像还在"; else ok "第一套销毁后镜像没了"; fi
  local db_a
  db_a="preview_$(slug_of "$PREVIEW_A")"
  assert_eq '' "$(psql_super "SELECT 1 FROM pg_database WHERE datname='$db_a'")" "第一套销毁后 database 没了"
  assert_eq '' "$(psql_super "SELECT 1 FROM pg_roles WHERE rolname='$db_a'")" "第一套销毁后 role 没了"
  if docker network inspect "${NET_PREFIX}${db_a}" >/dev/null 2>&1; then bad "第一套销毁后网络还在"; else ok "第一套销毁后网络没了"; fi

  local i=0
  while kill -0 "$pid" 2>/dev/null && [[ $i -lt 180 ]]; do
    sleep 1
    i=$((i + 1))
  done
  if kill -0 "$pid" 2>/dev/null; then
    bad "名额空出后第二套 180 秒内没起来"
    kill "$pid" 2>/dev/null || true
    return
  fi
  wait "$pid"
  if [[ $? -eq 0 ]]; then ok "名额空出后第二套自己起来了"; else bad "第二套后来启动失败"; fi
  assert_dir "$TMP/previews/$PREVIEW_B" "第二套后来建了目录"
  assert_eq 1 "$(compose_containers "$PREVIEW_B" | grep -c .)" "第二套后来起了容器"
  local port
  port=$(env_get "$TMP/previews/$PREVIEW_B/.env" PORT)
  assert_eq 200 "$(wait_http_code "$port" 200 30)" "第二套本机端口回 200"
}

# ---------------------------------------------------------------- 5. 销毁第二套

test_preview_stop() {
  if preview_helper "$PREVIEW_B" preview-stop "$PREVIEW_B" >/dev/null; then
    ok "第二套销毁退出 0"
  else
    bad "第二套销毁失败"
  fi
  local db_b
  db_b="preview_$(slug_of "$PREVIEW_B")"
  assert_absent "$TMP/previews/$PREVIEW_B" "销毁后预览目录没了"
  assert_absent "$TMP/caddy/previews/$PREVIEW_B.caddy" "销毁后 Caddy 路由没了"
  assert_eq 0 "$(compose_all_containers "$PREVIEW_B" | grep -c .)" "销毁后容器没了"
  assert_eq '' "$(psql_super "SELECT 1 FROM pg_database WHERE datname='$db_b'")" "销毁后 database 没了"
  assert_eq '' "$(psql_super "SELECT 1 FROM pg_roles WHERE rolname='$db_b'")" "销毁后 role 没了"
  if docker network inspect "${NET_PREFIX}${db_b}" >/dev/null 2>&1; then bad "销毁后网络还在"; else ok "销毁后网络没了"; fi
  if docker image inspect "$IMG_B" >/dev/null 2>&1; then bad "销毁后镜像还在"; else ok "销毁后镜像没了"; fi
  if preview_helper "$PREVIEW_B" preview-stop "$PREVIEW_B" >/dev/null 2>&1; then
    ok "重复销毁退出 0"
  else
    bad "重复销毁失败"
  fi
}

# ---------------------------------------------------------------- 6. sweep 边界

test_preview_sweep() {
  local env route log

  if preview_helper "$PREVIEW_C" preview-start "$PREVIEW_C" "$IMG_C" \
    --seed "$SEED" --commit-at "$(now_iso)" >/dev/null; then
    ok "sweep 用的预览起好了"
  else
    bad "sweep 用的预览没起来"
    return
  fi
  env=$TMP/previews/$PREVIEW_C/.env
  route=$TMP/caddy/previews/$PREVIEW_C.caddy

  if AFK_NOW=$(now_iso) preview_helper "$PREVIEW_C" preview-sweep >"$TMP/sweep-fresh.log" 2>&1; then
    ok "刚起的预览 sweep 退出 0"
  else
    bad "sweep 失败"
  fi
  if [[ -n $(compose_containers "$PREVIEW_C") ]]; then ok "刚起的预览没被销毁"; else bad "刚起的预览被误销毁"; fi

  env_set "$env" CREATED_AT "$(iso_days_ago 8)"
  if AFK_NOW=$(now_iso) preview_helper "$PREVIEW_C" preview-sweep >"$TMP/sweep-7d.log" 2>&1; then
    ok "满 7 天的 sweep 退出 0"
  else
    bad "满 7 天的 sweep 失败"
  fi
  if grep -q '满 7 天' "$TMP/sweep-7d.log"; then ok "sweep 打印满 7 天"; else bad "sweep 没打印满 7 天"; fi
  assert_eq 0 "$(compose_all_containers "$PREVIEW_C" | grep -c .)" "满 7 天后容器没了"
  assert_absent "$route" "满 7 天后路由没了"
  assert_absent "$TMP/previews/$PREVIEW_C" "满 7 天后目录没了"
  if docker image inspect "$IMG_C" >/dev/null 2>&1; then bad "满 7 天后镜像还在"; else ok "满 7 天后镜像没了"; fi

  # 24 小时边界：有访问就留着，访问也旧了才销毁。
  if preview_helper "$PREVIEW_D" preview-start "$PREVIEW_D" "$IMG_D" \
    --seed "$SEED" --commit-at "$(iso_hours_ago 30)" >/dev/null; then
    ok "24 小时边界的预览起好了"
  else
    bad "24 小时边界的预览没起来"
    return
  fi
  env=$TMP/previews/$PREVIEW_D/.env
  log=$TMP/caddy/logs/$PREVIEW_D.log
  env_set "$env" CREATED_AT "$(iso_days_ago 2)"
  env_set "$env" LAST_COMMIT_AT "$(iso_hours_ago 30)"
  mkdir -p "$TMP/caddy/logs"
  touch "$log"
  if AFK_NOW=$(now_iso) preview_helper "$PREVIEW_D" preview-sweep >"$TMP/sweep-access.log" 2>&1; then
    ok "有访问时的 sweep 退出 0"
  else
    bad "有访问时的 sweep 失败"
  fi
  if [[ -n $(compose_containers "$PREVIEW_D") ]]; then ok "刚有访问的预览留着"; else bad "刚有访问的预览被误销毁"; fi

  touch_epoch "$log" $(( $(date +%s) - 25 * 3600 ))
  if AFK_NOW=$(now_iso) preview_helper "$PREVIEW_D" preview-sweep >"$TMP/sweep-idle.log" 2>&1; then
    ok "24 小时无提交无访问的 sweep 退出 0"
  else
    bad "24 小时无提交无访问的 sweep 失败"
  fi
  if grep -q '24 小时无新提交且无访问' "$TMP/sweep-idle.log"; then
    ok "sweep 打印 24 小时原因"
  else
    bad "sweep 没打印 24 小时原因"
  fi
  assert_eq 0 "$(compose_all_containers "$PREVIEW_D" | grep -c .)" "24 小时无活动后容器没了"
  assert_absent "$TMP/previews/$PREVIEW_D" "24 小时无活动后目录没了"
}

# ---------------------------------------------------------------- 7. status 体检

test_preview_status() {
  if preview_helper "$PREVIEW_E" preview-start "$PREVIEW_E" "$IMG_E" \
    --seed "$SEED" --commit-at "$(now_iso)" >/dev/null; then
    ok "status 用的预览起好了"
  else
    bad "status 用的预览没起来"
    return
  fi

  local out
  if AFK_NOW=$(now_iso) preview_helper "$PREVIEW_E" preview-status >"$TMP/status.log" 2>&1; then
    ok "preview-status 退出 0"
  else
    bad "preview-status 失败"
  fi
  if grep -q '容器 1/1' "$TMP/status.log"; then ok "status 报容器 1/1"; else bad "status 没报容器 1/1"; fi
  if grep -q '数据库 有' "$TMP/status.log"; then ok "status 报数据库在"; else bad "status 没报数据库"; fi
  if grep -q '路由 有' "$TMP/status.log"; then ok "status 报路由在"; else bad "status 没报路由"; fi
  if grep -q '最后访问' "$TMP/status.log"; then ok "status 报最后访问时间"; else bad "status 没报最后访问时间"; fi

  if AFK_NOW=$(now_iso) preview_helper "$PREVIEW_E" preview-status --check >/dev/null 2>&1; then
    ok "preview-status --check 通过"
  else
    bad "preview-status --check 不通过"
  fi

  local id
  id=$(compose_containers "$PREVIEW_E" | head -1)
  docker stop "$id" >/dev/null
  if AFK_NOW=$(now_iso) preview_helper "$PREVIEW_E" preview-status --check >"$TMP/status-bad.log" 2>&1; then
    bad "容器停了 --check 还通过"
  else
    ok "容器停了 --check 不通过"
  fi
  if grep -q '容器 0/1' "$TMP/status-bad.log"; then ok "status 报容器 0/1"; else bad "status 没报容器 0/1"; fi
  docker start "$id" >/dev/null

  preview_helper "$PREVIEW_E" preview-stop "$PREVIEW_E" >/dev/null
  if AFK_NOW=$(now_iso) preview_helper "$PREVIEW_E" preview-status --check >/dev/null 2>&1; then
    ok "没有预览时 --check 通过"
  else
    bad "没有预览时 --check 不通过"
  fi
}

# ---------------------------------------------------------------- 8. 故障隔离

test_preview_failure() {
  local out
  if out=$(preview_helper "$PREVIEW_F" preview-start "$PREVIEW_F" "$IMG_MISSING" --seed "$SEED" 2>&1); then
    bad "镜像不存在居然起成功了"
  else
    ok "镜像不存在时 preview-start 退出非零"
  fi
  if printf '%s' "$out" | grep -q '镜像'; then ok "报错说清是镜像问题"; else bad "报错没说镜像问题"; fi
  assert_absent "$TMP/previews/$PREVIEW_F" "失败后没留预览目录"
  assert_absent "$TMP/caddy/previews/$PREVIEW_F.caddy" "失败后没留 Caddy 路由"

  local db_f
  db_f="preview_$(slug_of "$PREVIEW_F")"
  assert_eq '' "$(psql_super "SELECT 1 FROM pg_database WHERE datname='$db_f'")" "失败后没建 database"

  # 种子脚本失败也要清干净，不能占着唯一的预览名额。
  if out=$(preview_helper "$PREVIEW_F" preview-start "$PREVIEW_F" "$IMG_F" --seed false 2>&1); then
    bad "种子脚本失败居然起成功了"
  else
    ok "种子脚本失败时 preview-start 退出非零"
  fi
  assert_absent "$TMP/previews/$PREVIEW_F" "种子失败后没留预览目录"
  assert_absent "$TMP/caddy/previews/$PREVIEW_F.caddy" "种子失败后没留 Caddy 路由"
  assert_eq 0 "$(compose_all_containers "$PREVIEW_F" | grep -c .)" "种子失败后没留容器"
  assert_eq '' "$(psql_super "SELECT 1 FROM pg_database WHERE datname='$db_f'")" "种子失败后 database 删了"
  if docker image inspect "$IMG_F" >/dev/null 2>&1; then bad "种子失败后镜像还在"; else ok "种子失败后镜像删了"; fi

  if [[ ${AFK_TEST_NO_CADDY:-0} != 1 ]]; then
    assert_eq 200 "$(caddy_curl "$PRODUCT_ADDR" /)" "预览失败后成品地址仍回 200"
  fi
}

# ---------------------------------------------------------------- main

run_test "静态检查" test_static
run_test prepare prepare || true
export_env
run_test "成品基线" test_product
run_test "Caddy 基线" test_caddy_start
run_test "起第一套预览" test_preview_start
run_test "第二套排队" test_preview_queue
run_test "销毁第二套" test_preview_stop
run_test "sweep 边界" test_preview_sweep
run_test "status 体检" test_preview_status
run_test "故障隔离" test_preview_failure

printf '\n%d 项通过，%d 项失败\n' "$PASS" "$FAILED"
[[ $FAILED -eq 0 ]]
