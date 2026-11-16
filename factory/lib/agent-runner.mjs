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

/** 各角色的工具白名单；`--allowedTools` 用逗号分隔。 */
export const DECOMPOSE_TOOLS = 'Read,Write,Edit,Bash(gh:*)'
export const VERIFY_TOOLS = 'Read,Write,Edit,Bash(bash:*),Bash(node:*),Bash(npm:*),Bash(curl:*)'
export const REVIEW_TOOLS = 'Read,Write,Edit,Bash(gh:*)'
export const MERGER_TOOLS = 'Read,Write,Edit,Bash(git:*)'
export const FIXER_TOOLS = 'Read,Write,Edit,Bash(git:*)'

function toolList(value) {
  const rows = Array.isArray(value) ? value : String(value || '').split(',')
  return rows.map((item) => String(item).trim()).filter(Boolean)
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
    const args = [
      '-p',
      '--restricted',
      ...(toolSet.length ? ['--tools', toolSet.join(',')] : []),
      ...(allowed.length ? ['--allowedTools', allowed.join(',')] : []),
      ...extraArgs,
      text,
    ]
    const result = await exec(command, args, { cwd, env })
    const code = Number.isInteger(result?.code) ? result.code : 1
    return {
      ok: code === 0,
      code,
      stdout: String(result?.stdout || ''),
      stderr: String(result?.stderr || ''),
      briefPath,
      command,
      args,
    }
  }

  return { run }
}
