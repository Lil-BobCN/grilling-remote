/**
 * 客户仓工作区：客户仓副本、票分支、工作树的唯一 owner。
 *
 * 点火、管线、收尾以后都从这里拿路径和资源，不再各自拼 worktree。
 * 镜像构建归 `sandcastle-runner.mjs` 的 `defaultBuildImage`，这里不再另留接口。
 * 释放规则：
 * - 干净工作树直接删，删完跑 `git worktree prune`，`git worktree list` 不留登记。
 * - 只有未跟踪文件（截图、草稿）时，先挪进客户仓的 `.audit/archive/<时间>-<分支>/`，再删。
 * - 改了已跟踪文件的工作树保留，返回路径，等人工或下一轮处理。
 * - `abort` 是失败路径：未跟踪文件先归档，然后连脏工作树一起删。
 * - 被忽略的文件（node_modules、构建产物）不归档，随工作树删除。
 */
import { execFile } from 'node:child_process'
import { mkdir, readdir, realpath, rename, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { git, gitAuthEnv } from './git.mjs'
import { acquireFileLock } from './lock.mjs'

const execFileAsync = promisify(execFile)
const CONFIG_DIR = '.sandcastle'
const WORKTREES_DIR = join(CONFIG_DIR, 'worktrees')
const ENV_KEYS = ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'SHELL', 'USER']

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function tail(result, limit = 2000) {
  const text = String(result?.stderr || result?.stdout || '').trim()
  return text.length > limit ? text.slice(-limit) : text
}

function baseEnv(env) {
  const result = {}
  for (const key of ENV_KEYS) {
    if (env?.[key] !== undefined) result[key] = env[key]
  }
  return result
}

