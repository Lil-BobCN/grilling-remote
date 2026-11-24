#!/usr/bin/env node
/**
 * 清图命令：bot 陪运营者清地图的写回入口。
 *
 *   node factory/bin/map.mjs list --owner <owner> --repo <裸仓库名> --parent <父工单>
 *   node factory/bin/map.mjs init --owner <owner> --repo <裸仓库名> --parent <父工单>
 *   node factory/bin/map.mjs ticket --owner <owner> --repo <裸仓库名> --parent <父工单> \
 *     --title <标题> --type <grilling|research|prototype|task> --question <正文> --from-item <原文>
 *   node factory/bin/map.mjs conclude --owner <owner> --repo <裸仓库名> --parent <父工单> \
 *     --ticket <编号或标题前缀> --conclusion <一句话>
 *   node factory/bin/map.mjs defer --owner <owner> --repo <裸仓库名> --parent <父工单> \
 *     --item <原文> --to <out-of-scope|notes> [--reason <理由>] [--who <谁回话>] [--next <下一步>]
 *   node factory/bin/map.mjs check --owner <owner> --repo <裸仓库名> --parent <父工单>
 *
 * `--owner` 和 `--repo` 与 `gap.mjs`、`tickets.mjs` 一致：`--repo` 只接裸仓库名。
 *
 * 所有命令幂等：重复跑不建第二张票、不写第二条评论、不重复加行。
 * 地图从父工单的 `- 地图：<链接>` 找，并校验地图正文的父工单链接。
 * `--parent` 收工单链接、`#12` 或 `12`。输出一行 JSON；`check` 不通过退出码 1。
 */
import { pathToFileURL } from 'node:url'
import { gateReady } from '../lib/gap.mjs'
import { createGithub } from '../lib/github.mjs'
import { ensureCommentOnce, ensureLabel, ensureSubIssue } from '../lib/issues.mjs'
import {
  MapClearingError,
  addNextTicket,
  addProtocolMarker,
  appendDecision,
  appendOutOfScope,
  appendUnsettledNote,
  conclusionOf,
  hasProtocol,
  itemsOf,
  nextTicketNumber,
  outOfScopeLine,
  removeFogItem,
  removeNextTicket,
  renderDecisionTicket,
  sectionText,
  stripTicketNumber,
  ticketNumberOf,
  unsettledLine,
} from '../lib/map-clearing.mjs'
import {
  issueNumberFromUrl,
  mapBelongsToParent,
  TICKET_TYPES,
  TYPE_LABELS,
} from '../lib/map-issues.mjs'

const COMMANDS = ['list', 'init', 'ticket', 'conclude', 'defer', 'check']

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

/** `--parent` 接受 issue 链接、`#12` 或 `12`。 */
function parentNumberFrom(value) {
  const fromUrl = issueNumberFromUrl(value)
  if (fromUrl) return fromUrl
  const bare = /^\s*#?(\d+)\s*$/.exec(String(value || ''))
  if (bare) return Number(bare[1])
  throw new Error(`--parent 读不出父工单编号：${value}`)
}

async function resolveMap({ gh, owner, repo, parentInput }) {
  const parentNumber = parentNumberFrom(parentInput)
  const parentIssue = await gh.getIssue({ owner, repo, number: parentNumber })
  const mapUrl = /^-\s*地图：(\S+)/m.exec(String(parentIssue.body || ''))?.[1] || ''
  const mapNumber = issueNumberFromUrl(mapUrl)
  if (!mapNumber) {
    throw new Error(`父工单 #${parentNumber} 正文里找不到「- 地图：<链接>」，先跑 apply-map`)
  }
  const mapIssue = await gh.getIssue({ owner, repo, number: mapNumber })
  if (!mapBelongsToParent(mapIssue.body, parentIssue.html_url)) {
    throw new Error(
      `地图 #${mapNumber} 不属于父工单 #${parentNumber}：地图正文里没有父工单链接，` +
        '可能指到了旧图，先修父工单里的地图链接',
    )
  }
  return { parentIssue, mapIssue }
}

function ticketSummary(issue) {
  return { number: issue.number, title: issue.title, url: issue.html_url }
}

function findFogItem(section, item) {
  const target = String(item ?? '').trim()
  for (const line of String(section || '').split('\n')) {
    const stripped = line.replace(/^\s*[-*]\s+/, '').trim()
    if (stripped === target) return target
  }
  return null
}

