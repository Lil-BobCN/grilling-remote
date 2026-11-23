import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 健康检查的版本：发布包根有 release.json 就跟着发布走，旧包回退到 package.json。
 * release.json 缺失、不是合法 JSON 或没有字符串 version 时回退。
 * package.json 也读不到就抛，包不完整时别假装健康。
 */
export function readVersion(dir) {
  if (!dir) throw new Error('readVersion 需要 dir')
  let release = null
  try {
    release = JSON.parse(readFileSync(join(dir, 'release.json'), 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) {
      throw new Error(`release.json 读不了（${join(dir, 'release.json')}）：${error.message}`)
    }
  }
  if (typeof release?.version === 'string' && release.version.trim()) {
    return release.version.trim()
  }

  const pkgPath = join(dir, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  if (typeof pkg?.version !== 'string' || !pkg.version.trim()) {
    throw new Error(`package.json 没有 version（${pkgPath}）`)
  }
  return pkg.version.trim()
}
