#!/usr/bin/env node
/**
 * 回传导入命令行。systemd timer 每 30 秒跑一次：
 *
 *   node /data/app/current/bin/import.mjs --once
 *
 * 环境变量：
 *   GITHUB_ADMIN_TOKEN  建仓、建单、推分支用；和只读的 GITHUB_TOKEN 分开
 *   GITHUB_OWNER        客户仓建在哪个账号下
 *   GITHUB_API          默认 https://api.github.com，测试时指向假服务
 *   DATA_DIR / UPLOAD_DIR  和上传服务用同一份
 */
import { loadConfig } from '../lib/config.mjs'
import { importOnce } from '../lib/import.mjs'
import { logLine } from '../lib/log.mjs'

function usage() {
  console.error('用法：import.mjs --once')
}

async function main() {
  const args = process.argv.slice(2)
  if (!args.includes('--once')) {
    usage()
    process.exit(2)
  }

  const config = loadConfig()
  const now = new Date()
  const missing = []
  if (!config.githubAdminToken) missing.push('GITHUB_ADMIN_TOKEN')
  if (!config.githubOwner) missing.push('GITHUB_OWNER')
  if (missing.length) {
    logLine({
      ts: now.toISOString(),
      level: 'error',
      msg: '回传导入没跑：缺环境变量',
      missing,
    })
    process.exit(1)
  }

  const result = await importOnce({ config, now })
  logLine({
    ts: now.toISOString(),
    level: 'info',
    msg: '回传导入一轮结束',
    uploads: result.uploads,
    ...(result.skipped ? { skipped: result.skipped } : {}),
  })
}

main().catch((error) => {
  logLine({
    ts: new Date().toISOString(),
    level: 'error',
    msg: '回传导入命令出错',
    error: String(error && error.message ? error.message : error),
  })
  process.exit(1)
})
