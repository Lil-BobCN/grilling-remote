/**
 * 默认 runner：在客户仓里起一次 Sandcastle，容器里跑一个新会话。
 *
 * 依赖装在 `~/.afkfactory/sandcastle`（可用 `AFK_SANDCASTLE_HOME` 改），
 * 首次跑时 `npm install @ai-hero/sandcastle@0.12.0 tsx`。
 * 凭证只从客户仓的 `.sandcastle/.env` 取：Sandcastle 只转发这个文件里出现过的键。
 * 这里不把宿主的 `GH_TOKEN`、`ANTHROPIC_AUTH_TOKEN` 等拼进脚本或子进程环境。
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SANDCASTLE_VERSION = '0.12.0'
export const DEFAULT_MODEL = 'ccs-claude-deepseek--deepseek-v4-flash[1M]'

/** 工厂的 Dockerfile 模板；默认构建直接用它，镜像 tag 的哈希也包含它。 */
const SCAFFOLD_DOCKERFILE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'backend',
  'scaffold',
  '.sandcastle',
  'Dockerfile',
)

const ENV_KEYS = ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'SHELL', 'USER']

function baseEnv(env) {
  const result = {}
  for (const key of ENV_KEYS) {
    if (env?.[key] !== undefined) result[key] = env[key]
  }
  return result
}

function tail(result, limit = 2000) {
  const text = String(result?.stderr || result?.stdout || '').trim()
  return text.length > limit ? text.slice(-limit) : text
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export function defaultExec(
  command,
  args,
  { cwd, env, onStart, signal, killGraceMs = 5000 } = {},
) {
  if (signal?.aborted) {
    return Promise.resolve({ code: 1, stdout: '', stderr: '', aborted: true })
  }
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    })
    let started = false
    let stdout = ''
    let stderr = ''
    let settled = false
    let killTimer = null
    let aborted = false

    const mark = () => {
      if (started) return
      started = true
      if (typeof onStart === 'function') onStart()
    }

    const killGroup = (sig) => {
      if (!child.pid) return
      try {
        process.kill(-child.pid, sig)
      } catch (error) {
        if (error.code === 'ESRCH') return
        try {
          child.kill(sig)
        } catch {
          // 进程已经没了。
        }
      }
    }

    const onAbort = () => {
      aborted = true
      killGroup('SIGTERM')
      killTimer = setTimeout(() => killGroup('SIGKILL'), killGraceMs)
      killTimer?.unref?.()
    }

    const finish = (result) => {
      if (settled) return
      settled = true
      if (killTimer) clearTimeout(killTimer)
      signal?.removeEventListener?.('abort', onAbort)
      resolve(result)
    }

    signal?.addEventListener?.('abort', onAbort, { once: true })
    child.once('spawn', mark)
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.once('error', (error) => {
      finish({ code: 1, stdout, stderr: `${stderr}${error.message}`, aborted })
    })
    child.once('close', (code) => {
      finish({ code: Number.isInteger(code) ? code : 1, stdout, stderr, aborted })
    })
  })
}

async function readEnvFile(path) {
  const text = await readFile(path, 'utf8')
  const values = {}
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    values[key] = value
  }
  return values
}

async function ensureDeps({ home, env, exec }) {
  const marker = join(home, 'node_modules', '@ai-hero', 'sandcastle', 'package.json')
  if (await exists(marker)) return { installed: false }

  await mkdir(home, { recursive: true })
  const packageJson = join(home, 'package.json')
  if (!(await exists(packageJson))) {
    await writeFile(
      packageJson,
      `${JSON.stringify(
        { name: 'afkfactory-sandcastle-runner', private: true, type: 'module' },
        null,
        2,
      )}\n`,
    )
  }

  const result = await exec(
    'npm',
    ['install', `@ai-hero/sandcastle@${SANDCASTLE_VERSION}`, 'tsx'],
    { cwd: home, env: baseEnv(env) },
  )
  if (result.code !== 0) {
    throw new Error(`装 Sandcastle 依赖失败（退出码 ${result.code}）：${tail(result)}`)
  }
  return { installed: true }
}

