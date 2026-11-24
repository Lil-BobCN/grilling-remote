#!/usr/bin/env bash
# 部署面自测：共享健康判据、env 契约、发布指纹。不碰服务器，不需要 Docker。
#
#   bash deploy/test/deploy-selftest.sh
#
# 全部通过退出码 0，有失败退出码 1。

set -uo pipefail

REPO=$(cd -- "$(dirname -- "$0")/../.." && pwd)
PRODUCTS=$REPO/deploy/products
HELPER=$PRODUCTS/afk-product
HEALTH_LIB=$REPO/deploy/lib/health.sh
FINGERPRINT_LIB=$REPO/deploy/lib/fingerprint.sh

PASS=0
FAILED=0

ok() { PASS=$((PASS + 1)); printf '通过  %s\n' "$*"; }
bad() { FAILED=$((FAILED + 1)); printf '失败  %s\n' "$*" >&2; }
assert_eq() { # 期望 实际 说明
  if [[ $1 == "$2" ]]; then ok "$3"; else bad "$3（期望 $1，实际 $2）"; fi
}
assert_file() { # 路径 说明
  if [[ -f $1 ]]; then ok "$2"; else bad "$2（$1 不存在）"; fi
}

TMP=$(mktemp -d "${TMPDIR:-/tmp}/afk-deploy-selftest.XXXXXX") || exit 1
cleanup() {
  if [[ ${AFK_TEST_KEEP:-0} == 1 ]]; then
    printf '保留现场：%s\n' "$TMP"
    return
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

# ---------------------------------------------------------------- 健康判据

test_health_lib() {
  printf '\n== 共享健康判据\n'
  if [[ ! -f $HEALTH_LIB ]]; then
    bad "缺共享健康判据 $HEALTH_LIB"
    return
  fi
  # shellcheck source=/dev/null
  . "$HEALTH_LIB"

  local code
  for code in 200; do
    if healthy "$code"; then ok "healthy($code) 算健康"; else bad "healthy($code) 应该算健康"; fi
  done
  for code in 000 201 204 301 401 403 404 500 502 ''; do
    if healthy "$code"; then bad "healthy($code) 不该算健康"; else ok "healthy($code) 判失败"; fi
  done

  # wait_http 必须看状态码，不能只看 curl 退出码。
  curl() { printf '%s' "${FAKE_HTTP_CODE:-000}"; }
  local tries=2 interval=0
  FAKE_HTTP_CODE=000
  if wait_http 1 "$tries" "$interval"; then bad "wait_http 把 000 当活"; else ok "wait_http 把 000 判失败"; fi
  FAKE_HTTP_CODE=502
  if wait_http 1 "$tries" "$interval"; then bad "wait_http 把 502 当活"; else ok "wait_http 把 502 判失败"; fi
  FAKE_HTTP_CODE=200
  if wait_http 1 "$tries" "$interval"; then ok "wait_http 认 200"; else bad "wait_http 不认 200"; fi
  unset -f curl
}

# ---------------------------------------------------------------- 成品状态

mkdir -p "$TMP/bin"

cat >"$TMP/bin/docker" <<'EOF'
#!/usr/bin/env bash
case ${1:-} in
  inspect)
    if [[ ${3:-} == *State.Running* ]]; then printf 'true\n'; else printf '{"afk-test":{}}\n'; fi
    ;;
  ps)
    printf 'fake-container-1\n'
    ;;
  *) ;;
esac
exit 0
EOF

cat >"$TMP/bin/curl" <<'EOF'
#!/usr/bin/env bash
printf '%s' "${FAKE_HTTP_CODE:-000}"
EOF
chmod 755 "$TMP/bin/docker" "$TMP/bin/curl"

