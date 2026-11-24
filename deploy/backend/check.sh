#!/usr/bin/env bash
# 只读巡检。普通用户就能跑，证书到期需要 sudo。
#
#   bash deploy/backend/check.sh [--repo <仓库目录>] [--templates-only]
#
# --repo 给一份仓库副本时，逐文件对比服务器上的 scaffold、成品模板和仓库。
# --templates-only 只查发布指纹和模板，不查服务和磁盘，本机也能跑。
#
# 全部通过退出码 0，有硬失败退出码 1。

set -u

fail=0
ok() { printf '通过  %s\n' "$1"; }
bad() { printf '失败  %s\n' "$1"; fail=1; }
warn() { printf '注意  %s\n' "$1"; }

SELF_DIR=$(cd -- "$(dirname -- "$0")" && pwd)

find_lib() { # 文件名；顺序和 afk-product、deploy/rollback 一致：脚本旁边、仓库 deploy/lib、安装目录
  local name=$1 candidate
  for candidate in "$SELF_DIR/$name" "$SELF_DIR/../lib/$name" "/usr/local/share/afk-product/$name"; do
    if [[ -f $candidate ]]; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  return 1
}

HEALTH_LIB=$(find_lib health.sh) || {
  printf '失败  找不到 health.sh（共享健康判据）；按 docs/后端服务.md 的发布一节把 deploy/lib/health.sh 一起装到 /data/app/bin/\n' >&2
  exit 1
}
# shellcheck source=../lib/health.sh
. "$HEALTH_LIB"

FINGERPRINT_LIB=$(find_lib fingerprint.sh) || {
  printf '失败  找不到 fingerprint.sh（发布指纹）；按 docs/后端服务.md 的发布一节把 deploy/lib/fingerprint.sh 一起装到 /data/app/bin/\n' >&2
  exit 1
}
# shellcheck source=../lib/fingerprint.sh
. "$FINGERPRINT_LIB"

templates_only=0
repo_dir=${AFK_REPO_DIR:-}
while [[ $# -gt 0 ]]; do
  case $1 in
    --templates-only) templates_only=1; shift ;;
    --repo) repo_dir=${2:?--repo 要跟目录}; shift 2 ;;
    *) printf '不认识的参数：%s\n' "$1" >&2; exit 2 ;;
  esac
done

json_field() { # 文件 键
  sed -n "s/.*\"$2\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$1" | head -1
}

# 发布指纹和模板比对。--templates-only 只跑这一段。
check_release() {
  local release_dir=${AFK_RELEASE_DIR:-/data/app/current}
  local release_json=$release_dir/release.json
  local release_manifest=$release_dir/release.manifest
  local commit scaffold recorded actual rel path expected

  if [[ ! -f $release_json ]]; then
    warn "没有 ${release_json}（旧发布包），跳过发布指纹"
  else
    commit=$(json_field "$release_json" commit)
    if [[ -n $commit ]]; then ok "发布来源提交 $commit"; else warn "发布包没记来源提交"; fi

    scaffold=$(json_field "$release_json" scaffold_sha256)
    if [[ -z $scaffold ]]; then
      warn "发布包没记 scaffold 指纹"
    elif [[ ! -d $release_dir/scaffold ]]; then
      bad "发布目录里没有 scaffold，但 release.json 记了指纹"
    else
      actual=$(tree_sha256 "$release_dir/scaffold" || true)
      if [[ $actual == "$scaffold" ]]; then
        ok "服务器 scaffold 和发布记录一致"
      else
        bad "服务器 scaffold 指纹和发布记录不一致（发布包被改过或解包不完整）"
      fi
    fi

    recorded=$(json_field "$release_json" product_manifest_sha256)
    if [[ -z $recorded ]]; then
      warn "发布包没记成品模板指纹"
    else
      actual=$(release_manifest_sha256 server || true)
      if [[ $actual == "$recorded" ]]; then
        ok "服务器成品模板和发布记录一致"
      else
        bad "服务器成品模板和发布记录不一致，重跑 deploy/products/install.sh"
        if [[ -f $release_manifest ]]; then
          diff -u "$release_manifest" <(release_manifest server 2>/dev/null) 2>/dev/null \
            | grep -E '^[+-][0-9a-f]{64}  ' \
            | awk '{print $2}' | sort -u | sed 's/^/  /'
        fi
      fi
    fi
  fi

  if [[ -n ${repo_dir:-} ]]; then
    if [[ ! -d $repo_dir/backend/scaffold ]]; then
      bad "--repo 下没有 backend/scaffold：$repo_dir"
    elif [[ -d $release_dir/scaffold ]]; then
      if diff -r -q "$release_dir/scaffold" "$repo_dir/backend/scaffold" >/dev/null 2>&1; then
        ok "服务器 scaffold 和仓库一致"
      else
        bad "服务器 scaffold 和仓库不一致"
        diff -r -q "$release_dir/scaffold" "$repo_dir/backend/scaffold" 2>&1 | sed 's/^/  /' | head -20
      fi
    else
      warn "读不到 $release_dir/scaffold，跳过 scaffold 对比"
    fi

    while IFS=$'\t' read -r rel path; do
      expected="$repo_dir/$rel"
      if [[ ! -f $path ]]; then
        bad "服务器缺 ${rel}（${path}）"
      elif [[ ! -f $expected ]]; then
        bad "仓库缺 $rel"
      elif ! cmp -s "$path" "$expected"; then
        bad "服务器 $rel 和仓库不一致"
      else
        ok "服务器 $rel 和仓库一致"
      fi
    done < <(product_release_files server)
  else
    warn "没给 --repo，跳过和仓库的逐文件对比"
  fi
}

