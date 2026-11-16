/**
 * 按 PR 起停预览的 Mac 侧编排。
 *
 * 服务器上的活（目录、Compose、数据库、Caddy 路由、Basic Auth）全走
 * `afk-product` helper；这里只拼地址、调 helper、写 Mac 侧凭据文件、判断该不该销毁。
 * 外部命令全部由调用方注入，测试不碰服务器。
 */

function slugPart(value) {
  const slug = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug
}

function prNumber(pr) {
  const raw = pr && typeof pr === 'object' ? pr.number : pr
  const text = String(raw ?? '').trim()
  return /^\d+$/.test(text) ? text : ''
}

/** 预览地址的主机名：<客户简称>-<软件简称>-pr<PR号>.afkfactory.space */
export function previewAddress({ customer, product, pr }) {
  const customerSlug = slugPart(customer)
  if (!customerSlug) throw new Error('缺客户简称，拼不出预览地址')
  const productSlug = slugPart(product)
  if (!productSlug) throw new Error('缺软件简称，拼不出预览地址')
  const number = prNumber(pr)
  if (!number) throw new Error('缺 PR 号或不是数字，拼不出预览地址')
  return `${customerSlug}-${productSlug}-pr${number}.afkfactory.space`
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

/** 认 helper 打印的 AFK_PREVIEW key=value 行，人看的说明行忽略。 */
export function parsePreviewInfo(stdout) {
  const info = {}
  for (const line of String(stdout ?? '').split(/\r?\n/)) {
    const match = line.match(/^AFK_PREVIEW ([a-z_]+)=(.*)$/)
    if (match) info[match[1]] = match[2]
  }
  return info
}

/**
 * 从 `.audit/<票号>.tsv` 判断这张票要不要预览。
 * 约定：phase=preview 且 result=required 表示要；没有这一行就不建。
 * trail 传文件内容；没有文件就传空串。
 */
export function previewNeeded({ trail }) {
  const lines = String(trail ?? '')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
  if (lines.length < 2) return false
  const header = lines[0].split('\t').map((cell) => cell.trim())
  const phaseIndex = header.indexOf('phase')
  const resultIndex = header.indexOf('result')
  if (phaseIndex < 0 || resultIndex < 0) return false
  return lines.slice(1).some((line) => {
    const cells = line.split('\t')
    return (
      (cells[phaseIndex] ?? '').trim() === 'preview' &&
      (cells[resultIndex] ?? '').trim() === 'required'
    )
  })
}

/**
 * 这张票在 D3 起一套预览：从 PR head 构建镜像，调 helper 起服务器那套，
 * 再把凭据写到 Mac。失败只返回这张票的错误，不抛出去影响调度器里别的票。
 *
 * pr 可以是 PR 号，也可以是带 number 和 headCommitAt 的对象。
 * seed 可以是命令字符串，也可以是 ({ ticket, worktree }) => 命令 的函数。
 */
export async function startPreview({
  ticket,
  pr,
  customer,
  product,
  baseBranch,
  worktree,
  helper,
  buildImage,
  writeLocalEnv,
  seed = '',
  commitAt = '',
}) {
  let address
  try {
    address = previewAddress({ customer, product, pr })
  } catch (error) {
    return { ok: false, error: errorText(error) }
  }
  const url = `https://${address}/`

  let image
  try {
    const built = await buildImage({ ticket, pr, baseBranch, worktree, address })
    image = typeof built === 'string' ? built : built?.image
    if (!image) throw new Error('buildImage 没返回镜像名')
  } catch (error) {
    return { ok: false, address, url, stage: 'build', error: errorText(error) }
  }

  let seedCommand
  try {
    seedCommand = typeof seed === 'function' ? await seed({ ticket, worktree }) : seed
  } catch (error) {
    return { ok: false, address, url, stage: 'seed', error: errorText(error) }
  }

  const lastCommit = commitAt || (pr && typeof pr === 'object' ? pr.headCommitAt : '') || ''
  const args = ['preview-start', address, String(image)]
  if (seedCommand) args.push('--seed', String(seedCommand))
  if (lastCommit) args.push('--commit-at', String(lastCommit))

  let stdout
  try {
    stdout = await helper(args)
  } catch (error) {
    return { ok: false, address, url, image, stage: 'start', error: errorText(error) }
  }

  const info = parsePreviewInfo(stdout)
  if (!info.user || !info.password || !info.env) {
    await helper(['preview-stop', address]).catch(() => {})
    return {
      ok: false,
      address,
      url,
      image,
      stage: 'credentials',
      error: 'helper 输出里缺 Basic Auth 用户名、密码或服务器 .env 路径',
    }
  }

  let credentialsFile = null
  if (typeof writeLocalEnv === 'function') {
    try {
      credentialsFile = await writeLocalEnv({
        address,
        user: info.user,
        password: info.password,
        serverEnv: info.env,
        dir: info.dir,
      })
    } catch (error) {
      await helper(['preview-stop', address]).catch(() => {})
      return {
        ok: false,
        address,
        url,
        image,
        stage: 'credentials',
        error: errorText(error),
      }
    }
  }

  return {
    ok: true,
    address,
    url,
    image,
    user: info.user,
    password: info.password,
    database: info.db,
    serverEnv: info.env,
    serverDir: info.dir,
    credentialsFile,
  }
}

/**
 * 销毁一套预览并清掉 Mac 侧凭据。
 * helper 失败时保留凭据文件，方便重试；本机文件删不掉只算警告。
 */
export async function stopPreview({ address, helper, removeLocalEnv }) {
  try {
    await helper(['preview-stop', address])
  } catch (error) {
    return { ok: false, address, error: errorText(error) }
  }
  const result = { ok: true, address }
  if (typeof removeLocalEnv === 'function') {
    try {
      await removeLocalEnv({ address })
    } catch (error) {
      result.warning = `本机凭据没删掉：${errorText(error)}`
    }
  }
  return result
}

const HOUR_MS = 60 * 60 * 1000
export const PREVIEW_IDLE_MS = 24 * HOUR_MS
export const PREVIEW_MAX_AGE_MS = 7 * 24 * HOUR_MS

function toMs(value) {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}

function decidePreview(preview, nowMs) {
  const createdAt = toMs(preview.createdAt)
  const lastCommitAt = toMs(preview.lastCommitAt)
  const lastAccessAt = toMs(preview.lastAccessAt)
  if (createdAt === null && lastCommitAt === null && lastAccessAt === null) {
    return { destroy: false, reason: '没记录时间，不猜' }
  }
  if (createdAt !== null && nowMs - createdAt >= PREVIEW_MAX_AGE_MS) {
    return { destroy: true, reason: '满 7 天' }
  }
  const activity = [createdAt, lastCommitAt, lastAccessAt].filter((value) => value !== null)
  const lastActivity = Math.max(...activity)
  if (nowMs - lastActivity >= PREVIEW_IDLE_MS) {
    return { destroy: true, reason: '24 小时无新提交且无访问' }
  }
  return { destroy: false, reason: '还有活动' }
}

/**
 * 判断哪些预览该销毁：满 7 天，或 24 小时无新提交且无访问。
 * 一条失败只记进 failed，继续处理下一条。
 */
export async function sweepPreviews({ now, previews, helper }) {
  const nowMs = toMs(now)
  if (nowMs === null) throw new Error('sweepPreviews 缺 now 或时间格式不对')
  const stopped = []
  const kept = []
  const failed = []
  for (const preview of previews ?? []) {
    const decision = decidePreview(preview, nowMs)
    if (!decision.destroy) {
      kept.push({ address: preview.address, reason: decision.reason })
      continue
    }
    try {
      await helper(['preview-stop', preview.address])
      stopped.push({ address: preview.address, reason: decision.reason })
    } catch (error) {
      failed.push({ address: preview.address, error: errorText(error) })
    }
  }
  return { stopped, kept, failed }
}
