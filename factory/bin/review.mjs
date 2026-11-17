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
import { auditMain, runReviewCli } from './audit-cli.mjs'

const USAGE = `用法：
  node factory/bin/review.mjs --repo-dir <路径> --ticket <票号> --branch <分支或提交> [--mode standards|spec|interrogate]`

export function run(argv = process.argv.slice(2), deps = {}) {
  return runReviewCli(argv, deps)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await auditMain(() => run(), USAGE)
}
