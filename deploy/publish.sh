#!/usr/bin/env bash
# 重打包客户工作区，把 zip 和校验文件传到服务器，再核对一遍。
#
# 用法：
#   AFK_SERVER=dev@<服务器地址> bash deploy/publish.sh
#
# 可换的变量：
#   AFK_KEY        登录私钥，默认 ~/.ssh/id_ed25519_dev_hk
#   AFK_REMOTE_DIR 服务器上的站点根，默认 /data/www。要和 Caddyfile 的 root 一致。
#
# 服务器端的一次性设置见 deploy/README.md。

set -euo pipefail
cd "$(dirname "$0")/.."

server="${AFK_SERVER:?先设 AFK_SERVER，例如 AFK_SERVER=dev@1.2.3.4}"
key="${AFK_KEY:-$HOME/.ssh/id_ed25519_dev_hk}"
remote_dir="${AFK_REMOTE_DIR:-/data/www}"

bash customer-kit/build.sh

version=$(jq -r '.version' customer-kit/manifest.json)
file="客户工作区-$version.zip"
size=$(stat -f%z "customer-kit/dist/$file")

ssh -i "$key" "$server" "mkdir -p '$remote_dir/downloads'"
scp -q -i "$key" "customer-kit/dist/$file" "customer-kit/dist/$file.sha256" \
  "$server:$remote_dir/downloads/"

# 服务器上按 .sha256 复核，传坏了在这里就报出来
ssh -i "$key" "$server" "cd '$remote_dir/downloads' && sha256sum -c '$file.sha256'"

# 官网下载页读这份记录；发布成功后写，保证页面数字和线上文件一致
sha=$(cut -d' ' -f1 "customer-kit/dist/$file.sha256")
date=$(jq -r '.date' customer-kit/manifest.json)
jq -n --arg version "$version" --arg date "$date" --arg file "$file" \
  --argjson size "$size" --arg sha256 "$sha" \
  '{version: $version, date: $date, file: $file, size: $size, sha256: $sha256}' \
  > customer-kit/release.json

echo
echo "包名：$file"
echo "大小：$size 字节"
echo "SHA256：$sha"
echo "下载：https://afkfactory.dev/downloads/$file"
echo "官网数据：customer-kit/release.json（记得提交）"
