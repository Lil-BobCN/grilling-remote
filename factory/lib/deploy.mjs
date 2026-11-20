/**
 * 成品部署的 Mac 侧编排：拼交付地址、构建 linux/amd64 镜像、传到源站、
 * 调 helper 部署和回滚、健康检查、发部署完成通知和待客户验收邮件、打代码 zip。
 *
 * 服务器上的活（目录、Compose、数据库、Caddy 路由、版本记录）全走
 * `afk-product` helper；这里只按顺序调，外部命令全部由调用方注入，测试不碰服务器。
 * 部署失败重试一次；两次都失败就保留上一版，发「出事」通知，不返回成功。
 */
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { eventKey } from '../../backend/lib/protocol.mjs'
import { git } from './git.mjs'
import { sendEvent } from './notify.mjs'

const execFileAsync = promisify(execFile)

const HOST_SUFFIX = 'afkfactory.space'
const ADDRESS_RE =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/
const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

/** 默认给客户试的三件事。具体到某个功能时由调用方传 tries 覆盖。 */
export const DEFAULT_DELIVERY_TRIES = [
  '打开地址，看首页能不能出来',
  '把这次要的功能走一遍，填一条真数据',
  '刷新页面，确认刚才填的还在',
]

function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

function slugPart(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  // 客户简称和软件简称都是小写英文或拼音；中文、标点拼不出地址，不猜。
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(raw)) return ''
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * 交付地址：<客户简称>-<软件简称>.afkfactory.space。
 * 地址只由客户和软件决定，同一软件的后续单拿到同一个地址；第二个软件另给一个。
 */
export function deliveryAddress({ customer, product } = {}) {
  const customerSlug = slugPart(customer)
  if (!customerSlug) {
    throw new Error('缺客户简称，或客户简称只能用字母、数字、空格、点、下划线、连字符')
  }
  const productSlug = slugPart(product)
  if (!productSlug) {
    throw new Error('缺软件简称，或软件简称只能用字母、数字、空格、点、下划线、连字符')
  }
  if (customerSlug.length > 63) throw new Error('客户简称太长，拼不出合法地址')
  if (productSlug.length > 63) throw new Error('软件简称太长，拼不出合法地址')
  if (customerSlug.length + productSlug.length + 1 > 63) {
    throw new Error('软件简称太长，和客户简称拼起来超过 63 个字符')
  }
  const address = `${customerSlug}-${productSlug}.${HOST_SUFFIX}`
  if (!ADDRESS_RE.test(address)) throw new Error(`交付地址格式不对：${address}`)
  return address
}

/**
 * 软件简称决定交付地址，只从显式参数或仓名 `<客户简称>-<软件简称>` 的后缀取。
 * 拼不出返回空串，调用方报错，不拿需求名顶替。
 */
export function productFromRepo({ repo, customer, explicit } = {}) {
  const given = String(explicit ?? '').trim()
  if (given) return given
  const name = String(repo ?? '').split('/').filter(Boolean).pop() || ''
  const prefix = customer ? `${customer}-` : ''
  if (prefix && name.startsWith(prefix) && name.length > prefix.length) {
    return name.slice(prefix.length)
  }
  return ''
}

function normalizeTries(tries) {
  const list = Array.isArray(tries) ? tries : []
  const cleaned = list.map((item) => String(item ?? '').trim()).filter(Boolean)
  if (cleaned.length === 0) return [...DEFAULT_DELIVERY_TRIES]
  if (cleaned.length < 2 || cleaned.length > 3) throw new Error('给客户试的事要 2 到 3 件')
  return cleaned
}

/** 共享健康判据：只有 HTTP 200 算健康。000、401、502 都不算。 */
export function healthy(code) {
  return code === 200 || code === '200'
}

function healthOk(result) {
  if (typeof result === 'number' || typeof result === 'string') return healthy(result)
  if (result === false || result === null || result === undefined) return false
  if (result && typeof result === 'object' && result.ok === false) return false
  return true
}

function deployKey(orderId, event, version) {
  return eventKey({ subject: orderId || '成品', event, scope: version })
}

/** 部署失败的「出事」通知。通知失败不影响已经做出的判断。 */
export async function notifyDeployFailure({
  notifier,
  key,
  customer,
  requirement,
  reason = '部署失败',
  tried,
  link = '',
  attempt = 1,
} = {}) {
  if (typeof notifier?.send !== 'function') return
  try {
    await sendEvent(notifier, {
      key: key || deployKey('', '出事', reason),
      event: '出事',
      now: new Date(),
      link,
      data: {
        customer: customer || '未知客户',
        requirement: requirement || '成品部署',
        reason,
        tried,
        attempt,
      },
    })
  } catch {
    // 通知失败不改变部署结果。
  }
}

