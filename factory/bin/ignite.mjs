#!/usr/bin/env node
/**
 * 手工点火一张票。
 *
 *   node factory/bin/ignite.mjs --owner <owner> --repo <repo> --parent <父工单号> --ticket <子票号>
 *   node factory/bin/ignite.mjs ... --dry-run
 *
 * `--dry-run` 只读 GitHub 和本地客户仓，打印拼好的 prompt 和要跑的命令，不贴标签、
 * 不写评论、不跑容器。
 */
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createGithub } from '../lib/github.mjs'
import { buildPromptForTicket, createIgnite, parentOrder } from '../lib/ignition.mjs'
import { createNotifier } from '../lib/notify.mjs'
import { createSandcastleRunner, defaultExec } from '../lib/sandcastle-runner.mjs'

function option(argv, name, fallback) {
  const index = argv.indexOf(name)
  if (index === -1) return fallback
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`缺 ${name} 的值`)
  return value
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function tail(result, limit = 2000) {
  const text = String(result?.stderr || result?.stdout || '').trim()
  return text.length > limit ? text.slice(-limit) : text
}

export function createGhOpenPr({ token = process.env.GITHUB_TOKEN || '', exec = defaultExec } = {}) {
  return async function openPr({ repoDir, base, head, title, body }) {
    const env = { ...process.env }
    if (token) env.GH_TOKEN = token
    const result = await exec(
      'gh',
      ['pr', 'create', '--base', base, '--head', head, '--title', title, '--body', body],
      { cwd: repoDir, env },
    )
    if (result.code !== 0) {
      throw new Error(`gh pr create 失败（退出码 ${result.code}）：${tail(result)}`)
    }
    return { url: String(result.stdout || '').trim() }
  }
}

/**
 * @param {string[]} argv
 * @param {object} [deps] 测试注入：gh、runner、openPr、notifier、out、clock、config
 */
export async function run(argv = process.argv.slice(2), deps = {}) {
  const { gh, runner, openPr, notifier, out = console.log, clock, config = {} } = deps
  const owner = option(argv, '--owner', process.env.GITHUB_OWNER || '')
  const repo = option(argv, '--repo', '')
  const parentNumber = option(argv, '--parent', '')
  const ticketNumber = option(argv, '--ticket', '')
  if (!owner) throw new Error('缺 --owner（或环境变量 GITHUB_OWNER）')
  if (!repo) throw new Error('缺 --repo')
  if (!parentNumber) throw new Error('缺 --parent')
  if (!ticketNumber) throw new Error('缺 --ticket')

  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || ''
  const client = gh || createGithub({ token })
  const parent = await client.getIssue({ owner, repo, number: Number(parentNumber) })
  const ticket = await client.getIssue({ owner, repo, number: Number(ticketNumber) })
  const order = parentOrder(parent.body)
  const repoRoot =
    config.repoRoot ||
    process.env.AFK_REPO_ROOT ||
    join(homedir(), '.afkfactory', 'repos')
  const repoDir = join(repoRoot, repo)

  if (argv.includes('--dry-run')) {
    const local = await exists(repoDir)
    const prompt = await buildPromptForTicket({
      gh: client,
      owner,
      repo,
      parent,
      ticket,
      repoDir: local ? repoDir : '',
    })
    out(prompt)
    out(local ? `# 本地客户仓：${repoDir}` : `# 本地客户仓：${repoDir}（还没 checkout）`)
    out(`# 分支：req/${order} → ticket/${ticket.number}`)
    out(`# prompt 文件：${join(repoDir, '.sandcastle', `prompt-${ticket.number}.md`)}（dry-run 不写）`)
    out(`# 凭证：${join(repoDir, '.sandcastle', '.env')}`)
    out(
      `# 镜像：${process.env.AFK_SANDCASTLE_IMAGE || '取 .env 的 SANDCASTLE_IMAGE，没有就用 sandcastle:' + repo}`,
    )
    out(`# openPr：gh pr create --base req/${order} --head ticket/${ticket.number}`)
    return { ok: true, dryRun: true, prompt }
  }

  const sandcastleHome =
    process.env.AFK_SANDCASTLE_HOME || join(homedir(), '.afkfactory', 'sandcastle')
  const timeoutMs =
    config.timeoutMs ?? (Number(process.env.AFK_IGNITE_TIMEOUT_MS) || 120000)
  const ignite = createIgnite({
    config: {
      ...config,
      gh: client,
      owner,
      repoRoot,
      lockDir:
        config.lockDir ||
        process.env.AFK_LOCK_DIR ||
        join(homedir(), '.grilling', 'factory', 'locks'),
      image: config.image ?? process.env.AFK_SANDCASTLE_IMAGE ?? '',
      timeoutMs,
      token,
    },
    runner:
      runner ||
      createSandcastleRunner({ home: sandcastleHome, env: process.env }),
    openPr: openPr || createGhOpenPr({ token }),
    notifier: notifier || createNotifier({ home: process.env.NOTIFIER_HOME }),
    clock,
  })

  const result = await ignite({ owner, repo, parent, ticket })
  out(JSON.stringify(result))
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run()
    .then((result) => {
      if (result?.ok === false) process.exitCode = 1
    })
    .catch((error) => {
      console.error(error.message)
      process.exit(1)
    })
}
