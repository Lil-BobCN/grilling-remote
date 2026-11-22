import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { defaultBuildImage } from '../lib/sandcastle-runner.mjs'

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

function fakeExec({ existingImages = [], smokeCode = 0, smokeStderr = '' } = {}) {
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
        return { code: smokeCode, stdout: '', stderr: smokeStderr }
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

test('构建后用宿主 UID/GID 冒烟：能写 /home/agent 并设 safe.directory', async (t) => {
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

  const smoke = hook.calls.find((call) => call.command === 'docker' && call.args[0] === 'run')
  assert.ok(smoke, '真正构建过就要冒烟')
  assert.ok(smoke.args.includes('--rm'))
  assert.equal(argAfter(smoke.args, '--user'), '502:20')
  assert.equal(argAfter(smoke.args, '-e'), 'HOME=/home/agent')
  assert.equal(argAfter(smoke.args, '--entrypoint'), 'sh')
  assert.ok(smoke.args.includes(result.image), '冒烟容器用刚构建的镜像')
  const script = argAfter(smoke.args, '-c')
  assert.match(script, /test -w \/home\/agent/)
  assert.match(script, /git config --global --add safe\.directory \/home\/agent\/workspace/)
})

test('冒烟非 0 时抛错，信息带镜像名和输出尾部', async (t) => {
  const fixture = await makeFixture(t)
  const hook = fakeExec({
    smokeCode: 255,
    smokeStderr: 'error: could not lock config file /home/agent/.gitconfig: Permission denied',
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
      assert.match(error.message, /255/)
      assert.match(error.message, /could not lock config file/)
      return true
    },
  )
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
  assert.match(template, /@ai-hero\/sandcastle@0\.12\.0/)
  assert.match(template, /@anthropic-ai\/claude-code/)
})
