/**
 * 建仓和导入共用的 GitHub 写客户端（REST）。
 *
 * 读进度用 `lib/github.mjs`，那份是只读的；这里带建仓、标签、工单和评论。
 * 测试时把 `fetchImpl` 换成假实现，或用 `factory/test/fake-github.mjs` 起本地假服务。
 */

export class GithubApiError extends Error {
  constructor(method, path, status, body) {
    super(`GitHub ${method} ${path} 返回 ${status}`)
    this.name = 'GithubApiError'
    this.method = method
    this.path = path
    this.status = status
    this.body = body
  }
}

const PER_PAGE = 100

export function createGithubApi({
  token = '',
  apiBase = 'https://api.github.com',
  fetchImpl = globalThis.fetch,
  timeoutMs = 15000,
  userAgent = 'afkfactory',
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('缺少 fetch')

  async function request(method, path, body) {
    const response = await fetchImpl(`${apiBase}${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': userAgent,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })

    const text = await response.text()
    let data = null
    if (text) {
      try {
        data = JSON.parse(text)
      } catch {
        data = text
      }
    }
    if (!response.ok) throw new GithubApiError(method, path, response.status, data)
    return data
  }

  function repoPath(owner, repo, suffix = '') {
    return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${suffix}`
  }

  return {
    request,

    getRepo({ owner, repo }) {
      return request('GET', repoPath(owner, repo))
    },

    async getRepoOrNull({ owner, repo }) {
      try {
        return await request('GET', repoPath(owner, repo))
      } catch (error) {
        if (error instanceof GithubApiError && error.status === 404) return null
        throw error
      }
    },

    createRepo({ owner, name, private: isPrivate = true, description = '', ownerType = 'user' }) {
      const path = ownerType === 'org' ? `/orgs/${encodeURIComponent(owner)}/repos` : '/user/repos'
      return request('POST', path, { name, private: isPrivate, description, auto_init: false })
    },

    deleteRepo({ owner, repo }) {
      return request('DELETE', repoPath(owner, repo))
    },

    createLabel({ owner, repo, name, color = 'ededed', description = '' }) {
      return request('POST', repoPath(owner, repo, '/labels'), { name, color, description })
    },

    listLabels({ owner, repo }) {
      return request('GET', repoPath(owner, repo, `/labels?per_page=${PER_PAGE}`))
    },

    createIssue({ owner, repo, title, body = '', labels = [] }) {
      return request('POST', repoPath(owner, repo, '/issues'), { title, body, labels })
    },

    getIssue({ owner, repo, number }) {
      return request('GET', repoPath(owner, repo, `/issues/${number}`))
    },

    updateIssue({ owner, repo, number, ...fields }) {
      return request('PATCH', repoPath(owner, repo, `/issues/${number}`), fields)
    },

    createComment({ owner, repo, number, body }) {
      return request('POST', repoPath(owner, repo, `/issues/${number}/comments`), { body })
    },

    async listIssues({ owner, repo, state = 'open', labels = '' }) {
      const rows = []
      for (let page = 1; page <= 10; page += 1) {
        const query = new URLSearchParams({ state, per_page: String(PER_PAGE), page: String(page) })
        if (labels) query.set('labels', labels)
        const batch = await request('GET', repoPath(owner, repo, `/issues?${query.toString()}`))
        if (!Array.isArray(batch)) return rows
        rows.push(...batch)
        if (batch.length < PER_PAGE) break
      }
      return rows.filter((row) => !row.pull_request)
    },
  }
}
