import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { run as runInstall } from '../bin/install-launchd.mjs'
import { LAUNCHD_JOBS, installLaunchd, verifyLaunchd } from '../lib/launchd.mjs'

const REPO_ROOT = '/Users/example/afkfactory'
const NOT_LOADED = { code: 113, stdout: '', stderr: 'Could not find service' }

/** 假 launchctl：两个任务都加载，scheduler 有进程 4321。 */
function fakeLoaded({ pid = 4321 } = {}) {
  const calls = []
  const run = async (command, args) => {
    calls.push([command, ...args])
    if (command === 'ps') return { code: 0, stdout: 'node\n', stderr: '' }
    if (args[0] === 'print') {
      return String(args[1]).endsWith('com.afkfactory.scheduler')
        ? { code: 0, stdout: `state = running\n\tpid = ${pid}\n`, stderr: '' }
        : { code: 0, stdout: 'state = waiting\n', stderr: '' }
    }
    return { code: 0, stdout: '', stderr: '' }
  }
  return { run, calls }
}

async function installed(t) {
  const home = await mkdtemp(join(tmpdir(), 'afk-launchd-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const fake = fakeLoaded()
  const result = await installLaunchd({ home, repoRoot: REPO_ROOT, uid: 501, run: fake.run, retries: 0 })
  return { home, result, fake }
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

test('安装会先卸再装两个任务，再检查加载和进程', async (t) => {
  const { home, result, fake } = await installed(t)

  for (const job of LAUNCHD_JOBS) {
    const plist = `${home}/Library/LaunchAgents/${job.plist}`
    assert.ok(
      fake.calls.some((call) => call.join(' ') === `launchctl bootout gui/501/${job.label}`),
      `${job.label} 重装前先卸掉旧任务`,
    )
    assert.ok(
      fake.calls.some((call) => call.join(' ') === `launchctl bootstrap gui/501 ${plist}`),
      `${job.label} 从新 plist 加载`,
    )
    assert.ok(
      fake.calls.some((call) => call.join(' ') === `launchctl print gui/501/${job.label}`),
      `${job.label} 装完检查加载状态`,
    )
  }
  assert.equal(result.verify.ok, true)
  assert.equal(
    result.verify.jobs.find((row) => row.label === 'com.afkfactory.scheduler').pid,
    4321,
  )
  assert.equal(result.commands, undefined, '不再留一套手工加载命令')
})

test('安装后任务没加载：install 报错并指出任务名', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'afk-launchd-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const calls = []
  const run = async (command, args) => {
    calls.push([command, ...args])
    if (args[0] === 'print') return NOT_LOADED
    return { code: 0, stdout: '', stderr: '' }
  }

  await assert.rejects(
    installLaunchd({ home, repoRoot: REPO_ROOT, uid: 501, run, retries: 0 }),
    (error) => {
      assert.match(error.message, /com\.afkfactory\.pull-inbox/)
      assert.match(error.message, /未加载/)
      return true
    },
  )
  const bootouts = calls.filter((call) => call[1] === 'bootout')
  assert.equal(bootouts.length, 4, '装前卸一次，检查失败再回滚卸一次')
})

test('安装命令行遇到没加载的任务时退出失败', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'afk-launchd-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const run = async (command, args) => {
    if (args[0] === 'print') return NOT_LOADED
    return { code: 0, stdout: '', stderr: '' }
  }

  await assert.rejects(
    runInstall(['--repo-root', REPO_ROOT], { home, uid: 501, run, out: () => {}, retries: 0 }),
    /常驻任务没装好/,
  )
})

test('.sandcastle/.env.example 写清 GH_TOKEN 用 GitHub App 短效 token，只给当前客户仓', async () => {
  const text = await readFile(
    new URL('../../backend/scaffold/.sandcastle/.env.example', import.meta.url),
    'utf8',
  )
  assert.match(text, /GitHub App/)
  assert.match(text, /1 小时/)
  assert.match(text, /当前客户仓|当前仓/)
  assert.match(text, /Issues/)
  assert.match(text, /Pull requests/)
  assert.match(text, /Contents/)
})