/** 镜像 tag 带 Dockerfile 和模板的内容哈希；仓库名保留，名字只变 tag。 */
function hashTaggedImage(image, hash) {
  const value = String(image || '')
  const slash = value.lastIndexOf('/')
  const colon = value.lastIndexOf(':')
  const tagged = colon > slash
  const repo = tagged ? value.slice(0, colon) : value
  const tag = tagged ? value.slice(colon + 1) : ''
  const suffix = String(hash).slice(0, 12)
  return `${repo}:${tag ? `${tag}-${suffix}` : suffix}`
}

/** Dockerfile 内容和模板一起算哈希；任一变化都换 tag，下次点火重建。 */
function imageContentHash(dockerfileText, templateText) {
  return createHash('sha256')
    .update('dockerfile\0')
    .update(String(dockerfileText ?? ''))
    .update('\0template\0')
    .update(String(templateText ?? ''))
    .digest('hex')
}

async function readTextOrEmpty(path) {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return ''
  }
}

/**
 * 建镜像。默认只用工厂模板 `backend/scaffold/.sandcastle/Dockerfile`，
 * context 是模板所在目录，所以客户仓里的旧副本不再参与。
 * 显式传 `dockerfile` 时尊重调用方文件，context 是客户仓根。
 * tag 由实际 Dockerfile 内容和模板哈希生成，内容变了自动换 tag 并重建。
 * 宿主 UID/GID 作为 build-arg 传进去，按 Sandcastle 的镜像约定。
 */
export async function defaultBuildImage({
  image,
  repoDir,
  env,
  exec,
  dockerfile = '',
  templatePath = SCAFFOLD_DOCKERFILE,
  uid = typeof process.getuid === 'function' ? process.getuid() : undefined,
  gid = typeof process.getgid === 'function' ? process.getgid() : undefined,
}) {
  if (!repoDir) throw new Error('建镜像需要 repoDir')
  const dockerfilePath = dockerfile
    ? isAbsolute(dockerfile)
      ? dockerfile
      : resolve(repoDir, dockerfile)
    : templatePath
  const contextDir = dockerfile ? repoDir : dirname(templatePath)
  const hash = imageContentHash(
    await readTextOrEmpty(dockerfilePath),
    await readTextOrEmpty(templatePath),
  )
  const taggedImage = hashTaggedImage(image, hash)

  const inspect = await exec('docker', ['image', 'inspect', '--format', '{{.Id}}', taggedImage], {
    cwd: contextDir,
    env: baseEnv(env),
  })
  if (inspect.code === 0 && String(inspect.stdout || '').trim()) {
    return { built: false, image: taggedImage, hash }
  }

  const args = ['build']
  if (uid !== undefined) args.push('--build-arg', `AGENT_UID=${uid}`)
  if (gid !== undefined) args.push('--build-arg', `AGENT_GID=${gid}`)
  args.push('-f', dockerfilePath, '-t', taggedImage, contextDir)
  const result = await exec('docker', args, { cwd: contextDir, env: baseEnv(env) })
  if (result.code !== 0) {
    throw new Error(`建镜像 ${taggedImage} 失败（退出码 ${result.code}）：${tail(result)}`)
  }

  // 冒烟用镜像默认入口起一个常驻容器，再进去检查；Sandcastle 现场也是 docker run -d 不带命令。
  const containerName = `afk-sandcastle-smoke-${String(hash).slice(0, 12)}-${process.pid}-${Date.now()}`
  const smokeArgs = ['run', '-d', '--name', containerName]
  if (uid !== undefined && gid !== undefined) smokeArgs.push('--user', `${uid}:${gid}`)
  smokeArgs.push('-e', 'HOME=/home/agent', taggedImage)
  try {
    const started = await exec('docker', smokeArgs, { cwd: contextDir, env: baseEnv(env) })
    if (started.code !== 0) {
      throw new Error(
        `镜像 ${taggedImage} 冒烟失败（容器启动退出码 ${started.code}）：${tail(started)}`,
      )
    }
    const check = await exec(
      'docker',
      [
        'exec',
        containerName,
        'sh',
        '-c',
        'test -w /home/agent && git config --global --add safe.directory /home/agent/workspace',
      ],
      { cwd: contextDir, env: baseEnv(env) },
    )
    if (check.code !== 0) {
      throw new Error(`镜像 ${taggedImage} 冒烟失败（容器内检查退出码 ${check.code}）：${tail(check)}`)
    }
  } finally {
    await exec('docker', ['rm', '-f', containerName], { cwd: contextDir, env: baseEnv(env) })
  }
  return { built: true, image: taggedImage, hash }
}

