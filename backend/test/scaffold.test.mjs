import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { createGithub } from '../../factory/lib/github.mjs'
import { startFakeGithub } from '../../factory/test/fake-github.mjs'
import { scaffoldCustomerRepo } from '../lib/scaffold.mjs'

const execFileAsync = promisify(execFile)

const ARGS = {
  owner: 'acme',
  repoName: 'acme-shuiguo',
  shortName: 'acme',
  product: 'shuiguo',
}

const NINE_LABELS = [
  'needs-triage',
  'needs-info',
  'ready-for-agent',
  'ready-for-human',
  'wontfix',
  '状态:已提交',
  '状态:排队中',
  '状态:开发中',
  '状态:待验收',
]

const REQUIRED_FILES = [
  'AGENTS.md',
  '.gitignore',
  'package.json',
  'docs/agents/issue-tracker.md',
  'docs/agents/triage-labels.md',
  'docs/agents/domain.md',
  'docs/agents/feature-map.md',
  'scripts/check.sh',
  'scripts/lint.mjs',
  'scripts/verify.sh',
  '.github/workflows/ci.yml',
  '.sandcastle/Dockerfile',
  '.sandcastle/main.mts',
  '.sandcastle/prompt.md',
  '.sandcastle/.env.example',
  '.sandcastle/.gitignore',
  '.claude/skills/verify/SKILL.md',
  'src/server.mjs',
  'src/features/catalog/index.mjs',
  'src/features/orders/index.mjs',
  'src/features/pages/index.mjs',
]

async function git(cwd, args) {
  const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], { maxBuffer: 8 * 1024 * 1024 })
  return stdout.trim()
}

async function setup(t) {
  const fake = await startFakeGithub()
  t.after(() => fake.close())
  const gh = createGithub({ apiBase: fake.base, token: 'test' })
  const scratch = await mkdtemp(join(tmpdir(), 'afk-scaffold-'))
  t.after(() => rm(scratch, { recursive: true, force: true }))
  const workDir = join(scratch, 'repo')
  const bare = join(scratch, 'remote.git')
  await execFileAsync('git', ['init', '--bare', '-b', 'main', bare])
  return { fake, gh, workDir, bare, scratch }
}

test('新仓生成全套文件、初始提交并推送到 main', async (t) => {
  const { gh, workDir, bare, scratch } = await setup(t)

  const result = await scaffoldCustomerRepo({
    ...ARGS,
    gh,
    workDir,
    remoteUrl: bare,
  })

  assert.equal(result.created, true)
  assert.equal(result.owner, 'acme')
  assert.equal(result.repo, 'acme-shuiguo')
  assert.equal(result.workDir, workDir)
  assert.match(result.commit, /^[0-9a-f]{40}$/)

  for (const file of REQUIRED_FILES) {
    await stat(join(workDir, file))
  }

  const agents = await readFile(join(workDir, 'AGENTS.md'), 'utf8')
  assert.ok(agents.split('\n').length <= 40, 'AGENTS.md 超过 40 行')
  assert.match(agents, /本文件与代码冲突时，以代码为准/)
  assert.match(agents, /FACTORY:/)
  assert.match(agents, /scripts\/check\.sh/)

  const fourDocs = ['AGENTS.md', 'docs/agents/issue-tracker.md', 'docs/agents/triage-labels.md', 'docs/agents/domain.md']
  for (const file of fourDocs) {
    const text = await readFile(join(workDir, file), 'utf8')
    for (const word of ['中台', '地图', '补缺口', '调度器']) {
      assert.ok(!text.includes(word), `${file} 含有内部流程词「${word}」`)
    }
    assert.ok(!text.includes('{{'), `${file} 还有没替换的占位符`)
  }

  const packageJson = JSON.parse(await readFile(join(workDir, 'package.json'), 'utf8'))
  assert.equal(packageJson.name, 'acme-shuiguo')
  assert.equal(packageJson.type, 'module')

  const clone = join(scratch, 'clone')
  await execFileAsync('git', ['clone', bare, clone])
  assert.equal(await git(clone, ['rev-parse', '--abbrev-ref', 'HEAD']), 'main')
  const log = await git(clone, ['log', '--format=%s'])
  assert.equal(log.split('\n').length, 1)
  assert.match(log, /^FACTORY:/)
  assert.equal(await git(clone, ['rev-parse', 'HEAD']), result.commit)

  const tracked = (await git(clone, ['ls-files'])).split('\n').filter(Boolean)
  for (const file of REQUIRED_FILES) {
    assert.ok(tracked.includes(file), `远端缺少 ${file}`)
  }
})

test('九个标签真实存在，给测试票打标签成功', async (t) => {
  const { gh, workDir, bare } = await setup(t)
  await scaffoldCustomerRepo({ ...ARGS, gh, workDir, remoteUrl: bare })

  const labels = await gh.listLabels({ owner: 'acme', repo: 'acme-shuiguo' })
  const names = labels.map((row) => row.name)
  for (const name of NINE_LABELS) {
    assert.ok(names.includes(name), `缺少标签 ${name}`)
  }

  const issue = await gh.createIssue({
    owner: 'acme',
    repo: 'acme-shuiguo',
    title: '测试票',
    labels: ['needs-triage', '状态:排队中'],
  })
  await gh.addLabels({
    owner: 'acme',
    repo: 'acme-shuiguo',
    number: issue.number,
    labels: ['ready-for-agent'],
  })
  const loaded = await gh.getIssue({ owner: 'acme', repo: 'acme-shuiguo', number: issue.number })
  assert.deepEqual(
    loaded.labels.map((row) => row.name).sort(),
    ['needs-triage', 'ready-for-agent', '状态:排队中'].sort(),
  )

  await assert.rejects(
    gh.createIssue({
      owner: 'acme',
      repo: 'acme-shuiguo',
      title: '标签写错的票',
      labels: ['不存在的标签'],
    }),
    (error) => error.status === 422,
  )
})

