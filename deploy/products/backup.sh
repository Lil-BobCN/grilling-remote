#!/usr/bin/env bash
# 成品备份：遍历 /data/products 下的成品，按软件 pg_dump 到
# /data/products/backups/<交付地址>/<日期>.sql.gz，保留 7 个日备和 4 个周备。
# 连续两次失败打印告警并以非零退出；第一次失败只记录，不告警。
#
#   sudo afk-product-backup            # 全部成品，systemd timer 每天 3 点跑这个
#   sudo afk-product-backup <交付地址>  # 只备一个
#
# 同步到 Mac 只定义接口：打印 rsync 命令并写 /data/products/backups/.sync-pending，
# 真正的同步任务在 Mac 上跑。本脚本不发网络请求。
#
# 路径和策略都能用环境变量覆盖（本机测试用）：
#   AFK_PRODUCTS_ROOT、AFK_BACKUP_DIR、AFK_PG_ENV、AFK_PG_CONTAINER、
#   AFK_DAILY_KEEP、AFK_WEEKLY_KEEP、AFK_DOCKER、AFK_TODAY

set -uo pipefail

PRODUCTS_ROOT=${AFK_PRODUCTS_ROOT:-/data/products}
BACKUP_DIR=${AFK_BACKUP_DIR:-$PRODUCTS_ROOT/backups}
PG_CONTAINER=${AFK_PG_CONTAINER:-afk-products-postgres}
PG_ENV=${AFK_PG_ENV:-$PRODUCTS_ROOT/postgres/.env}
DAILY_KEEP=${AFK_DAILY_KEEP:-7}
WEEKLY_KEEP=${AFK_WEEKLY_KEEP:-4}
DOCKER=${AFK_DOCKER:-docker}
TODAY=${AFK_TODAY:-$(date -u +%F)}

die() { printf '%s\n' "$*" >&2; exit 1; }
log() { printf '%s\n' "$*"; }

env_get() {
  sed -n "s/^$2=//p" "$1" 2>/dev/null | tail -1
}

chown_if_root() {
  [[ ${EUID} -eq 0 ]] || return 0
  chown "$@"
}

# GNU date 和 BSD date 参数不一样，按能跑的那个用。
iso_week_of() {
  if date -d "$1" '+%G-W%V' >/dev/null 2>&1; then
    date -d "$1" '+%G-W%V'
  else
    date -j -f '%Y-%m-%d' "$1" '+%G-W%V'
  fi
}