test('factory/README.md 写清常驻安装入口、--verify 和日志位置', async () => {
  const text = await readFile(new URL('../README.md', import.meta.url), 'utf8')
  assert.match(text, /install-launchd\.mjs/)
  assert.match(text, /~\/\.afkfactory\/logs\//)
  assert.match(text, /--verify/)
  assert.match(text, /不要再用 `nohup`/)
})

async function homeWithPlists(t) {
  const home = await mkdtemp(join(tmpdir(), 'afk-launchd-verify-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const dir = join(home, 'Library', 'LaunchAgents')
  await mkdir(dir, { recursive: true })
  for (const job of LAUNCHD_JOBS) await writeFile(join(dir, job.plist), '<plist/>')
  return home
}

function launchctlOutput(rows) {
  return async (command, args) => {
    const row = rows[args[1]] || rows[args[1]?.split('/').pop()]
    if (row) return row
    return NOT_LOADED
  }
}

test('verifyLaunchd 发现任务没加载：报未加载和任务名', async (t) => {
  const home = await homeWithPlists(t)
  const result = await verifyLaunchd({
    home,
    uid: 501,
    run: async () => (NOT_LOADED),
  })

  assert.equal(result.ok, false)
  for (const job of LAUNCHD_JOBS) {
    const row = result.jobs.find((item) => item.label === job.label)
    assert.equal(row.ok, false)
    assert.equal(row.loaded, false)
    assert.match(row.reason, /未加载/)
  }
})

test('verifyLaunchd 发现 plist 没写：报未安装', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'afk-launchd-verify-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const result = await verifyLaunchd({ home, uid: 501, run: async () => ({ code: 0, stdout: '' }) })

  assert.equal(result.ok, false)
  for (const row of result.jobs) {
    assert.equal(row.ok, false)
    assert.match(row.reason, /没安装/)
  }
})

test('verifyLaunchd 对常驻的 scheduler 检查进程，进程不在就报错', async (t) => {
  const home = await homeWithPlists(t)
  const run = launchctlOutput({
    'com.afkfactory.pull-inbox': { code: 0, stdout: 'state = waiting\n' },
    'com.afkfactory.scheduler': { code: 0, stdout: 'state = running\n\tpid = 4321\n' },
  })
  const runProcess = async (command, args) => {
    if (command === 'launchctl') return run(command, args)
    return { code: 1, stdout: '', stderr: 'no such process' }
  }

  const result = await verifyLaunchd({ home, uid: 501, run: runProcess })

  const scheduler = result.jobs.find((item) => item.label === 'com.afkfactory.scheduler')
  assert.equal(scheduler.ok, false)
  assert.equal(scheduler.pid, 4321)
  assert.match(scheduler.reason, /进程/)
  const pull = result.jobs.find((item) => item.label === 'com.afkfactory.pull-inbox')
  assert.equal(pull.ok, true, 'pull-inbox 是按间隔跑，不要求常驻进程')
})

test('verifyLaunchd 全部加载时返回 pid', async (t) => {
  const home = await homeWithPlists(t)
  const run = async (command, args) => {
    if (command === 'ps') return { code: 0, stdout: 'node\n' }
    if (args[1]?.endsWith('com.afkfactory.scheduler')) {
      return { code: 0, stdout: 'state = running\n\tpid = 4321\n' }
    }
    return { code: 0, stdout: 'state = waiting\n' }
  }

  const result = await verifyLaunchd({ home, uid: 501, run })

  assert.equal(result.ok, true)
  assert.equal(result.jobs.find((item) => item.label === 'com.afkfactory.scheduler').pid, 4321)
})

test('install-launchd --verify 未加载时失败，错误里写任务名', async (t) => {
  const home = await homeWithPlists(t)
  await assert.rejects(
    runInstall(['--verify'], {
      home,
      uid: 501,
      run: async () => (NOT_LOADED),
      out: () => {},
    }),
    (error) => {
      assert.match(error.message, /com\.afkfactory\.pull-inbox/)
      assert.match(error.message, /未加载/)
      return true
    },
  )
})

test('verifyLaunchd 发现 launchd 之外还有手工调度器：报进程号', async (t) => {
  const home = await homeWithPlists(t)
  const run = async (command, args) => {
    if (command === 'ps') return { code: 0, stdout: 'node\n', stderr: '' }
    if (command === 'pgrep') return { code: 0, stdout: '4321\n9999\n', stderr: '' }
    return String(args[1]).endsWith('com.afkfactory.scheduler')
      ? { code: 0, stdout: 'state = running\n\tpid = 4321\n', stderr: '' }
      : { code: 0, stdout: 'state = waiting\n\tlast exit code = 0\n', stderr: '' }
  }

  const result = await verifyLaunchd({ home, uid: 501, run })

  assert.equal(result.ok, false)
  const scheduler = result.jobs.find((row) => row.label === 'com.afkfactory.scheduler')
  assert.equal(scheduler.loaded, true)
  assert.match(scheduler.reason, /launchd 之外还有调度器进程：9999/)
  assert.equal(result.jobs.find((row) => row.label === 'com.afkfactory.pull-inbox').ok, true)
})

test('verifyLaunchd 发现 pull-inbox 上次运行失败：报退出码', async (t) => {
  const home = await homeWithPlists(t)
  const run = async (command, args) => {
    if (command === 'ps') return { code: 0, stdout: 'node\n', stderr: '' }
    if (command === 'pgrep') return { code: 1, stdout: '', stderr: '' }
    if (String(args[1]).endsWith('com.afkfactory.scheduler')) {
      return { code: 0, stdout: 'state = running\n\tpid = 4321\n', stderr: '' }
    }
    return { code: 0, stdout: 'state = not running\n\tlast exit code = 78\n', stderr: '' }
  }

  const result = await verifyLaunchd({ home, uid: 501, run })

  assert.equal(result.ok, false)
  const pull = result.jobs.find((row) => row.label === 'com.afkfactory.pull-inbox')
  assert.equal(pull.loaded, true)
  assert.match(pull.reason, /上次运行退出码 78/)
})