test_product_status() {
  printf '\n== product-status --check\n'
  local address="acme-shop.afkfactory.space"
  local root="$TMP/products"
  mkdir -p "$root/$address"
  cat >"$root/$address/.env" <<'EOF'
IMAGE=acme-shop.afkfactory.space:v1
PORT=19100
APP_NETWORK=afk-test-net
APP_UID=1000
APP_GID=1000
APP_INTERNAL_PORT=3000
PG_HOST=afk-test-pg
DB_NAME=acme_shop
DB_USER=acme_shop
DB_PASSWORD=secret
APP_KEY=key
ADMIN_PASSWORD=admin
EOF

  local out status
  (
    export PATH="$TMP/bin:$PATH"
    export AFK_PRODUCTS_ROOT="$root"
    export AFK_PREVIEWS_ROOT="$TMP/previews"
    export AFK_PG_CONTAINER=afk-test-pg
    export AFK_TEMPLATE_DIR="$PRODUCTS"
    export AFK_DOCKER="$TMP/bin/docker"
    FAKE_HTTP_CODE=000 bash "$HELPER" product-status --check "$address"
  ) >"$TMP/status-000.log" 2>&1
  status=$?
  out=$(cat "$TMP/status-000.log")
  if [[ $status -eq 0 ]]; then bad "product-status --check 把 000 判健康"; else ok "product-status --check 把 000 判失败"; fi
  if printf '%s' "$out" | grep -q '本机 HTTP 000'; then ok "product-status 打印 000 现场"; else bad "product-status 没打印 HTTP 000"; fi

  (
    export PATH="$TMP/bin:$PATH"
    export AFK_PRODUCTS_ROOT="$root"
    export AFK_PREVIEWS_ROOT="$TMP/previews"
    export AFK_PG_CONTAINER=afk-test-pg
    export AFK_TEMPLATE_DIR="$PRODUCTS"
    export AFK_DOCKER="$TMP/bin/docker"
    FAKE_HTTP_CODE=502 bash "$HELPER" product-status --check "$address"
  ) >"$TMP/status-502.log" 2>&1
  status=$?
  if [[ $status -eq 0 ]]; then bad "product-status --check 把 502 判健康"; else ok "product-status --check 把 502 判失败"; fi

  (
    export PATH="$TMP/bin:$PATH"
    export AFK_PRODUCTS_ROOT="$root"
    export AFK_PREVIEWS_ROOT="$TMP/previews"
    export AFK_PG_CONTAINER=afk-test-pg
    export AFK_TEMPLATE_DIR="$PRODUCTS"
    export AFK_DOCKER="$TMP/bin/docker"
    FAKE_HTTP_CODE=200 bash "$HELPER" product-status --check "$address"
  ) >"$TMP/status-200.log" 2>&1
  status=$?
  if [[ $status -eq 0 ]]; then ok "product-status --check 认 200"; else bad "product-status --check 不认 200"; fi
}

# ---------------------------------------------------------------- env 契约

env_get() { # 文件 键
  sed -n "s/^$2=//p" "$1" 2>/dev/null | tail -1
}

prepare_template() { # 目录
  local dir=$1
  mkdir -p "$dir/caddy"
  cp "$PRODUCTS/compose.template.yml" "$dir/compose.template.yml"
  cp "$PRODUCTS/caddy/product.caddy" "$dir/caddy/product.caddy"
  cp "$PRODUCTS/caddy/preview.caddy" "$dir/caddy/preview.caddy"
  cp "$PRODUCTS/app.env.example" "$dir/app.env.example"
}

run_init() { # 地址 模板目录 [额外参数...]
  local address=$1 template=$2
  shift 2
  (
    export PATH="$TMP/bin:$PATH"
    export AFK_PRODUCTS_ROOT="$TMP/contract/products"
    export AFK_PREVIEWS_ROOT="$TMP/contract/previews"
    export AFK_CADDY_PRODUCTS="$TMP/contract/caddy/products"
    export AFK_CADDY_PREVIEWS="$TMP/contract/caddy/previews"
    export AFK_BACKUP_DIR="$TMP/contract/backups"
    export AFK_PG_ENV="$TMP/contract/postgres.env"
    export AFK_PG_CONTAINER=afk-test-pg
    export AFK_NETWORK_PREFIX=afk-test-
    export AFK_PORT_START=19100
    export AFK_TEMPLATE_DIR="$template"
    export AFK_CADDY_RELOAD=never
    export AFK_DOCKER="$TMP/bin/docker"
    bash "$HELPER" product-init "$address" --image acme-shop.afkfactory.space:v1 "$@"
  )
}

