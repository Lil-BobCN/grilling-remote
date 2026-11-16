#!/usr/bin/env bash
# Mac 侧备份同步：把服务器上的成品备份和每个成品的 data/ 拉到本机。
#
#   AFK_SERVER=dev@<服务器地址> bash deploy/products/backup-sync.sh
#
# 可选环境变量：
#   AFK_LOCAL_BACKUP_DIR   本机目录，默认 ~/afkfactory-backups
#   AFK_SERVER_BACKUP_DIR  服务器备份目录，默认 /data/products/backups
#   AFK_RSYNC              rsync 命令，默认 rsync
#   AFK_RSYNC_PATH         服务器上跑的 rsync，默认 `sudo rsync`
#   AFK_SSH_KEY            ssh -i 的私钥路径
#
# 保留策略归服务器上的 backup.sh：日备 7 个、周备 4 个。这里只增量拉，
# 不加 --delete，本机多出来的旧文件自己删。
set -euo pipefail

SERVER=${AFK_SERVER:-}
DEST=${AFK_LOCAL_BACKUP_DIR:-$HOME/afkfactory-backups}
REMOTE=${AFK_SERVER_BACKUP_DIR:-/data/products/backups}
RSYNC=${AFK_RSYNC:-rsync}
RSYNC_PATH=${AFK_RSYNC_PATH:-sudo rsync}
DRY_RUN=0

usage() {
  sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
}

while [[ $# -gt 0 ]]; do
  case $1 in
    --server)
      [[ $# -ge 2 ]] || usage
      SERVER=$2
      shift 2
      ;;
    --dest)
      [[ $# -ge 2 ]] || usage
      DEST=$2
      shift 2
      ;;
    --remote)
      [[ $# -ge 2 ]] || usage
      REMOTE=$2
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    *)
      usage
      ;;
  esac
done

[[ -n $SERVER ]] || { echo '先设 AFK_SERVER，例如 AFK_SERVER=dev@1.2.3.4' >&2; exit 2; }
[[ -n $DEST ]] || { echo '本机目录不能为空' >&2; exit 2; }

SSH_CMD="ssh"
if [[ -n ${AFK_SSH_KEY:-} ]]; then
  SSH_CMD="ssh -i ${AFK_SSH_KEY}"
fi

mkdir -p "$DEST/backups" "$DEST/products"

opts=(-az --partial --human-readable)
[[ $DRY_RUN -eq 1 ]] && opts+=(--dry-run)

echo "拉备份：$SERVER:$REMOTE/ -> $DEST/backups/"
"$RSYNC" "${opts[@]}" -e "$SSH_CMD" --rsync-path="$RSYNC_PATH" \
  "$SERVER:$REMOTE/" "$DEST/backups/"

# 只拉每个成品的 data/，不带 releases/ 和 postgres/ 这类大目录。
echo "拉成品数据：$SERVER:/data/products/*/data/ -> $DEST/products/"
"$RSYNC" "${opts[@]}" -e "$SSH_CMD" --rsync-path="$RSYNC_PATH" \
  --include='*/' --include='*/data/***' --exclude='*' \
  "$SERVER:/data/products/" "$DEST/products/"

echo "同步完成：$DEST"
