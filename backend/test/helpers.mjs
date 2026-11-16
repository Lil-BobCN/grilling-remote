import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { createServer } from 'node:http'
import { loadConfig } from '../lib/config.mjs'
import { createHandler } from '../lib/app.mjs'
import { hashPassword } from '../lib/auth.mjs'
import { writeJsonAtomic } from '../lib/store.mjs'

const execFileAsync = promisify(execFile)
const zipScript = fileURLToPath(new URL('./make-zip.py', import.meta.url))

export const PASSWORD = 'correct horse battery'
export const EMAIL = 'boss@example.com'

export async function makeConfig(overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), 'afkapp-test-'))
  const env = {
    DATA_DIR: join(root, 'data'),
    UPLOAD_DIR: join(root, 'uploads'),
    SESSION_SECRET: 'test-secret',
    COOKIE_SECURE: 'false',
    ALLOWED_ORIGINS: 'http://127.0.0.1',
    AFK_GIT_SYNC: '0',
    MAX_UPLOAD_BYTES: String(512 * 1024),
    ZIP_MAX_UNCOMPRESSED: String(2 * 1024 * 1024),
    ZIP_MAX_FILE: String(2 * 1024 * 1024),
    UPLOADS_PER_USER: '5',
    UPLOADS_PER_IP: '20',
    LOGINS_PER_IP: '50',
    ...overrides,
  }
  const config = loadConfig(env)
  config.version = '1.0.0-test'
  await mkdir(config.dataDir, { recursive: true })
  await mkdir(config.uploadDir, { recursive: true })
  return { config, root }
}

export async function seedCustomer(config, extras = {}) {
  const passwordHash = await hashPassword(PASSWORD)
  const row = {
    id: 'c-0001',
    short_name: 'acme',
    display_name: 'Acme 老板',
    email: EMAIL,
    status: 'active',
    repos: {},
    wechat: '',
    note: '',
    password_hash: passwordHash,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    disabled_at: null,
    disabled_reason: null,
    ...extras,
  }
  await writeJsonAtomic(join(config.dataDir, 'customers.json'), [row])
  return row
}

export async function startServer(config) {
  const handler = createHandler(config)
  const server = createServer(handler)
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const { port } = server.address()
  const base = `http://127.0.0.1:${port}`
  config.allowedOrigins.push(base)
  return {
    base,
    close: async () => {
      handler.close()
      await new Promise((done) => server.close(done))
    },
  }
}

/**
 * 假 GitHub：只实现读工单和读评论两个接口。
 * calls 记每个请求的路径，用来验证缓存有没有省掉请求。
 */
export async function startFakeGithub({ issue, comments = [] } = {}) {
  const state = {
    issue: issue || { state: 'open', closed_at: null },
    comments,
    fail: false,
    calls: [],
  }

  const server = createServer((req, res) => {
    state.calls.push(req.url)
    if (state.fail) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end('{"message":"boom"}')
      return
    }

    const url = new URL(req.url, 'http://127.0.0.1')
    if (/^\/repos\/[^/]+\/[^/]+\/issues\/\d+\/comments$/.test(url.pathname)) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(state.comments))
      return
    }
    if (/^\/repos\/[^/]+\/[^/]+\/issues\/\d+$/.test(url.pathname)) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(state.issue))
      return
    }
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end('{"message":"not found"}')
  })

  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const { port } = server.address()

  return {
    base: `http://127.0.0.1:${port}`,
    state,
    close: () => new Promise((done) => server.close(done)),
  }
}

export async function seedAdmin(config, extras = {}) {
  const row = {
    id: 'a-0001',
    email: 'admin@example.com',
    display_name: '运营者',
    password_hash: await hashPassword(PASSWORD),
    status: 'active',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    disabled_at: null,
    disabled_reason: null,
    ...extras,
  }
  await writeJsonAtomic(join(config.dataDir, 'admins.json'), [row])
  return row
}

