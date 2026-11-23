import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 健康检查的版本：发布包根有 release.json 就跟着发布走，旧包（没有这个文件）回退到 package.json。
 * release.json 存在但坏了或没有字符串 version，说明包不完整，直接抛错，不假装健康。
 */
export function readVersion(dir) {
  if (!dir) throw new Error('readVersion 需要 dir')
  const releasePath = join(dir, 'release.json')
  let text = null
  try {
    text = readFileSync(releasePath, 'utf8')
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw new Error(`release.json 读不了（${releasePath}）：${error.message}`)
    }
  }
  if (text !== null) {
    let release
    try {
      release = JSON.parse(text)
    } catch (error) {
      throw new Error(`release.json 不是合法 JSON（${releasePath}）：${error.message}`)
    }
    if (typeof release?.version !== 'string' || !release.version.trim()) {
      throw new Error(`release.json 没有 version（${releasePath}）`)
    }
    return release.version.trim()
  }

  const pkgPath = join(dir, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  if (typeof pkg?.version !== 'string' || !pkg.version.trim()) {
    throw new Error(`package.json 没有 version（${pkgPath}）`)
  }
  return pkg.version.trim()
}
