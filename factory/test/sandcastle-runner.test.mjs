import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { defaultBuildImage, createSandcastleRunner } from '../lib/sandcastle-runner.mjs'

async function makeFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'afk-sandcastle-runner-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const templateDir = join(root, 'scaffold', '.sandcastle')
  const repoDir = join(root, 'repo')
  await mkdir(templateDir, { recursive: true })
  await mkdir(join(repoDir, '.sandcastle'), { recursive: true })
  const templatePath = join(templateDir, 'Dockerfile')
  await writeFile(templatePath, 'FROM node:26-bookworm\nARG AGENT_UID=1000\n')
  return { root, templateDir, templatePath, repoDir }
}

function fakeExec({
  existingImages = [],
  runCode = 0,
  runStderr = '',
  execCode = 0,
  execStderr = '',
} = {}) {
  const calls = []
  const known = new Set(existingImages)
  return {
    calls,
    async exec(command, args, options = {}) {
      calls.push({ command, args, options })
      if (command !== 'docker') return { code: 0, stdout: '', stderr: '' }
      if (args[0] === 'image' && args[1] === 'inspect') {
        const name = args.at(-1)
        return known.has(name)
          ? { code: 0, stdout: 'sha256:image-id\n', stderr: '' }
          : { code: 1, stdout: '', stderr: `Error: No such image: ${name}` }
      }
      if (args[0] === 'build') {
        const index = args.indexOf('-t')
        if (index > 0) known.add(args[index + 1])
        return { code: 0, stdout: 'Successfully built', stderr: '' }
      }
      if (args[0] === 'run') {
        return { code: runCode, stdout: '', stderr: runStderr }
      }
      if (args[0] === 'exec') {
        return { code: execCode, stdout: '', stderr: execStderr }
      }
      return { code: 0, stdout: '', stderr: '' }
    },
  }
}

function argAfter(args, flag) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

test('默认构建用工厂模板和模板目录，带宿主 UID/GID 的 build-arg', async (t) => {
  const fixture = await makeFixture(t)
  await writeFile(
    join(fixture.repoDir, '.sandcastle', 'Dockerfile'),
    'FROM node:26-bookworm\n# 客户仓旧副本\n',
  )
  const hook = fakeExec()
  const result = await defaultBuildImage({
    image: 'sandcastle:demo',
    repoDir: fixture.repoDir,
    templatePath: fixture.templatePath,
    exec: hook.exec,
    uid: 502,
    gid: 20,
  })

  assert.equal(result.built, true)
  assert.match(result.image, /^sandcastle:demo-[0-9a-f]{12}$/)
  const build = hook.calls.find((call) => call.command === 'docker' && call.args[0] === 'build')
  assert.ok(build, '没命中镜像时要构建')
  assert.equal(build.options.cwd, fixture.templateDir)
  assert.equal(argAfter(build.args, '-f'), fixture.templatePath, '默认用工厂模板当 Dockerfile')
  assert.equal(argAfter(build.args, '--build-arg'), 'AGENT_UID=502')
  assert.ok(build.args.includes('AGENT_GID=20'))
  assert.equal(build.args.at(-1), fixture.templateDir, '构建上下文是模板目录')
  assert.equal(argAfter(build.args, '-t'), result.image)
})

test('构建后用宿主 UID/GID 冒烟：默认入口起常驻容器，exec 能写 /home/agent 并设 safe.directory', async (t) => {
  const fixture = await makeFixture(t)
  const hook = fakeExec()
  const result = await defaultBuildImage({
    image: 'sandcastle:demo',
    repoDir: fixture.repoDir,
    templatePath: fixture.templatePath,
    exec: hook.exec,
    uid: 502,
    gid: 20,
  })

  const dockerCalls = hook.calls.filter((call) => call.command === 'docker')
  const smokeIndex = dockerCalls.findIndex((call) => call.args[0] === 'run')
  assert.ok(smokeIndex >= 0, '真正构建过就要冒烟')
  const smoke = dockerCalls[smokeIndex]
  assert.ok(smoke.args.includes('-d'), '后台起容器，不覆盖入口')
  const containerName = argAfter(smoke.args, '--name')
  assert.match(containerName, /^afk-sandcastle-smoke-[0-9a-f]{12}-\d+-\d+$/)
  assert.equal(argAfter(smoke.args, '--user'), '502:20')
  assert.equal(argAfter(smoke.args, '-e'), 'HOME=/home/agent')
  assert.ok(!smoke.args.includes('--entrypoint'), '不覆盖镜像默认入口')
  assert.equal(smoke.args.at(-1), result.image, '冒烟容器用刚构建的镜像')

  const exec = dockerCalls[smokeIndex + 1]
  assert.deepEqual(exec.args.slice(0, 3), ['exec', containerName, 'sh'])
  const script = argAfter(exec.args, '-c')
  assert.match(script, /test -w \/home\/agent/)
  assert.match(script, /git config --global --add safe\.directory \/home\/agent\/workspace/)

  const cleanup = dockerCalls.at(-1)
  assert.deepEqual(cleanup.args, ['rm', '-f', containerName], '冒烟结束清理容器')
})

