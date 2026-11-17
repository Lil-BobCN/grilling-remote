/**
 * 验证和评审 CLI 的公共部分：参数解析、跑 agent、输出 JSON 和退出码。
 * `verify.mjs` 和 `review.mjs` 只按角色分派，不再各留一份。
 */
import { createAgentRunner } from '../lib/agent-runner.mjs'
import { runReviewAudit, runVerifyAudit } from '../lib/audit-agents.mjs'

export function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

export function parseAuditArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) throw new Error(`不认识的参数：${arg}`)
    const key = arg.slice(2)
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`${arg} 后面要跟值`)
    options[key] = value
    index += 1
  }
  return options
}

function common({ argv, deps }) {
  const options = parseAuditArgs(argv)
  const repoDir = options['repo-dir'] || process.cwd()
  const ticket = Number(options.ticket)
  if (!Number.isInteger(ticket) || ticket <= 0 || !options.branch) {
    throw new Error('要 --repo-dir、--ticket 和 --branch')
  }
  const runner =
    deps.runner ||
    createAgentRunner({
      command: options['agent-command'] || process.env.AFK_AGENT_COMMAND || 'claude',
    })
  return { options, repoDir, ticket, runner }
}

export async function runVerifyCli(argv = [], deps = {}) {
  const { options, repoDir, ticket, runner } = common({ argv, deps })
  const result = await runVerifyAudit({
    repoDir,
    ticket,
    branch: options.branch,
    before: options.before || '',
    runner,
    now: deps.now,
  })
  return { output: result, exitCode: result.ok ? 0 : 1 }
}

export async function runReviewCli(argv = [], deps = {}) {
  const { options, repoDir, ticket, runner } = common({ argv, deps })
  const result = await runReviewAudit({
    repoDir,
    ticket,
    branch: options.branch,
    mode: options.mode || 'all',
    runner,
    now: deps.now,
  })
  return { output: result, exitCode: result.ok ? 0 : 1 }
}

/** 统一的命令行收尾：成功和失败都写一行 JSON，失败退出码 1，参数错 2。 */
export async function auditMain(run, usage) {
  try {
    const { output, exitCode } = await run()
    process.stdout.write(`${JSON.stringify(output)}\n`)
    if (exitCode !== 0) process.exitCode = exitCode
  } catch (error) {
    if (/^要 --repo-dir/.test(errorText(error)) || /不认识|后面要跟值/.test(errorText(error))) {
      process.stderr.write(`${usage}\n`)
      process.exitCode = 2
      return
    }
    process.stderr.write(`${JSON.stringify({ ok: false, error: errorText(error) })}\n`)
    process.exitCode = 2
  }
}
