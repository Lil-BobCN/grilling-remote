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
 *   NOTIFIER_COMMAND  有 operator_alert 时调的通知命令，默认 `python3 -m notifier send`
 *   SITE_BASE         通知里的链接前缀，默认 https://afkfactory.space
 *
 * 每轮还会把服务器 `/data/customers/customers.json` 同步到本机，给调度器读。
 * 拉取失败保留上一份并记 warning。
 *
 * 服务器上跑 `sudo -n afk-uploads ...`；helper 和 sudoers 由
 * deploy/backend/install.sh 装好，不开放任意路径。
 * 脚本只在本地副本完整并且 `meta.status === 'imported'` 时删远端目录。
 */
import { randomUUID } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createSshRemote, pullInbox } from '../lib/inbox.mjs'
import { logLine } from '../lib/log.mjs'

function option(name, fallback) {
  const index = process.argv.indexOf(name)
  if (index === -1) return fallback
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`缺 ${name} 的值`)
  return value
}

function notifierEvent({ meta, alert }) {
  const requirement =
    (Array.isArray(meta.requirements) ? meta.requirements.map((item) => item.name).filter(Boolean).join('、') : '') ||
    meta.id
  const siteBase = (process.env.SITE_BASE || 'https://afkfactory.space').replace(/\/+$/, '')
  return {
    v: 1,
    key: `inbox:${meta.id}:${alert.at || ''}:${alert.reason || ''}`,
    event: '出事',
    occurred_at: alert.at || new Date().toISOString(),
    link: `${siteBase}/app/admin`,
    data: {
      customer: meta.user?.short_name || '客户',
      requirement,
      reason: alert.reason || '回传导入',
      tried: alert.message || '导入步骤报错，详情看服务器日志',
    },
  }
}

function runNotifier(commandLine, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(commandLine, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolveRun()
      else reject(new Error(`通知命令退出码 ${code}：${stderr.trim()}`))
    })
  })
}

async function notifyOperator({ meta, alert }) {
  const event = notifierEvent({ meta, alert })
  const file = join(tmpdir(), `afk-notify-${randomUUID()}.json`)
  await writeFile(file, `${JSON.stringify(event, null, 2)}\n`, 'utf8')
  try {
    const commandLine = process.env.NOTIFIER_COMMAND || 'python3'
    const args =
      commandLine === 'python3' ? ['-m', 'notifier', 'send', '--event-file', file] : ['--event-file', file]
    await runNotifier(commandLine, args)
  } finally {
    await rm(file, { force: true })
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

  const result = await pullInbox({ remote, inboxDir, customersPath, notify: notifyOperator })
  logLine({
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
