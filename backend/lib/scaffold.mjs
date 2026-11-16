/**
 * 建客户仓：生成骨架和模板应用，本地跑 check，建 GitHub 私有仓，初始提交，推送，建九个标签。
 *
 * 已有仓时不重建、不覆盖，返回 `{created: false}`。
 * 中途失败时删掉本次新建的 GitHub 仓和本地目录，错误信息写清卡在哪一步。
 * 模板文件在 `backend/scaffold/`，和客户仓根目录同构；`{{REPO_NAME}}`、
 * `{{SHORT_NAME}}`、`{{PRODUCT}}` 三个占位符在生成时替换。
 */
import { execFile } from 'node:child_process'
import { chmod, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const TEMPLATE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'scaffold')

/** 九个标签：五个 triage 加四个状态。名字、颜色和说明见 docs/工单模型.md 和 docs/agents/triage-labels.md。 */
export const LABELS = [
  { name: 'needs-triage', color: 'd4c5f9', description: '需要判断怎么处理' },
  { name: 'needs-info', color: 'fbca04', description: '等待补充信息' },
  { name: 'ready-for-agent', color: '0e8a16', description: '信息完整，可以交给 agent' },
  { name: 'ready-for-human', color: '1d76db', description: '需要人处理或作出决定' },
  { name: 'wontfix', color: 'ffffff', description: '确定不处理' },
  { name: '状态:已提交', color: 'ededed', description: '已建单，等技术闸门' },
  { name: '状态:排队中', color: 'fbca04', description: '轮到了，等点火' },
  { name: '状态:开发中', color: '1d76db', description: '正在跑' },
  { name: '状态:待验收', color: '0e8a16', description: '活干完了，等下一步确认' },
]

const STEP_NAMES = {
  params: '参数',
  query: '检查已有仓',
  generate: '生成文件',
  check: '本地检查',
  verify: '本地验证',
  'create-repo': '建 GitHub 仓',
  commit: '初始提交',
  push: '推送',
  labels: '建标签',
}

export class ScaffoldError extends Error {
  constructor(step, cause, { cleanup = [] } = {}) {
    let reason = cause instanceof Error ? cause.message : String(cause)
    if (cause?.body?.message) reason += `（${cause.body.message}）`
    const label = STEP_NAMES[step] || step
    const tail = cleanup.length ? `；清理没做完：${cleanup.join('；')}` : ''
    super(`建仓失败：卡在「${label}」（${step}）这一步：${reason}${tail}`)
    this.name = 'ScaffoldError'
    this.step = step
    this.cause = cause
    this.cleanup = cleanup
  }
}

async function run(cmd, args, { cwd, timeoutMs = 120000, env } = {}) {
  const result = await execFileAsync(cmd, args, {
    cwd,
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
    ...(env ? { env: { ...process.env, ...env } } : {}),
  }).catch((error) => error)
  if (result.code) {
    const output = String(result.stderr || result.stdout || result.message || '').trim()
    throw new Error(`${cmd} ${args.join(' ')} 失败：${output}`)
  }
  return String(result.stdout || '').trim()
}

function git(cwd, args, options) {
  return run('git', ['-C', cwd, ...args], options)
}

/** 推 GitHub 时用 token 认证，不写进 remote 地址。 */
function pushAuthEnv(remoteUrl, token = process.env.GITHUB_TOKEN) {
  if (!token || !/^https:\/\/(www\.)?github\.com\//i.test(remoteUrl)) return {}
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64')
  return {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
  }
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function assertEmptyDir(dir) {
  const entries = await readdir(dir)
  if (entries.length) throw new Error(`工作目录不是空的：${dir}`)
}

async function clearDir(dir) {
  for (const entry of await readdir(dir)) {
    await rm(join(dir, entry), { recursive: true, force: true })
  }
}

async function walkFiles(dir) {
  const rows = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) rows.push(...(await walkFiles(full)))
    else if (entry.isFile()) rows.push(full)
  }
  return rows
}

export async function generateCustomerRepo({ workDir, shortName, product, repoName }) {
  const replacements = {
    '{{REPO_NAME}}': repoName,
    '{{SHORT_NAME}}': shortName,
    '{{PRODUCT}}': product,
  }
  const files = (await walkFiles(TEMPLATE_DIR)).sort()
  const written = []

  for (const source of files) {
    const rel = relative(TEMPLATE_DIR, source)
    let text = await readFile(source, 'utf8')
    for (const [token, value] of Object.entries(replacements)) {
      text = text.split(token).join(value)
    }
    if (text.includes('{{')) throw new Error(`模板里还有没替换的占位符：${rel}`)

    const target = join(workDir, rel)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, text)
    if (rel.endsWith('.sh')) await chmod(target, 0o755)
    written.push(rel)
  }

  return written.sort()
}

export async function runCheck(workDir) {
  return run('bash', ['scripts/check.sh'], { cwd: workDir })
}

/**
 * 跑模板自带的验证脚本：启动应用，走一条关键路径，有 Chrome 就留第一张截图。
 * 没有 Chrome 时脚本跳过截图，这里记一句在 `.audit/verify.txt`。
 */
export async function runVerifyScript(workDir) {
  return run('bash', ['scripts/verify.sh'], { cwd: workDir })
}