product_dirs() { # 输出成品目录，每行一个
  local d
  if [[ -n ${1:-} ]]; then
    printf '%s\n' "$PRODUCTS_ROOT/$1"
    return
  fi
  for d in "$PRODUCTS_ROOT"/*/; do
    [[ -f "$d/.env" ]] || continue
    [[ -n $(env_get "$d/.env" DB_NAME) ]] || continue
    printf '%s\n' "${d%/}"
  done
}

prune() { # 目录 保留个数
  local dir=$1 keep=$2 count extra
  count=$(ls -1 "$dir"/*.sql.gz 2>/dev/null | wc -l | tr -d ' ')
  [[ $count -gt $keep ]] || return 0
  extra=$((count - keep))
  ls -1 "$dir"/*.sql.gz | sort | awk -v extra="$extra" 'NR <= extra' | while IFS= read -r old; do
    rm -f "$old"
  done
}

failed=0
synced_any=0
sync_lines=""

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR" 2>/dev/null || true
chown_if_root root:root "$BACKUP_DIR"

[[ -f $PG_ENV ]] || die "找不到 ${PG_ENV}。先跑 deploy/products/install.sh"
SUPER_USER=$(env_get "$PG_ENV" AFK_PG_SUPERUSER)
[[ -n $SUPER_USER ]] || SUPER_USER=$(env_get "$PG_ENV" POSTGRES_USER)
[[ -n $SUPER_USER ]] || SUPER_USER=postgres
SUPER_PASS=$(env_get "$PG_ENV" AFK_PG_SUPERUSER_PASSWORD)
[[ -n $SUPER_PASS ]] || SUPER_PASS=$(env_get "$PG_ENV" POSTGRES_PASSWORD)

week=$(iso_week_of "$TODAY")

while IFS= read -r dir; do
  [[ -n $dir ]] || continue
  address=$(basename "$dir")
  env="$dir/.env"
  if [[ ! -f $env ]]; then
    log "跳过 ${address}：没有 .env"
    continue
  fi
  db=$(env_get "$env" DB_NAME)
  if [[ -z $db ]]; then
    log "跳过 ${address}：.env 里没有 DB_NAME"
    continue
  fi

  out_dir="$BACKUP_DIR/$address"
  mkdir -p "$out_dir"
  chmod 700 "$out_dir" 2>/dev/null || true
  chown_if_root root:root "$out_dir"

  out="$out_dir/$TODAY.sql.gz"
  raw="$out_dir/.$TODAY.tmp.$$.sql"
  tmp="$out_dir/.$TODAY.tmp.$$.gz"
  fail_file="$BACKUP_DIR/.failures/$address"
  mkdir -p "$BACKUP_DIR/.failures"
  chmod 700 "$BACKUP_DIR/.failures" 2>/dev/null || true

  if "$DOCKER" exec -e PGPASSWORD="$SUPER_PASS" "$PG_CONTAINER" \
    pg_dump -U "$SUPER_USER" -d "$db" --no-privileges >"$raw" 2>/dev/null \
    && [[ -s $raw ]] \
    && gzip -c "$raw" >"$tmp" \
    && gzip -t "$tmp" 2>/dev/null; then
    rm -f "$raw"
    chmod 600 "$tmp"
    mv "$tmp" "$out"
    chown_if_root root:root "$out"
    rm -f "$fail_file"
    log "备份 $address -> ${out}（$(du -h "$out" | awk '{ print $1 }')）"

    # 每个 ISO 周第一份备份留成周备；周日那次失败也不会丢掉整周的周备。
    if [[ ! -f "$out_dir/weekly/$week.sql.gz" ]]; then
      mkdir -p "$out_dir/weekly"
      chmod 700 "$out_dir/weekly" 2>/dev/null || true
      cp -p "$out" "$out_dir/weekly/$week.sql.gz"
      prune "$out_dir/weekly" "$WEEKLY_KEEP"
    fi
    prune "$out_dir" "$DAILY_KEEP"
  else
    rm -f "$raw" "$tmp"
    count=0
    [[ -f $fail_file ]] && count=$(cat "$fail_file" 2>/dev/null || echo 0)
    count=$((count + 1))
    printf '%s\n' "$count" >"$fail_file"
    chmod 600 "$fail_file"
    if [[ $count -ge 2 ]]; then
      printf '告警：%s 连续 %s 次备份失败（最后一次 %s），看 docker logs %s\n' \
        "$address" "$count" "$TODAY" "$PG_CONTAINER" >&2
      failed=1
    else
      printf '失败：%s 这次没备成（第 %s 次，连续两次才告警）\n' "$address" "$count" >&2
    fi
  fi

  synced_any=1
  sync_lines="$sync_lines$out_dir
$dir/data
"
done < <(product_dirs "${1:-}")

if [[ $synced_any -eq 0 ]]; then
  log "没有成品，跳过"
  exit 0
fi

# 同步到 Mac 的接口：只打印和写标记，不发网络请求。
printf '%s\n' "$sync_lines" >"$BACKUP_DIR/.sync-pending"
chmod 600 "$BACKUP_DIR/.sync-pending"
log "待同步到 Mac："
printf '%s' "$sync_lines" | sed 's/^/  /'
log "Mac 上用 rsync 拉：rsync -a <服务器>:$BACKUP_DIR/ <Mac 备份目录>/"

[[ $failed -eq 0 ]] || exit 2
