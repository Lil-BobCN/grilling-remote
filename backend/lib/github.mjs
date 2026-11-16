/**
 * 从工单评论里读客户进度。
 *
 * 只读，不改 GitHub。按订单缓存，默认 60 秒；读失败先用最近一次缓存。
 * 订单的 `issue` 写完整工单链接，或写 `{owner, repo, number}`。
 */
import { logLine } from './log.mjs'
import { PROGRESS_PREFIX } from './progress.mjs'

const cache = new Map()
const COMMENT_PAGES = 3
const PER_PAGE = 100

export function clearIssueCache() {
  cache.clear()
}

function issueFromUrl(raw) {
  let url
  try {
    url = new URL(String(raw || '').trim())
  } catch {
    return null
  }
  if (!/^(www\.)?github\.com$|^api\.github\.com$/i.test(url.hostname)) return null

  const path = url.pathname.split('/').filter(Boolean)
  if (path[0] === 'repos') path.shift()
  if (path.length < 4 || path[2] !== 'issues') return null
  if (!/^\d+$/.test(path[3])) return null
  return {
    owner: path[0],
    repo: path[1],
    number: Number(path[3]),
    url: `https://github.com/${path[0]}/${path[1]}/issues/${path[3]}`,
  }
}

export function parseIssueRef(order) {
  const raw = order?.issue
  if (raw && typeof raw === 'object') {
    if (raw.url) return issueFromUrl(raw.url)
    if (raw.owner && raw.repo && raw.number) {
      const number = Number(raw.number)
      if (!Number.isInteger(number) || number <= 0) return null
      return {
        owner: String(raw.owner),
        repo: String(raw.repo),
        number,
        url: `https://github.com/${raw.owner}/${raw.repo}/issues/${number}`,
      }
    }
    return null
  }
  return issueFromUrl(raw) || issueFromUrl(order?.issue_url)
}

function progressLines(body) {
  if (typeof body !== 'string') return []
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith(PROGRESS_PREFIX))
}

async function requestJson(config, path) {
  const response = await fetch(`${config.githubApi}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${config.githubToken}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'afkapp',
    },
    signal: AbortSignal.timeout(config.githubTimeoutMs),
  })
  if (!response.ok) {
    throw new Error(`GitHub ${response.status} ${path}`)
  }
  return response.json()
}

async function readComments(config, ref) {
  const transitions = []
  for (let page = 1; page <= COMMENT_PAGES; page += 1) {
    const rows = await requestJson(
      config,
      `/repos/${ref.owner}/${ref.repo}/issues/${ref.number}/comments?per_page=${PER_PAGE}&page=${page}`,
    )
    if (!Array.isArray(rows)) break
    for (const row of rows) {
      for (const line of progressLines(row?.body)) {
        transitions.push({ at: row?.created_at || '', line })
      }
    }
    if (rows.length < PER_PAGE) break
  }
  return transitions
}

/**
 * @returns {{ state: 'open'|'closed'|null, closedAt: string|null,
 *   transitions: Array<{at: string, line: string}>, issueUrl: string|null,
 *   skipped?: string, error?: string, stale?: boolean }}
 */
export async function readIssueProgress(config, order, now = Date.now()) {
  const ref = parseIssueRef(order)
  if (!ref) return { state: null, closedAt: null, transitions: [], issueUrl: null, skipped: 'no issue' }
  if (!config.githubToken) {
    return {
      state: null,
      closedAt: null,
      transitions: [],
      issueUrl: ref.url,
      skipped: 'no token',
    }
  }

  const key = order?.id || ref.url
  const cached = cache.get(key)
  if (cached && now - cached.checkedAt < config.progressCacheMs) {
    return cached.value
  }

  try {
    const [issue, transitions] = await Promise.all([
      requestJson(config, `/repos/${ref.owner}/${ref.repo}/issues/${ref.number}`),
      readComments(config, ref),
    ])
    const value = {
      state: issue?.state === 'closed' ? 'closed' : 'open',
      closedAt: issue?.closed_at || null,
      transitions,
      issueUrl: ref.url,
    }
    cache.set(key, { checkedAt: now, value })
    return value
  } catch (error) {
    const message = String(error && error.message ? error.message : error)
    logLine({
      ts: new Date(now).toISOString(),
      level: 'warning',
      msg: '读工单评论失败',
      order_id: order?.id || null,
      issue: ref.url,
      error: message,
    })
    if (cached?.value) {
      const value = { ...cached.value, stale: true, error: message }
      cache.set(key, { checkedAt: now, value })
      return value
    }
    const value = {
      state: null,
      closedAt: null,
      transitions: [],
      issueUrl: ref.url,
      error: message,
    }
    cache.set(key, { checkedAt: now, value })
    return value
  }
}
