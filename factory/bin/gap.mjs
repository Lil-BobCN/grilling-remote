#!/usr/bin/env node
/**
 * 补缺口 Agent 的命令行入口。
 *
 *   node factory/bin/gap.mjs apply-map --scratch <目录> --owner <owner> --repo <仓> \
 *     --requirement <需求名> --parent <父工单链接> [--mode replace]
 *   node factory/bin/gap.mjs propose --scratch <目录> --owner <owner> --repo <仓> --number <地图编号> \
 *     [--recommendations <推荐答案.json>] [--compliance "<一句话>"]
 *   node factory/bin/gap.mjs propose --scratch <目录> --owner <owner> --repo <仓> --parent <父工单> \
 *     [--compliance "<一句话>"]
 *   node factory/bin/gap.mjs point --owner <owner> --repo <仓> --number <父工单编号> \
 *     --answers '<JSON>'
 *   node factory/bin/gap.mjs point-small --owner <owner> --repo <仓> --parent <父工单> \
 *     --scratch <目录> --answers '<JSON>'
 *
 * `propose` 看 `--scratch` 里有没有 `需求草稿.md`、没有 `map.md`：是小需求就用
 * `--parent`，提案末尾列实现票。其余单仍用 `--number` 指定地图。
 * `--answers` 接受数组，或 `{ "answers": [...], "impacts": [...] }`。
 * `--recommendations` 用题目或出处作键，给业务题补推荐答案。
 * 默认用 `GITHUB_TOKEN` 建客户端；测试传 `{ gh }` 注入假 GitHub。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { draftProposal, postPoint, postProposal } from '../lib/gap.mjs'
import { createGithub } from '../lib/github.mjs'
import { ensureMapIssues, parseMap, readDecisionTickets } from '../lib/map-issues.mjs'
import {
  isSmallRequirement,
  pointSmallRequirement,
  renderSmallProposal,
} from '../lib/small.mjs'

function parseOptions(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    if (!flag || !flag.startsWith('--')) throw new Error(`多出来的参数：${flag}`)
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`缺 ${flag} 的值`)
    options[flag.slice(2)] = value
  }
  return options
}

function required(options, name) {
  if (!options[name]) throw new Error(`缺 --${name}`)
  return options[name]
}

function issueNumberFromUrl(url) {
  const match = /\/issues\/(\d+)(?:[#?].*)?\/?$/.exec(String(url || '').trim())
  return match ? Number(match[1]) : null
}

/** `--parent` 接受 issue 链接、`#12` 或 `12`。 */
function parentNumberFrom(value) {
  const fromUrl = issueNumberFromUrl(value)
  if (fromUrl) return fromUrl
  const bare = /^\s*#?(\d+)\s*$/.exec(String(value || ''))
  if (bare) return Number(bare[1])
  throw new Error(`--parent 读不出父工单编号：${value}`)
}

function parentUrlFromMapBody(body) {
  const marker = /<!--\s*factory:parent=(\S+?)\s*-->/m.exec(String(body || ''))
  if (marker) return marker[1]
  const notes = /^-\s*父工单：(\S+)/m.exec(String(body || ''))
  return notes ? notes[1] : ''
}

