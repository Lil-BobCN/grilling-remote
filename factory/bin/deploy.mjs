#!/usr/bin/env node
/**
 * 部署、回滚和代码 zip 的命令行入口。
 *
 *   node factory/bin/deploy.mjs deploy --repo-dir <目录> --customer <客户简称> \
 *     --product <软件简称> --order <订单号> --version <版本> [--dry-run]
 *   node factory/bin/deploy.mjs rollback --address <交付地址>
 *   node factory/bin/deploy.mjs zip --repo-dir <目录> --ref <提交> --address <交付地址> --version <版本>
 *
 * 默认实现：
 *   - 构建：docker build --platform linux/amd64 -t <地址>:<版本>，再 docker save 成 tar；
 *   - 传：scp 到 AFK_SERVER（例如 dev@<服务器地址>）；
 *   - load / 部署 / 回滚：ssh 到服务器 sudo -n afk-product ...；
 *   - 健康：https://<地址>/，AFK_HEALTH_URL 可覆盖；
 *   - 邮件：ssh 到服务器 sudo -n afk-uploads send-delivery-mail ...；
 *   - 通知：factory/lib/notify.mjs。
 * 所有外部命令都能注入，测试不跑 Docker、SSH 和邮件。
 */
import { execFile } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import {
  buildCodeZip,
  deliveryAddress,
  deployProduct,
  publishCodeZip,
  rollbackProduct,
} from '../lib/deploy.mjs'
import { createNotifier } from '../lib/notify.mjs'

const execFileAsync = promisify(execFile)
const USAGE = `用法：
  node factory/bin/deploy.mjs deploy --repo-dir <目录> --customer <客户简称> --product <软件简称> --order <订单号> --version <版本> [--dry-run]
  node factory/bin/deploy.mjs rollback --address <交付地址>
  node factory/bin/deploy.mjs zip --repo-dir <目录> --ref <提交> --address <交付地址> --version <版本>`
const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

function tail(text, limit = 2000) {
  const value = String(text ?? '').trim()
  return value.length > limit ? value.slice(-limit) : value
}

function serverTarget() {
  const server = String(process.env.AFK_SERVER || '').trim()
  if (!server) throw new Error('缺 AFK_SERVER（例如 dev@<服务器地址>）')
  return server
}

function helperCommand() {
  if (process.env.AFK_HELPER?.trim()) return process.env.AFK_HELPER.trim().split(/\s+/)
  return ['ssh', serverTarget(), 'sudo', '-n', '/usr/local/sbin/afk-product']
}

function uploadsCommand() {
  if (process.env.AFK_UPLOADS_HELPER?.trim()) {
    return process.env.AFK_UPLOADS_HELPER.trim().split(/\s+/)
  }
  return ['ssh', serverTarget(), 'sudo', '-n', '/usr/local/sbin/afk-uploads']
}

async function run(command, args, options = {}) {
  const result = await execFileAsync(command, args, {
    maxBuffer: 64 * 1024 * 1024,
    timeout: 60 * 60 * 1000,
    ...options,
  }).catch((error) => {
    throw new Error(`${command} ${args[0] || ''} 失败：${tail(error.stderr || error.message)}`)
  })
  return String(result.stdout ?? '')
}

async function runHelper(args) {
  const [command, ...prefix] = helperCommand()
  return run(command, [...prefix, ...args])
}

async function dockerBuildImage({ repoDir, version, platform = 'linux/amd64', image }) {
  const tag = image || `afk-product:${version}`
  const docker = process.env.AFK_DOCKER || 'docker'
  const dir = await mkdtemp(join(tmpdir(), 'afk-deploy-image-'))
  const tar = join(dir, `${tag.replace(/[^A-Za-z0-9._-]+/g, '_')}.tar`)
  await run(docker, ['build', '--platform', platform, '-t', tag, repoDir])
  await run(docker, ['save', '-o', tar, tag])
  return { tar, image: tag }
}

async function scpTransfer({ tar, remote }) {
  await run('scp', [tar, `${serverTarget()}:${remote}`])
  return remote
}

async function sshLoadImage({ tar }) {
  const output = await runHelper(['product-load', tar])
  // load 成功就删服务器上的临时 tar；删不掉只算警告，不影响部署。
  if (!process.env.AFK_HELPER?.trim()) {
    await run('ssh', [serverTarget(), 'rm', '-f', tar]).catch(() => {})
  }
  return output
}

async function httpHealthCheck({ address }) {
  const url = process.env.AFK_HEALTH_URL || `https://${address}/`
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
  }).catch((error) => {
    throw new Error(`${url} 连不上：${errorText(error)}`)
  })
  if (!response.ok) throw new Error(`${url} 回 ${response.status}`)
  return true
}

