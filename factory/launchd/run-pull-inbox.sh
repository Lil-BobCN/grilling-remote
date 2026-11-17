#!/bin/bash
# launchd 每 5 分钟跑一次：从服务器拉回传件，并同步 customers.json。
# 由 factory/bin/install-launchd.mjs 生成；要改就改仓库里的模板再重装。
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
source "$HOME/.afkfactory/env"
cd "__REPO_ROOT__"
exec node factory/bin/pull-inbox.mjs