export function renderRunScript({ model, imageName, prompt, ticketBranch }) {
  return [
    "import { run, claudeCode } from '@ai-hero/sandcastle'",
    "import { docker } from '@ai-hero/sandcastle/sandboxes/docker'",
    '',
    '// 凭证只从 .sandcastle/.env 取，Sandcastle 只转发这个文件里出现过的键。',
    '// GH_TOKEN 也在 .sandcastle/.env 里，只限当前客户仓；不读宿主环境变量。',
    '// 脏工作树会被 Sandcastle 保留，路径要通过 preservedWorktreePath 交给工厂清理。',
    'try {',
    '  const result = await run({',
    `    agent: claudeCode(${JSON.stringify(model)}),`,
    `    sandbox: docker({ imageName: ${JSON.stringify(imageName)} }),`,
    `    promptFile: ${JSON.stringify(prompt)},`,
    `    branchStrategy: { type: 'branch', branch: ${JSON.stringify(ticketBranch)} },`,
    '  })',
    '  console.log(`AFK_RESULT:${JSON.stringify({ commits: result.commits, branch: result.branch, preservedWorktreePath: result.preservedWorktreePath })}`)',
    '} catch (error) {',
    '  console.log(`AFK_RESULT:${JSON.stringify({ commits: [], branch: undefined, preservedWorktreePath: error?.preservedWorktreePath, error: String(error?.message || error) })}`)',
    '  throw error',
    '}',
    '',
  ].join('\n')
}

function tryParseResult(stdout) {
  const line = String(stdout || '')
    .split(/\r?\n/)
    .reverse()
    .find((row) => row.startsWith('AFK_RESULT:'))
  if (!line) return null
  try {
    return JSON.parse(line.slice('AFK_RESULT:'.length))
  } catch {
    return null
  }
}

function parseResult(stdout, ticketBranch) {
  const line = String(stdout || '')
    .split(/\r?\n/)
    .reverse()
    .find((row) => row.startsWith('AFK_RESULT:'))
  if (!line) throw new Error('Sandcastle 没有输出 AFK_RESULT')
  let parsed
  try {
    parsed = JSON.parse(line.slice('AFK_RESULT:'.length))
  } catch {
    throw new Error(`Sandcastle 的 AFK_RESULT 不是合法 JSON：${line.slice(0, 200)}`)
  }
  return {
    commits: Array.isArray(parsed?.commits) ? parsed.commits : [],
    branch: parsed?.branch || ticketBranch,
    ...(parsed?.preservedWorktreePath
      ? { preservedWorktreePath: parsed.preservedWorktreePath }
      : {}),
  }
}

async function listSandcastleContainers({ exec, cwd, env }) {
  const result = await exec('docker', ['ps', '-aq', '--filter', 'name=^sandcastle-'], { cwd, env })
  // 列不出来时返回 null，不能当成空集：否则取消时会误删同机别的容器。
  if (result?.code !== 0) return null
  return new Set(
    String(result.stdout || '')
      .split(/\s+/)
      .filter(Boolean),
  )
}

/** 取消后只清这次新起的容器，不碰同机别的票或别的仓的沙箱。 */
async function removeNewSandcastleContainers({ exec, cwd, env, before }) {
  if (!before) return []
  const after = await listSandcastleContainers({ exec, cwd, env })
  if (!after) return []
  const fresh = [...after].filter((id) => !before.has(id))
  for (const id of fresh) {
    await exec('docker', ['rm', '-f', id], { cwd, env })
  }
  return fresh
}

