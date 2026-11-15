#!/usr/bin/env bash
# 在服务器上发布一版。用 root 跑。
#
#   sudo bash deploy/backend/deploy.sh <发布包.tgz> <版本号>
#
# 发布包解到 /data/app/releases/<版本号>，切 current 软链，重启服务，
# 健康检查不过就切回上一版。第一次发布前先跑 install.sh。

set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "要用 root 跑：sudo bash $0 <发布包.tgz> <版本号>" >&2
  exit 1
fi

TARBALL=${1:?用法：deploy.sh <发布包.tgz> <版本号>}
VERSION=${2:?用法：deploy.sh <发布包.tgz> <版本号>}

[[ -f $TARBALL ]] || { echo "找不到发布包：$TARBALL" >&2; exit 1; }
[[ $VERSION =~ ^[0-9A-Za-z][0-9A-Za-z._-]*$ ]] || { echo "版本号只能用字母、数字、点、下划线和连字符" >&2; exit 1; }

RELEASES=/data/app/releases
RELEASE=$RELEASES/$VERSION
CURRENT=/data/app/current
PREVIOUS=/data/app/previous

[[ -d $RELEASES ]] || { echo "先跑 install.sh" >&2; exit 1; }
[[ ! -e $RELEASE ]] || { echo "版本 $VERSION 已存在，不覆盖" >&2; exit 1; }

OLD=$(readlink -f "$CURRENT" 2>/dev/null || true)

health_ok() {
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://127.0.0.1:8787/app/api/health || true)
  [[ $code == 200 ]] || return 1
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://127.0.0.1:8787/app/api/session || true)
  [[ $code == 401 ]] || return 1
}

show_failure() {
  echo "== 服务状态" >&2
  systemctl status afkapp --no-pager -l >&2 || true
  echo "== 最近日志" >&2
  journalctl -u afkapp -n 40 --no-pager >&2 || true
}

incoming=$(mktemp -d /data/app/.incoming.XXXXXX)
trap 'rm -rf "$incoming"' EXIT

tar -xzf "$TARBALL" -C "$incoming"
[[ -f $incoming/server.mjs ]] || { echo "发布包里没有 server.mjs" >&2; exit 1; }

mv "$incoming" "$RELEASE"
chown -R afkapp:afkapp "$RELEASE"
chmod -R u+rwX,go-rwx "$RELEASE"

ln -sfn "$RELEASE" "$CURRENT"
systemctl restart afkapp

for _ in $(seq 1 20); do
  health_ok && break
  sleep 0.5
done

if ! health_ok; then
  echo "健康检查没过，切回上一版" >&2
  show_failure
  if [[ -n $OLD && -d $OLD ]]; then
    ln -sfn "$OLD" "$CURRENT"
    systemctl restart afkapp || true
  else
    rm -f "$CURRENT"
    systemctl stop afkapp || true
  fi
  exit 1
fi

if [[ -n $OLD && $OLD != "$RELEASE" ]]; then
  ln -sfn "$OLD" "$PREVIOUS"
fi

systemctl enable afkapp >/dev/null 2>&1 || true
echo "发布完成：$VERSION"
echo "当前版本：$(readlink -f "$CURRENT")"
