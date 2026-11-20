/**
 * 测试用假 GitHub。只实现工厂用到的接口，状态放在内存里。
 *
 * 用法：
 *   const fake = await startFakeGithub()
 *   const gh = createGithub({ apiBase: fake.base, token: 'test' })
 *   ...
 *   await fake.close()
 */
import { createServer } from 'node:http'

function now() {
  return new Date().toISOString()
}

function splitRepo(pathname, offset = 0) {
  const parts = pathname.split('/').filter(Boolean)
  return { owner: parts[offset], repo: parts[offset + 1], rest: parts.slice(offset + 2) }
}

export async function startFakeGithub({ repos = [], issues = [], pulls = [] } = {}) {
  const state = {
    nextId: 10000,
    repos: new Map(),
    issues: new Map(),
    pulls: new Map(),
    requests: [],
    fail: null,
  }

  const key = (owner, repo) => `${owner}/${repo}`

  function newId() {
    state.nextId += 1
    return state.nextId
  }

  function addRepo(owner, name, extra = {}) {
    const repo = {
      id: newId(),
      name,
      full_name: `${owner}/${name}`,
      owner: { login: owner },
      private: true,
      html_url: `https://github.com/${owner}/${name}`,
      default_branch: 'main',
      description: '',
      ...extra,
    }
    state.repos.set(key(owner, name), repo)
    state.issues.set(key(owner, name), [])
    state.pulls.set(key(owner, name), [])
    return repo
  }

  function issueStore(owner, repo) {
    const found = state.issues.get(key(owner, repo))
    if (!found) throw Object.assign(new Error('repo not found'), { status: 404 })
    return found
  }

  function pullStore(owner, repo) {
    const found = state.pulls.get(key(owner, repo))
    if (!found) throw Object.assign(new Error('repo not found'), { status: 404 })
    return found
  }

  function labelsOf(owner, repo) {
    const repoInfo = state.repos.get(key(owner, repo))
    if (!repoInfo) throw Object.assign(new Error('repo not found'), { status: 404 })
    if (!repoInfo.labels) repoInfo.labels = new Map()
    return repoInfo.labels
  }

  function issueView(issue, owner, repo) {
    const children = (issue.subIssues || []).map((id) => {
      const found = issueStore(owner, repo).find((row) => row.id === id)
      return found ? issueView(found, owner, repo) : null
    }).filter(Boolean)
    return {
      id: issue.id,
      number: issue.number,
      title: issue.title,
      body: issue.body,
      state: issue.state,
      state_reason: issue.state_reason || null,
      labels: issue.labels.map((name) => ({ name })),
      html_url: `https://github.com/${owner}/${repo}/issues/${issue.number}`,
      created_at: issue.created_at,
      updated_at: issue.updated_at,
      closed_at: issue.closed_at,
      sub_issues_summary: {
        total: children.length,
        completed: children.filter((row) => row.state === 'closed').length,
        percent_completed: 0,
      },
      issue_dependencies_summary: {
        blocked_by: (issue.blockedBy || []).length,
        total_blocked_by: (issue.blockedBy || []).length,
        blocking: 0,
        total_blocking: 0,
      },
      repository_url: `https://api.github.com/repos/${owner}/${repo}`,
    }
  }

  function commentView(comment, owner, repo, issue) {
    return {
      id: comment.id,
      body: comment.body,
      user: { login: 'tester' },
      created_at: comment.created_at,
      updated_at: comment.created_at,
      html_url: `https://github.com/${owner}/${repo}/issues/${issue.number}#issuecomment-${comment.id}`,
    }
  }

  async function readBody(req) {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const text = Buffer.concat(chunks).toString('utf8')
    if (!text) return {}
    try {
      return JSON.parse(text)
    } catch {
      throw Object.assign(new Error('bad json'), { status: 400 })
    }
  }

  function send(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(body === undefined ? '' : JSON.stringify(body))
  }

  function findIssueByNumber(owner, repo, number) {
    const issue = issueStore(owner, repo).find((row) => row.number === Number(number))
    if (!issue) throw Object.assign(new Error('issue not found'), { status: 404 })
    return issue
  }

  function findIssueById(owner, repo, id) {
    return issueStore(owner, repo).find((row) => row.id === Number(id)) || null
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    let body = {}
    try {
      if (req.method !== 'GET' && req.method !== 'DELETE') body = await readBody(req)
    } catch (error) {
      send(res, error.status || 400, { message: error.message })
      return
    }
    state.requests.push({ method: req.method, path: url.pathname + url.search, body })

    try {
      if (state.fail) throw Object.assign(new Error(state.fail.message || 'boom'), { status: state.fail.status || 500 })

      const path = url.pathname

      if (req.method === 'POST' && (path === '/user/repos' || /^\/orgs\/[^/]+\/repos$/.test(path))) {
        const owner = path === '/user/repos' ? body.owner || 'acme' : path.split('/')[2]
        if (state.repos.has(key(owner, body.name))) {
          send(res, 422, { message: 'repository already exists' })
          return
        }
        const repo = addRepo(owner, body.name, {
          private: body.private !== false,
          description: body.description || '',
        })
        send(res, 201, repo)
        return
      }

      if (req.method === 'GET' && /^\/repos\/[^/]+\/[^/]+$/.test(path)) {
        const { owner, repo } = splitRepo(path, 1)
        const found = state.repos.get(key(owner, repo))
        if (!found) {
          send(res, 404, { message: 'Not Found' })
          return
        }
        send(res, 200, found)
        return
      }

      if (req.method === 'DELETE' && /^\/repos\/[^/]+\/[^/]+$/.test(path)) {
        const { owner, repo } = splitRepo(path, 1)
        if (!state.repos.delete(key(owner, repo))) {
          send(res, 404, { message: 'Not Found' })
          return
        }
        state.issues.delete(key(owner, repo))
        state.pulls.delete(key(owner, repo))
        res.writeHead(204)
        res.end()
        return
      }

      if (req.method === 'GET' && /^\/repos\/[^/]+\/[^/]+\/labels$/.test(path)) {
        const { owner, repo } = splitRepo(path, 1)
        const labels = [...labelsOf(owner, repo).values()]
        send(res, 200, labels.slice(0, 100))
        return
      }

      if (req.method === 'POST' && /^\/repos\/[^/]+\/[^/]+\/labels$/.test(path)) {
        const { owner, repo } = splitRepo(path, 1)
        const labels = labelsOf(owner, repo)
        if (labels.has(body.name)) {
          send(res, 422, { message: 'label already exists' })
          return
        }
        const label = {
          id: newId(),
          name: body.name,
          color: body.color || 'ededed',
          description: body.description || '',
        }
        labels.set(body.name, label)
        send(res, 201, label)
        return
      }

      if (req.method === 'GET' && /^\/repos\/[^/]+\/[^/]+\/issues$/.test(path)) {
        const { owner, repo } = splitRepo(path, 1)
        const wanted = url.searchParams.get('labels') || ''
        const labelNames = wanted.split(',').map((name) => name.trim()).filter(Boolean)
        const stateFilter = url.searchParams.get('state') || 'open'
        let rows = issueStore(owner, repo)
          .filter((row) => stateFilter === 'all' || row.state === stateFilter)
          .filter((row) => labelNames.every((name) => row.labels.includes(name)))
          .map((row) => issueView(row, owner, repo))
        const page = Number(url.searchParams.get('page') || 1)
        const perPage = Number(url.searchParams.get('per_page') || 30)
        rows = rows.slice((page - 1) * perPage, page * perPage)
        send(res, 200, rows)
        return
      }

      if (req.method === 'POST' && /^\/repos\/[^/]+\/[^/]+\/issues$/.test(path)) {
        const { owner, repo } = splitRepo(path, 1)
        const store = issueStore(owner, repo)
        const labels = labelsOf(owner, repo)
        const wanted = body.labels || []
        const missing = wanted.find((name) => !labels.has(name))
        if (missing) {
          send(res, 422, { message: `label '${missing}' not found` })
          return
        }
        const issue = {
          id: newId(),
          number: store.length + 1,
          title: body.title || '',
          body: body.body || '',
          state: 'open',
          state_reason: null,
          labels: [...wanted],
          comments: [],
          subIssues: [],
          blockedBy: [],
          created_at: now(),
          updated_at: now(),
          closed_at: null,
        }
        store.push(issue)
        send(res, 201, issueView(issue, owner, repo))
        return
      }

      const issueMatch = path.match(/^\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)(\/.*)?$/)
      if (issueMatch) {
        const [, owner, repo, number, rest = ''] = issueMatch
        const issue = findIssueByNumber(owner, repo, number)

        if (!rest && req.method === 'GET') {
          send(res, 200, issueView(issue, owner, repo))
          return
        }

        if (!rest && req.method === 'PATCH') {
          if (body.title !== undefined) issue.title = body.title
          if (body.body !== undefined) issue.body = body.body
          if (body.state !== undefined) {
            issue.state = body.state
            issue.closed_at = body.state === 'closed' ? now() : null
            if (body.state === 'closed' && body.state_reason) issue.state_reason = body.state_reason
          }
          issue.updated_at = now()
          send(res, 200, issueView(issue, owner, repo))
          return
        }

        if (rest === '/comments' && req.method === 'GET') {
          send(res, 200, issue.comments.map((row) => commentView(row, owner, repo, issue)))
          return
        }

        if (rest === '/comments' && req.method === 'POST') {
          const comment = {
            id: newId(),
            body: body.body || '',
            created_at: now(),
          }
          issue.comments.push(comment)
          issue.updated_at = now()
          send(res, 201, commentView(comment, owner, repo, issue))
          return
        }

        if (rest === '/labels' && req.method === 'POST') {
          const labels = labelsOf(owner, repo)
          const wanted = body.labels || []
          const missing = wanted.find((name) => !labels.has(name))
          if (missing) {
            send(res, 422, { message: `label '${missing}' not found` })
            return
          }
          for (const name of wanted) if (!issue.labels.includes(name)) issue.labels.push(name)
          issue.updated_at = now()
          send(res, 200, issue.labels.map((name) => labels.get(name)))
          return
        }

        const labelMatch = rest.match(/^\/labels\/(.+)$/)
        if (labelMatch && req.method === 'DELETE') {
          const name = decodeURIComponent(labelMatch[1])
          issue.labels = issue.labels.filter((row) => row !== name)
          issue.updated_at = now()
          send(res, 200, issue.labels.map((row) => ({ name: row })))
          return
        }

        if (rest === '/sub_issues' && req.method === 'GET') {
          const children = (issue.subIssues || [])
            .map((id) => findIssueById(owner, repo, id))
            .filter(Boolean)
            .map((row) => issueView(row, owner, repo))
          send(res, 200, children)
          return
        }

        if (rest === '/sub_issues' && req.method === 'POST') {
          const child = findIssueById(owner, repo, body.sub_issue_id)
          if (!child) {
            send(res, 404, { message: 'sub issue not found' })
            return
          }
          if (!issue.subIssues.includes(child.id)) issue.subIssues.push(child.id)
          send(res, 201, issueView(child, owner, repo))
          return
        }

        if (rest === '/dependencies/blocked_by' && req.method === 'GET') {
          const rows = (issue.blockedBy || [])
            .map((id) => findIssueById(owner, repo, id))
            .filter(Boolean)
            .map((row) => issueView(row, owner, repo))
          send(res, 200, rows)
          return
        }

        if (rest === '/dependencies/blocked_by' && req.method === 'POST') {
          const blocker = findIssueById(owner, repo, body.issue_id)
          if (!blocker) {
            send(res, 404, { message: 'blocking issue not found' })
            return
          }
          if (!issue.blockedBy.includes(blocker.id)) issue.blockedBy.push(blocker.id)
          send(res, 201, issueView(blocker, owner, repo))
          return
        }
      }

      if (req.method === 'GET' && /^\/repos\/[^/]+\/[^/]+\/pulls$/.test(path)) {
        const { owner, repo } = splitRepo(path, 1)
        const head = url.searchParams.get('head') || ''
        const state = url.searchParams.get('state') || 'open'
        const rows = pullStore(owner, repo)
          .filter((row) => state === 'all' || row.state === state)
          .filter((row) => !head || row.head.ref === head || row.head.label === head)
        send(res, 200, rows)
        return
      }

      if (req.method === 'POST' && /^\/repos\/[^/]+\/[^/]+\/pulls$/.test(path)) {
        const { owner, repo } = splitRepo(path, 1)
        const store = pullStore(owner, repo)
        const pull = {
          id: newId(),
          number: store.length + 1,
          title: body.title || '',
          body: body.body || '',
          state: 'open',
          draft: Boolean(body.draft),
          head: { ref: body.head, label: `${owner}:${body.head}`, sha: 'head-sha' },
          base: { ref: body.base || 'main' },
          merged: false,
          merged_at: null,
          merge_commit_sha: null,
          html_url: `https://github.com/${owner}/${repo}/pull/${store.length + 1}`,
        }
        store.push(pull)
        send(res, 201, pull)
        return
      }

      const pullMatch = path.match(/^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)(\/merge)?$/)
      if (pullMatch) {
        const [, owner, repo, number, merge] = pullMatch
        const pull = pullStore(owner, repo).find((row) => row.number === Number(number))
        if (!pull) {
          send(res, 404, { message: 'pull not found' })
          return
        }
        if (merge && req.method === 'PUT') {
          pull.merged = true
          pull.merged_at = now()
          pull.state = 'closed'
          pull.merge_commit_sha = `merge-${pull.number}`
          send(res, 200, { merged: true, message: 'Pull Request successfully merged', sha: pull.merge_commit_sha })
          return
        }
        if (!merge && req.method === 'GET') {
          send(res, 200, pull)
          return
        }
      }

      send(res, 404, { message: `未实现的接口：${req.method} ${path}` })
    } catch (error) {
      send(res, error.status || 500, { message: error.message })
    }
  })

  for (const repo of repos) addRepo(repo.owner || 'acme', repo.name, repo.extra || {})
  for (const owner of new Set(repos.map((repo) => repo.owner || 'acme'))) {
    const repoName = repos.find((repo) => (repo.owner || 'acme') === owner).name
    for (const name of ['needs-triage', 'needs-info', 'ready-for-agent', 'ready-for-human', 'wontfix']) {
      labelsOf(owner, repoName).set(name, { id: newId(), name, color: 'ededed', description: '' })
    }
  }
  for (const seed of issues) {
    const owner = seed.owner || 'acme'
    const repo = seed.repo || repos[0]?.name
    const store = issueStore(owner, repo)
    const issue = {
      id: newId(),
      number: store.length + 1,
      title: seed.title || '',
      body: seed.body || '',
      state: seed.state || 'open',
      state_reason: null,
      labels: seed.labels || [],
      comments: (seed.comments || []).map((text) => ({ id: newId(), body: text, created_at: now() })),
      subIssues: [],
      blockedBy: [],
      created_at: now(),
      updated_at: now(),
      closed_at: null,
    }
    store.push(issue)
  }
  for (const seed of pulls) {
    const owner = seed.owner || 'acme'
    const repo = seed.repo || repos[0]?.name
    pullStore(owner, repo).push({
      id: newId(),
      number: pullStore(owner, repo).length + 1,
      title: seed.title || '',
      body: seed.body || '',
      state: seed.state || 'open',
      draft: Boolean(seed.draft),
      head: { ref: seed.head || 'feature', label: `${owner}:${seed.head || 'feature'}`, sha: 'head-sha' },
      base: { ref: seed.base || 'main' },
      merged: false,
      merged_at: null,
      merge_commit_sha: null,
      html_url: '',
    })
  }

  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const { port } = server.address()

  return {
    base: `http://127.0.0.1:${port}`,
    state,
    async close() {
      await new Promise((done) => server.close(done))
    },
  }
}