function findTicket(children, raw) {
  const text = String(raw ?? '').trim()
  if (!text) return null
  // 「编号」先按标题前缀找，`06` 能直接对上 `06 送货范围怎么定`。
  const byTitle = children.find((row) => String(row.title).startsWith(text))
  if (byTitle) return byTitle
  const bare = /^#?(\d+)$/.exec(text)
  if (bare) {
    const number = Number(bare[1])
    return children.find((row) => row.number === number) || null
  }
  return children.find((row) => stripTicketNumber(row.title).startsWith(text)) || null
}

async function commandList({ gh, owner, repo, mapIssue }) {
  const body = mapIssue.body || ''
  const children = await gh.listSubIssues({ owner, repo, number: mapIssue.number })
  const notes = sectionText(body, 'Notes') || ''
  return {
    map: mapIssue.html_url,
    fog: itemsOf(sectionText(body, 'Not yet specified') || ''),
    next: itemsOf(sectionText(body, '接下来') || '').filter((item) => item !== '无'),
    openTickets: children.filter((row) => row.state !== 'closed').map(ticketSummary),
    closedTickets: children.filter((row) => row.state === 'closed').map(ticketSummary),
    decisions: itemsOf(sectionText(body, 'Decisions so far') || ''),
    deferred: itemsOf(notes).filter((item) => /^未定[：:]/.test(item)),
    protocol: hasProtocol(body),
  }
}

async function commandInit({ gh, owner, repo, mapIssue }) {
  const added = !hasProtocol(mapIssue.body)
  if (added) {
    await gh.updateIssue({
      owner,
      repo,
      number: mapIssue.number,
      body: addProtocolMarker(mapIssue.body),
    })
  }
  return { map: mapIssue.html_url, added }
}

async function commandTicket({ gh, owner, repo, mapIssue, options }) {
  const title = required(options, 'title')
  const type = required(options, 'type')
  if (!TICKET_TYPES.includes(type)) {
    throw new Error(`--type 要填 ${TICKET_TYPES.join('、')} 之一`)
  }
  const plainTitle = stripTicketNumber(title)
  if (!plainTitle) throw new Error('--title 是空的')
  const question = required(options, 'question')
  const fromItem = String(required(options, 'from-item')).trim()

  const body = mapIssue.body || ''
  const children = await gh.listSubIssues({ owner, repo, number: mapIssue.number })
  const fog = sectionText(body, 'Not yet specified')
  if (fog === null) throw new MapClearingError('地图缺「Not yet specified」段')
  const fogItem = findFogItem(fog, fromItem)
  const existing = children.find((row) => stripTicketNumber(row.title) === plainTitle) || null

  let issue = existing
  let created = false
  let removedItem = null

  if (fogItem !== null) {
    removedItem = fogItem
    let nextBody = removeFogItem(body, fogItem)
    if (issue) {
      const number = ticketNumberOf(issue.title)
      if (number !== null) nextBody = addNextTicket(nextBody, number, plainTitle)
      if (nextBody !== body) {
        await gh.updateIssue({ owner, repo, number: mapIssue.number, body: nextBody })
      }
    } else {
      const number = nextTicketNumber(children.map((row) => row.title))
      const rendered = renderDecisionTicket({ number, title: plainTitle, question })
      await ensureLabel(gh, { owner, repo, name: `wayfinder:${type}`, ...TYPE_LABELS[type] })
      issue = await gh.createIssue({
        owner,
        repo,
        title: rendered.title,
        body: rendered.body,
        labels: [`wayfinder:${type}`],
      })
      await ensureSubIssue(gh, { owner, repo, parent: mapIssue.number, childId: issue.id })
      nextBody = addNextTicket(nextBody, number, plainTitle)
      await gh.updateIssue({ owner, repo, number: mapIssue.number, body: nextBody })
      created = true
    }
  } else if (!issue) {
    throw new MapClearingError(`Not yet specified 里找不到这一项：${fromItem}`)
  }

  return {
    map: mapIssue.html_url,
    ticket: ticketSummary(issue),
    created,
    removedItem,
  }
}

