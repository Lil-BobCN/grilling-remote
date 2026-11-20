#!/usr/bin/env bash
# 共享健康判据。成品 helper、巡检和发布脚本都 source 这一份。
# 只有 HTTP 200 算健康；000（连不上）、204、401、5xx 都不算。

healthy() { # 状态码
  [[ ${1:-} == 200 ]]
}

wait_http() { # 端口 [尝试次数] [间隔秒]
  local port=$1 tries=${2:-30} interval=${3:-1} i=0 code
  while [[ $i -lt $tries ]]; do
    code=$(curl -s -o /dev/null --max-time 2 -w '%{http_code}' "http://127.0.0.1:$port/" 2>/dev/null || true)
    if healthy "$code"; then return 0; fi
    i=$((i + 1))
    if [[ $i -lt $tries ]]; then sleep "$interval"; fi
  done
  return 1
}
