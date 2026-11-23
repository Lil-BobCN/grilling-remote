#!/usr/bin/env bash
# 在开发机上打服务器 helper 包。只打包，不传服务器。
#
#   bash deploy/products/package.sh [输出文件]
#
# 默认输出 output/afk-products-helper.tgz。包从仓库根打，保留 deploy/ 和
# backend/ 的相对布局；打包时解引用软链，app.env.example 进包后是普通文件。
# 解包后到解包目录跑 sudo bash deploy/products/install.sh。

set -euo pipefail

OUT=${1:-output/afk-products-helper.tgz}

HERE=$(cd -- "$(dirname -- "$0")" && pwd)
REPO=$(cd -- "$HERE/../.." && pwd)

die() { printf '%s\n' "$*" >&2; exit 1; }

for target in deploy/products deploy/lib backend/scaffold/.env.example \
  deploy/products/caddy/main-include.caddy; do
  [[ -e $REPO/$target ]] || die "缺文件：$REPO/$target"
done

# app.env.example 是软链；断链时点名缺的是目标文件，不只报「缺文件」。
if [[ -L $REPO/deploy/products/app.env.example && ! -e $REPO/deploy/products/app.env.example ]]; then
  die "app.env.example 是软链，目标不存在：$(readlink "$REPO/deploy/products/app.env.example")；先补 backend/scaffold/.env.example"
fi
[[ -e $REPO/deploy/products/app.env.example ]] || die "缺文件：$REPO/deploy/products/app.env.example"

mkdir -p "$(dirname -- "$OUT")"
COPYFILE_DISABLE=1 tar -czhf "$OUT" --no-xattrs --exclude='._*' --exclude='*/._*' \
  --exclude='.DS_Store' --exclude='*/.DS_Store' \
  -C "$REPO" deploy/products deploy/lib backend/scaffold/.env.example

echo "helper 包：$OUT"
echo "大小：$(du -h "$OUT" | awk '{print $1}')"
echo "解包后到解包目录跑：sudo bash deploy/products/install.sh"
