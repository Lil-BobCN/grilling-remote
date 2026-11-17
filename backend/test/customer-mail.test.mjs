import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { renderValidationMail, sendValidationMail } from '../lib/customer-mail.mjs'

function runWithInput(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args)
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(`退出码 ${code}：${stderr}`))
    })
    child.stdin.end(input)
  })
}

const CUSTOMER = {
  id: 'c-0001',
  short_name: 'acme',
  display_name: 'Acme 老板',
  email: 'boss@example.com',
}

const ORDER = {
  id: 'o-0001',
  title: '预约取货',
  requirement: 'demo',
  missing: ['缺验收场景。让 agent 按已经定下的内容起草验收场景。', '还有票没做完：01.md。'],
  validation: {
    passed: false,
    missing: ['缺验收场景。让 agent 按已经定下的内容起草验收场景。', '还有票没做完：01.md。'],
  },
}

test('校验未通过邮件写清缺什么、怎么补和订单页链接', () => {
  const mail = renderValidationMail({
    customer: CUSTOMER,
    order: ORDER,
    siteBase: 'https://afkfactory.space',
  })

  assert.equal(mail.to, 'boss@example.com')
  assert.match(mail.subject, /Acme 老板/)
  assert.match(mail.subject, /预约取货/)
  assert.match(mail.body, /缺验收场景/)
  assert.match(mail.body, /还有票没做完/)
  assert.match(mail.body, /补好再传一次/)
  assert.match(mail.body, /https:\/\/afkfactory\.space\/app\/orders\/o-0001/)
})

test('发送器可注入，发送内容就是渲染结果', async () => {
  const sent = []
  const mail = await sendValidationMail({
    config: { siteBase: 'https://example.test' },
    customer: CUSTOMER,
    order: ORDER,
    sender: async (message) => sent.push(message),
  })

  assert.equal(sent.length, 1)
  assert.deepEqual(sent[0], mail)
  assert.match(mail.body, /https:\/\/example\.test\/app\/orders\/o-0001/)
})

test('customer-mail.py --dry-run 打印收件人、主题和正文', async () => {
  const script = fileURLToPath(new URL('../bin/customer-mail.py', import.meta.url))
  const stdout = await runWithInput(
    'python3',
    [script, '--dry-run', '--to', 'boss@example.com', '--subject', '测试主题', '--body-stdin'],
    '邮件正文\n',
  )
  assert.match(stdout, /To: boss@example\.com/)
  assert.match(stdout, /Subject: 测试主题/)
  assert.match(stdout, /邮件正文/)
})
