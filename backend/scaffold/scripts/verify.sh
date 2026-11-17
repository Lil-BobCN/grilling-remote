#!/usr/bin/env bash
# 启动应用，走一条关键路径：看首页、下一单、打开确认页。留下截图。
set -euo pipefail
cd "$(dirname "$0")/.."

# 导入服务从 app.env 继承 PORT=8787，和正在跑的 afkapp 撞端口。
# 这里用独立变量，别读父进程的 PORT。
VERIFY_PORT=${VERIFY_PORT:-4317}
PORT=$VERIFY_PORT
export PORT

node src/server.mjs &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT

ready=0
for _ in $(seq 1 50); do
  if curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.1
done
if [ "$ready" -ne 1 ]; then
  echo "应用没起来：http://127.0.0.1:${PORT}/health" >&2
  exit 1
fi

location=$(
  curl -fsS -o /dev/null -D - -X POST \
    -d 'phone=13800138000&slotId=s1' \
    "http://127.0.0.1:${PORT}/orders" |
    tr -d '\r' |
    awk 'tolower($1) == "location:" { print $2 }'
)
if [ -z "$location" ]; then
  echo "下单没有返回跳转地址" >&2
  exit 1
fi

page=$(curl -fsS "http://127.0.0.1:${PORT}${location}")
case "$page" in
  *订好了*) echo "关键路径通过：下单成功，确认页有「订好了」" ;;
  *)
    echo "确认页没有「订好了」" >&2
    exit 1
    ;;
esac

mkdir -p .audit/screenshots
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [ -x "$CHROME" ]; then
  "$CHROME" --headless --disable-gpu --hide-scrollbars --window-size=1280,900 \
    --screenshot=".audit/screenshots/first-order.png" \
    "http://127.0.0.1:${PORT}${location}" >/dev/null 2>&1
  echo "截图：.audit/screenshots/first-order.png"
else
  echo "没找到 Chrome，跳过截图。关键路径已验证。"
fi
