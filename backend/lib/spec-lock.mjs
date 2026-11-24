/**
 * 锁单检查：先看父工单最新关口，再回退到带 `ready-for-agent` 的 spec issue。
 *
 * 父工单最新一条 `点头：补缺口` 之后没有 `改口：重传`，就是锁住。
 * 上传接收时间早于点头评论的按未锁放行，避免上传先到、点头后到被误拒。
 * 没有父工单号或没有点头时，按 spec 标签检查，旧单不用迁移。
 * 读不到 GitHub 时放行并记 warning：不拿旧缓存或猜测替客户拒绝上传。
 */
import { logLine } from './log.mjs'
import { gateKind } from './protocol.mjs'

const PER_PAGE = 100
const MAX_ISSUE_PAGES = 3
const MAX_COMMENT_PAGES = 10
const POINT_PREFIX = '点头：补缺口'
const UNLOCK_PREFIX = '改口：重传'

function isLockedByIssues(issues, requirement) {
  if (!Array.isArray(issues)) return false
  return issues.some((issue) => {
    if (issue && issue.pull_request) return false
    const haystack = `${issue?.title || ''}\n${issue?.body || ''}`
    return haystack.includes(requirement)
  })
}

/** 父工单号接受完整链接、`#12` 或 `12`；读不出返回 null。 */
function issueNumberFrom(value) {
  const text = String(value || '').trim()
  const fromUrl = /\/issues\/(\d+)(?:[#?].*)?\/?$/.exec(text)
  if (fromUrl) return Number(fromUrl[1])
  const bare = /^#?(\d+)$/.exec(text)
  return bare ? Number(bare[1]) : null
}

async function fetchJson({ fetchImpl, config, url }) {
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${config.githubToken}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'afkapp',
    },
    signal: AbortSignal.timeout(config.githubTimeoutMs || 5000),
  })
  if (!response.ok) throw new Error(`GitHub ${response.status}`)
  return response.json()
}

function firstLine(body) {
  return String(body || '')
    .replace(/^﻿/, '')
    .trimStart()
    .split(/\r?\n/)[0]
    .trim()
}

/** GitHub 按时间升序返回评论，从后往前找第一条第一行带指定词干的关口。 */
function latestMatching(comments, prefix) {
  for (let index = comments.length - 1; index >= 0; index -= 1) {
    const body = comments[index]?.body
    if (!gateKind(body)) continue
    if (firstLine(body).startsWith(prefix)) {
      return { body: String(body), comment: comments[index], index }
    }
  }
  return null
}

/**
 * 读父工单评论判锁。
 * `decided: false` 表示没有点头，交给调用方回退到 spec 标签检查。
 */
async function pointLock({ fetchImpl, config, owner, repo, parentNumber, uploadedAt }) {
  const comments = []
  for (let page = 1; page <= MAX_COMMENT_PAGES; page += 1) {
    const url =
      `${config.githubApi}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}` +
      `/issues/${parentNumber}/comments?per_page=${PER_PAGE}&page=${page}`
    const batch = await fetchJson({ fetchImpl, config, url })
    if (!Array.isArray(batch)) break
    comments.push(...batch)
    if (batch.length < PER_PAGE) break
  }

  const point = latestMatching(comments, POINT_PREFIX)
  if (!point) return { decided: false }
  const unlock = latestMatching(comments, UNLOCK_PREFIX)
  if (unlock && unlock.index > point.index) return { decided: true, locked: false }

  const uploadTime = Date.parse(uploadedAt || '')
  const pointTime = Date.parse(point.comment?.created_at || '')
  if (Number.isFinite(uploadTime) && Number.isFinite(pointTime) && uploadTime < pointTime) {
    return { decided: true, locked: false }
  }
  return { decided: true, locked: true }
}

export function createSpecLock(config, { fetchImpl = globalThis.fetch } = {}) {
  return async function specLock({ owner, repo, requirement, parentIssue = '', uploadedAt = '' }) {
    if (!owner || !repo || !requirement) return false
    if (!config.githubToken) return false

    try {
      const parentNumber = issueNumberFrom(parentIssue)
      if (parentNumber) {
        const point = await pointLock({
          fetchImpl,
          config,
          owner,
          repo,
          parentNumber,
          uploadedAt,
        })
        if (point.decided) return point.locked
      }

      for (let page = 1; page <= MAX_ISSUE_PAGES; page += 1) {
        const url =
          `${config.githubApi}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}` +
          `/issues?labels=ready-for-agent&state=open&per_page=${PER_PAGE}&page=${page}`
        const rows = await fetchJson({ fetchImpl, config, url })
        if (isLockedByIssues(rows, requirement)) return true
        if (!Array.isArray(rows) || rows.length < PER_PAGE) break
      }
      return false
    } catch (error) {
      logLine({
        ts: new Date().toISOString(),
        level: 'warning',
        msg: '锁单检查读不到 GitHub，按未锁放行',
        owner,
        repo,
        requirement,
        parentIssue,
        error: String(error && error.message ? error.message : error),
      })
      return false
    }
  }
}
