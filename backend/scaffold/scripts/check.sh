#!/usr/bin/env bash
# 一条命令跑完 typecheck、lint、test。CI 和本地用同一条。
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== typecheck =="
find src scripts -type f -name '*.mjs' -print0 |
  while IFS= read -r -d '' file; do
    node --check "$file"
  done
echo "typecheck：通过"

echo "== lint =="
node scripts/lint.mjs

echo "== test =="
node --test $(find src -type f -name '*.test.mjs' | sort)

echo "check 全过"
