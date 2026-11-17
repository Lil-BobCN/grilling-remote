import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { LAUNCHD_JOBS, installLaunchd } from '../lib/launchd.mjs'

const REPO_ROOT = '/Users/example/afkfactory'

async function installed(t) {
  const home = await mkdtemp(join(tmpdir(), 'afk-launchd-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const result = await installLaunchd({ home, repoRoot: REPO_ROOT })
  return { home, result }
}

function plistPath(home, label) {
  return join(home, 'Library', 'LaunchAgents', `${label}.plist`)
}

test('安装脚本把两份 plist 放进 ~/Library/LaunchAgents，参数指向 wrapper', async (t) => {
  const { home } = await installed(t)

  for (const job of LAUNCHD_JOBS) {
    const text = await readFile(plistPath(home, job.label), 'utf8')
    assert.match(text, new RegExp(`<key>Label</key>\\s*<string>${job.label}</string>`))
    assert.match(text, /<key>ProgramArguments<\/key>\s*<array>\s*<string>\/bin\/bash<\/string>/)
    assert.ok(
      text.includes(`<string>${home}/.afkfactory/bin/${job.script}</string>`),
      `${job.label} 的 ProgramArguments 指向 ${job.script}`,
    )
    assert.match(text, /<key>RunAtLoad<\/key>\s*<true\/>/)
    assert.ok(
      text.includes(`<key>StandardOutPath</key>\n  <string>${home}/.afkfactory/logs/${job.log}</string>`),
      `${job.label} 的 StandardOutPath 落在 ~/.afkfactory/logs/`,
    )
    assert.ok(
      text.includes(`<key>StandardErrorPath</key>\n  <string>${home}/.afkfactory/logs/${job.log}</string>`),
      `${job.label} 的 StandardErrorPath 落在 ~/.afkfactory/logs/`,
    )
  }
})

test('scheduler 由 launchd 常驻：KeepAlive 加 --loop，重启后重新读 GitHub 状态', async (t) => {
  const { home, result } = await installed(t)
  const scheduler = await readFile(plistPath(home, 'com.afkfactory.scheduler'), 'utf8')
  assert.match(scheduler, /<key>KeepAlive<\/key>\s*<true\/>/)

  const wrapper = await readFile(join(home, '.afkfactory', 'bin', 'run-scheduler.sh'), 'utf8')
  assert.match(wrapper, /factory\/bin\/scheduler\.mjs.*--loop/)
  assert.doesNotMatch(wrapper, /--once/, 'launchd 拉起的进程要一直跑')

  // 进程状态只在 GitHub，重启后新进程按标签重新推导。已有用例：
  // test/scheduler.test.mjs「同一仓第一张在后台跑时，第二张仍等待；新实例不重复点火」。
  assert.ok(result.plists.includes(plistPath(home, 'com.afkfactory.scheduler')))
})

test('安装脚本创建日志目录和 wrapper，日志都在 ~/.afkfactory/logs/ 下', async (t) => {
  const { home } = await installed(t)

  const logsDir = await stat(join(home, '.afkfactory', 'logs'))
  assert.ok(logsDir.isDirectory())

  const pull = await readFile(join(home, '.afkfactory', 'bin', 'run-pull-inbox.sh'), 'utf8')
  assert.match(pull, /^#!\/bin\/bash/)
  assert.match(pull, /source "\$HOME\/\.afkfactory\/env"/)
  assert.match(pull, /export PATH=/)
  assert.match(pull, /factory\/bin\/pull-inbox\.mjs/)

  const scheduler = await readFile(join(home, '.afkfactory', 'bin', 'run-scheduler.sh'), 'utf8')
  assert.match(scheduler, /^#!\/bin\/bash/)
  assert.match(scheduler, /source "\$HOME\/\.afkfactory\/env"/)
  assert.match(scheduler, /export PATH=/)
  assert.match(scheduler, /\$HOME\/\.afkfactory\/logs\/scheduler-runs\.jsonl/, '每轮 runs.jsonl 也放进 logs')

  for (const job of LAUNCHD_JOBS) {
    const mode = (await stat(join(home, '.afkfactory', 'bin', job.script))).mode
    assert.ok(mode & 0o111, `${job.script} 可执行`)
  }
})

test('plist 里没有凭证和环境变量，token 只从 ~/.afkfactory/env 读', async (t) => {
  const { home } = await installed(t)
  for (const job of LAUNCHD_JOBS) {
    const text = await readFile(plistPath(home, job.label), 'utf8')
    assert.doesNotMatch(text, /TOKEN|SECRET|PASSWORD|ANTHROPIC|GH_TOKEN|GITHUB_TOKEN/)
    assert.doesNotMatch(text, /<key>EnvironmentVariables<\/key>/)
  }

  const templates = await readFile(new URL('../launchd/com.afkfactory.scheduler.plist', import.meta.url), 'utf8')
  assert.doesNotMatch(templates, /\/Users\//, '模板不写具体机器路径')
})

test('安装只写文件，不加载 launchd；加载命令交给运营者', async (t) => {
  const { home, result } = await installed(t)

  const text = result.commands.join('\n')
  assert.match(text, /launchctl bootstrap gui\/\$\(id -u\)/)
  for (const job of LAUNCHD_JOBS) {
    assert.ok(text.includes(`${home}/Library/LaunchAgents/${job.label}.plist`), `命令里列出 ${job.label}`)
  }

  const source = await readFile(new URL('../lib/launchd.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /node:child_process|execFile|spawn\(/, '安装脚本不执行 launchctl')
})

test('.sandcastle/.env.example 写清 GH_TOKEN 用细粒度 PAT，只给当前客户仓', async () => {
  const text = await readFile(
    new URL('../../backend/scaffold/.sandcastle/.env.example', import.meta.url),
    'utf8',
  )
  assert.match(text, /fine-grained|细粒度/)
  assert.match(text, /只选当前客户仓|只限当前客户仓/)
  assert.match(text, /Issues/)
  assert.match(text, /Pull requests/)
  assert.match(text, /Contents/)
})

test('factory/README.md 写清常驻安装入口和日志位置', async () => {
  const text = await readFile(new URL('../README.md', import.meta.url), 'utf8')
  assert.match(text, /install-launchd\.mjs/)
  assert.match(text, /~\/\.afkfactory\/logs\//)
  assert.match(text, /launchctl bootstrap/)
})
