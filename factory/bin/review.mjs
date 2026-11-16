#!/usr/bin/env node
/**
 * 评审 agent 的命令行入口。跑完把 `phase=review` 追加到 `.audit/<票号>.tsv`。
 *
 *   node factory/bin/review.mjs --repo-dir <路径> --ticket <票号> --branch <分支或提交> \
 *     [--mode standards|spec|interrogate]
 *
 * 不写 `--mode` 时同时写「标准」和 `spec` 两行；高风险票另跑 `--mode interrogate`。
 * 默认跑 `claude -p --restricted`；测试注入 `runner`。
 * 输出一行 JSON，`ok` 为 false 时退出码 1。
 */
import { fileURLToPath } from 'node:url'
import { createAgentRunner } from '../lib/agent-runner.mjs'
import { runReviewAudit } from '../lib/audit-agents.mjs'

const USAGE = `用法：
  node factory/bin/review.mjs --repo-dir <路径> --ticket <票号> --branch <分支或提交> [--mode standards|spec|interrogate]`

function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

export function parseArgs(argv) {
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

export async function run(argv = process.argv.slice(2), deps = {}) {
  const options = parseArgs(argv)
  const repoDir = options['repo-dir'] || process.cwd()
  const ticket = Number(options.ticket)
  if (!Number.isInteger(ticket) || ticket <= 0 || !options.branch) throw new Error(USAGE)

  const runner =
    deps.runner ||
    createAgentRunner({
      command: options['agent-command'] || process.env.AFK_AGENT_COMMAND || 'claude',
    })
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

async function main() {
  try {
    const { output, exitCode } = await run()
    process.stdout.write(`${JSON.stringify(output)}\n`)
    if (exitCode !== 0) process.exitCode = exitCode
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: errorText(error) })}\n`)
    process.exitCode = 2
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}
