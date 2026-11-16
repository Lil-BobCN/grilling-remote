#!/usr/bin/env node
/**
 * 预览环境的命令行入口。运营者和调度器手工排查时用。
 *
 *   node factory/bin/preview.mjs start --address <地址> --image <镜像:tag> [--seed <命令>] [--commit-at <ISO 时间>]
 *   node factory/bin/preview.mjs stop --address <地址>
 *   node factory/bin/preview.mjs sweep --once
 *
 * 默认调本机 PATH 里的 afk-product。跨机器时：
 *   AFK_HELPER='/usr/local/sbin/afk-product'         直接指定 helper（可以带前缀参数，空格分隔）
 *   AFK_SSH_TARGET='dev@<服务器>'                    ssh 到服务器跑 sudo afk-product
 * Mac 侧凭据默认写 private/预览/<地址>.env，用 AFK_LOCAL_PREVIEW_DIR 覆盖。
 *
 * 输出一行 JSON，方便脚本读。
 */

import { chmod, mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runHelper } from '../lib/helper.mjs'
import { parsePreviewInfo } from '../lib/preview.mjs'

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const USAGE = `用法：
  node factory/bin/preview.mjs start --address <地址> --image <镜像:tag> [--seed <命令>] [--commit-at <ISO 时间>]
  node factory/bin/preview.mjs stop --address <地址>
  node factory/bin/preview.mjs sweep --once`

function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

function parseOptions(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) throw new Error(`不认识的参数：${arg}`)
    const key = arg.slice(2)
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`${arg} 后面要跟值`)
    options[key] = value
    index += 1
  }
  return options
}

export function localPreviewDir() {
  return process.env.AFK_LOCAL_PREVIEW_DIR || join(REPO_ROOT, 'private', '预览')
}

export async function writeLocalPreviewEnv({ dir, address, info }) {
  await mkdir(dir, { recursive: true })
  const path = join(dir, `${address}.env`)
  const body = [
    `ADDRESS=${address}`,
    `URL=https://${address}/`,
    `BASIC_AUTH_USER=${info.user}`,
    `BASIC_AUTH_PASSWORD=${info.password}`,
    `SERVER_ENV=${info.env}`,
    '',
  ].join('\n')
  await writeFile(path, body, { mode: 0o600 })
  await chmod(path, 0o600)
  return path
}

async function cmdStart(argv) {
  const options = parseOptions(argv)
  if (!options.address || !options.image) throw new Error(USAGE)
  if (!/^[a-z0-9][a-z0-9.-]*\.[a-z0-9-]+$/.test(options.address)) {
    throw new Error(`地址格式不对：${options.address}`)
  }
  const args = ['preview-start', options.address, options.image]
  if (options.seed) args.push('--seed', options.seed)
  if (options['commit-at']) args.push('--commit-at', options['commit-at'])

  const stdout = await runHelper(args)
  const info = parsePreviewInfo(stdout)
  if (!info.user || !info.password || !info.env) {
    throw new Error('helper 输出里缺 Basic Auth 用户名、密码或服务器 .env 路径')
  }
  const credentialsFile = await writeLocalPreviewEnv({
    dir: localPreviewDir(),
    address: options.address,
    info,
  })
  return {
    ok: true,
    address: options.address,
    url: `https://${options.address}/`,
    user: info.user,
    password: info.password,
    database: info.db,
    serverEnv: info.env,
    credentialsFile,
  }
}

async function cmdStop(argv) {
  const options = parseOptions(argv)
  if (!options.address) throw new Error(USAGE)
  await runHelper(['preview-stop', options.address])
  const credentialsFile = join(localPreviewDir(), `${options.address}.env`)
  let removed = false
  try {
    await rm(credentialsFile)
    removed = true
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  return { ok: true, address: options.address, credentialsRemoved: removed }
}

async function cmdSweep(argv) {
  if (argv.length !== 1 || argv[0] !== '--once') throw new Error(USAGE)
  const output = await runHelper(['preview-sweep'])
  return { ok: true, output: output.trim() }
}

async function main() {
  const [command, ...argv] = process.argv.slice(2)
  try {
    let result
    if (command === 'start') result = await cmdStart(argv)
    else if (command === 'stop') result = await cmdStop(argv)
    else if (command === 'sweep') result = await cmdSweep(argv)
    else {
      process.stderr.write(`${USAGE}\n`)
      process.exitCode = 2
      return
    }
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: errorText(error) })}\n`)
    process.exitCode = 1
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}
