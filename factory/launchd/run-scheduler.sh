#!/bin/bash
# launchd 常驻：跑调度器 --loop。异常退出后由 launchd 拉起。
# 由 factory/bin/install-launchd.mjs 生成；要改就改仓库里的模板再重装。
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
source "$HOME/.afkfactory/env"
: "${GITHUB_OWNER:?~/.afkfactory/env 里缺 GITHUB_OWNER}"
export AFK_SCHEDULER_LOG="${AFK_SCHEDULER_LOG:-$HOME/.afkfactory/logs/scheduler-runs.jsonl}"
cd "__REPO_ROOT__"
exec node factory/bin/scheduler.mjs --loop --customers "${CUSTOMERS_FILE:-customers.json}" --owner "$GITHUB_OWNER"
