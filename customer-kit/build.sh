#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

version=$(jq -r '.version' manifest.json)
built_on=$(jq -r '.date' manifest.json)
name="客户工作区-$version"

mkdir -p dist
rm -f "dist/$name.zip" "dist/$name.zip.sha256"

# 从 manifest.json 生成包内技能清单
jq -r --arg v "$version" --arg d "$built_on" '
  "# 技能清单\n\n工作区版本：\($v)（\($d)）\n\n| 技能 | 一句话 | 什么时候用 |\n| --- | --- | --- |",
  (.skills[] | "| `\(.name)` | \(.summary) | \(.when) |")
' manifest.json > package/技能清单.md

# 用 python3 的 zipfile 打包，两个原因：
# 1. 它给非 ASCII 文件名打 UTF-8 标记（第 11 位）。系统的 zip 3.0 不打，
#    Windows 自带解压会按本地代码页读，中文文件名显示成乱码。
# 2. 包内时间戳固定成 manifest.json 的 date。内容不变时重打，SHA256 不变，
#    不会因为 技能清单.md 每次重写、mtime 变了而换一个校验值。
NAME="$name" BUILT_ON="$built_on" python3 - <<'PY'
import datetime, os, zipfile

root, name = "package", os.environ["NAME"]
out = os.path.join("dist", f"{name}.zip")
fixed = datetime.datetime.fromisoformat(os.environ["BUILT_ON"]).timetuple()[:6]

files = []
for dirpath, dirnames, filenames in os.walk(root):
    dirnames.sort()
    for f in sorted(filenames):
        if f == ".DS_Store":
            continue
        full = os.path.join(dirpath, f)
        files.append((full, os.path.relpath(full, root)))

with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for full, rel in files:
        info = zipfile.ZipInfo(rel, date_time=fixed)
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        with open(full, "rb") as fh:
            z.writestr(info, fh.read())
PY
(cd dist && shasum -a 256 "$name.zip" > "$name.zip.sha256")

echo "built: $(pwd)/dist/$name.zip"
cat "dist/$name.zip.sha256"
