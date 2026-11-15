#!/usr/bin/env bash
# 在服务器上回滚到上一版。用 root 跑。
#
#   sudo bash deploy/backend/rollback.sh
#
# 健康检查不过会把当前版本再切回来。

set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "要用 root 跑：sudo bash $0" >&2
  exit 1
fi

CURRENT=/data/app/current
PREVIOUS=/data/app/previous

[[ -L $PREVIOUS ]] || { echo "没有上一版，rollback 不适用" >&2; exit 1; }
TARGET=$(readlink -f "$PREVIOUS")
[[ -d $TARGET ]] || { echo "上一版目录不存在：$TARGET" >&2; exit 1; }
CUR=$(readlink -f "$CURRENT" 2>/dev/null || true)

health_ok() {
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://127.0.0.1:8787/app/api/health || true)
  [[ $code == 200 ]] || return 1
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://127.0.0.1:8787/app/api/session || true)
  [[ $code == 401 ]] || return 1
}

ln -sfn "$TARGET" "$CURRENT"
systemctl restart afkapp

for _ in $(seq 1 20); do
  health_ok && break
  sleep 0.5
done

if ! health_ok; then
  echo "回滚后健康检查没过，切回原版本" >&2
  journalctl -u afkapp -n 40 --no-pager >&2 || true
  if [[ -n $CUR && -d $CUR ]]; then
    ln -sfn "$CUR" "$CURRENT"
    systemctl restart afkapp || true
  fi
  exit 1
fi

if [[ -n $CUR && $CUR != "$TARGET" ]]; then
  ln -sfn "$CUR" "$PREVIOUS"
fi

echo "已回滚到：$TARGET"
