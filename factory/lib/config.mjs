/**
 * 工厂启动配置：读 env 文件和进程环境，校验必需键，解析 helper 和模型。
 *
 * 进程环境的非空值优先于 env 文件；AFK_AGENT_MODEL 又优先于 ANTHROPIC_MODEL。
 * 启动校验只在这一层做，调度决策不读这个模块以外的环境。
 */
import { execFile } from 'node:child_process'
import { readFile as readFileDefault, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const HELPER_PATH = '/usr/local/sbin/afk-product'
// ssh 的常用带值选项；判断 AFK_HELPER 里 ssh 有没有主机和远程命令时跳过它们。
const SSH_OPTIONS_WITH_VALUE = new Set([
  '-b', '-c', '-D', '-E', '-F', '-i', '-J', '-L', '-l', '-m', '-o', '-p', '-R', '-S', '-W', '-w',
])

export class ConfigError extends Error {
  constructor(message, { key = '', file = '', line = 0 } = {}) {
    super(message)
    this.name = 'ConfigError'
    this.key = key
    this.file = file
    this.line = line
  }
}

function parseValue(raw) {
  let value = String(raw ?? '').trim()
  if (value.startsWith('"') || value.startsWith("'")) {
    const quote = value[0]
    const close = value.indexOf(quote, 1)
    if (close !== -1) return value.slice(1, close)
    return value.slice(1)
  }
  value = value.replace(/\s+#.*$/, '').trim()
  return value
}

/** 读 shell 风格的 env 文本：空行、# 注释、export、单双引号和行尾注释都认。 */
export function parseEnvFile(text, { file = '' } = {}) {
  const values = {}
  const where = file ? ` ${file}` : ''
  String(text ?? '')
    .split(/\r?\n/)
    .forEach((line, index) => {
      let trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) return
      if (trimmed.startsWith('export ')) trimmed = trimmed.slice('export '.length).trim()
      const eq = trimmed.indexOf('=')
      const key = eq > 0 ? trimmed.slice(0, eq).trim() : ''
      if (eq <= 0 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        throw new ConfigError(`env 文件${where} 第 ${index + 1} 行看不懂：${line}`, {
          file,
          line: index + 1,
        })
      }
      values[key] = parseValue(trimmed.slice(eq + 1))
    })
  return values
}

function checkedTarget(file, envFileFound) {
  return envFileFound ? `${file} 里也没有` : `${file} 不存在`
}

function missingKeyMessage(key, file, envFileFound) {
  return `缺 ${key}：进程环境没有，${checkedTarget(file, envFileFound)}`
}

const HELPER_FIX =
  "改成完整命令，例如 AFK_HELPER='/usr/local/sbin/afk-product' 或 " +
  "AFK_HELPER='ssh dev@<服务器> sudo -n /usr/local/sbin/afk-product'；" +
  '也可以删掉 AFK_HELPER，改设 AFK_SERVER（可配 AFK_SSH_KEY）'

/** ssh 命令里有没有「主机 + 远程命令」两段；没有就说明子命令会被当成主机名。 */
function sshHasTargetAndCommand(command) {
  let i = 1
  while (i < command.length) {
    const token = command[i]
    if (token === '--') {
      i += 1
      break
    }
    if (token.startsWith('-')) {
      i += SSH_OPTIONS_WITH_VALUE.has(token) ? 2 : 1
      continue
    }
    return i + 1 < command.length
  }
  const rest = command.slice(i)
  return rest.length >= 2
}

/**
 * 解析 helper 命令。没配时返回 null，由 loadConfig 报错。
 *
 * `AFK_HELPER=ssh` 这种只写传输命令的配置会报错：再拼 `preview-sweep`
 * 就变成 `ssh preview-sweep`，子命令被当成主机名。
 */
export function resolveHelperCommand(env = {}) {
  const raw = String(env.AFK_HELPER ?? '').trim()
  if (raw) {
    const command = raw.split(/\s+/)
    const program = command[0].split('/').pop()
    if (program === 'ssh' && !sshHasTargetAndCommand(command)) {
      throw new ConfigError(`AFK_HELPER 里的 ssh 缺主机或远程命令，像 preview-sweep 这样的子命令会被当成主机名。${HELPER_FIX}`, {
        key: 'AFK_HELPER',
      })
    }
    return { command, source: 'AFK_HELPER' }
  }

  const sshTarget = String(env.AFK_SSH_TARGET ?? '').trim()
  if (sshTarget) {
    return {
      command: ['ssh', sshTarget, 'sudo', HELPER_PATH],
      source: 'AFK_SSH_TARGET',
    }
  }

  const server = String(env.AFK_SERVER ?? '').trim()
  if (server) {
    const key = String(env.AFK_SSH_KEY ?? '').trim()
    return {
      command: ['ssh', ...(key ? ['-i', key] : []), server, 'sudo', '-n', HELPER_PATH],
      source: 'AFK_SERVER',
    }
  }

  return null
}

/**
 * 调一次 `claude` 验证模型能用。只发一句「只回复 OK」，不改代码。
 * `exec` 可注入，单测不跑真模型。
 */
export async function probeClaudeModel({
  model,
  command = 'claude',
  exec = defaultProbeExec,
  env = process.env,
  timeoutMs = 60000,
} = {}) {
  const name = String(model ?? '').trim()
  if (!name) {
    throw new ConfigError('模型探测失败：没给模型名。设 ANTHROPIC_MODEL 或 AFK_AGENT_MODEL', {
      key: 'ANTHROPIC_MODEL',
    })
  }
  const args = ['只回复 OK', '-p', '--restricted', '--model', name]
  const result = await exec(command, args, {
    timeout: timeoutMs,
    env: { ...env, ANTHROPIC_MODEL: name },
  })
  const code = Number.isInteger(result?.code) ? result.code : 1
  if (code !== 0) {
    const detail = String(result?.stderr || result?.stdout || '').trim().slice(-500)
    throw new ConfigError(
      `模型探测失败：${command} --model ${name} 退出码 ${code}${detail ? `：${detail}` : ''}。` +
        '检查 ANTHROPIC_MODEL、ANTHROPIC_AUTH_TOKEN 和 ANTHROPIC_BASE_URL',
      { key: 'ANTHROPIC_MODEL' },
    )
  }
  return { ok: true, model: name, command }
}

async function defaultProbeExec(command, args, options) {
  try {
    const result = await execFileAsync(command, args, { ...options, maxBuffer: 1024 * 1024 })
    return { code: 0, stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? '') }
  } catch (error) {
    return {
      code: Number.isInteger(error.code) ? error.code : 1,
      stdout: String(error.stdout ?? ''),
      stderr: String(error.stderr || error.message || ''),
    }
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function typeName(value) {
  if (Array.isArray(value)) return '数组'
  if (value === null) return 'null'
  if (isPlainObject(value)) return '对象'
  return (
    { string: '字符串', number: '数字', boolean: '布尔值', undefined: '未设置' }[typeof value] ||
    typeof value
  )
}

function skipWs(text, start) {
  let i = start
  while (i < text.length && /\s/.test(text[i])) i += 1
  return i
}

function readJsonString(text, start) {
  let i = start + 1
  let value = ''
  const escapes = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '"': '"', '\\': '\\', '/': '/' }
  while (i < text.length) {
    const ch = text[i]
    if (ch === '\\') {
      const next = text[i + 1]
      if (next === 'u') {
        value += String.fromCharCode(Number.parseInt(text.slice(i + 2, i + 6), 16))
        i += 6
        continue
      }
      value += escapes[next] ?? next
      i += 2
      continue
    }
    if (ch === '"') return { value, end: i + 1 }
    value += ch
    i += 1
  }
  return { value, end: text.length }
}

function skipJsonValue(text, start) {
  let i = skipWs(text, start)
  const ch = text[i]
  if (ch === '"') return readJsonString(text, i).end
  if (ch === '[' || ch === '{') {
    let depth = 0
    while (i < text.length) {
      const c = text[i]
      if (c === '"') {
        i = readJsonString(text, i).end
        continue
      }
      if (c === '[' || c === '{') depth += 1
      else if (c === ']' || c === '}') {
        depth -= 1
        if (depth === 0) return i + 1
      }
      i += 1
    }
    return i
  }
  while (i < text.length && !/[\s,\]}]/.test(text[i])) i += 1
  return i
}