test('冒烟非 0 时抛错，信息带镜像名和输出尾部', async (t) => {
  const fixture = await makeFixture(t)
  const hook = fakeExec({
    execCode: 1,
    execStderr: 'Error response from daemon: container 6da2eec8407f is not running',
  })

  await assert.rejects(
    () =>
      defaultBuildImage({
        image: 'sandcastle:demo',
        repoDir: fixture.repoDir,
        templatePath: fixture.templatePath,
        exec: hook.exec,
        uid: 502,
        gid: 20,
      }),
    (error) => {
      assert.match(error.message, /sandcastle:demo-[0-9a-f]{12}/)
      assert.match(error.message, /退出码 1/)
      assert.match(error.message, /is not running/)
      return true
    },
  )

  const cleanup = hook.calls.at(-1)
  assert.equal(cleanup.command, 'docker')
  assert.deepEqual(cleanup.args.slice(0, 2), ['rm', '-f'], '失败也要清理容器')
})

test('同 tag 镜像已存在时走 inspect 快路径，不构建也不冒烟', async (t) => {
  const fixture = await makeFixture(t)
  const hook = fakeExec()
  const first = await defaultBuildImage({
    image: 'sandcastle:demo',
    repoDir: fixture.repoDir,
    templatePath: fixture.templatePath,
    exec: hook.exec,
    uid: 502,
    gid: 20,
  })
  hook.calls.length = 0

  const again = await defaultBuildImage({
    image: 'sandcastle:demo',
    repoDir: fixture.repoDir,
    templatePath: fixture.templatePath,
    exec: hook.exec,
    uid: 502,
    gid: 20,
  })

  assert.equal(again.built, false)
  assert.equal(again.image, first.image)
  assert.equal(hook.calls.length, 1, '只查 inspect，不再构建或冒烟')
  assert.deepEqual(hook.calls[0].args.slice(0, 3), ['image', 'inspect', '--format'])
})

test('工厂模板遵守 Sandcastle 0.12.0 的镜像约定', async () => {
  const template = await readFile(
    new URL('../../backend/scaffold/.sandcastle/Dockerfile', import.meta.url),
    'utf8',
  )

  assert.match(template, /^ARG AGENT_UID=1000$/m)
  assert.match(template, /^ARG AGENT_GID=1000$/m)
  assert.match(template, /(groupmod|usermod).*node/)
  assert.match(template, /^USER \$\{AGENT_UID\}:\$\{AGENT_GID\}$/m)
  assert.match(template, /^WORKDIR \/home\/agent$/m)
  assert.match(template, /^ENTRYPOINT \["sleep", "infinity"\]$/m)
  assert.match(template, /@ai-hero\/sandcastle@0\.12\.0/)
  assert.match(template, /@anthropic-ai\/claude-code/)
})

test('取消后清理这次新起的 sandcastle 容器，不动已有容器', async (t) => {
  const fixture = await makeFixture(t)
  const calls = []
  let psCount = 0
  const exec = async (command, args) => {
    calls.push({ command, args })
    if (command === 'docker' && args[0] === 'ps') {
      psCount += 1
      return { code: 0, stdout: psCount === 1 ? 'old1\n' : 'old1\nnew1\nnew2\n', stderr: '' }
    }
    if (command === 'docker' && args[0] === 'rm') {
      return { code: 0, stdout: '', stderr: '' }
    }
    return { code: 1, stdout: '', stderr: 'killed' }
  }
  const controller = new AbortController()
  controller.abort()
  const runner = createSandcastleRunner({
    home: join(fixture.root, 'sandcastle'),
    exec,
    env: {},
  })

  await assert.rejects(
    () =>
      runner.run({
        repoDir: fixture.repoDir,
        ticketBranch: 'ticket/51',
        prepared: { scriptPath: join(fixture.root, 'sandcastle', 'run-51.mts') },
        signal: controller.signal,
      }),
    (error) => {
      assert.equal(error.aborted, true)
      assert.deepEqual(error.cleanedContainers, ['new1', 'new2'])
      return true
    },
  )
  const removed = calls
    .filter((call) => call.command === 'docker' && call.args[0] === 'rm')
    .map((call) => call.args.at(-1))
  assert.deepEqual(removed, ['new1', 'new2'])
})
