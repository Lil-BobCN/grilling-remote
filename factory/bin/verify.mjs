#!/usr/bin/env node
/**
 * 验证 agent 的命令行入口。跑完把 `phase=verify` 和 `phase=test` 追加到
 * `.audit/<票号>.tsv`，不改代码，不提交。
 *
 *   node factory/bin/verify.mjs --repo-dir <路径> --ticket <票号> --branch <分支或提交> [--before <改前提交>]
 *
 * 默认跑 `claude -p --restricted`；测试注入 `runner`。
 * 输出一行 JSON，`ok` 为 false 时退出码 1。
 */
import { fileURLToPath } from 'node:url'
import { auditMain, runVerifyCli } from './audit-cli.mjs'

const USAGE = `用法：
  node factory/bin/verify.mjs --repo-dir <路径> --ticket <票号> --branch <分支或提交> [--before <改前提交>]`

export function run(argv = process.argv.slice(2), deps = {}) {
  return runVerifyCli(argv, deps)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await auditMain(() => run(), USAGE)
}