async function commandConclude({ gh, owner, repo, mapIssue, options }) {
  const rawTicket = required(options, 'ticket')
  const conclusion = String(required(options, 'conclusion')).trim()
  if (!conclusion) throw new Error('--conclusion 是空的')

  const body = mapIssue.body || ''
  const children = await gh.listSubIssues({ owner, repo, number: mapIssue.number })
  const target = findTicket(children, rawTicket)
  if (!target) throw new MapClearingError(`地图下找不到票：${rawTicket}`)

  const comments = await gh.listComments({ owner, repo, number: target.number })
  const previous = conclusionOf(comments)
  if (previous && previous !== conclusion) {
    throw new MapClearingError('这张票已有结论，改结论走改口/重传')
  }
  const commented = previous
    ? false
    : await ensureCommentOnce(gh, {
        owner,
        repo,
        number: target.number,
        body: `结论：${conclusion}`,
      })
  const closedNow = target.state !== 'closed'
  if (closedNow) await gh.closeIssue({ owner, repo, number: target.number })

  let nextBody = removeNextTicket(body, ticketNumberOf(target.title))
  const withDecision = appendDecision(nextBody, target.title, conclusion)
  const decisionsAdded = withDecision !== nextBody
  nextBody = withDecision
  if (nextBody !== body) {
    await gh.updateIssue({ owner, repo, number: mapIssue.number, body: nextBody })
  }

  return {
    map: mapIssue.html_url,
    ticket: ticketSummary(target),
    commented,
    closed: closedNow,
    decisionsAdded,
  }
}

async function commandDefer({ gh, owner, repo, mapIssue, options }) {
  const item = String(required(options, 'item')).trim()
  const to = required(options, 'to')
  if (!['out-of-scope', 'notes'].includes(to)) {
    throw new Error('--to 只能填 out-of-scope 或 notes')
  }

  let line = ''
  let sectionName = ''
  if (to === 'out-of-scope') {
    const reason = String(options.reason || '').trim()
    if (!reason) throw new Error('--to out-of-scope 要带 --reason')
    line = outOfScopeLine(item, reason)
    sectionName = 'Out of scope'
  } else {
    const who = String(options.who || '').trim()
    const next = String(options.next || '').trim()
    if (!who || !next) throw new Error('--to notes 要带 --who 和 --next')
    line = unsettledLine(item, who, next)
    sectionName = 'Notes'
  }

  const body = mapIssue.body || ''
  const fog = sectionText(body, 'Not yet specified')
  if (fog === null) throw new MapClearingError('地图缺「Not yet specified」段')
  const fogItem = findFogItem(fog, item)

  let changed = false
  if (fogItem !== null) {
    let nextBody = removeFogItem(body, fogItem)
    nextBody =
      to === 'out-of-scope'
        ? appendOutOfScope(nextBody, fogItem, options.reason)
        : appendUnsettledNote(nextBody, fogItem, options.who, options.next)
    changed = nextBody !== body
    if (changed) {
      await gh.updateIssue({ owner, repo, number: mapIssue.number, body: nextBody })
    }
  } else if (!itemsOf(sectionText(body, sectionName) || '').includes(line.replace(/^\s*-\s+/, ''))) {
    throw new MapClearingError(`Not yet specified 里找不到这一项：${item}`)
  }

  return { map: mapIssue.html_url, item, to, changed }
}

/** 和 `gap.mjs point` 共用 `gateReady`：老地图只看两条，带协议才跑严格门禁。 */
async function commandCheck({ gh, owner, repo, mapIssue }) {
  return gateReady({
    gh,
    owner,
    repo,
    mapIssueNumber: mapIssue.number,
    mapBody: mapIssue.body || '',
  })
}

export async function run(argv, { gh, log = console } = {}) {
  const [command, ...rest] = argv
  if (!COMMANDS.includes(command)) throw new Error(`未知命令：${command || '（空）'}`)
  const options = parseOptions(rest)
  const client = gh || createGithub({ token: process.env.GITHUB_TOKEN || '' })
  const owner = required(options, 'owner')
  const repo = required(options, 'repo')
  const { mapIssue } = await resolveMap({
    gh: client,
    owner,
    repo,
    parentInput: required(options, 'parent'),
  })

  const context = { gh: client, owner, repo, mapIssue, options }
  const handlers = {
    list: commandList,
    init: commandInit,
    ticket: commandTicket,
    conclude: commandConclude,
    defer: commandDefer,
    check: commandCheck,
  }
  const result = await handlers[command](context)
  log.log(JSON.stringify(result))
  return result
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  run(process.argv.slice(2))
    .then((result) => {
      if (result && result.ready === false) process.exitCode = 1
    })
    .catch((error) => {
      console.error(error.message)
      if (Array.isArray(error.blockers)) {
        for (const blocker of error.blockers) console.error(`- ${blocker.text}`)
      }
      process.exit(1)
    })
}
