/**
 * 默认 runner：在客户仓里起一次 Sandcastle，容器里跑一个新会话。
 *
 * 依赖装在 `~/.afkfactory/sandcastle`（可用 `AFK_SANDCASTLE_HOME` 改），
 * 首次跑时 `npm install @ai-hero/sandcastle@0.12.0 tsx`。
 * 凭证只从客户仓的 `.sandcastle/.env` 取：Sandcastle 只转发这个文件里出现过的键。
 * 这里不把宿主的 `GH_TOKEN`、`ANTHROPIC_AUTH_TOKEN` 等拼进脚本或子进程环境。
 */
import { spawn } from 'node:child_process'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

export const SANDCASTLE_VERSION = '0.12.0'
export const DEFAULT_MODEL = 'ccs-claude-deepseek--deepseek-v4-flash[1M]'

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

export async function defaultBuildImage({ image, home, env, exec }) {
  const inspect = await exec('docker', ['image', 'inspect', '--format', '{{.Id}}', image], {
    cwd: home,
    env: baseEnv(env),
  })
  if (inspect.code === 0) return { built: false, image }

  const result = await exec(
    'npx',
    ['@ai-hero/sandcastle', 'docker', 'build-image', '--image-name', image],
    { cwd: home, env: baseEnv(env) },
  )
  if (result.code !== 0) {
    throw new Error(`建镜像 ${image} 失败（退出码 ${result.code}）：${tail(result)}`)
  }
  return { built: true, image }
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
  const parsed = tryParseResult(stdout)
  if (!parsed) throw new Error('Sandcastle 没有输出 AFK_RESULT')
  return {
    commits: Array.isArray(parsed?.commits) ? parsed.commits : [],
    branch: parsed?.branch || ticketBranch,
    ...(parsed?.preservedWorktreePath
      ? { preservedWorktreePath: parsed.preservedWorktreePath }
      : {}),
  }
}

/**
 * @param {object} [options]
 * @param {string} [options.home] runner 目录，默认 `AFK_SANDCASTLE_HOME` 或 `~/.afkfactory/sandcastle`
 * @param {string} [options.model]
 * @param {object} [options.env] 宿主环境；只用 PATH、HOME 这类进程键，不转发凭证
 * @param {Function} [options.exec] 外部命令替身 `(command, args, {cwd, env, onStart}) => {code, stdout, stderr}`
 * @param {Function} [options.buildImage] 建镜像替身
 */
export function createSandcastleRunner({
  home = process.env.AFK_SANDCASTLE_HOME || join(homedir(), '.afkfactory', 'sandcastle'),
  model = process.env.AFK_SANDCASTLE_MODEL || DEFAULT_MODEL,
  env = process.env,
  exec = defaultExec,
  buildImage = defaultBuildImage,
} = {}) {
  /** 装依赖、备镜像、写脚本。不计入点火两分钟回执。 */
  async function prepare(args) {
    const { repoDir, ticketBranch, prompt, envFile, image } = args
    if (!repoDir || !ticketBranch || !prompt) {
      throw new Error('runner 缺少 repoDir、ticketBranch 或 prompt')
    }
    if (!envFile || !(await exists(envFile))) {
      throw new Error(`缺 .sandcastle/.env：${envFile || '(未指定)'}。凭证只从这个文件取。`)
    }

    const envValues = await readEnvFile(envFile)
    const deps = await ensureDeps({ home, env, exec })

    const imageName = image || envValues.SANDCASTLE_IMAGE || `sandcastle:${basename(repoDir)}`
    const built = await buildImage({ image: imageName, home, env, exec })

    const ticketNumber = String(ticketBranch).split('/').pop().replace(/[^A-Za-z0-9._-]/g, '-')
    const scriptPath = join(home, `run-${ticketNumber}.mts`)
    await writeFile(
      scriptPath,
      renderRunScript({ model, imageName, prompt, ticketBranch }),
      'utf8',
    )

    return {
      imageName,
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
      const error = new Error(`Sandcastle 退出码 ${result.code}：${tail(result)}`)
      const parsed = tryParseResult(result.stdout)
      if (parsed?.preservedWorktreePath) error.preservedWorktreePath = parsed.preservedWorktreePath
      throw error
    }
    return parseResult(result.stdout, ticketBranch)
  }

  return { prepare, run }
}