async function notifyDeployDone({ notifier, key, customer, requirement, address, version, pr, link }) {
  if (typeof notifier?.send !== 'function') return
  try {
    await sendEvent(notifier, {
      key: key || deployKey('', '部署完成', version),
      event: '部署完成',
      now: new Date(),
      link,
      data: {
        customer,
        requirement,
        address,
        version,
        ...(pr ? { pr } : {}),
      },
    })
  } catch {
    // 已经部署好了，通知失败不回滚。
  }
}

function missingFunctions(names, fns) {
  return names.filter((name) => typeof fns[name] !== 'function')
}

/**
 * 部署一套成品。同一个交付地址重复部署只换镜像，不建第二套。
 *
 * 步骤：构建镜像 → 传 tar → 服务器 load → product-init（幂等，第一次会建目录、
 * 数据库和路由，已有的 .env 不动）→ product-deploy（换镜像，失败退回上一版）→ 健康检查。
 * 任何一步失败整套重跑一次；两次都失败发「出事」，返回 `{ok:false, reason:'部署失败', tried}`，不标已交付。
 */
export async function deployProduct({
  repoDir,
  customer,
  product,
  orderId,
  version,
  requirement = '',
  link = '',
  pr,
  tries,
  remote,
  buildImage,
  transfer,
  loadImage,
  helper,
  healthCheck,
  sendDeliveryMail,
  notifier,
} = {}) {
  let address
  try {
    address = deliveryAddress({ customer, product })
  } catch (error) {
    const tried = `交付地址拼不出来：${errorText(error)}`
    await notifyDeployFailure({
      notifier,
      key: deployKey(orderId, '出事', '部署失败'),
      customer,
      requirement: requirement || product,
      tried,
      link,
    })
    return { ok: false, reason: 'bad_address', tried, error: errorText(error) }
  }

  if (!repoDir) return { ok: false, reason: 'bad_input', missing: ['repoDir'] }
  if (!orderId) return { ok: false, reason: 'bad_input', missing: ['orderId'] }
  const textVersion = String(version ?? '')
  if (!VERSION_RE.test(textVersion)) {
    return { ok: false, reason: 'bad_input', missing: ['version'] }
  }
  const missing = missingFunctions(
    ['buildImage', 'transfer', 'loadImage', 'helper', 'healthCheck'],
    { buildImage, transfer, loadImage, helper, healthCheck },
  )
  if (missing.length) return { ok: false, reason: 'bad_input', missing }

  let deliveryTries
  try {
    deliveryTries = normalizeTries(tries)
  } catch (error) {
    return { ok: false, reason: 'bad_input', error: errorText(error) }
  }

  const image = `${address}:${textVersion}`
  const remoteTar = remote || `/tmp/afk-deploy-${address}-${textVersion}.tar`
  const requirementName = requirement || product
  // 应用自己的 env 契约放在仓库根 .env.example；有就传给服务器 product-init，
  // 没有（旧仓）就用 helper 自带的模板契约。
  const envExample = join(repoDir, '.env.example')
  const hasEnvExample = await readFile(envExample).then(
    () => true,
    () => false,
  )
  const failures = []

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const built = await buildImage({
        repoDir,
        version: textVersion,
        platform: 'linux/amd64',
        image,
        address,
      })
      const tar = typeof built === 'string' ? built : built?.tar
      const builtImage = (built && typeof built === 'object' && built.image) || image
      if (!tar) throw new Error('buildImage 没返回镜像 tar')

      const uploaded = await transfer({ tar, remote: remoteTar })
      const serverTar = uploaded || remoteTar
      await loadImage({ tar: serverTar, image: builtImage, address, version: textVersion })

      // product-init 幂等：第一次建目录、数据库和 Caddy 路由；已有的 .env 不动，
      // 换镜像和失败恢复都交给 product-deploy。
      const initArgs = ['product-init', address, '--image', builtImage]
      if (hasEnvExample) {
        const remoteEnvExample = `/tmp/afk-env-example-${address}.example`
        await transfer({ tar: envExample, remote: remoteEnvExample })
        initArgs.push('--env-example', remoteEnvExample)
      }
      await helper(initArgs)
      await helper(['product-deploy', address, '--image', builtImage])

      const healthResult = await healthCheck({ address })
      if (!healthOk(healthResult)) throw new Error(`健康检查没过：https://${address}/`)

      await notifyDeployDone({
        notifier,
        key: deployKey(orderId, '部署完成', textVersion),
        customer,
        requirement: requirementName,
        address,
        version: textVersion,
        pr,
        link,
      })

      let warning = ''
      if (typeof sendDeliveryMail === 'function') {
        try {
          await sendDeliveryMail({ orderId, address, tries: deliveryTries })
        } catch (error) {
          warning = `客户邮件没发出去：${errorText(error)}`
        }
      }

      return {
        ok: true,
        address,
        version: textVersion,
        image: builtImage,
        ...(warning ? { warning } : {}),
      }
    } catch (error) {
      failures.push(`第 ${attempt} 次：${errorText(error)}`)
    }
  }

  const tried = failures.join('；')
  await notifyDeployFailure({
    notifier,
    key: deployKey(orderId, '出事', '部署失败'),
    customer,
    requirement: requirementName,
    tried,
    link,
    attempt: 2,
  })
  return { ok: false, reason: '部署失败', tried, address, version: textVersion, attempts: 2 }
}

