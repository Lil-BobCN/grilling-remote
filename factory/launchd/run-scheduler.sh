#!/bin/bash
# launchd 常驻：跑调度器 --loop。异常退出后由 launchd 拉起。
# 由 factory/bin/install-launchd.mjs 生成；要改就改仓库里的模板再重装。
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
# 读进来的键要 export 给 node 和它起的 claude 子进程。
set -a
if [ -n "${AFK_ENV_FILE:-}" ]; then
  source "$AFK_ENV_FILE"
elif [ -f "$HOME/.afkfactory/env" ]; then
  source "$HOME/.afkfactory/env"
fi
set +a
export AFK_SCHEDULER_LOG="${AFK_SCHEDULER_LOG:-$HOME/.afkfactory/logs/scheduler-runs.jsonl}"
cd "__REPO_ROOT__"
args=(node factory/bin/scheduler.mjs --loop --customers "${CUSTOMERS_FILE:-customers.json}")
if [ -n "${GITHUB_OWNER:-}" ]; then
  args+=(--owner "$GITHUB_OWNER")
fi
# 缺 token、helper、模型时，由 scheduler 的启动自检报出键名和文件。
exec "${args[@]}"
