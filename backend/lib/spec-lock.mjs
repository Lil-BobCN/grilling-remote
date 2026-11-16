/**
 * 锁单检查：仓库里有没有带 `ready-for-agent` 的 spec issue 提到这个需求。
 *
 * 有就说明 to-spec 已发布、单子锁住，同一需求目录不能再改。
 * 读不到 GitHub 时放行并记 warning：不拿旧缓存或猜测替客户拒绝上传。
 */
import { logLine } from './log.mjs'

const PER_PAGE = 100
const MAX_PAGES = 3

function isLockedByIssues(issues, requirement) {
  if (!Array.isArray(issues)) return false
  return issues.some((issue) => {
    if (issue && issue.pull_request) return false
    const haystack = `${issue?.title || ''}\n${issue?.body || ''}`
    return haystack.includes(requirement)
  })
}

export function createSpecLock(config, { fetchImpl = globalThis.fetch } = {}) {
  return async function specLock({ owner, repo, requirement }) {
    if (!owner || !repo || !requirement) return false
    if (!config.githubToken) return false

    try {
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const url =
          `${config.githubApi}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}` +
          `/issues?labels=ready-for-agent&state=open&per_page=${PER_PAGE}&page=${page}`
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
        const rows = await response.json()
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
        error: String(error && error.message ? error.message : error),
      })
      return false
    }
  }
}