/**
 * 回滚一条命令：helper 切回上一版并重启，跑同一组健康检查。
 * 失败发「出事」通知，成功不另发事件。
 */
export async function rollbackProduct({
  address,
  helper,
  healthCheck,
  notifier,
  customer = '',
  requirement = '回滚',
  orderId = '',
  link = '',
} = {}) {
  if (!address) return { ok: false, reason: 'bad_input', missing: ['address'] }
  if (!ADDRESS_RE.test(String(address))) {
    return { ok: false, reason: 'bad_address', error: `交付地址格式不对：${address}` }
  }
  const missing = missingFunctions(['helper', 'healthCheck'], { helper, healthCheck })
  if (missing.length) return { ok: false, reason: 'bad_input', missing }

  let stage = 'product-rollback'
  try {
    await helper(['product-rollback', address])
    stage = '回滚后健康检查'
    const healthResult = await healthCheck({ address })
    if (!healthOk(healthResult)) throw new Error(`健康检查没过：https://${address}/`)
    return { ok: true, address }
  } catch (error) {
    const tried = `${stage}：${errorText(error)}`
    await notifyDeployFailure({
      notifier,
      key: deployKey(orderId || address, '出事', '回滚失败'),
      customer: customer || address,
      requirement,
      reason: '回滚失败',
      tried,
      link,
    })
    return { ok: false, address, reason: '回滚失败', tried }
  }
}

/**
 * 构建一个 linux/amd64 镜像。`ref` 给了就从那个提交的临时 worktree 构建，
 * 不给就用当前工作树。工作树用完就删，不留在仓库里。
 *
 * `run(command, args, options)` 可注入，测试不跑 Docker。
 */
export async function buildDockerImage({
  repoDir,
  ref = '',
  image,
  platform = 'linux/amd64',
  docker = process.env.AFK_DOCKER || 'docker',
  run,
} = {}) {
  if (!repoDir || !image) throw new Error('buildDockerImage 缺 repoDir 或 image')
  const execute =
    run ||
    (async (command, args) => {
      const result = await execFileAsync(command, args, {
        maxBuffer: 64 * 1024 * 1024,
        timeout: 60 * 60 * 1000,
      }).catch((error) => {
        throw new Error(`${command} ${args[0] || ''} 失败：${String(error.stderr || error.message).trim()}`)
      })
      return String(result.stdout ?? '')
    })

  let context = repoDir
  let worktree = ''
  if (ref) {
    worktree = await mkdtemp(join(tmpdir(), 'afk-image-src-'))
    await rm(worktree, { recursive: true, force: true })
    await git(repoDir, ['worktree', 'add', '--detach', worktree, ref], { timeoutMs: 120000 })
    context = worktree
  }
  try {
    await execute(docker, ['build', '--platform', platform, '-t', image, context])
  } finally {
    if (worktree) {
      await git(repoDir, ['worktree', 'remove', '--force', worktree]).catch(() => {})
      await rm(worktree, { recursive: true, force: true }).catch(() => {})
    }
  }
  return image
}

/** 从仓库某个提交打一个代码 zip，给默认交付地址配套。 */
export async function buildCodeZip({ repoDir, ref, outDir, name } = {}) {
  if (!repoDir || !ref || !outDir) throw new Error('buildCodeZip 缺 repoDir、ref 或 outDir')
  await mkdir(outDir, { recursive: true })
  const base = name || `code-${slugPart(ref) || 'archive'}.zip`
  const zip = join(outDir, base.endsWith('.zip') ? base : `${base}.zip`)
  await git(repoDir, ['archive', '--format=zip', `--output=${zip}`, ref])
  return zip
}

/** 把代码 zip 传到服务器的下载目录，返回客户能点的 URL。 */
export async function publishCodeZip({ zip, address, version, transfer } = {}) {
  if (!zip || !address || !version) throw new Error('publishCodeZip 缺 zip、address 或 version')
  if (!ADDRESS_RE.test(String(address))) throw new Error(`交付地址格式不对：${address}`)
  if (!VERSION_RE.test(String(version))) throw new Error(`版本号只能用字母、数字、点、下划线和连字符：${version}`)
  if (typeof transfer !== 'function') throw new Error('publishCodeZip 缺 transfer')
  const file = `${address}-${version}.zip`
  const target = `/data/www/downloads/${file}`
  await transfer({ tar: zip, remote: target })
  return `https://afkfactory.space/downloads/${file}`
}