export async function login(base, email = EMAIL, password = PASSWORD) {
  const response = await fetch(`${base}/app/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ email, password }),
  })
  const setCookie = response.headers.get('set-cookie') || ''
  return { response, cookie: setCookie.split(';')[0] }
}

export async function upload(base, cookie, bytes, { filename = 'workspace.zip', finished = 'true', origin = base } = {}) {
  const form = new FormData()
  form.append('file', new Blob([bytes]), filename)
  form.append('finished', finished)
  const headers = {}
  if (cookie) headers.Cookie = cookie
  if (origin) headers.Origin = origin
  return fetch(`${base}/app/api/uploads`, { method: 'POST', headers, body: form })
}

export async function makeWorkspace({
  small = true,
  complete = true,
  name = 'demo',
  names = null,
  nested = false,
  software = null,
  zipTool = 'python',
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'afkapp-ws-'))
  const workspace = join(root, '工作区')
  const requirementNames = names && names.length > 0 ? names : [name]
  await mkdir(workspace, { recursive: true })
  await writeFile(join(workspace, 'AGENTS.md'), '# 客户工作区\n', 'utf8')
  if (software !== null) await writeFile(join(workspace, '软件.md'), software, 'utf8')

  let requirement = ''
  for (const requirementName of requirementNames) {
    requirement = join(workspace, '.scratch', requirementName)
    await mkdir(requirement, { recursive: true })

    if (small) {
      await writeFile(
        join(requirement, '需求草稿.md'),
        `# ${requirementName} 需求草稿\n\nStatus: ${complete ? '已问完' : '进行中'}\n\n## 1. 客户原话\n\n想要一个预约取货的小程序。\n`,
        'utf8',
      )
    } else {
      const issues = join(requirement, 'issues')
      await mkdir(issues, { recursive: true })
      await writeFile(
        join(requirement, 'map.md'),
        `# ${requirementName} 地图\n\n## Destination\n\n预约取货。\n\n## 接下来\n\n${
          complete ? '' : '- [ ] 还没定的事\n'
        }\n## Decisions so far\n\n- [01](issues/01.md)：到店取\n\n## Not yet specified\n\n## Out of scope\n\n无\n`,
        'utf8',
      )
      await writeFile(
        join(issues, '01.md'),
        `# 01\n\nType: grilling\nStatus: ${complete ? 'resolved' : 'claimed'}\n\n## Question\n\n到店取还是送货？\n\n## 结论\n\n到店取。\n`,
        'utf8',
      )
    }

    if (complete) {
      await writeFile(
        join(requirement, '验收场景.md'),
        '# 验收场景\n\n客户确认：2026-11-15\n\n- 能打开预约页\n',
        'utf8',
      )
    }
  }

  const zipPath = join(root, 'workspace.zip')
  if (zipTool === 'python') {
    await execFileAsync('python3', [zipScript, nested ? root : workspace, zipPath])
  } else if (zipTool === 'zip') {
    await execFileAsync('zip', ['-r', '-q', zipPath, nested ? '工作区' : '.'], {
      cwd: nested ? root : workspace,
    })
  } else if (zipTool === 'ditto') {
    await execFileAsync(
      'ditto',
      [
        '-c',
        '-k',
        '--sequesterRsrc',
        ...(nested ? ['--keepParent'] : []),
        nested ? '工作区' : workspace,
        zipPath,
      ],
      { cwd: nested ? root : undefined },
    )
  } else {
    throw new Error(`不认识的打包方式：${zipTool}`)
  }
  return { zipPath, workspace, requirement }
}

export async function readZip(path) {
  const { readFile } = await import('node:fs/promises')
  return readFile(path)
}

export async function makeZipFromEntries(entries) {
  const root = await mkdtemp(join(tmpdir(), 'afkapp-zip-'))
  const script = `
import sys, zipfile, os
out = sys.argv[1]
entries = []
for arg in sys.argv[2:]:
    name, kind, payload = arg.split('|', 2)
    entries.append((name, kind, payload))
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for name, kind, payload in entries:
        if kind == 'dir':
            z.writestr(name, b'')
        elif kind == 'link':
            info = zipfile.ZipInfo(name)
            info.external_attr = (0o120777 << 16)
            z.writestr(info, payload)
        else:
            z.writestr(name, payload)
`
  const zipPath = join(root, 'entries.zip')
  await execFileAsync('python3', ['-c', script, zipPath, ...entries.map((e) => `${e.name}|${e.kind}|${e.payload ?? ''}`)])
  return { zipPath }
}

export async function makeBigWorkspace(bytes = 4 * 1024 * 1024) {
  const root = await mkdtemp(join(tmpdir(), 'afkapp-big-'))
  const workspace = join(root, '工作区')
  const requirement = join(workspace, '.scratch', 'demo')
  await mkdir(requirement, { recursive: true })
  await writeFile(join(requirement, '需求草稿.md'), 'Status: 已问完\n', 'utf8')
  await writeFile(join(requirement, '验收场景.md'), '客户确认：2026-11-15\n', 'utf8')
  await writeFile(join(workspace, 'big.bin'), Buffer.alloc(bytes))
  const zipPath = join(root, 'big.zip')
  await execFileAsync('python3', [zipScript, workspace, zipPath])
  return { zipPath }
}
