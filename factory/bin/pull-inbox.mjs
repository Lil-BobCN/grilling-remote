#!/usr/bin/env node
/**
 * 从服务器拉回传件到运营者 Mac 的 `inbox/`。
 *
 * 用法（在仓库根跑）：
 *
 *   AFK_SERVER=dev@<服务器地址> node factory/bin/pull-inbox.mjs [--inbox <目录>]
 *
 * 可选环境变量：
 *   AFK_SSH_KEY       ssh -i 的私钥路径
 *   AFK_UPLOADS_HELPER 服务器上的 helper 路径，默认 /usr/local/sbin/afk-uploads
 *   AFK_INBOX         本地存档目录，默认当前目录下的 inbox
 *   AFK_CUSTOMERS_FILE 本机 customers.json 路径，默认 inbox 的上一层
 *   NOTIFIER_COMMAND  通知命令，默认 python3
 *   NOTIFIER_HOME     通知模块的运行目录，默认 ~/.grilling/notifier
 *   SITE_BASE         通知里的链接前缀，默认 https://afkfactory.space
 *
 * 每轮还会把服务器 `/data/customers/customers.json` 同步到本机，给调度器读。
 * 拉取失败保留上一份并记 warning。
 *
 * 服务器上跑 `sudo -n afk-uploads ...`；helper 和 sudoers 由
 * deploy/backend/install.sh 装好，不开放任意路径。
 * 脚本只在本地副本完整并且 `meta.status === 'imported'` 时删远端目录。
 */
import { dirname, join, resolve } from 'node:path'
import { createSshRemote, importEvent, pullInbox } from '../lib/inbox.mjs'
import { logLine } from '../lib/log.mjs'
import { createNotifier } from '../lib/notify.mjs'

function option(name, fallback) {
  const index = process.argv.indexOf(name)
  if (index === -1) return fallback
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`缺 ${name} 的值`)
  return value
}

function notifyOperator(notifier) {
  return async function sendImportEvent({ meta, alert }) {
    const siteBase = (process.env.SITE_BASE || 'https://afkfactory.space').replace(/\/+$/, '')
    const event = importEvent({ meta, alert, link: `${siteBase}/app/admin` })
    const result = await notifier.send(event)
    if (!result || result.code !== 0) {
      throw new Error(`通知命令退出码 ${result?.code ?? '?'}：${String(result?.stdout || '').trim()}`)
    }
  }
}

async function main() {
  const server = process.env.AFK_SERVER
  if (!server) {
    console.error('先设 AFK_SERVER，例如 AFK_SERVER=dev@1.2.3.4')
    process.exit(2)
  }
  const inboxDir = resolve(option('--inbox', process.env.AFK_INBOX || 'inbox'))
  const customersPath = resolve(
    option('--customers', process.env.AFK_CUSTOMERS_FILE || join(dirname(inboxDir), 'customers.json')),
  )
  const remote = createSshRemote({
    server,
    key: process.env.AFK_SSH_KEY || '',
    helper: process.env.AFK_UPLOADS_HELPER || '/usr/local/sbin/afk-uploads',
  })
  const notifier = createNotifier({
    command: process.env.NOTIFIER_COMMAND || 'python3',
    home: process.env.NOTIFIER_HOME,
  })

  const result = await pullInbox({
    remote,
    inboxDir,
    customersPath,
    notify: notifyOperator(notifier),
  })
  logLine({
    level: 'info',
    msg: '回传件拉取结束',
    inbox: inboxDir,
    customers: result.customers,
    pulled: result.pulled,
    removed: result.removed,
    notified: result.notified,
  })
}

main().catch((error) => {
  logLine({ level: 'error', msg: '回传件拉取失败', error: String(error && error.message ? error.message : error) })
  process.exit(1)
})