/** 找根数组或 `{customers: [...]}` 里那个数组的起点。 */
function findCustomersArrayStart(text) {
  let i = skipWs(text, 0)
  if (text[i] === '[') return i
  if (text[i] !== '{') return -1
  i = skipWs(text, i + 1)
  while (i < text.length) {
    if (text[i] !== '"') return -1
    const key = readJsonString(text, i)
    i = skipWs(text, key.end)
    if (text[i] !== ':') return -1
    i = skipWs(text, i + 1)
    if (key.value === 'customers' && text[i] === '[') return i
    i = skipWs(text, skipJsonValue(text, i))
    if (text[i] === ',') {
      i = skipWs(text, i + 1)
      continue
    }
    return -1
  }
  return -1
}

function findArrayElements(text, start) {
  const elements = []
  let i = start + 1
  let depth = 1
  let elementStart = -1
  const push = (end) => {
    if (elementStart >= 0) elements.push({ start: elementStart, end })
  }
  while (i < text.length) {
    const ch = text[i]
    if (/\s/.test(ch)) {
      i += 1
      continue
    }
    if (ch === '"') {
      if (elementStart < 0) elementStart = i
      i = readJsonString(text, i).end
      continue
    }
    if (elementStart < 0 && ch !== ']') elementStart = i
    if (ch === '[' || ch === '{') {
      depth += 1
      i += 1
      continue
    }
    if (ch === ']' || ch === '}') {
      depth -= 1
      i += 1
      if (depth === 0) {
        push(i)
        return elements
      }
      continue
    }
    if (ch === ',' && depth === 1) {
      push(i)
      elementStart = -1
      i += 1
      continue
    }
    i += 1
  }
  return elements
}

