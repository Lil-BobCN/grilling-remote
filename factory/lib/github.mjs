/**
 * 很薄的 GitHub REST 客户端。工厂只用到一个账号、一个 owner。
 *
 * 所有方法接收普通对象，返回 GitHub 原始 JSON；调用方自己挑字段。
 * 测试时把 `fetchImpl` 换成假服务，或直接用 test/fake-github.mjs 起一个本地服务。
 */

export class GitHubError extends Error {
  constructor(method, path, status, body) {
    super(`GitHub ${method} ${path} 返回 ${status}`)
    this.name = 'GitHubError'
    this.method = method
    this.path = path
    this.status = status
    this.body = body
  }
}

const PER_PAGE = 100

export function createGithub({
  token = '',
  apiBase = 'https://api.github.com',
  fetchImpl = globalThis.fetch,
  timeoutMs = 15000,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('缺少 fetch')

  async function request(method, path, body) {
    const response = await fetchImpl(`${apiBase}${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'afkfactory',
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
    if (!response.ok) throw new GitHubError(method, path, response.status, data)
    return data
  }

  async function requestAll(path, { maxPages = 10 } = {}) {
    const rows = []
    for (let page = 1; page <= maxPages; page += 1) {
      const separator = path.includes('?') ? '&' : '?'
      const batch = await request('GET', `${path}${separator}per_page=${PER_PAGE}&page=${page}`)
      if (!Array.isArray(batch)) return rows
      rows.push(...batch)
      if (batch.length < PER_PAGE) break
    }
    return rows
  }

  function repoPath(owner, repo, suffix = '') {
    return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${suffix}`
  }

  return {
    request,
    requestAll,

    async createRepo({ owner, name, private: isPrivate = true, description = '', ownerType = 'user' }) {
      const path = ownerType === 'org' ? `/orgs/${owner}/repos` : '/user/repos'
      return request('POST', path, { name, private: isPrivate, description, auto_init: false })
    },

    async getRepo({ owner, repo }) {
      return request('GET', repoPath(owner, repo))
    },

    async getRepoOrNull({ owner, repo }) {
      try {
        return await request('GET', repoPath(owner, repo))
      } catch (error) {
        if (error instanceof GitHubError && error.status === 404) return null
        throw error
      }
    },

    async deleteRepo({ owner, repo }) {
      return request('DELETE', repoPath(owner, repo))
    },

    async createLabel({ owner, repo, name, color = 'ededed', description = '' }) {
      return request('POST', repoPath(owner, repo, '/labels'), { name, color, description })
    },

    async listLabels({ owner, repo }) {
      return requestAll(repoPath(owner, repo, '/labels'))
    },

    async createIssue({ owner, repo, title, body = '', labels = [] }) {
      return request('POST', repoPath(owner, repo, '/issues'), { title, body, labels })
    },

    async getIssue({ owner, repo, number }) {
      return request('GET', repoPath(owner, repo, `/issues/${number}`))
    },

    async updateIssue({ owner, repo, number, ...fields }) {
      return request('PATCH', repoPath(owner, repo, `/issues/${number}`), fields)
    },

    async closeIssue({ owner, repo, number, stateReason = 'completed' }) {
      return request('PATCH', repoPath(owner, repo, `/issues/${number}`), {
        state: 'closed',
        state_reason: stateReason,
      })
    },

    async reopenIssue({ owner, repo, number }) {
      return request('PATCH', repoPath(owner, repo, `/issues/${number}`), { state: 'open' })
    },

    async listIssues({ owner, repo, state = 'open', labels = '' }) {
      const query = new URLSearchParams({ state })
      if (labels) query.set('labels', labels)
      const rows = await requestAll(repoPath(owner, repo, `/issues?${query.toString()}`))
      return rows.filter((row) => !row.pull_request)
    },

    async addLabels({ owner, repo, number, labels }) {
      return request('POST', repoPath(owner, repo, `/issues/${number}/labels`), { labels })
    },

    async removeLabel({ owner, repo, number, name }) {
      return request(
        'DELETE',
        repoPath(owner, repo, `/issues/${number}/labels/${encodeURIComponent(name)}`),
      )
    },

    async listComments({ owner, repo, number }) {
      return requestAll(repoPath(owner, repo, `/issues/${number}/comments`))
    },

    async createComment({ owner, repo, number, body }) {
      return request('POST', repoPath(owner, repo, `/issues/${number}/comments`), { body })
    },

    async listSubIssues({ owner, repo, number }) {
      return requestAll(repoPath(owner, repo, `/issues/${number}/sub_issues`))
    },

    async addSubIssue({ owner, repo, number, subIssueId }) {
      return request('POST', repoPath(owner, repo, `/issues/${number}/sub_issues`), {
        sub_issue_id: subIssueId,
      })
    },

    async listBlockedBy({ owner, repo, number }) {
      return requestAll(repoPath(owner, repo, `/issues/${number}/dependencies/blocked_by`))
    },

    async addBlockedBy({ owner, repo, number, issueId }) {
      return request('POST', repoPath(owner, repo, `/issues/${number}/dependencies/blocked_by`), {
        issue_id: issueId,
      })
    },

    async getPull({ owner, repo, number }) {
      return request('GET', repoPath(owner, repo, `/pulls/${number}`))
    },

    async findPullByHead({ owner, repo, head }) {
      const rows = await requestAll(
        repoPath(owner, repo, `/pulls?state=open&head=${encodeURIComponent(head)}`),
      )
      return rows[0] || null
    },

    async listPulls({ owner, repo, state = 'all' }) {
      return requestAll(repoPath(owner, repo, `/pulls?state=${encodeURIComponent(state)}`))
    },

    async mergePull({ owner, repo, number, mergeMethod = 'merge', commitTitle } = {}) {
      return request('PUT', repoPath(owner, repo, `/pulls/${number}/merge`), {
        merge_method: mergeMethod,
        ...(commitTitle ? { commit_title: commitTitle } : {}),
      })
    },
  }
}