export async function run(argv, { gh, log = console } = {}) {
  const [command, ...rest] = argv
  const options = parseOptions(rest)
  const client = gh || createGithub({ token: process.env.GITHUB_TOKEN || '' })
  const owner = required(options, 'owner')
  const repo = required(options, 'repo')

  if (command === 'apply-map') {
    const result = await ensureMapIssues({
      gh: client,
      owner,
      repo,
      requirement: required(options, 'requirement'),
      scratchDir: required(options, 'scratch'),
      parentIssueUrl: required(options, 'parent'),
      mode: options.mode || 'add',
    })
    if (result.skipped) {
      log.log(JSON.stringify({ skipped: result.skipped }))
      return result
    }
    const summary = {
      map: result.mapIssue.html_url,
      number: result.mapIssue.number,
      tickets: result.tickets.map((ticket) => ({
        number: ticket.number,
        title: ticket.title,
        issue: ticket.issue.html_url,
        created: ticket.created,
      })),
    }
    log.log(JSON.stringify(summary))
    return result
  }

  if (command === 'propose') {
    const scratchDir = required(options, 'scratch')
    if (await isSmallRequirement(scratchDir)) {
      const parentNumber = parentNumberFrom(required(options, 'parent'))
      const parentIssue = await client.getIssue({ owner, repo, number: parentNumber })
      const proposal = await renderSmallProposal({
        scratchDir,
        parentIssue,
        compliance: options.compliance,
      })
      const posted = await postProposal({
        gh: client,
        owner,
        repo,
        number: parentNumber,
        body: proposal.body,
      })
      log.log(
        JSON.stringify({
          posted,
          parent: parentNumber,
          questions: proposal.questions.length,
          small: true,
        }),
      )
      return { posted, parent: parentNumber, questions: proposal.questions, small: true }
    }

    const mapNumber = Number(required(options, 'number'))
    const mapIssue = await client.getIssue({ owner, repo, number: mapNumber })
    const parentUrl = parentUrlFromMapBody(mapIssue.body)
    const parentNumber = issueNumberFromUrl(parentUrl)
    if (!parentNumber) throw new Error('地图正文里找不到父工单链接')
    const map = parseMap(await readFile(join(scratchDir, 'map.md'), 'utf8'))
    const tickets = await readDecisionTickets(join(scratchDir, 'issues'))
    const recommendations = options.recommendations
      ? JSON.parse(await readFile(options.recommendations, 'utf8'))
      : {}
    const proposal = await draftProposal({
      scratchDir,
      map,
      tickets,
      mapUrl: mapIssue.html_url,
      recommendations,
      compliance: options.compliance,
    })
    const posted = await postProposal({
      gh: client,
      owner,
      repo,
      number: parentNumber,
      body: proposal.body,
    })
    log.log(JSON.stringify({ posted, parent: parentNumber, questions: proposal.questions.length }))
    return { posted, parent: parentNumber, questions: proposal.questions }
  }

  if (command === 'point') {
    const parentNumber = Number(required(options, 'number'))
    const parent = await client.getIssue({ owner, repo, number: parentNumber })
    const mapUrl = /^-\s*地图：(\S+)/m.exec(String(parent.body || ''))?.[1] || ''
    const mapIssueNumber = issueNumberFromUrl(mapUrl)
    if (!mapIssueNumber) throw new Error('父工单正文里找不到地图链接')
    const raw = JSON.parse(required(options, 'answers'))
    const { answers, impacts } = Array.isArray(raw) ? { answers: raw, impacts: [] } : raw
    const posted = await postPoint({
      gh: client,
      owner,
      repo,
      number: parentNumber,
      mapIssueNumber,
      parentIssueUrl: parent.html_url,
      answers,
      impacts,
    })
    log.log(JSON.stringify({ posted, parent: parentNumber }))
    return { posted, parent: parentNumber }
  }

  if (command === 'point-small') {
    const parentNumber = parentNumberFrom(required(options, 'parent'))
    const result = await pointSmallRequirement({
      gh: client,
      owner,
      repo,
      parent: parentNumber,
      scratchDir: required(options, 'scratch'),
      operatorAnswers: JSON.parse(required(options, 'answers')),
    })
    log.log(
      JSON.stringify({
        posted: result.posted,
        parent: parentNumber,
        ticket: result.ticket.number,
      }),
    )
    return { posted: result.posted, parent: parentNumber, ticket: result.ticket.number }
  }

  throw new Error(`未知命令：${command || '（空）'}`)
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  run(process.argv.slice(2)).catch((error) => {
    console.error(error.message)
    if (Array.isArray(error.blockers)) {
      for (const blocker of error.blockers) console.error(`- ${blocker.text}`)
    }
    process.exit(1)
  })
}
