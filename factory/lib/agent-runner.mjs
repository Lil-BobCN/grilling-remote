/**
 * 默认 agent runner：跑一次无头 Claude Code 会话，只用来做验证、评审、解冲突。
 *
 * 命令默认 `claude`，参数 `-p --restricted`，brief 正文作为提示词传进去，
 * 同时写到临时文件里，方便调度器事后查这一跑到底给了什么。
 * 测试注入 `exec`，不跑真模型。
 */
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function safeName(name) {
  return String(name || 'brief')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'brief'
}

/** `--restricted` 会去掉跑命令的工具，必须用 `--tools` 点名它们。 */
export const AGENT_TOOLS = 'Bash,Read,Write,Edit'
/**
 * 验证和评审不给 Write/Edit，和作业说明里的「不改代码」一致。
 * 注意：Bash 仍能写文件，这组工具只挡住直接编辑。
 */
export const NO_WRITE_TOOLS = 'Bash,Read'

/** 各角色的工具白名单；`--allowedTools` 用逗号分隔。 */
export const DECOMPOSE_TOOLS = 'Read,Write,Edit,Bash(gh:*)'
export const GAP_TOOLS = 'Read,Write,Edit,Bash(node:*),Bash(gh:*)'
export const VERIFY_TOOLS = 'Read,Bash(bash:*),Bash(node:*),Bash(npm:*),Bash(curl:*)'
export const REVIEW_TOOLS = 'Read,Bash(gh:*)'
export const MERGER_TOOLS = 'Read,Write,Edit,Bash(git:*)'
export const FIXER_TOOLS = 'Read,Write,Edit,Bash(git:*)'

function toolList(value) {
  const rows = Array.isArray(value) ? value : String(value || '').split(',')
  return rows.map((item) => String(item).trim()).filter(Boolean)
}

/**
 * 认证、额度失败的特征串。`unrecognized_model` 只是警告，每次调用都有，不能算。
 * 真实 `claude -p` 的错误可能落在 stdout，也可能落在 stderr，两边都查。
 */
const AUTH_FAILURE_PATTERNS = [
  /API Error: 401\b/,
  /API Error: 402\b/,
  /API Error: 403\b/,
  /用户额度不足/,
  /Insufficient Balance/,
]

function authFailureMessage(stdout, stderr) {
  for (const line of `${stdout}\n${stderr}`.split('\n')) {
    if (AUTH_FAILURE_PATTERNS.some((pattern) => pattern.test(line))) {
      return line.trim()
    }
  }
  return ''
}

export function defaultExec(command, args, { cwd, env, onStart } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
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

/**
 * @param {object} [options]
 * @param {string} [options.command] 默认 `claude`
 * @param {Function} [options.exec] 测试替身 `(command, args, {cwd, env}) => {code, stdout, stderr}`
 * @param {string} [options.briefDir] brief 文件放哪，默认新建临时目录
 * @param {string|string[]} [options.allowedTools] 默认工具白名单
 * @param {string|string[]} [options.tools] `--tools` 的可用工具集合，默认 Bash,Read,Write,Edit
 */
export function createAgentRunner({
  command = 'claude',
  exec = defaultExec,
  briefDir,
  allowedTools = [],
  tools = AGENT_TOOLS,
} = {}) {
  async function run({
    brief,
    cwd,
    env,
    name = 'brief',
    extraArgs = [],
    allowedTools: runTools,
    tools: runToolSet,
  } = {}) {
    const text = String(brief ?? '')
    if (!text.trim()) throw new Error('agent runner 缺 brief')

    const dir = briefDir || (await mkdtemp(join(tmpdir(), 'afkfactory-brief-')))
    const briefPath = join(dir, `${safeName(name)}.md`)
    await writeFile(briefPath, text, 'utf8')

    const toolSet = toolList(runToolSet === undefined ? tools : runToolSet)
    const allowed = toolList(runTools === undefined ? allowedTools : runTools)
    // 提示词放最前。`--tools`、`--allowedTools` 接收多个值，放后面会把提示词一起吞掉。
    const args = [
      text,
      ...extraArgs,
      '-p',
      '--restricted',
      ...(toolSet.length ? ['--tools', toolSet.join(',')] : []),
      ...(allowed.length ? ['--allowedTools', allowed.join(',')] : []),
    ]
    const result = await exec(command, args, { cwd, env })
    const code = Number.isInteger(result?.code) ? result.code : 1
    const stdout = String(result?.stdout || '')
    const stderr = String(result?.stderr || '')
    const authMessage = authFailureMessage(stdout, stderr)
    return {
      ok: code === 0,
      code,
      stdout,
      stderr,
      ...(authMessage ? { authFailure: true, authMessage } : {}),
      briefPath,
      command,
      args,
    }
  }

  return { run }
}
