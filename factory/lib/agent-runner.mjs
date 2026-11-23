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
export const DECOMPOSE_TOOLS = 'Read,Write,Edit,Bash(node:*),Bash(gh:*)'
export const GAP_TOOLS = 'Read,Write,Edit,Bash(node:*),Bash(gh:*)'
export const VERIFY_TOOLS = 'Read,Bash(bash:*),Bash(node:*),Bash(npm:*),Bash(curl:*)'
export const REVIEW_TOOLS = 'Read,Bash(gh:*)'
export const MERGER_TOOLS = 'Read,Write,Edit,Bash(git:*)'
export const FIXER_TOOLS = 'Read,Write,Edit,Bash(git:*)'

export const DEFAULT_AGENT_TIMEOUT_MS = 45 * 60 * 1000
export const DEFAULT_KILL_GRACE_MS = 5000

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

/**
 * 起子进程。`detached: true` 让子进程成为进程组组长，取消时能一次带走孙进程；
 * 普通 spawn 的负 pid 会报 ESRCH，什么都杀不掉。先 SIGTERM，宽限期后 SIGKILL。
 */
export function defaultExec(
  command,
  args,
  { cwd, env, onStart, signal, killGraceMs = DEFAULT_KILL_GRACE_MS } = {},
) {
  if (signal?.aborted) {
    return Promise.resolve({ code: 1, stdout: '', stderr: '', aborted: true })
  }
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
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

/**
 * @param {object} [options]
 * @param {string} [options.command] 默认 `claude`
 * @param {string} [options.model] 模型名，默认 AFK_AGENT_MODEL 或 ANTHROPIC_MODEL；缺了直接报错
 * @param {Function} [options.exec] 测试替身 `(command, args, {cwd, env, signal}) => {code, stdout, stderr}`
 * @param {string} [options.briefDir] brief 文件放哪，默认新建临时目录
 * @param {string|string[]} [options.allowedTools] 默认工具白名单
 * @param {string|string[]} [options.tools] `--tools` 的可用工具集合，默认 Bash,Read,Write,Edit
 * @param {number} [options.timeoutMs] 单次 agent 硬上限，默认 AFK_AGENT_TIMEOUT_MS 或 45 分钟
 */
export function createAgentRunner({
  command = 'claude',
  model = process.env.AFK_AGENT_MODEL || process.env.ANTHROPIC_MODEL || '',
  exec = defaultExec,
  briefDir,
  allowedTools = [],
  tools = AGENT_TOOLS,
  timeoutMs = Number(process.env.AFK_AGENT_TIMEOUT_MS) || DEFAULT_AGENT_TIMEOUT_MS,
} = {}) {
  const modelName = String(model || '').trim()
  if (!modelName) {
    throw new Error('agent runner 缺模型：设 AFK_AGENT_MODEL 或 ANTHROPIC_MODEL')
  }

  async function run({
    brief,
    cwd,
    env,
    name = 'brief',
    extraArgs = [],
    allowedTools: runTools,
    tools: runToolSet,
    signal,
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
      '--model',
      modelName,
      ...(toolSet.length ? ['--tools', toolSet.join(',')] : []),
      ...(allowed.length ? ['--allowedTools', allowed.join(',')] : []),
    ]
    if (signal?.aborted) {
      return {
        ok: false,
        code: 1,
        stdout: '',
        stderr: '',
        aborted: true,
        reason: 'aborted',
        briefPath,
        command,
        args,
      }
    }

    const controller = new AbortController()
    let timedOut = false
    const onAbort = () => controller.abort(signal.reason)
    signal?.addEventListener?.('abort', onAbort, { once: true })
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true
            controller.abort(new Error('agent 超时'))
          }, timeoutMs)
        : null
    timer?.unref?.()

    let result
    try {
      result = await exec(command, args, { cwd, env, signal: controller.signal })
    } finally {
      if (timer) clearTimeout(timer)
      signal?.removeEventListener?.('abort', onAbort)
    }
    const code = Number.isInteger(result?.code) ? result.code : 1
    const stdout = String(result?.stdout || '')
    const stderr = String(result?.stderr || '')
    const authMessage = authFailureMessage(stdout, stderr)
    const aborted = Boolean(result?.aborted || signal?.aborted || timedOut)
    return {
      ok: code === 0 && !timedOut,
      code,
      stdout,
      stderr,
      ...(timedOut ? { timedOut: true, reason: 'agent-timeout' } : {}),
      ...(aborted ? { aborted: true } : {}),
      ...(authMessage ? { authFailure: true, authMessage } : {}),
      briefPath,
      command,
      args,
    }
  }

  return { run }
}
