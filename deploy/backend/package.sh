#!/usr/bin/env bash
# 在开发机上打发布包。只打包，不传服务器。
#
#   bash deploy/backend/package.sh <源目录> <版本号> [输出文件]
#
# 例：bash deploy/backend/package.sh deploy/backend/placeholder 0.1.0
# 输出默认放 output/afkapp-<版本号>.tgz，output/ 不进仓库。
#
# 包根会带 release.json 和 release.manifest：记录来源提交、scaffold 指纹和
# 成品模板指纹。服务器上的 check.sh 拿它们和实际安装的文件比对。

set -euo pipefail

SRC=${1:?用法：package.sh <源目录> <版本号> [输出文件]}
VERSION=${2:?用法：package.sh <源目录> <版本号> [输出文件]}
OUT=${3:-output/afkapp-$VERSION.tgz}

[[ -d $SRC ]] || { echo "源目录不存在：$SRC" >&2; exit 1; }
# 后面 tar 的第二个 -C 会先切到 $META，相对路径 $SRC 会按 $META 解析。入口处统一转绝对路径。
SRC=$(cd -- "$SRC" && pwd -P)
[[ $VERSION =~ ^[0-9A-Za-z][0-9A-Za-z._-]*$ ]] || { echo "版本号只能用字母、数字、点、下划线和连字符" >&2; exit 1; }

HERE=$(cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=../lib/fingerprint.sh
. "$HERE/../lib/fingerprint.sh"

COMMIT=$(git -C "$SRC" rev-parse HEAD 2>/dev/null || true)
ROOT=$(git -C "$SRC" rev-parse --show-toplevel 2>/dev/null || true)

SCAFFOLD_HASH=""
if [[ -d $SRC/scaffold ]]; then
  SCAFFOLD_HASH=$(tree_sha256 "$SRC/scaffold" 2>/dev/null || true)
fi
MANIFEST=""
MANIFEST_HASH=""
if [[ -n $ROOT && -d $ROOT/deploy/products ]]; then
  MANIFEST=$(release_manifest repo "$ROOT" 2>/dev/null || true)
  if [[ -n $MANIFEST ]]; then
    MANIFEST_HASH=$(printf '%s\n' "$MANIFEST" | sha256_stream)
  fi
fi
if [[ -z $MANIFEST ]]; then
  echo "注意：仓库里没有完整的 deploy/products 和 deploy/lib，发布包不带成品模板指纹" >&2
fi
if [[ -z $SCAFFOLD_HASH ]]; then
  echo "注意：$SRC 下没有 scaffold，发布包不带 scaffold 指纹" >&2
fi

META=$(mktemp -d "${TMPDIR:-/tmp}/afk-package.XXXXXX")
trap 'rm -rf "$META"' EXIT
{
  printf '{\n'
  printf '  "version": "%s",\n' "$VERSION"
  printf '  "commit": "%s",\n' "$COMMIT"
  printf '  "scaffold_sha256": "%s",\n' "$SCAFFOLD_HASH"
  printf '  "product_manifest_sha256": "%s",\n' "$MANIFEST_HASH"
  printf '  "built_at": "%s"\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '}\n'
} >"$META/release.json"
if [[ -n $MANIFEST ]]; then
  printf '%s\n' "$MANIFEST" >"$META/release.manifest"
fi

mkdir -p "$(dirname -- "$OUT")"
META_FILES=(release.json)
[[ -f $META/release.manifest ]] && META_FILES+=(release.manifest)
# macOS 的 tar 会把扩展属性写成 96 个 ._ 文件塞进包里，服务器解包后模板里
# 会多出 ._index.test.mjs，客户仓的 node --check 一读就报语法错。
# COPYFILE_DISABLE 从源头拦住，--exclude 再兜一层。
COPYFILE_DISABLE=1 tar -czf "$OUT" --no-xattrs --exclude='._*' --exclude='*/._*' \
  --exclude='.DS_Store' --exclude='*/.DS_Store' \
  -C "$META" "${META_FILES[@]}" -C "$SRC" .

if command -v sha256sum >/dev/null 2>&1; then
  sum=$(sha256sum "$OUT" | awk '{print $1}')
else
  sum=$(shasum -a 256 "$OUT" | awk '{print $1}')
fi

echo "发布包：$OUT"
echo "大小：$(du -h "$OUT" | awk '{print $1}')"
echo "SHA256：$sum"
echo "来源提交：${COMMIT:-未知}"
echo "scaffold 指纹：${SCAFFOLD_HASH:-无}"
echo "成品模板指纹：${MANIFEST_HASH:-无}"