function lineAt(text, offset) {
  if (offset < 0) return 0
  let line = 1
  for (let i = 0; i < offset && i < text.length; i += 1) {
    if (text[i] === '\n') line += 1
  }
  return line
}

function keyLine(text, key, element, fallback) {
  if (!element) return fallback
  const escaped = String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`"${escaped}"\\s*:`).exec(text.slice(element.start, element.end))
  return match ? lineAt(text, element.start + match.index) : fallback
}

/** 校验 customers 文本的形状，返回客户行数组。 */
export function validateCustomersText(text, { file = '' } = {}) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new ConfigError(`customers 文件 ${file} 不是合法 JSON：${error.message}`, { file })
  }

  let rows
  if (Array.isArray(parsed)) rows = parsed
  else if (isPlainObject(parsed) && Array.isArray(parsed.customers)) rows = parsed.customers
  else {
    throw new ConfigError(
      `customers 文件 ${file} 形状不对：根必须是数组或 {customers: [...]}，现在是${typeName(parsed)}`,
      { file },
    )
  }

  const arrayStart = findCustomersArrayStart(text)
  const elements = arrayStart === -1 ? [] : findArrayElements(text, arrayStart)

  rows.forEach((row, index) => {
    const element = elements[index]
    const line = element ? lineAt(text, element.start) : 0
    const where = line ? `第 ${line} 行` : `第 ${index + 1} 个元素`
    if (!isPlainObject(row)) {
      throw new ConfigError(
        `customers 文件 ${file} ${where}：第 ${index + 1} 个客户不是对象，是${typeName(row)}`,
        { file, line },
      )
    }
    if (row.status !== 'active' && row.status !== 'disabled') {
      const statusLine = keyLine(text, 'status', element, line)
      throw new ConfigError(
        `customers 文件 ${file} 第 ${statusLine} 行：status 必须是 active 或 disabled，现在是${typeName(row.status)}`,
        { file, line: statusLine },
      )
    }
    if (row.repos !== undefined && !isPlainObject(row.repos)) {
      const reposLine = keyLine(text, 'repos', element, line)
      throw new ConfigError(
        `customers 文件 ${file} 第 ${reposLine} 行：repos 必须是对象（软件简称 → 仓名），现在是${typeName(row.repos)}`,
        { file, line: reposLine },
      )
    }
    if (isPlainObject(row.repos)) {
      for (const [product, value] of Object.entries(row.repos)) {
        if (typeof value !== 'string' || !value.trim()) {
          const productLine = keyLine(text, product, element, line)
          throw new ConfigError(
            `customers 文件 ${file} 第 ${productLine} 行：repos["${product}"] 必须是仓名字符串，现在是${typeName(value)}`,
            { file, line: productLine },
          )
        }
      }
    }
  })

  return rows
}

/** 读 customers 文件并校验形状。不合法就报错，不静默返回空数组。 */
export async function readCustomersFile(path, { readFile = readFileDefault } = {}) {
  let text
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new ConfigError(`customers 文件不存在：${path}`, { file: path })
    }
    throw new ConfigError(`读不了 customers 文件 ${path}：${error.message}`, { file: path })
  }
  return validateCustomersText(text, { file: path })
}

/**
 * 给常驻调度器用的 customers 读取器：每轮看 mtime，变了才重读并重新校验。
 *
 * 文件形状不对时抛出 ConfigError，不退回上一次的表，也不当成零个客户仓。
 * 返回的函数可以直接每轮调用。
 */
