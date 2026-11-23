import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 健康检查的版本：发布包根有 release.json 就跟着发布走，旧包回退到 package.json。
 * 两个都读不到或坏了都不抛，返回 package.json 的版本或空串，健康检查照常应答。
 */
export function readVersion({ dir, readFile = readFileSync } = {}) {
  if (!dir) throw new Error('readVersion 需要 dir')
  try {
    const release = JSON.parse(readFile(join(dir, 'release.json'), 'utf8'))
    if (release?.version) return String(release.version)
  } catch {
    // 旧发布包没有 release.json，按 package.json 走。
  }
  const pkg = JSON.parse(readFile(join(dir, 'package.json'), 'utf8'))
  return String(pkg?.version || '')
}
