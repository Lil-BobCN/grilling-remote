#!/usr/bin/env bash
# 只读巡检。普通用户就能跑，证书到期需要 sudo。
#
#   bash deploy/backend/check.sh
#
# 全部通过退出码 0，有硬失败退出码 1。

set -u

fail=0
ok() { printf '通过  %s\n' "$1"; }
bad() { printf '失败  %s\n' "$1"; fail=1; }
warn() { printf '注意  %s\n' "$1"; }

if systemctl is-active --quiet afkapp; then
  ok "afkapp 在跑"
else
  bad "afkapp 没在跑"
fi

if ss -tln | grep -q '127\.0\.0\.1:8787'; then
  ok "8787 在听，且只在本机"
else
  bad "8787 没在听"
fi

health=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://127.0.0.1:8787/app/api/health || true)
if [[ $health == 200 ]]; then
  ok "健康检查 200"
else
  bad "健康检查回 $health"
fi

session=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://127.0.0.1:8787/app/api/session || true)
if [[ $session == 401 ]]; then
  ok "未登录会话回 401"
else
  bad "未登录会话回 $session"
fi

disk_bad=$(df -P / /data | awk 'NR > 1 && $5 + 0 >= 90 { print $6 " " $5 }')
disk_warn=$(df -P / /data | awk 'NR > 1 && $5 + 0 >= 80 && $5 + 0 < 90 { print $6 " " $5 }')
if [[ -n $disk_warn ]]; then
  warn "磁盘过 80%：$disk_warn"
fi
if [[ -n $disk_bad ]]; then
  bad "磁盘过 90%：$disk_bad"
else
  ok "磁盘低于 90%"
fi

if systemctl is-active --quiet caddy; then
  ok "caddy 在跑"
else
  bad "caddy 没在跑"
fi

if sudo -n true 2>/dev/null; then
  cert=$(sudo -n openssl x509 -in /etc/caddy/certs/origin.pem -noout -enddate 2>/dev/null || true)
  if [[ -n $cert ]]; then
    ok "源站证书 $cert"
  else
    bad "读不到源站证书"
  fi
else
  warn "证书到期没查，需要 sudo"
fi

errors=$(journalctl -q -u afkapp --since '24 hours ago' -p err --no-pager 2>/dev/null | tail -5)
if [[ -n $errors ]]; then
  warn "过去 24 小时有错误日志："
  printf '%s\n' "$errors"
else
  ok "过去 24 小时没有错误日志"
fi

if journalctl -q -u afkapp --since '15 minutes ago' --no-pager 2>/dev/null \
  | grep -q '订单推送私有仓超过 10 分钟未成功'; then
  bad "订单推送私有仓积压超过 10 分钟"
else
  ok "近 15 分钟没有订单同步积压"
fi

# 成品预置环境（docs/运维手册.md 第十二节）。没装 helper 时整段跳过。
if [[ -x /usr/local/sbin/afk-product ]]; then
  if product_out=$(sudo -n /usr/local/sbin/afk-product product-status --check 2>&1); then
    ok "成品预置环境正常"
  else
    bad "成品预置环境有异常"
    printf '%s\n' "$product_out" | sed 's/^/  /'
  fi
fi

if [[ -r /proc/meminfo ]]; then
  mem_avail=$(awk '/^MemAvailable:/ { print int($2 / 1024) }' /proc/meminfo)
  if [[ -n $mem_avail && $mem_avail -lt 512 ]]; then
    warn "可用内存 ${mem_avail} MiB，低于 512 MiB，按第十二节报运营者加机器"
  else
    ok "可用内存 ${mem_avail} MiB"
  fi
fi

echo "最近 3 条请求："
journalctl -u afkapp -n 3 --no-pager 2>/dev/null | sed 's/^/  /'

echo
if [[ $fail -eq 0 ]]; then
  echo "巡检通过"
else
  echo "巡检有失败项"
fi
exit "$fail"