async function recordVerify({ workDir, stdout }) {
  const shot = join(workDir, '.audit', 'screenshots', 'first-order.png')
  const screenshot = await exists(shot)
  const lines = [
    '建仓时的第一轮验证（scripts/verify.sh）',
    '',
    String(stdout || '').trim(),
    '',
    screenshot ? '截图：.audit/screenshots/first-order.png' : '没有 Chrome，跳过截图。关键路径已验证。',
    '',
  ]
  await mkdir(join(workDir, '.audit'), { recursive: true })
  await writeFile(join(workDir, '.audit', 'verify.txt'), lines.join('\n'))
  return screenshot ? '.audit/screenshots/first-order.png' : ''
}

/**
 * @param {object} options
 * @param {object} options.gh GitHub 客户端，见 factory/lib/github.mjs
 * @param {string} options.owner
 * @param {string} options.repoName
 * @param {string} options.shortName 客户简称
 * @param {string} options.product 软件简称
 * @param {string} options.workDir 生成仓库的本地目录，必须不存在或为空
 * @param {string} options.remoteUrl git 远端地址
 * @param {'user'|'org'} [options.ownerType]
 * @param {Function} [options.verify] 本机验证命令，默认跑 `bash scripts/verify.sh`；测试注入假实现
 * @returns {Promise<object>}
 */
export async function scaffoldCustomerRepo({
  gh,
  owner,
  repoName,
  shortName,
  product,
  workDir,
  remoteUrl,
  ownerType = 'user',
  verify = runVerifyScript,
  token = process.env.GITHUB_TOKEN,
}) {
  for (const [name, value] of Object.entries({ owner, repoName, shortName, product, workDir, remoteUrl })) {
    if (!value || typeof value !== 'string') throw new ScaffoldError('params', new Error(`缺少 ${name}`))
  }
  if (!gh) throw new ScaffoldError('params', new Error('缺少 gh'))
  if (ownerType !== 'user' && ownerType !== 'org') {
    throw new ScaffoldError('params', new Error(`ownerType 只能是 user 或 org，收到 ${ownerType}`))
  }

  let existing
  try {
    existing = await gh.getRepoOrNull({ owner, repo: repoName })
  } catch (error) {
    throw new ScaffoldError('query', error)
  }
  if (existing) {
    return {
      created: false,
      reason: 'exists',
      owner,
      repo: repoName,
      htmlUrl: existing.html_url || null,
    }
  }

  const hadDir = await exists(workDir)
  try {
    if (hadDir) await assertEmptyDir(workDir)
    else await mkdir(workDir, { recursive: true })
  } catch (error) {
    throw new ScaffoldError('generate', error)
  }

  let step = 'generate'
  let repoCreated = false
  try {
    const files = await generateCustomerRepo({ workDir, shortName, product, repoName })

    step = 'check'
    await runCheck(workDir)

    step = 'verify'
    const verifyOutput = await verify(workDir)
    const verifyText = typeof verifyOutput === 'string' ? verifyOutput : verifyOutput?.stdout || ''
    const screenshot = await recordVerify({ workDir, stdout: verifyText })

    step = 'create-repo'
    const repo = await gh.createRepo({
      owner,
      name: repoName,
      private: true,
      description: `${shortName} 的 ${product} 应用`,
      ownerType,
    })
    repoCreated = true

    step = 'commit'
    await git(workDir, ['init', '-b', 'main'])
    await git(workDir, ['config', 'user.name', 'AFK Factory'])
    await git(workDir, ['config', 'user.email', 'factory@afkfactory.space'])
    await git(workDir, ['add', '-A'])
    await git(workDir, ['commit', '-m', 'FACTORY: 建仓：客户仓骨架和模板应用'])
    const commit = await git(workDir, ['rev-parse', 'HEAD'])

    step = 'push'
    await git(workDir, ['remote', 'add', 'origin', remoteUrl])
    await git(workDir, ['push', '-u', 'origin', 'main'], { env: pushAuthEnv(remoteUrl, token) })

    step = 'labels'
    for (const label of LABELS) {
      await gh.createLabel({ owner, repo: repoName, ...label })
    }
    const created = await gh.listLabels({ owner, repo: repoName })
    const present = new Set(created.map((row) => row.name))
    const missing = LABELS.map((row) => row.name).filter((name) => !present.has(name))
    if (missing.length) throw new Error(`标签没建出来：${missing.join('、')}`)

    return {
      created: true,
      owner,
      repo: repoName,
      htmlUrl: repo.html_url || null,
      remoteUrl,
      workDir,
      commit,
      labels: LABELS.map((row) => row.name),
      files,
      verify: { screenshot },
    }
  } catch (error) {
    const cleanup = []

    // 建仓请求可能在 GitHub 已经建出仓之后才报错，先核对再删，避免留下空仓。
    if (!repoCreated && step === 'create-repo') {
      try {
        repoCreated = Boolean(await gh.getRepoOrNull({ owner, repo: repoName }))
      } catch (cleanupError) {
        cleanup.push(`核对建仓结果失败：${cleanupError.message}`)
      }
    }

    if (repoCreated) {
      try {
        await gh.deleteRepo({ owner, repo: repoName })
      } catch (cleanupError) {
        cleanup.push(`删 GitHub 仓失败：${cleanupError.message}`)
      }
    }

    try {
      if (hadDir) await clearDir(workDir)
      else await rm(workDir, { recursive: true, force: true })
    } catch (cleanupError) {
      cleanup.push(`删本地目录失败：${cleanupError.message}`)
    }

    throw error instanceof ScaffoldError ? error : new ScaffoldError(step, error, { cleanup })
  }
}
