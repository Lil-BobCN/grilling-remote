#!/usr/bin/env node
/**
 * 导入失败后的重试入口。
 *
 *   node /data/app/current/bin/retry-import.mjs --order o-0004 [--operator 名字] [--reason 说明]
 *   node /data/app/current/bin/retry-import.mjs --upload upload-... [--operator 名字] [--reason 说明]
 *
 * 只把上传记录改回 `ready`，下一轮导入扫描会重新处理失败的单。
 * 操作者和时间写进上传 meta 的 `retries`，同时写 journal。输出一行 JSON。
 */
import { pathToFileURL } from 'node:url'
import { loadConfig } from '../lib/config.mjs'
import { retryImport } from '../lib/retry-import.mjs'

function option(argv, name) {
  const index = argv.indexOf(name)
  if (index === -1) return ''
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`缺 ${name} 的值`)
  return value
}

function usage() {
  console.error('用法：retry-import.mjs --order <订单号> | --upload <上传编号> [--operator 名字] [--reason 说明]')
}

export async function run(argv = process.argv.slice(2), { config = loadConfig(), out = console.log, now = new Date() } = {}) {
  const orderId = option(argv, '--order')
  const uploadId = option(argv, '--upload')
  if (!orderId && !uploadId) {
    usage()
    const error = new Error('要给 --order 或 --upload')
    error.exitCode = 2
    throw error
  }
  const operator = option(argv, '--operator') || process.env.AFK_OPERATOR || process.env.USER || ''
  const reason = option(argv, '--reason')
  const result = await retryImport({ config, orderId, uploadId, operator, reason, now })
  out(JSON.stringify(result))
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error(error.message)
    process.exitCode = error.exitCode || 1
  })
}