if [[ $templates_only -eq 1 ]]; then
  check_release
  if [[ $fail -eq 0 ]]; then
    echo "模板检查通过"
  else
    echo "模板检查有失败项"
  fi
  exit "$fail"
fi

if systemctl is-active --quiet afkapp; then
  ok "afkapp 在跑"
else
  bad "afkapp 没在跑"
fi

if ss -tln | grep -q '127\.0\.0\.1:8787'; then
  ok "8787 在听，且只在本机"
else
  bad "8787 没在听"
fi

health_raw=$(curl -s --max-time 2 -w '\n%{http_code}' http://127.0.0.1:8787/app/api/health || true)
health_body=${health_raw%$'\n'*}
health=${health_raw##*$'\n'}
[[ -n $health ]] || health=000
if healthy "$health"; then
  ok "健康检查 200"
else
  bad "健康检查回 $health"
fi
health_version=$(printf '%s' "$health_body" | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
if [[ -n $health_version ]]; then
  ok "健康接口版本 $health_version"
else
  bad "健康接口没带版本"
fi

session=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://127.0.0.1:8787/app/api/session || true)
if [[ $session == 401 ]]; then
  ok "未登录会话回 401"
else
  bad "未登录会话回 $session"
fi

disk_bad=$(df -P / /data | awk 'NR > 1 && $5 + 0 >= 90 { print $6 " " $5 }')
disk_warn=$(df -P / /data | awk 'NR > 1 && $5 + 0 >= 80 && $5 + 0 < 90 { print $6 " " $5 }')
if [[ -n $disk_warn ]]; then
  warn "磁盘过 80%：$disk_warn"
fi
if [[ -n $disk_bad ]]; then
  bad "磁盘过 90%：$disk_bad"
else
  ok "磁盘低于 90%"
fi

if systemctl is-active --quiet caddy; then
  ok "caddy 在跑"
else
  bad "caddy 没在跑"
fi

if sudo -n true 2>/dev/null; then
  cert=$(sudo -n openssl x509 -in /etc/caddy/certs/origin.pem -noout -enddate 2>/dev/null || true)
  if [[ -n $cert ]]; then
    ok "源站证书 $cert"
  else
    bad "读不到源站证书"
  fi
else
  warn "证书到期没查，需要 sudo"
fi

errors=$(journalctl -q -u afkapp --since '24 hours ago' -p err --no-pager 2>/dev/null | tail -5)
if [[ -n $errors ]]; then
  warn "过去 24 小时有错误日志："
  printf '%s\n' "$errors"
else
  ok "过去 24 小时没有错误日志"
fi

if journalctl -q -u afkapp --since '15 minutes ago' --no-pager 2>/dev/null \
  | grep -q '订单推送私有仓超过 10 分钟未成功'; then
  bad "订单推送私有仓积压超过 10 分钟"
else
  ok "近 15 分钟没有订单同步积压"
fi

# 成品预置环境（docs/运维手册.md 第十二节）。没装 helper 时整段跳过。
if [[ -x /usr/local/sbin/afk-product ]]; then
  if product_out=$(sudo -n /usr/local/sbin/afk-product product-status --check 2>&1); then
    ok "成品预置环境正常"
  else
    bad "成品预置环境有异常"
    printf '%s\n' "$product_out" | sed 's/^/  /'
  fi
fi

check_release

if [[ -r /proc/meminfo ]]; then
  mem_avail=$(awk '/^MemAvailable:/ { print int($2 / 1024) }' /proc/meminfo)
  if [[ -n $mem_avail && $mem_avail -lt 512 ]]; then
    warn "可用内存 ${mem_avail} MiB，低于 512 MiB，按第十二节报运营者加机器"
  else
    ok "可用内存 ${mem_avail} MiB"
  fi
fi

echo "最近 3 条请求："
journalctl -u afkapp -n 3 --no-pager 2>/dev/null | sed 's/^/  /'

echo
if [[ $fail -eq 0 ]]; then
  echo "巡检通过"
else
  echo "巡检有失败项"
fi
exit "$fail"
