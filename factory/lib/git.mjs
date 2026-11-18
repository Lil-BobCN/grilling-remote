import { execFile } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export class GitError extends Error {
  constructor(args, result) {
    super(`git ${args.join(' ')} 失败：${String(result.stderr || result.stdout || '').trim()}`)
    this.name = 'GitError'
    this.args = args
    this.stdout = result.stdout || ''
    this.stderr = result.stderr || ''
    this.code = result.code
  }
}

export async function git(cwd, args, { timeoutMs = 60000, env } = {}) {
  const result = await execFileAsync('git', ['-C', cwd, ...args], {
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
    ...(env && Object.keys(env).length ? { env: { ...process.env, ...env } } : {}),
  }).catch((error) => error)
  if (result.code) throw new GitError(args, result)
  return String(result.stdout || '').trim()
}

export async function initRepo(dir, { branch = 'main', userName = 'AFK Factory', userEmail = 'factory@afkfactory.space' } = {}) {
  await mkdir(dir, { recursive: true })
  await git(dir, ['init', '-b', branch])
  await git(dir, ['config', 'user.name', userName])
  await git(dir, ['config', 'user.email', userEmail])
  return branch
}

export async function initBareRepo(dir, { branch = 'main' } = {}) {
  await mkdir(dir, { recursive: true })
  await git(dir, ['init', '--bare', '-b', branch])
  return dir
}

export async function commitAll(dir, message) {
  await git(dir, ['add', '-A'])
  const status = await git(dir, ['status', '--porcelain'])
  if (!status) return null
  await git(dir, ['commit', '-m', message])
  return git(dir, ['rev-parse', 'HEAD'])
}

export async function addRemote(dir, name, url) {
  const existing = await git(dir, ['remote']).catch(() => '')
  if (existing.split(/\s+/).includes(name)) {
    await git(dir, ['remote', 'set-url', name, url])
  } else {
    await git(dir, ['remote', 'add', name, url])
  }
}

export async function push(dir, { remote = 'origin', branch = 'main', setUpstream = false } = {}) {
  const args = ['push']
  if (setUpstream) args.push('-u')
  args.push(remote, branch)
  return git(dir, args, { timeoutMs: 120000 })
}

/** GitHub 的 https 地址才加 token 认证头；本地路径和 ssh 地址保持原样。 */
export function gitAuthEnv(url, token) {
  if (!token || !/^https:\/\/(www\.)?github\.com\//i.test(String(url || ''))) return {}
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64')
  return {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
  }
}

/** 推到 origin。不传 url 就读仓库自己的 origin 地址，用来判断要不要带 token。 */
export async function pushOrigin(dir, branch, { token = '', url = '', timeoutMs = 120000 } = {}) {
  const remoteUrl = url || (await git(dir, ['remote', 'get-url', 'origin']).catch(() => ''))
  const env = gitAuthEnv(remoteUrl, token)
  await git(dir, ['push', 'origin', branch], { timeoutMs, env })
  return { branch }
}

export async function currentBranch(dir) {
  return git(dir, ['branch', '--show-current'])
}

export async function branchExists(dir, branch) {
  const result = await execFileAsync('git', ['-C', dir, 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`], {
    timeout: 15000,
  }).catch((error) => error)
  return result.code === 0
}

export async function isBranchCheckedOut(dir, branch) {
  const worktrees = await git(dir, ['worktree', 'list', '--porcelain']).catch(() => '')
  return worktrees
    .split(/\r?\n\r?\n/)
    .some((block) => block.split(/\r?\n/).includes(`branch refs/heads/${branch}`))
}

export async function createWorktree(dir, { path, branch, base = 'main' }) {
  await git(dir, ['worktree', 'add', '-B', branch, path, base], { timeoutMs: 120000 })
  return path
}

export async function removeWorktree(dir, path) {
  await git(dir, ['worktree', 'remove', '--force', path], { timeoutMs: 60000 }).catch(() => {})
  await git(dir, ['worktree', 'prune']).catch(() => {})
}

export async function mergeNoFf(dir, branch, message) {
  await git(dir, ['merge', '--no-ff', '--no-edit', '-m', message, branch], { timeoutMs: 120000 })
  return git(dir, ['rev-parse', 'HEAD'])
}

export async function diffNames(dir, base, head) {
  const output = await git(dir, ['diff', '--name-only', `${base}...${head}`])
  return output ? output.split(/\r?\n/).filter(Boolean) : []
}