test('重复跑返回 created:false，不改远端也不覆盖本地文件', async (t) => {
  const { fake, gh, workDir, bare } = await setup(t)
  await scaffoldCustomerRepo({ ...ARGS, gh, workDir, remoteUrl: bare })

  const agentsPath = join(workDir, 'AGENTS.md')
  await writeFile(agentsPath, '客户改过的规则\n')
  const headBefore = await git(bare, ['rev-parse', 'main'])
  const requestsBefore = fake.state.requests.length

  const second = await scaffoldCustomerRepo({ ...ARGS, gh, workDir, remoteUrl: bare })

  assert.equal(second.created, false)
  assert.equal(second.reason, 'exists')
  assert.equal(second.repo, 'acme-shuiguo')
  assert.equal(await readFile(agentsPath, 'utf8'), '客户改过的规则\n')
  assert.equal(await git(bare, ['rev-parse', 'main']), headBefore)

  const added = fake.state.requests.slice(requestsBefore)
  assert.deepEqual(
    added.map((row) => `${row.method} ${row.path.split('?')[0]}`),
    ['GET /repos/acme/acme-shuiguo'],
  )
})

test('建标签失败时删掉新建的仓和临时目录，并报出卡在哪一步', async (t) => {
  const fake = await startFakeGithub()
  t.after(() => fake.close())
  const fetchImpl = async (url, init = {}) => {
    if (init.method === 'POST' && new URL(url).pathname.endsWith('/labels')) {
      return new Response(JSON.stringify({ message: '标签服务炸了' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return fetch(url, init)
  }
  const gh = createGithub({ apiBase: fake.base, token: 'test', fetchImpl })

  const scratch = await mkdtemp(join(tmpdir(), 'afk-scaffold-'))
  t.after(() => rm(scratch, { recursive: true, force: true }))
  const workDir = join(scratch, 'repo')
  const bare = join(scratch, 'remote.git')
  await execFileAsync('git', ['init', '--bare', '-b', 'main', bare])

  await assert.rejects(
    scaffoldCustomerRepo({ ...ARGS, gh, workDir, remoteUrl: bare }),
    (error) => {
      assert.equal(error.name, 'ScaffoldError')
      assert.equal(error.step, 'labels')
      assert.match(error.message, /建标签/)
      assert.match(error.message, /标签服务炸了/)
      return true
    },
  )

  assert.equal(await gh.getRepoOrNull({ owner: 'acme', repo: 'acme-shuiguo' }), null)
  await assert.rejects(stat(workDir))
})

test('建仓请求返回失败但 GitHub 已建出仓时，清理也要删掉它', async (t) => {
  const fake = await startFakeGithub()
  t.after(() => fake.close())
  const fetchImpl = async (url, init = {}) => {
    const response = await fetch(url, init)
    if (init.method === 'POST' && new URL(url).pathname === '/user/repos') {
      return new Response(JSON.stringify({ message: '建仓响应丢了' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return response
  }
  const gh = createGithub({ apiBase: fake.base, token: 'test', fetchImpl })

  const scratch = await mkdtemp(join(tmpdir(), 'afk-scaffold-'))
  t.after(() => rm(scratch, { recursive: true, force: true }))
  const workDir = join(scratch, 'repo')
  const bare = join(scratch, 'remote.git')
  await execFileAsync('git', ['init', '--bare', '-b', 'main', bare])

  await assert.rejects(
    scaffoldCustomerRepo({ ...ARGS, gh, workDir, remoteUrl: bare }),
    (error) => {
      assert.equal(error.name, 'ScaffoldError')
      assert.equal(error.step, 'create-repo')
      assert.match(error.message, /建 GitHub 仓/)
      return true
    },
  )

  assert.equal(await gh.getRepoOrNull({ owner: 'acme', repo: 'acme-shuiguo' }), null)
  await assert.rejects(stat(workDir))
})

test('生成的模板应用能启动，check 能跑过，verify 技能指向截图', async (t) => {
  const { gh, workDir, bare } = await setup(t)
  await scaffoldCustomerRepo({ ...ARGS, gh, workDir, remoteUrl: bare })

  const { stdout } = await execFileAsync('bash', ['scripts/check.sh'], {
    cwd: workDir,
    timeout: 120000,
    maxBuffer: 8 * 1024 * 1024,
  })
  assert.match(stdout, /check 全过/)

  const { createApp } = await import(pathToFileURL(join(workDir, 'src/server.mjs')).href)
  const server = createApp({ product: '取货测试' })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  t.after(() => new Promise((done) => server.close(done)))
  const { port } = server.address()
  const base = `http://127.0.0.1:${port}`

  const home = await fetch(`${base}/`)
  assert.match(await home.text(), /取货测试/)

  const response = await fetch(`${base}/orders`, {
    method: 'POST',
    body: new URLSearchParams({ phone: '13800138000', slotId: 's1' }),
    redirect: 'manual',
  })
  assert.equal(response.status, 303)
  const page = await fetch(`${base}${response.headers.get('location')}`)
  assert.match(await page.text(), /订好了/)

  const skill = await readFile(join(workDir, '.claude/skills/verify/SKILL.md'), 'utf8')
  assert.match(skill, /scripts\/verify\.sh/)
  assert.match(skill, /\.audit\/screenshots/)
})
