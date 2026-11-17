#!/usr/bin/env node
/**
 * 拆票命令行。提案阶段只打印评论，点头后才建票。
 *
 *   node factory/bin/tickets.mjs proposal --seams <接缝.txt> --tickets <票.json>
 *   node factory/bin/tickets.mjs create --owner <owner> --repo <repo> --parent <父工单号> --tickets <票.json>
 *   node factory/bin/tickets.mjs point --count <建了几张>
 *
 * 建票默认用环境变量 `GITHUB_TOKEN` 建客户端；测试注入 `gh`。
 */
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { gateKind } from '../lib/gate.mjs'
import { createGithub } from '../lib/github.mjs'
import { ensureCommentOnce } from '../lib/issues.mjs'
import {
  createTickets,
  parseTicketsPayload,
  renderPoint,
  renderProposal,
} from '../lib/tickets.mjs'

function option(argv, name) {
  const index = argv.indexOf(name)
  if (index === -1) throw new Error(`缺 ${name}`)
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`缺 ${name} 的值`)
  return value
}

async function readJson(path) {
  const text = await readFile(path, 'utf8')
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`不是合法 JSON：${path}`)
  }
}

export async function run(argv = process.argv.slice(2), { gh, out = console.log } = {}) {
  const command = argv[0]

  if (command === 'proposal') {
    const seamsPath = option(argv, '--seams')
    const tickets = await readJson(option(argv, '--tickets'))
    const seams = (await readFile(seamsPath, 'utf8'))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    const body = renderProposal({ seams, tickets })
    out(body)
    return body
  }

  if (command === 'point') {
    const count = Number(option(argv, '--count'))
    if (!Number.isInteger(count) || count < 0) throw new Error('--count 必须是非负整数')
    const body = renderPoint({ count })
    out(body)
    return body
  }

  if (command === 'create') {
    const owner = option(argv, '--owner')
    const repo = option(argv, '--repo')
    const parent = Number(option(argv, '--parent'))
    const client = gh || createGithub({ token: process.env.GITHUB_TOKEN || '' })
    let tickets
    if (argv.includes('--from-proposal')) {
      const comments = await client.listComments({ owner, repo, number: parent })
      const proposal = [...comments]
        .reverse()
        .find((comment) => gateKind(comment.body) === '提案：拆票')
      tickets = proposal ? parseTicketsPayload(proposal.body) : null
      if (!tickets) throw new Error('父工单上没有可解析的提案：拆票票单')
    } else {
      tickets = await readJson(option(argv, '--tickets'))
    }
    const result = await createTickets({ gh: client, owner, repo, parent, tickets })
    if (argv.includes('--point')) {
      await ensureCommentOnce(client, {
        owner,
        repo,
        number: parent,
        body: renderPoint({ count: result.tickets.length }),
      })
    }
    out(JSON.stringify(result, null, 2))
    return result
  }

  throw new Error(`未知命令：${command || '（空）'}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
