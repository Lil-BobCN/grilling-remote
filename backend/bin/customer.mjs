#!/usr/bin/env node
/**
 * 客户白名单命令行。命令和字段按 docs/客户白名单维护.md 第九节。
 *
 * 用 afkapp 用户跑：
 *   sudo -u afkapp node /data/app/current/bin/customer.mjs add --short-name acme ...
 */

import { join, resolve } from 'node:path'
import { hashPassword } from '../lib/auth.mjs'
import { gitSync, readJson, withFileLock, writeJsonAtomic } from '../lib/store.mjs'

const dataDir = resolve(process.env.DATA_DIR || '/data/customers')
const file = join(dataDir, 'customers.json')

function usage() {
  console.error(`用法：
  customer.mjs add --short-name <简称> --display-name <称呼> --email <邮箱> [--wechat <微信>] [--note <备注>] [--password-stdin]
  customer.mjs list
  customer.mjs show <id|邮箱>
  customer.mjs disable <id|邮箱> --reason <原因>
  customer.mjs enable <id|邮箱>
  customer.mjs change-email <id|邮箱> <新邮箱>
  customer.mjs reset-password <id|邮箱> [--password-stdin]`)
}

function parseArgs(argv) {
  const positionals = []
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (item.startsWith('--')) {
      const name = item.slice(2)
      if (name === 'password-stdin') {
        options[name] = true
        continue
      }
      const value = argv[index + 1]
      if (value === undefined) throw new Error(`缺少 ${item} 的值`)
      options[name] = value
      index += 1
    } else {
      positionals.push(item)
    }
  }
  return { positionals, options }
}

async function readSecret(prompt) {
  if (!process.stdin.isTTY) {
    const text = await readAllStdin()
    return text.split('\n')[0]
  }

  process.stdout.write(prompt)
  return new Promise((done) => {
    const stdin = process.stdin
    stdin.setRawMode(true)
    stdin.setEncoding('utf8')
    stdin.resume()
    let value = ''

    const finish = () => {
      stdin.setRawMode(false)
      stdin.pause()
      stdin.off('data', onData)
      process.stdout.write('\n')
      done(value)
    }

    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          finish()
          return
        }
        if (char === '\u0003') {
          stdin.setRawMode(false)
          process.stdout.write('\n')
          process.exit(130)
        }
        if (char === '\u007f' || char === '\b') {
          value = value.slice(0, -1)
          continue
        }
        value += char
      }
    }

    stdin.on('data', onData)
  })
}

function readAllStdin() {
  return new Promise((done, fail) => {
    const chunks = []
    process.stdin.on('data', (chunk) => chunks.push(chunk))
    process.stdin.on('end', () => done(Buffer.concat(chunks).toString('utf8')))
    process.stdin.on('error', fail)
  })
}

async function promptPassword(options) {
  if (options['password-stdin']) {
    const value = await readSecret('')
    if (!value) throw new Error('密码是空的')
    return value
  }
  const first = await readSecret('初始密码：')
  const second = await readSecret('再输一遍：')
  if (first !== second) throw new Error('两次输入不一致')
  if (!first) throw new Error('密码是空的')
  return first
}

function rowsOf(value) {
  if (Array.isArray(value)) return value
  if (value && Array.isArray(value.customers)) return value.customers
  return []
}

function now() {
  return new Date().toISOString()
}

function findRow(rows, key) {
  const target = String(key || '').trim()
  if (!target) return null
  return (
    rows.find((row) => row.id === target) ||
    rows.find((row) => String(row.email || '').toLowerCase() === target.toLowerCase()) ||
    null
  )
}

function checkShortName(value) {
  if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(value || '')) {
    throw new Error('简称只能用小写英文、数字和连字符，2 到 31 位')
  }
}

function checkEmail(value) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value || '')) throw new Error('邮箱格式不对')
}

function nextId(rows) {
  let max = 0
  for (const row of rows) {
    const match = /^c-(\d+)$/.exec(row.id || '')
    if (match) max = Math.max(max, Number(match[1]))
  }
  return `c-${String(max + 1).padStart(4, '0')}`
}

async function save(rows, message) {
  await writeJsonAtomic(file, rows)
  const sync = await gitSync(dataDir, message, {
    enabled: process.env.AFK_GIT_SYNC !== '0',
    timeoutMs: 15000,
  })
  if (sync.error) console.error(`写入成功，但同步到私有仓失败：${sync.error}`)
}

