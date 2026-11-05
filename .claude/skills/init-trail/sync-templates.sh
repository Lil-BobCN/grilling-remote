#!/bin/sh
# 从本仓库重新生成 init-trail 的模板。在仓库根目录运行。
set -e
T=.claude/skills/init-trail/templates
mkdir -p "$T"
sed -n '/^## 地图上的变动怎么留痕/,$p' docs/agents/issue-tracker.md > "$T/issue-tracker-trail.md"
sed -n '/^\*\*冒头\*\*：/,$p' GLOSSARY.md > "$T/glossary-trail.md"
awk '/^### 地图变动/{f=1} /^## 冲突处理/{f=0} f' AGENTS.md > "$T/agents-pointer.md"
for s in map-gate wrap-up next spec-check; do cp ".claude/skills/$s/SKILL.md" "$T/skill-$s.md"; done
for f in "$T"/*.md; do [ -s "$f" ] || { echo "空文件: $f"; exit 1; }; done
wc -l "$T"/*.md
