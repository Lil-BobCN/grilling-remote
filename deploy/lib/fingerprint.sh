#!/usr/bin/env bash
# 发布指纹：scaffold 树和成品模板清单的 sha256。package.sh 写进发布包，check.sh 拿来比对。
# 只依赖 find、sed 和 sha256sum（没有就用 macOS 的 shasum）。

file_sha256() { # 文件
  [[ -f $1 ]] || return 1
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

sha256_stream() { # 从标准输入算
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  else
    shasum -a 256 | awk '{print $1}'
  fi
}

tree_sha256() { # 目录；路径和内容一起算，文件顺序固定
  local dir=$1 f
  [[ -d $dir ]] || return 1
  (
    cd "$dir" || exit 1
    find . -type f ! -name '._*' ! -name '.DS_Store' | LC_ALL=C sort | while IFS= read -r f; do
      printf '%s\n' "$f"
      file_sha256 "$f" || exit 1
    done
  ) | sha256_stream
}

# 成品发布要记录的服务器文件。相对路径两边一样，实际路径随模式变：
# repo 在源码仓里算，server 在服务器安装位置算。
product_release_files() { # 模式 repo|server，仓库根目录（repo 模式必填）
  local mode=$1 root=${2:-} share=${AFK_SHARE_DIR:-/usr/local/share/afk-product}
  case $mode in
    repo)
      printf '%s\t%s\n' 'deploy/products/afk-product' "$root/deploy/products/afk-product"
      printf '%s\t%s\n' 'deploy/products/compose.template.yml' "$root/deploy/products/compose.template.yml"
      printf '%s\t%s\n' 'deploy/products/caddy/product.caddy' "$root/deploy/products/caddy/product.caddy"
      printf '%s\t%s\n' 'deploy/products/caddy/preview.caddy' "$root/deploy/products/caddy/preview.caddy"
      printf '%s\t%s\n' 'deploy/products/app.env.example' "$root/deploy/products/app.env.example"
      printf '%s\t%s\n' 'deploy/lib/health.sh' "$root/deploy/lib/health.sh"
      printf '%s\t%s\n' 'deploy/lib/fingerprint.sh' "$root/deploy/lib/fingerprint.sh"
      ;;
    server)
      printf '%s\t%s\n' 'deploy/products/afk-product' "${AFK_HELPER_PATH:-/usr/local/sbin/afk-product}"
      printf '%s\t%s\n' 'deploy/products/compose.template.yml' "$share/compose.template.yml"
      printf '%s\t%s\n' 'deploy/products/caddy/product.caddy' "$share/caddy/product.caddy"
      printf '%s\t%s\n' 'deploy/products/caddy/preview.caddy' "$share/caddy/preview.caddy"
      printf '%s\t%s\n' 'deploy/products/app.env.example' "$share/app.env.example"
      printf '%s\t%s\n' 'deploy/lib/health.sh' "$share/health.sh"
      printf '%s\t%s\n' 'deploy/lib/fingerprint.sh' "$share/fingerprint.sh"
      ;;
    *)
      printf '不认识的模式：%s\n' "$mode" >&2
      return 1
      ;;
  esac
}

release_manifest() { # 模式 仓库根目录；每行「sha256  相对路径」
  local mode=$1 root=${2:-} rel path sum
  while IFS=$'\t' read -r rel path; do
    if [[ ! -f $path ]]; then
      printf 'missing %s\n' "$rel" >&2
      return 1
    fi
    sum=$(file_sha256 "$path") || return 1
    printf '%s  %s\n' "$sum" "$rel"
  done < <(product_release_files "$mode" "$root")
}

release_manifest_sha256() { # 模式 仓库根目录
  local manifest
  manifest=$(release_manifest "$1" "${2:-}") || return 1
  printf '%s\n' "$manifest" | sha256_stream
}