/**
 * @param {object} [options]
 * @param {string} [options.home] runner 目录，默认 `AFK_SANDCASTLE_HOME` 或 `~/.afkfactory/sandcastle`
 * @param {string} [options.model]
 * @param {object} [options.env] 宿主环境；只用 PATH、HOME 这类进程键，不转发凭证
 * @param {Function} [options.exec] 外部命令替身 `(command, args, {cwd, env, onStart}) => {code, stdout, stderr}`
 * @param {Function} [options.buildImage] 建镜像替身
 * @param {string} [options.templatePath] 工厂 Dockerfile 模板，默认构建的唯一来源，参与镜像 tag 哈希
 */
export function createSandcastleRunner({
  home = process.env.AFK_SANDCASTLE_HOME || join(homedir(), '.afkfactory', 'sandcastle'),
  model = process.env.AFK_SANDCASTLE_MODEL || DEFAULT_MODEL,
  env = process.env,
  exec = defaultExec,
  buildImage = defaultBuildImage,
  templatePath = SCAFFOLD_DOCKERFILE,
} = {}) {
  /** 装依赖、备镜像、写脚本。不计入点火两分钟回执。 */
  async function prepare(args) {
    const { repoDir, ticketBranch, prompt, envFile, image, dockerfile } = args
    if (!repoDir || !ticketBranch || !prompt) {
      throw new Error('runner 缺少 repoDir、ticketBranch 或 prompt')
    }
    if (!envFile || !(await exists(envFile))) {
      throw new Error(`缺 .sandcastle/.env：${envFile || '(未指定)'}。凭证只从这个文件取。`)
    }

    const envValues = await readEnvFile(envFile)
    const deps = await ensureDeps({ home, env, exec })

    const imageName = image || envValues.SANDCASTLE_IMAGE || `sandcastle:${basename(repoDir)}`
    const built = await buildImage({
      image: imageName,
      repoDir,
      dockerfile: dockerfile || '',
      templatePath,
      env,
      exec,
    })
    const actualImage = built?.image || imageName

    const ticketNumber = String(ticketBranch).split('/').pop().replace(/[^A-Za-z0-9._-]/g, '-')
    const scriptPath = join(home, `run-${ticketNumber}.mts`)
    await writeFile(
      scriptPath,
      renderRunScript({ model, imageName: actualImage, prompt, ticketBranch }),
      'utf8',
    )

    return {
      imageName: actualImage,
      hash: String(built?.hash || ''),
      scriptPath,
      installed: Boolean(deps?.installed),
      built: Boolean(built?.built),
    }
  }

  /** 真正起容器和会话；子进程起来时调用 started() 回执。 */
  async function run(args) {
    const { repoDir, ticketBranch, started, prepared, signal } = args
    if (!prepared?.scriptPath) throw new Error('先跑 prepare()，拿到 scriptPath 再 run()')

    const runEnv = { ...baseEnv(env), NODE_PATH: join(home, 'node_modules') }
    // 取消要带走这次起的沙箱容器；先记下已有的，结束后只删新增的。
    const before = signal ? await listSandcastleContainers({ exec, cwd: repoDir, env: runEnv }) : null
    const result = await exec(join(home, 'node_modules', '.bin', 'tsx'), [prepared.scriptPath], {
      cwd: repoDir,
      env: runEnv,
      signal,
      onStart: () => {
        if (typeof started === 'function') started()
      },
    })
    const cleanedContainers =
      signal?.aborted && before
        ? await removeNewSandcastleContainers({ exec, cwd: repoDir, env: runEnv, before })
        : []

    if (result.code !== 0) {
      const error = new Error(`Sandcastle 退出码 ${result.code}：${tail(result)}`)
      const parsed = tryParseResult(result.stdout)
      if (parsed?.preservedWorktreePath) error.preservedWorktreePath = parsed.preservedWorktreePath
      if (result.aborted || signal?.aborted) error.aborted = true
      if (cleanedContainers.length) error.cleanedContainers = cleanedContainers
      throw error
    }
    return {
      ...parseResult(result.stdout, ticketBranch),
      ...(cleanedContainers.length ? { cleanedContainers } : {}),
    }
  }

  return { prepare, run }
}