function branchSlug(branch) {
  const slug = String(branch || '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return slug || 'detached'
}

function archiveStamp(at) {
  const date = at instanceof Date ? at : new Date(at ?? Date.now())
  const iso = Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
  return `${iso.slice(0, 19).replace(/[-:]/g, '')}Z`
}

/** 把 `git worktree list --porcelain` 拆成 `{path, branch}` 行。 */
export function parseWorktreeList(text) {
  return String(text || '')
    .split(/\r?\n\r?\n/)
    .map((block) => {
      const lines = block.split(/\r?\n/)
      const pathLine = lines.find((line) => line.startsWith('worktree '))
      const branchLine = lines.find((line) => line.startsWith('branch refs/heads/'))
      return {
        path: pathLine ? pathLine.slice('worktree '.length) : '',
        branch: branchLine ? branchLine.slice('branch refs/heads/'.length) : '',
      }
    })
    .filter((row) => row.path)
}

async function canonicalPath(path) {
  try {
    return await realpath(path)
  } catch {
    return resolve(path)
  }
}

/** target 是否在 parent 目录里面；用真实路径比较，兼容 /var 和 /private/var。 */
async function isInside(parent, target) {
  const [from, to] = await Promise.all([canonicalPath(parent), canonicalPath(target)])
  const rel = relative(from, to)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** 默认外部命令执行器，测试可注入替身。 */
export async function defaultCommandExec(command, args, { cwd, env } = {}) {
  const result = await execFileAsync(command, args, {
    cwd,
    env,
    timeout: 30 * 60 * 1000,
    maxBuffer: 16 * 1024 * 1024,
  }).catch((error) => error)
  const failed = result instanceof Error
  return {
    code: failed ? 1 : 0,
    stdout: String(result?.stdout ?? ''),
    stderr: String(result?.stderr ?? result?.message ?? ''),
  }
}

function defaultRemoteUrlFor({ owner, repo }) {
  return `https://github.com/${owner}/${repo}.git`
}

/**
 * @param {object} [options]
 * @param {string} [options.repoRoot] 客户仓副本根目录，默认 `~/.afkfactory/repos`
 * @param {string} [options.lockDir] 每仓锁目录
 * @param {string} [options.token] GitHub token，只用于 https 地址
 * @param {Function} [options.remoteUrlFor] `({owner, repo}) => url`
 * @param {Function} [options.pushBranch] 本地需求分支领先时用的推送函数
 * @param {object} [options.env] 外部命令的环境
 * @param {Function} [options.git] git 替身，签名同 `git.mjs` 的 `git`
 * @param {Function} [options.exec] docker、npx 替身 `(command, args, {cwd, env}) => {code, stdout, stderr}`
 * @param {Function} [options.clock]
 */
export function createRepoWorkspace({
  repoRoot = process.env.AFK_REPO_ROOT || join(homedir(), '.afkfactory', 'repos'),
  lockDir = process.env.AFK_LOCK_DIR || join(homedir(), '.grilling', 'factory', 'locks'),
  token = process.env.GITHUB_TOKEN || '',
  remoteUrlFor = defaultRemoteUrlFor,
  pushBranch = null,
  env = process.env,
  git: gitImpl = git,
  exec = defaultCommandExec,
  clock = () => new Date(),
} = {}) {
  function worktreePath(repoDir, branch) {
    return join(repoDir, WORKTREES_DIR, branchSlug(branch))
  }

  async function worktreeList(repoDir) {
    return parseWorktreeList(await gitImpl(repoDir, ['worktree', 'list', '--porcelain']))
  }

  async function statusPorcelain(path) {
    return gitImpl(path, ['status', '--porcelain', '--untracked-files=all'])
  }

  async function findWorktreeRow(rows, target) {
    const wanted = await canonicalPath(target)
    for (const row of rows) {
      if ((await canonicalPath(row.path)) === wanted) return row
    }
    return null
  }

  /** 未跟踪、没被忽略的文件；忽略文件不归档。 */
  async function untrackedFiles(worktree) {
    const output = await gitImpl(worktree, ['ls-files', '--others', '--exclude-standard', '-z'])
    return output.split('\0').filter(Boolean)
  }

  async function archiveUntracked({ repoDir, worktree, branch, at }) {
    const archived = []
    const errors = []
    let files = []
    try {
      files = await untrackedFiles(worktree)
    } catch (error) {
      return { archived, errors: [{ file: '', error: String(error?.message || error) }] }
    }
    if (!files.length) return { archived, errors }

    const base = `${archiveStamp(at)}-${branchSlug(branch)}`
    let batch = base
    for (let index = 2; ; index += 1) {
      if (!(await exists(join(repoDir, '.audit', 'archive', batch)))) break
      batch = `${base}-${index}`
    }

    for (const file of files) {
      // 工作树里已经归档过的文件不再套一层 .audit。
      const relativeFile = file.startsWith('.audit/') ? file.slice('.audit/'.length) : file
      try {
        const target = join(repoDir, '.audit', 'archive', batch, relativeFile)
        await mkdir(dirname(target), { recursive: true })
        await rename(join(worktree, file), target)
        archived.push({ from: file, to: relative(repoDir, target) })
      } catch (error) {
        errors.push({ file, error: String(error?.message || error) })
      }
    }
    return { archived, errors }
  }

  /** 登记还在但目录已经没了，prune 掉；返回是否已不在登记里。 */
  async function pruneMissing(repoDir, row) {
    if (await exists(row.path)) return false
    await gitImpl(repoDir, ['worktree', 'prune']).catch(() => {})
    const rows = await worktreeList(repoDir).catch(() => [])
    return !(await findWorktreeRow(rows, row.path))
  }

  /** 删工作树并 prune；返回登记是否真的没了。 */
  async function removeWorktree(repoDir, path) {
    try {
      await gitImpl(repoDir, ['worktree', 'remove', '--force', path])
    } catch {
      // 目录已经不在了也继续 prune，最后按登记判断。
    }
    await gitImpl(repoDir, ['worktree', 'prune']).catch(() => {})
    const rows = await worktreeList(repoDir).catch(() => [])
    return !(await findWorktreeRow(rows, path))
  }

  async function deleteBranchIfFree(repoDir, branch) {
    const rows = await worktreeList(repoDir).catch(() => [])
    if (rows.some((row) => row.branch === branch)) return false
    try {
      await gitImpl(repoDir, ['branch', '-D', branch])
      return true
    } catch {
      return false
    }
  }

  /** 确保客户仓副本存在并切到需求分支。 */
  async function ensure({ owner = '', repo, reqBranch = '' } = {}) {
    if (!repo) throw new Error('ensure 需要 repo 名')
    const repoDir = join(repoRoot, repo)
    const url = remoteUrlFor({ owner, repo })
    const authEnv = gitAuthEnv(url, token)
    let cloned = false

    if (await exists(join(repoDir, '.git'))) {
      await gitImpl(repoDir, ['fetch', 'origin'], { env: authEnv })
    } else {
      await mkdir(repoRoot, { recursive: true })
      await gitImpl(repoRoot, ['clone', url, repoDir], { env: authEnv })
      cloned = true
    }

    let localAhead = 0
    if (reqBranch) {
      const remoteRef = `origin/${reqBranch}`
      const found = await gitImpl(
        repoDir,
        ['rev-parse', '--verify', '--quiet', `refs/remotes/${remoteRef}`],
      ).catch(() => '')
      if (!found) throw new Error(`客户仓里没有需求分支 ${reqBranch}`)

      // 本地需求分支可能带着上一次合并但没推到 origin，先推，推不了就报错。
      const localHead = await gitImpl(
        repoDir,
        ['rev-parse', '--verify', '--quiet', `refs/heads/${reqBranch}`],
      ).catch(() => '')
      if (localHead) {
        localAhead = Number(
          (await gitImpl(repoDir, ['rev-list', '--count', `${remoteRef}..${reqBranch}`]).catch(
            () => '0',
          )) || 0,
        )
        if (localAhead > 0) {
          if (typeof pushBranch !== 'function') {
            throw new Error(
              `本地 ${reqBranch} 有 ${localAhead} 个提交没推到 origin。没有重置本地分支，先解决推送再点火。`,
            )
          }
          try {
            await pushBranch({ repoDir, owner, repo, branch: reqBranch })
          } catch (error) {
            throw new Error(
              `本地 ${reqBranch} 有 ${localAhead} 个提交没推到 origin：${String(
                error?.message || error,
              )}。没有重置本地分支，先解决推送再点火。`,
            )
          }
        }
      }

      await gitImpl(repoDir, ['checkout', '-B', reqBranch, remoteRef])
    }

    return { repoDir, reqBranch, cloned, localAhead }
  }

  /** 每仓一把文件锁；拿不到返回 `{skipped:true}`。 */
  async function lock({ owner = '', repo, timeoutMs = 0, staleMs = 10 * 60 * 1000 } = {}) {
    if (!repo) throw new Error('lock 需要 repo 名')
    const path = join(lockDir, `${owner}__${repo}.lock`)
    const acquired = await acquireFileLock(path, { timeoutMs, staleMs })
    return { ...acquired, path }
  }

  /** 建票分支和工作树；旧的干净工作树先删，脏的报错保留。 */
  async function prepareTicket({ repoDir, base = '', ticketBranch } = {}) {
    if (!repoDir) throw new Error('prepareTicket 需要 repoDir')
    if (!ticketBranch) throw new Error('prepareTicket 需要 ticketBranch')
    const path = worktreePath(repoDir, ticketBranch)
    const rows = await worktreeList(repoDir)
    const existing = await findWorktreeRow(rows, path)

    if (existing) {
      if (await exists(existing.path)) {
        const dirty = await statusPorcelain(existing.path)
        if (dirty) {
          throw new Error(
            `工作树 ${existing.path} 有未提交改动，先 release 或 abort 再 prepareTicket`,
          )
        }
        await removeWorktree(repoDir, existing.path)
      } else {
        await pruneMissing(repoDir, existing)
      }
    } else if (await exists(path)) {
      throw new Error(`目录已存在但不是 git 工作树，未动：${path}`)
    }

    await mkdir(dirname(path), { recursive: true })
    // 票分支已有提交时接着用，不用 -B 重置，避免重试丢上一次的提交。
    const localBranch = await gitImpl(
      repoDir,
      ['rev-parse', '--verify', '--quiet', `refs/heads/${ticketBranch}`],
    ).catch(() => '')
    const args = ['worktree', 'add']
    if (localBranch) {
      args.push(path, ticketBranch)
    } else {
      if (!base) throw new Error(`prepareTicket 需要 base：票分支 ${ticketBranch} 还不存在`)
      args.push('-b', ticketBranch, path, base)
    }
    await gitImpl(repoDir, args)
    return { repoDir, worktree: path, branch: ticketBranch, base }
  }

  /**
   * 正常收尾：干净工作树删；只有未跟踪文件时归档后删；改了已跟踪文件时保留。
   * `deleteBranch: true` 时，工作树删掉后顺手删票分支。
   */
  async function release({ repoDir, worktree, branch = '', deleteBranch = false } = {}) {
    if (!repoDir) throw new Error('release 需要 repoDir')
    const path = worktree || (branch ? worktreePath(repoDir, branch) : '')
    if (!path) throw new Error('release 需要 worktree 或 branch')

    const rows = await worktreeList(repoDir)
    const row = await findWorktreeRow(rows, path)
    if (!row) {
      await gitImpl(repoDir, ['worktree', 'prune']).catch(() => {})
      if (deleteBranch && branch) await deleteBranchIfFree(repoDir, branch)
      return {
        path,
        branch,
        registered: false,
        removed: false,
        kept: false,
        dirty: false,
        archived: [],
      }
    }

    const branchName = branch || row.branch || ''
    if (await pruneMissing(repoDir, row)) {
      if (deleteBranch && branchName) await deleteBranchIfFree(repoDir, branchName)
      return {
        path,
        branch: branchName,
        registered: false,
        removed: true,
        kept: false,
        dirty: false,
        archived: [],
      }
    }

    const dirtyText = await statusPorcelain(row.path)
    const { archived, errors } = dirtyText
      ? await archiveUntracked({ repoDir, worktree: row.path, branch: branchName, at: clock() })
      : { archived: [], errors: [] }
    const stillDirty = Boolean(await statusPorcelain(row.path).catch(() => dirtyText))

    if (stillDirty || errors.length) {
      return {
        path,
        branch: branchName,
        registered: true,
        removed: false,
        kept: true,
        dirty: true,
        archived,
        ...(errors.length ? { errors } : {}),
      }
    }

    const removed = await removeWorktree(repoDir, row.path)
    if (removed && deleteBranch && branchName) {
      await deleteBranchIfFree(repoDir, branchName)
    }
    return {
      path,
      branch: branchName,
      registered: !removed,
      removed,
      kept: !removed,
      dirty: false,
      archived,
    }
  }

  /**
   * 失败路径清理：未跟踪文件先归档，然后连脏工作树一起删。
   * 归档失败时保留现场，把错误交给调用方。
   */
  async function abort({ repoDir, worktree, branch = '', deleteBranch = false } = {}) {
    if (!repoDir) throw new Error('abort 需要 repoDir')
    const path = worktree || (branch ? worktreePath(repoDir, branch) : '')
    if (!path) throw new Error('abort 需要 worktree 或 branch')

    const rows = await worktreeList(repoDir)
    const row = await findWorktreeRow(rows, path)
    if (!row) {
      await gitImpl(repoDir, ['worktree', 'prune']).catch(() => {})
      return {
        path,
        branch,
        registered: false,
        removed: false,
        kept: false,
        dirty: false,
        archived: [],
      }
    }

    const branchName = branch || row.branch || ''
    if (await pruneMissing(repoDir, row)) {
      if (deleteBranch && branchName) await deleteBranchIfFree(repoDir, branchName)
      return {
        path,
        branch: branchName,
        registered: false,
        removed: true,
        kept: false,
        dirty: false,
        archived: [],
      }
    }

    const dirtyText = await statusPorcelain(row.path)
    const { archived, errors } = await archiveUntracked({
      repoDir,
      worktree: row.path,
      branch: branchName,
      at: clock(),
    })
    if (errors.length) {
      return {
        path,
        branch: branchName,
        registered: true,
        removed: false,
        kept: true,
        dirty: Boolean(dirtyText),
        archived,
        errors,
      }
    }

    const removed = await removeWorktree(repoDir, row.path)
    if (removed && deleteBranch && branchName) {
      await deleteBranchIfFree(repoDir, branchName)
    }
    return {
      path,
      branch: branchName,
      registered: !removed,
      removed,
      kept: !removed,
      dirty: Boolean(dirtyText),
      archived,
    }
  }

  async function listRepoDirs() {
    let entries
    try {
      entries = await readdir(repoRoot, { withFileTypes: true })
    } catch {
      return []
    }
    const dirs = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const dir = join(repoRoot, entry.name)
      if (await exists(join(dir, '.git'))) dirs.push(dir)
    }
    return dirs
  }

  /**
   * 巡检：列出孤儿容器（`sandcastle-` 开头且没在跑）和 `.sandcastle/worktrees` 下的工作树。
   * `remove: true` 时清掉；脏工作树仍按 release 规则保留。`keep` 里的名字和路径不动。
   */
  async function sweep({ repoDirs, remove = false, keep = [] } = {}) {
    const result = { containers: [], worktrees: [], errors: [] }
    const keepNames = new Set(keep)
    const keepPaths = new Set(await Promise.all(keep.map((path) => canonicalPath(path))))

    const ps = await exec(
      'docker',
      ['ps', '-a', '--filter', 'name=^sandcastle-', '--format', '{{.Names}}\t{{.State}}'],
      { env: baseEnv(env) },
    )
    if (ps.code !== 0) {
      result.errors.push({ target: 'docker ps', error: tail(ps) || `退出码 ${ps.code}` })
    } else {
      for (const line of String(ps.stdout || '').split(/\r?\n/)) {
        const [name, state = ''] = line.trim().split('\t')
        if (!name) continue
        const kept = keepNames.has(name)
        const orphan = !kept && state !== 'running'
        let removed = false
        if (orphan && remove) {
          const rm = await exec('docker', ['rm', '-f', name], { env: baseEnv(env) })
          removed = rm.code === 0
          if (!removed) result.errors.push({ target: name, error: tail(rm) || `退出码 ${rm.code}` })
        }
        result.containers.push({ name, state, orphan, kept, removed })
      }
    }

    const repos = repoDirs ? [].concat(repoDirs) : await listRepoDirs()
    for (const repoDir of repos) {
      let rows
      try {
        rows = await worktreeList(repoDir)
      } catch (error) {
        result.errors.push({ target: repoDir, error: String(error?.message || error) })
        continue
      }
      for (const row of rows) {
        if (!(await isInside(join(repoDir, WORKTREES_DIR), row.path))) continue
        if (keepPaths.has(await canonicalPath(row.path))) continue
        if (!remove) {
          const dirty = Boolean(await statusPorcelain(row.path).catch(() => 'dirty'))
          result.worktrees.push({
            repoDir,
            path: row.path,
            branch: row.branch,
            dirty,
            removed: false,
            kept: dirty,
          })
          continue
        }
        let released
        try {
          released = await release({ repoDir, worktree: row.path, branch: row.branch })
        } catch (error) {
          result.errors.push({ target: row.path, error: String(error?.message || error) })
          continue
        }
        result.worktrees.push({
          repoDir,
          path: row.path,
          branch: row.branch,
          dirty: released.dirty,
          removed: released.removed,
          kept: released.kept,
          archived: released.archived,
        })
        if (released.errors) {
          result.errors.push({ target: row.path, error: released.errors.map((row) => row.error).join('；') })
        }
      }
    }

    return result
  }

  return { ensure, lock, prepareTicket, release, abort, sweep }
}

let sharedWorkspace = null

function shared() {
  if (!sharedWorkspace) sharedWorkspace = createRepoWorkspace()
  return sharedWorkspace
}

export function ensure(args) {
  return shared().ensure(args)
}

export function lock(args) {
  return shared().lock(args)
}

export function prepareTicket(args) {
  return shared().prepareTicket(args)
}

export function release(args) {
  return shared().release(args)
}

export function abort(args) {
  return shared().abort(args)
}

export function sweep(args) {
  return shared().sweep(args)
}