test_env_contract() {
  printf '\n== env 契约\n'
  mkdir -p "$TMP/contract"
  cat >"$TMP/contract/postgres.env" <<'EOF'
POSTGRES_USER=postgres
POSTGRES_PASSWORD=pg
AFK_PG_SUPERUSER=postgres
AFK_PG_SUPERUSER_PASSWORD=pg
EOF

  if [[ ! -f $PRODUCTS/app.env.example ]]; then
    bad "缺应用 env 契约 $PRODUCTS/app.env.example"
    return
  fi

  local template="$TMP/template-default"
  prepare_template "$template"

  local address="acme-shop.afkfactory.space"
  local out status
  out=$(run_init "$address" "$template" 2>&1)
  status=$?
  if [[ $status -eq 0 ]]; then
    ok "按应用 .env.example 初始化成功"
  else
    bad "按应用 .env.example 初始化失败：$out"
    return
  fi

  local env="$TMP/contract/products/$address/.env"
  local key
  while IFS= read -r key; do
    [[ -n $key ]] || continue
    if grep -q "^$key=" "$env"; then
      ok ".env 里有契约键 $key"
    else
      bad ".env 里缺契约键 $key"
    fi
  done < <(sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' "$template/app.env.example")

  assert_eq "0.0.0.0" "$(env_get "$env" HOST)" "契约默认值 HOST 写进 .env"
  assert_eq "$address" "$(env_get "$env" APP_NAME)" "APP_NAME 按地址生成"
  assert_eq "19100" "$(env_get "$env" PORT)" "PORT 用挑好的端口，不被契约默认值覆盖"

  # 应用契约把 DATABASE_URL 留空时，product-init 用 DB 凭据生成连接串。
  local db_contract="$TMP/db.env.example"
  cat >"$db_contract" <<'EOF'
PORT=3000
HOST=0.0.0.0
APP_NAME=
DATABASE_URL=
EOF
  local db_address="acme-db.afkfactory.space"
  out=$(run_init "$db_address" "$template" --env-example "$db_contract" 2>&1)
  status=$?
  if [[ $status -eq 0 ]]; then
    ok "契约留空 DATABASE_URL 时 init 成功"
  else
    bad "契约留空 DATABASE_URL 时 init 失败：$out"
  fi
  local db_env="$TMP/contract/products/$db_address/.env"
  local db_name db_user db_pass
  db_name=$(env_get "$db_env" DB_NAME)
  db_user=$(env_get "$db_env" DB_USER)
  db_pass=$(env_get "$db_env" DB_PASSWORD)
  assert_eq "postgresql://${db_user}:${db_pass}@afk-test-pg:5432/${db_name}" "$(env_get "$db_env" DATABASE_URL)" "首次 init 写 DATABASE_URL"

  # 已有 .env（首次失败留下的）缺 DATABASE_URL：重跑 init 用现有凭据回填。
  grep -v '^DATABASE_URL=' "$db_env" >"$TMP/db-without-url.env"
  cat "$TMP/db-without-url.env" >"$db_env"
  out=$(run_init "$db_address" "$template" 2>&1)
  status=$?
  if [[ $status -eq 0 ]]; then
    ok "已有 .env 缺 DATABASE_URL 时重跑 init 成功"
  else
    bad "已有 .env 缺 DATABASE_URL 时重跑 init 失败：$out"
  fi
  assert_eq "postgresql://${db_user}:${db_pass}@afk-test-pg:5432/${db_name}" "$(env_get "$db_env" DATABASE_URL)" "重跑 init 回填 DATABASE_URL"

  # 契约里留空的键，helper 不知道怎么生成就失败，并点名。
  local template_missing="$TMP/template-missing"
  prepare_template "$template_missing"
  cat >"$template_missing/app.env.example" <<'EOF'
PORT=3000
HOST=0.0.0.0
APP_NAME=
MYSTERY_REQUIRED=
EOF
  out=$(run_init "acme-other.afkfactory.space" "$template_missing" 2>&1)
  status=$?
  if [[ $status -ne 0 ]]; then ok "契约缺可生成值时 init 失败"; else bad "契约缺可生成值时 init 还成功"; fi
  if printf '%s' "$out" | grep -q 'MYSTERY_REQUIRED'; then
    ok "失败信息点名缺的键"
  else
    bad "失败信息没点名 MYSTERY_REQUIRED：$out"
  fi

  # --env-example 覆盖模板自带的契约，应用默认值优先；契约另存一份，下次手动 init 还用。
  local custom="$TMP/custom.env.example"
  cat >"$custom" <<'EOF'
PORT=3000
HOST=0.0.0.0
APP_NAME=我的店
CUSTOM_DEFAULT=hello
EOF
  out=$(run_init "acme-custom.afkfactory.space" "$template" --env-example "$custom" 2>&1)
  status=$?
  if [[ $status -eq 0 ]]; then ok "--env-example 覆盖契约时 init 成功"; else bad "--env-example 覆盖契约时 init 失败：$out"; fi
  local custom_env="$TMP/contract/products/acme-custom.afkfactory.space/.env"
  assert_eq "我的店" "$(env_get "$custom_env" APP_NAME)" "--env-example 的默认值写进 .env"
  assert_eq "hello" "$(env_get "$custom_env" CUSTOM_DEFAULT)" "自定义契约键写进 .env"
  assert_file "$TMP/contract/products/acme-custom.afkfactory.space/app.env.example" "应用契约另存到成品目录"

  # 手动重跑不带 --env-example 时，用存下来的应用契约，不用模板契约。
  grep -v '^CUSTOM_DEFAULT=' "$custom_env" >"$TMP/custom-without.env"
  cat "$TMP/custom-without.env" >"$custom_env"
  out=$(run_init "acme-custom.afkfactory.space" "$template" 2>&1)
  status=$?
  if [[ $status -eq 0 ]]; then ok "不带 --env-example 重跑 init 成功"; else bad "不带 --env-example 重跑 init 失败：$out"; fi
  assert_eq "hello" "$(env_get "$custom_env" CUSTOM_DEFAULT)" "重跑时按存下的应用契约补键"

  # 没有契约文件就不猜，直接失败。
  local template_none="$TMP/template-none"
  prepare_template "$template_none"
  rm -f "$template_none/app.env.example"
  out=$(run_init "acme-none.afkfactory.space" "$template_none" 2>&1)
  status=$?
  if [[ $status -ne 0 ]]; then ok "缺应用 .env.example 时 init 失败"; else bad "缺应用 .env.example 时 init 还成功"; fi
  if printf '%s' "$out" | grep -q 'env 契约'; then
    ok "缺契约的报错写清楚"
  else
    bad "缺契约的报错不清楚：$out"
  fi
}

# ---------------------------------------------------------------- 发布指纹

run_check() { # 仓库目录（可空）
  local repo=${1:-}
  local args=(--templates-only)
  if [[ -n $repo ]]; then args+=(--repo "$repo"); fi
  AFK_RELEASE_DIR="$TMP/release" \
    AFK_SHARE_DIR="$TMP/share" \
    AFK_HELPER_PATH="$TMP/sbin/afk-product" \
    bash "$REPO/deploy/backend/check.sh" "${args[@]}"
}

test_release_fingerprint() {
  printf '\n== 发布指纹\n'
  if [[ ! -f $FINGERPRINT_LIB ]]; then
    bad "缺发布指纹库 $FINGERPRINT_LIB"
    return
  fi

  local root="$TMP/repo"
  mkdir -p "$root/backend/scaffold/src" "$root/deploy/products/caddy" "$root/deploy/lib"
  printf 'console.log(1)\n' >"$root/backend/scaffold/src/server.mjs"
  printf 'PORT=3000\nHOST=0.0.0.0\nAPP_NAME=\n' >"$root/backend/scaffold/.env.example"
  printf 'services: {}\n' >"$root/deploy/products/compose.template.yml"
  printf 'route\n' >"$root/deploy/products/caddy/product.caddy"
  printf 'preview\n' >"$root/deploy/products/caddy/preview.caddy"
  printf 'PORT=3000\nHOST=0.0.0.0\nAPP_NAME=\n' >"$root/deploy/products/app.env.example"
  printf '#!/usr/bin/env bash\n' >"$root/deploy/products/afk-product"
  cp "$HEALTH_LIB" "$root/deploy/lib/health.sh"
  cp "$FINGERPRINT_LIB" "$root/deploy/lib/fingerprint.sh"
  (
    cd "$root" || exit 1
    git init -q -b main
    git add -A
    git -c user.name=test -c user.email=test@example.invalid commit -qm base
  ) || { bad "临时仓库建不起来"; return; }

  local pkg="$TMP/afkapp-test.tgz"
  if bash "$REPO/deploy/backend/package.sh" "$root/backend" 1.0.0 "$pkg" >"$TMP/package.log" 2>&1; then
    ok "package.sh 打出发布包"
  else
    bad "package.sh 失败：$(cat "$TMP/package.log")"
    return
  fi

  # 文档里的用法是在仓库根用相对源目录打包；脚本内部的第二次 tar -C 不能把它解析到元数据目录下。
  local relative_pkg="$TMP/afkapp-relative.tgz"
  if (cd "$root" && bash "$REPO/deploy/backend/package.sh" backend 1.0.1 "$relative_pkg") >"$TMP/package-relative.log" 2>&1; then
    ok "package.sh 在仓库根用相对源目录打出发布包"
  else
    bad "package.sh 用相对源目录失败：$(cat "$TMP/package-relative.log")"
  fi
  if [[ -s $relative_pkg ]]; then ok "相对源目录的发布包非空"; else bad "相对源目录的发布包是空文件"; fi
  local relative_release="$TMP/release-relative"
  mkdir -p "$relative_release"
  tar -xzf "$relative_pkg" -C "$relative_release"
  assert_eq "1.0.1" "$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$relative_release/release.json" | head -1)" "相对源目录的发布包记下版本号"
  assert_eq "$(git -C "$root" rev-parse HEAD)" "$(sed -n 's/.*"commit"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$relative_release/release.json" | head -1)" "相对源目录的发布包记下来源提交"

  mkdir -p "$TMP/release"
  tar -xzf "$pkg" -C "$TMP/release"
  if [[ -f $TMP/release/release.json ]]; then ok "发布包根有 release.json"; else bad "发布包根没有 release.json"; fi
  if [[ -f $TMP/release/release.manifest ]]; then ok "发布包根有 release.manifest"; else bad "发布包根没有 release.manifest"; fi
  if [[ -f $TMP/release/scaffold/src/server.mjs ]]; then ok "发布包里有 scaffold"; else bad "发布包里没有 scaffold"; fi

  # shellcheck source=/dev/null
  . "$FINGERPRINT_LIB"
  local expected_commit actual_commit expected_scaffold actual_scaffold
  expected_commit=$(git -C "$root" rev-parse HEAD)
  actual_commit=$(sed -n 's/.*"commit"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$TMP/release/release.json" | head -1)
  assert_eq "$expected_commit" "$actual_commit" "release.json 记下来源提交"
  expected_scaffold=$(tree_sha256 "$root/backend/scaffold")
  actual_scaffold=$(sed -n 's/.*"scaffold_sha256"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$TMP/release/release.json" | head -1)
  assert_eq "$expected_scaffold" "$actual_scaffold" "release.json 的 scaffold 指纹和仓库一致"

  mkdir -p "$TMP/share/caddy" "$TMP/sbin"
  cp "$root/deploy/products/compose.template.yml" "$TMP/share/compose.template.yml"
  cp "$root/deploy/products/caddy/product.caddy" "$TMP/share/caddy/product.caddy"
  cp "$root/deploy/products/caddy/preview.caddy" "$TMP/share/caddy/preview.caddy"
  cp "$root/deploy/products/app.env.example" "$TMP/share/app.env.example"
  cp "$root/deploy/products/afk-product" "$TMP/sbin/afk-product"
  cp "$HEALTH_LIB" "$TMP/share/health.sh"
  cp "$FINGERPRINT_LIB" "$TMP/share/fingerprint.sh"

  local out status
  out=$(run_check "$root" 2>&1)
  status=$?
  if [[ $status -eq 0 ]]; then ok "模板、scaffold、仓库全一致时 check.sh 通过"; else bad "全一致时 check.sh 失败：$out"; fi
  if printf '%s' "$out" | grep -q '发布来源提交'; then ok "check.sh 打印来源提交"; else bad "check.sh 没打印来源提交"; fi

  printf 'changed\n' >"$TMP/share/compose.template.yml"
  out=$(run_check "$root" 2>&1)
  status=$?
  if [[ $status -ne 0 ]]; then ok "服务器成品模板和发布记录不一致时 check.sh 失败"; else bad "服务器成品模板不一致时 check.sh 还通过"; fi
  if printf '%s' "$out" | grep -q 'compose.template.yml'; then
    ok "check.sh 点名不一致的模板文件"
  else
    bad "check.sh 没点名 compose.template.yml：$out"
  fi
  cp "$root/deploy/products/compose.template.yml" "$TMP/share/compose.template.yml"

  printf 'changed\n' >"$TMP/release/scaffold/src/server.mjs"
  out=$(run_check "$root" 2>&1)
  status=$?
  if [[ $status -ne 0 ]]; then ok "服务器 scaffold 被改过时 check.sh 失败"; else bad "服务器 scaffold 被改过时 check.sh 还通过"; fi
  if printf '%s' "$out" | grep -q 'scaffold 指纹'; then ok "check.sh 报 scaffold 指纹不一致"; else bad "check.sh 没报 scaffold 指纹：$out"; fi
  printf 'console.log(1)\n' >"$TMP/release/scaffold/src/server.mjs"

  printf 'repo newer\n' >"$root/backend/scaffold/src/server.mjs"
  out=$(run_check "$root" 2>&1)
  status=$?
  if [[ $status -ne 0 ]]; then ok "仓库比服务器新时 check.sh 失败"; else bad "仓库比服务器新时 check.sh 还通过"; fi
  if printf '%s' "$out" | grep -q '和仓库不一致'; then ok "check.sh 报和仓库不一致"; else bad "check.sh 没报和仓库不一致：$out"; fi
}

# ---------------------------------------------------------------- helper 打包

test_helper_package() {
  printf '\n== helper 打包\n'
  local pkg="$TMP/afk-products-helper.tgz"
  if bash "$REPO/deploy/products/package.sh" "$pkg" >"$TMP/helper-package.log" 2>&1; then
    ok "package.sh 打出 helper 包"
  else
    bad "helper 打包失败：$(cat "$TMP/helper-package.log")"
    return
  fi

  local unpack="$TMP/helper-unpack"
  mkdir -p "$unpack"
  tar -xzf "$pkg" -C "$unpack"
  local envfile="$unpack/deploy/products/app.env.example"
  if [[ -f $envfile && ! -L $envfile && -s $envfile ]]; then
    ok "解包后 app.env.example 是普通非空文件"
  else
    bad "解包后 app.env.example 不是普通非空文件"
  fi
  assert_file "$unpack/deploy/lib/health.sh" "helper 包带 deploy/lib/health.sh"
  assert_file "$unpack/backend/scaffold/.env.example" "helper 包带 scaffold 的 .env.example"

  local out status
  out=$(bash "$unpack/deploy/products/install.sh" --check-files 2>&1)
  status=$?
  if [[ $status -eq 0 ]]; then ok "解包后 install.sh 文件预检通过"; else bad "解包后文件预检失败：$out"; fi

  local broken="$TMP/helper-broken"
  cp -R "$unpack" "$broken"
  rm -f "$broken/deploy/products/app.env.example"
  ln -s ../../backend/scaffold/missing.env.example "$broken/deploy/products/app.env.example"
  out=$(bash "$broken/deploy/products/install.sh" --check-files 2>&1)
  status=$?
  if [[ $status -ne 0 ]] && printf '%s' "$out" | grep -q 'deploy/products/package.sh 打包'; then
    ok "app.env.example 断链时 install.sh 给出打包命令"
  else
    bad "app.env.example 断链提示不对：$out"
  fi

  local missing="$TMP/helper-missing"
  cp -R "$unpack" "$missing"
  rm -f "$missing/deploy/products/caddy/main-include.caddy"
  out=$(bash "$missing/deploy/products/install.sh" --check-files 2>&1)
  status=$?
  if [[ $status -ne 0 ]] && printf '%s' "$out" | grep -q 'main-include.caddy'; then
    ok "缺 main-include.caddy 时文件预检失败并点名"
  else
    bad "缺 main-include.caddy 的预检不对：$out"
  fi

  local mini="$TMP/mini-repo"
  mkdir -p "$mini/deploy/products" "$mini/deploy/lib" "$mini/backend/scaffold"
  cp "$REPO/deploy/products/package.sh" "$mini/deploy/products/package.sh"
  out=$(bash "$mini/deploy/products/package.sh" "$TMP/mini.tgz" 2>&1)
  status=$?
  if [[ $status -ne 0 ]] && printf '%s' "$out" | grep -q 'backend/scaffold/.env.example'; then
    ok "缺 scaffold 的 .env.example 时打包报错并点名"
  else
    bad "缺目标文件的报错不对：$out"
  fi
}

# ---------------------------------------------------------------- 入口

test_health_lib
test_product_status
test_env_contract
test_release_fingerprint
test_helper_package

printf '\n通过 %d 项，失败 %d 项\n' "$PASS" "$FAILED"
[[ $FAILED -eq 0 ]]
