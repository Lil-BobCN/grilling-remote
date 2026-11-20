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

/** 客户仓模板里的 Dockerfile；镜像 tag 的哈希把这份模板也算进去。 */
export const SCAFFOLD_DOCKERFILE = join(
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

export function defaultExec(command, args, { cwd, env, onStart } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let started = false
    let stdout = ''
    let stderr = ''
    const mark = () => {
      if (started) return
      started = true
      if (typeof onStart === 'function') onStart()
    }
    child.once('spawn', mark)
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.once('error', (error) => {
      resolve({ code: 1, stdout, stderr: `${stderr}${error.message}` })
    })
    child.once('close', (code) => {
      resolve({ code: Number.isInteger(code) ? code : 1, stdout, stderr })
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
export function hashTaggedImage(image, hash) {
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
export function imageContentHash(dockerfileText, templateText) {
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
 * 在客户仓里建镜像。cwd 是客户仓，默认 context 是 `<repoDir>/.sandcastle`；
 * 需要仓根做 context 时显式传 `dockerfile`，CLI 会收到绝对路径。
 * tag 由 Dockerfile 内容和模板哈希生成，内容变了自动换 tag 并重建。
 */
export async function defaultBuildImage({
  image,
  repoDir,
  env,
  exec,
  dockerfile = '',
  templatePath = SCAFFOLD_DOCKERFILE,
}) {
  if (!repoDir) throw new Error('建镜像需要 repoDir')
  const dockerfilePath = dockerfile
    ? isAbsolute(dockerfile)
      ? dockerfile
      : resolve(repoDir, dockerfile)
    : join(repoDir, '.sandcastle', 'Dockerfile')
  const hash = imageContentHash(
    await readTextOrEmpty(dockerfilePath),
    await readTextOrEmpty(templatePath),
  )
  const taggedImage = hashTaggedImage(image, hash)

  const inspect = await exec('docker', ['image', 'inspect', '--format', '{{.Id}}', taggedImage], {
    cwd: repoDir,
    env: baseEnv(env),
  })
  if (inspect.code === 0 && String(inspect.stdout || '').trim()) {
    return { built: false, image: taggedImage, hash }
  }

  const args = [
    '--yes',
    `@ai-hero/sandcastle@${SANDCASTLE_VERSION}`,
    'docker',
    'build-image',
    '--image-name',
    taggedImage,
  ]
  if (dockerfile) args.push('--dockerfile', dockerfilePath)
  const result = await exec('npx', args, { cwd: repoDir, env: baseEnv(env) })
  if (result.code !== 0) {
    throw new Error(`建镜像 ${taggedImage} 失败（退出码 ${result.code}）：${tail(result)}`)
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
    'const result = await run({',
    `  agent: claudeCode(${JSON.stringify(model)}),`,
    `  sandbox: docker({ imageName: ${JSON.stringify(imageName)} }),`,
    `  promptFile: ${JSON.stringify(prompt)},`,
    `  branchStrategy: { type: 'branch', branch: ${JSON.stringify(ticketBranch)} },`,
    '})',
    'console.log(`AFK_RESULT:${JSON.stringify({ commits: result.commits, branch: result.branch })}`)',
    '',
  ].join('\n')
}

function parseResult(stdout, ticketBranch) {
  const line = String(stdout || '')
    .split(/\r?\n/)
    .reverse()
    .find((row) => row.startsWith('AFK_RESULT:'))
  if (!line) throw new Error('Sandcastle 没有输出 AFK_RESULT')
  const parsed = JSON.parse(line.slice('AFK_RESULT:'.length))
  return {
    commits: Array.isArray(parsed?.commits) ? parsed.commits : [],
    branch: parsed?.branch || ticketBranch,
  }
}

/**
 * @param {object} [options]
 * @param {string} [options.home] runner 目录，默认 `AFK_SANDCASTLE_HOME` 或 `~/.afkfactory/sandcastle`
 * @param {string} [options.model]
 * @param {object} [options.env] 宿主环境；只用 PATH、HOME 这类进程键，不转发凭证
 * @param {Function} [options.exec] 外部命令替身 `(command, args, {cwd, env, onStart}) => {code, stdout, stderr}`
 * @param {Function} [options.buildImage] 建镜像替身
 * @param {string} [options.templatePath] 客户仓 Dockerfile 模板，参与镜像 tag 哈希
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
      home,
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
      image: actualImage,
      hash: String(built?.hash || ''),
      scriptPath,
      installed: Boolean(deps?.installed),
      built: Boolean(built?.built),
    }
  }

  /** 真正起容器和会话；子进程起来时调用 started() 回执。 */
  async function run(args) {
    const { repoDir, ticketBranch, started, prepared } = args
    if (!prepared?.scriptPath) throw new Error('先跑 prepare()，拿到 scriptPath 再 run()')

    const result = await exec(join(home, 'node_modules', '.bin', 'tsx'), [prepared.scriptPath], {
      cwd: repoDir,
      env: { ...baseEnv(env), NODE_PATH: join(home, 'node_modules') },
      onStart: () => {
        if (typeof started === 'function') started()
      },
    })

    if (result.code !== 0) {
      throw new Error(`Sandcastle 退出码 ${result.code}：${tail(result)}`)
    }
    return parseResult(result.stdout, ticketBranch)
  }

  return { prepare, run }
}