async function sshSendDeliveryMail({ orderId, address, tries }) {
  const [command, ...prefix] = uploadsCommand()
  const args = [...prefix, 'send-delivery-mail', orderId, address]
  if (Array.isArray(tries) && tries.length) args.push('--tries', tries.join('；'))
  return run(command, args)
}

/** 默认实现的 deployProduct：Docker、SSH、HTTPS 和 notifier。 */
export async function deployWithDefaults({
  repoDir,
  customer,
  product,
  orderId,
  version,
  requirement,
  link,
  pr,
  tries,
  remote,
  notifier,
} = {}) {
  return deployProduct({
    repoDir,
    customer,
    product,
    orderId,
    version,
    requirement,
    link,
    pr,
    tries,
    remote,
    buildImage: dockerBuildImage,
    transfer: scpTransfer,
    loadImage: sshLoadImage,
    helper: runHelper,
    healthCheck: httpHealthCheck,
    sendDeliveryMail: sshSendDeliveryMail,
    notifier: notifier || createNotifier(),
  })
}

/** 默认实现的 rollbackProduct。 */
export async function rollbackWithDefaults({
  address,
  customer,
  requirement,
  orderId,
  link,
  notifier,
} = {}) {
  return rollbackProduct({
    address,
    customer,
    requirement,
    orderId,
    link,
    helper: runHelper,
    healthCheck: httpHealthCheck,
    notifier: notifier || createNotifier(),
  })
}

function parseArgs(argv) {
  const options = { dryRun: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--dry-run') {
      options.dryRun = true
      continue
    }
    if (!arg.startsWith('--')) throw new Error(`不认识的参数：${arg}`)
    const key = arg.slice(2)
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`${arg} 后面要跟值`)
    options[key] = value
    index += 1
  }
  return options
}

/**
 * @param {'deploy'|'rollback'|'zip'} command
 * @param {object} options `parseArgs` 的结果
 * @param {object} [deps] 测试注入 `deploy`、`rollback`、`buildCodeZip`、`publishCodeZip`、`transfer`
 */
export async function runDeploy(command, options, deps = {}) {
  if (command === 'deploy') {
    const repoDir = options['repo-dir'] || process.cwd()
    const { customer, product, order, version } = options
    if (!customer || !product || !order || !version) throw new Error(USAGE)
    if (!VERSION_RE.test(version)) throw new Error(`版本号只能用字母、数字、点、下划线和连字符：${version}`)
    const address = deliveryAddress({ customer, product })
    if (options.dryRun) {
      return {
        output: { dryRun: true, ok: true, address, image: `${address}:${version}`, order, version },
        exitCode: 0,
      }
    }
    const deploy = deps.deploy || deployWithDefaults
    const result = await deploy({ repoDir, customer, product, orderId: order, version })
    return { output: result, exitCode: result?.ok ? 0 : 1 }
  }

  if (command === 'rollback') {
    const { address } = options
    if (!address) throw new Error(USAGE)
    const rollback = deps.rollback || rollbackWithDefaults
    const result = await rollback({ address })
    return { output: result, exitCode: result?.ok ? 0 : 1 }
  }

  if (command === 'zip') {
    const repoDir = options['repo-dir'] || process.cwd()
    const { ref, address, version } = options
    if (!ref || !address || !version) throw new Error(USAGE)
    if (!VERSION_RE.test(version)) throw new Error(`版本号只能用字母、数字、点、下划线和连字符：${version}`)
    const outDir = await mkdtemp(join(tmpdir(), 'afk-deploy-zip-'))
    const zip = await (deps.buildCodeZip || buildCodeZip)({
      repoDir,
      ref,
      outDir,
      name: `${address}-${version}.zip`,
    })
    const url = await (deps.publishCodeZip || publishCodeZip)({
      zip,
      address,
      version,
      transfer: deps.transfer || scpTransfer,
    })
    return { output: { ok: true, zip, url }, exitCode: 0 }
  }

  throw new Error(USAGE)
}

async function main() {
  const [command, ...argv] = process.argv.slice(2)
  try {
    if (!['deploy', 'rollback', 'zip'].includes(command)) {
      process.stderr.write(`${USAGE}\n`)
      process.exitCode = 2
      return
    }
    const { output, exitCode } = await runDeploy(command, parseArgs(argv))
    process.stdout.write(`${JSON.stringify(output)}\n`)
    if (exitCode !== 0) process.exitCode = exitCode
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: errorText(error) })}\n`)
    process.exitCode = 2
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}

export { parseArgs }