async function lockAndLoad(fn) {
  return withFileLock(join(dataDir, '.customers.lock'), async () => {
    const rows = rowsOf(await readJson(file, []))
    return fn(rows)
  })
}

function publicRow(row) {
  const { password_hash: ignored, ...rest } = row
  return rest
}

async function main() {
  const argv = process.argv.slice(2)
  if (argv.length === 0) {
    usage()
    process.exit(1)
  }

  const { positionals, options } = parseArgs(argv)
  const command = positionals[0]

  if (command === 'add') {
    const shortName = String(options['short-name'] || '').trim()
    const displayName = String(options['display-name'] || '').trim()
    const email = String(options.email || '').trim().toLowerCase()
    checkShortName(shortName)
    checkEmail(email)
    if (!displayName) throw new Error('缺少 --display-name')

    const password = await promptPassword(options)
    if (password.length < 8) throw new Error('密码至少 8 位')
    const passwordHash = await hashPassword(password)

    const id = await lockAndLoad(async (rows) => {
      if (rows.some((row) => row.short_name === shortName)) throw new Error(`简称已被占用：${shortName}`)
      if (rows.some((row) => String(row.email || '').toLowerCase() === email)) {
        throw new Error(`邮箱已存在：${email}`)
      }
      const stamp = now()
      const row = {
        id: nextId(rows),
        short_name: shortName,
        display_name: displayName,
        email,
        status: 'active',
        repos: {},
        wechat: options.wechat || '',
        note: options.note || '',
        password_hash: passwordHash,
        created_at: stamp,
        updated_at: stamp,
        disabled_at: null,
        disabled_reason: null,
      }
      rows.push(row)
      await save(rows, `客户：新增 ${row.id} ${shortName}`)
      return row.id
    })

    console.log(id)
    return
  }

  if (command === 'list') {
    const rows = rowsOf(await readJson(file, []))
    for (const row of rows) {
      console.log(
        [row.id, row.short_name, row.display_name, row.email, row.status, Object.values(row.repos || {}).join(',')].join('\t'),
      )
    }
    return
  }

  if (command === 'show') {
    const rows = rowsOf(await readJson(file, []))
    const row = findRow(rows, positionals[1])
    if (!row) throw new Error('找不到这个客户')
    console.log(JSON.stringify(publicRow(row), null, 2))
    return
  }

  if (command === 'disable') {
    const reason = String(options.reason || '').trim()
    if (!reason) throw new Error('缺少 --reason')
    await lockAndLoad(async (rows) => {
      const row = findRow(rows, positionals[1])
      if (!row) throw new Error('找不到这个客户')
      row.status = 'disabled'
      row.disabled_at = now()
      row.disabled_reason = reason
      row.updated_at = now()
      await save(rows, `客户：停用 ${row.id}`)
    })
    return
  }

  if (command === 'enable') {
    await lockAndLoad(async (rows) => {
      const row = findRow(rows, positionals[1])
      if (!row) throw new Error('找不到这个客户')
      row.status = 'active'
      row.disabled_at = null
      row.disabled_reason = null
      row.updated_at = now()
      await save(rows, `客户：启用 ${row.id}`)
    })
    return
  }

  if (command === 'change-email') {
    const next = String(positionals[2] || '').trim().toLowerCase()
    checkEmail(next)
    await lockAndLoad(async (rows) => {
      const row = findRow(rows, positionals[1])
      if (!row) throw new Error('找不到这个客户')
      if (rows.some((item) => item !== row && String(item.email || '').toLowerCase() === next)) {
        throw new Error(`邮箱已存在：${next}`)
      }
      row.email = next
      row.updated_at = now()
      await save(rows, `客户：换邮箱 ${row.id}`)
    })
    return
  }

  if (command === 'reset-password') {
    const password = await promptPassword(options)
    if (password.length < 8) throw new Error('密码至少 8 位')
    const passwordHash = await hashPassword(password)
    await lockAndLoad(async (rows) => {
      const row = findRow(rows, positionals[1])
      if (!row) throw new Error('找不到这个客户')
      row.password_hash = passwordHash
      row.updated_at = now()
      await save(rows, `客户：重设密码 ${row.id}`)
    })
    return
  }

  usage()
  process.exit(1)
}

main().catch((error) => {
  console.error(error.message || error)
  process.exit(1)
})
