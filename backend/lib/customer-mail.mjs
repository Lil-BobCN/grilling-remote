/**
 * 给客户发的邮件。只有一封：校验未通过时，写清缺什么、怎么补和订单页链接。
 * 发送器可注入；默认调用 `backend/bin/customer-mail.py`，SMTP 配置从环境变量读。
 */
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('../bin/customer-mail.py', import.meta.url))
const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩']

function missingOf(order) {
  const list = order?.validation?.missing || order?.missing || []
  return Array.isArray(list) ? list.filter((item) => typeof item === 'string' && item.trim()) : []
}

function mark(index) {
  return CIRCLED[index] || `${index + 1}.`
}

export function renderValidationMail({ customer, order, siteBase = 'https://afkfactory.space' }) {
  const name = customer?.display_name || customer?.short_name || customer?.email || '客户'
  const title = order?.title || order?.requirement || '这次需求'
  const missing = missingOf(order)
  const link = `${String(siteBase).replace(/\/+$/, '')}/app/orders/${encodeURIComponent(order.id)}`

  const items = missing.map((text, index) => `${mark(index)}${text}`).join('\n')
  const body = [
    `${name} · ${title}：你传的包收到了，还差 ${missing.length || '几'} 样才齐：`,
    items || '回传包还差一些内容才齐，打开订单页看缺口。',
    `补好再传一次就行。缺口和进度看这里：${link}`,
  ].join('\n\n')

  return {
    to: customer?.email || '',
    subject: `${name} · ${title}：回传包还差几样`,
    body,
    link,
  }
}

export function sendWithPython(config, mail) {
  const python = config?.python || 'python3'
  return new Promise((resolve, reject) => {
    const child = execFile(
      python,
      [SCRIPT, '--to', mail.to, '--subject', mail.subject, '--body-stdin'],
      { timeout: 30000, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const reason = String(stderr || error.message || error).trim()
          reject(new Error(`客户邮件没发出去：${reason}`))
          return
        }
        resolve(String(stdout || '').trim())
      },
    )
    child.stdin.end(mail.body)
  })
}

export async function sendValidationMail({ config, customer, order, sender }) {
  const mail = renderValidationMail({ customer, order, siteBase: config?.siteBase })
  if (!mail.to) throw new Error(`订单 ${order?.id} 的客户没有邮箱，发不了校验未通过邮件`)
  const send = sender || ((message) => sendWithPython(config, message))
  await send(mail)
  return mail
}