export function createCustomersReader(
  path,
  { readFile = readFileDefault, statFile = stat } = {},
) {
  let cachedRows = null
  let cachedMtime = null
  return async function readCustomers() {
    let info
    try {
      info = await statFile(path)
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new ConfigError(`customers 文件不存在：${path}`, { file: path })
      }
      throw new ConfigError(`读不了 customers 文件 ${path}：${error.message}`, { file: path })
    }
    if (cachedRows && info.mtimeMs === cachedMtime) return cachedRows
    const rows = await readCustomersFile(path, { readFile })
    cachedRows = rows
    cachedMtime = info.mtimeMs
    return rows
  }
}

async function readEnvValues({ env, envFile, readFile }) {
  const home = env.HOME || homedir()
  const explicitFile = envFile || env.AFK_ENV_FILE
  const file = explicitFile || join(home, '.afkfactory', 'env')
  try {
    const text = await readFile(file, 'utf8')
    return { file, values: parseEnvFile(text, { file }), found: true }
  } catch (error) {
    if (error instanceof ConfigError) throw error
    if (error.code === 'ENOENT') {
      if (explicitFile) {
        throw new ConfigError(`AFK_ENV_FILE 指向的文件不存在：${file}`, {
          key: 'AFK_ENV_FILE',
          file,
        })
      }
      return { file, values: {}, found: false }
    }
    throw new ConfigError(`读不了 env 文件 ${file}：${error.message}`, { file })
  }
}

/**
 * 读 env 文件和进程环境，校验启动必需的键。
 *
 * @param {object} [options]
 * @param {object} [options.env] 进程环境，默认 `process.env`
 * @param {string} [options.envFile] env 文件路径，默认 `AFK_ENV_FILE` 或 `~/.afkfactory/env`
 * @param {Function} [options.readFile] 读文件替身
 * @param {Function|null} [options.probeModel] 模型探测替身，传 null 跳过
 */
export async function loadConfig({
  env = process.env,
  envFile,
  readFile = readFileDefault,
  probeModel = probeClaudeModel,
} = {}) {
  const loaded = await readEnvValues({ env, envFile, readFile })
  const values = { ...loaded.values }
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && String(value) !== '') values[key] = String(value)
  }

  const githubToken = String(values.GITHUB_TOKEN ?? '').trim()
  if (!githubToken) {
    throw new ConfigError(missingKeyMessage('GITHUB_TOKEN', loaded.file, loaded.found), {
      key: 'GITHUB_TOKEN',
      file: loaded.file,
    })
  }

  const helper = resolveHelperCommand(values)
  if (!helper) {
    throw new ConfigError(
      '缺 helper 配置：设 AFK_HELPER（完整命令），或设 AFK_SERVER（可配 AFK_SSH_KEY）。' +
        `查过：进程环境、${loaded.file}`,
      { key: 'AFK_HELPER', file: loaded.file },
    )
  }
  const sshKey = String(values.AFK_SSH_KEY ?? '').trim()
  if (helper.source === 'AFK_SERVER' && sshKey) {
    try {
      await stat(sshKey)
    } catch {
      throw new ConfigError(
        `AFK_SSH_KEY 指向的私钥不存在：${sshKey}。查过：进程环境、${loaded.file}`,
        { key: 'AFK_SSH_KEY', file: loaded.file },
      )
    }
  }

  const modelName = String(values.AFK_AGENT_MODEL || values.ANTHROPIC_MODEL || '').trim()
  const modelCommand = String(values.AFK_AGENT_COMMAND || 'claude').trim()
  if (!modelName) {
    throw new ConfigError(
      `缺模型（ANTHROPIC_MODEL 或 AFK_AGENT_MODEL）：进程环境没有，${checkedTarget(loaded.file, loaded.found)}`,
      { key: 'ANTHROPIC_MODEL', file: loaded.file },
    )
  }
  if (/\s/.test(modelCommand)) {
    throw new ConfigError(`AFK_AGENT_COMMAND 只能是一个可执行文件，不能带参数：${modelCommand}`, {
      key: 'AFK_AGENT_COMMAND',
      file: loaded.file,
    })
  }
  if (typeof probeModel === 'function') {
    await probeModel({ model: modelName, command: modelCommand, env: values })
  }

  return {
    envFile: loaded.file,
    envFileFound: loaded.found,
    values,
    githubToken,
    helper,
    model: { name: modelName, command: modelCommand },
  }
}
