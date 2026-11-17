#!/usr/bin/env node
/**
 * 建客户仓的命令行入口。
 *
 *   GITHUB_TOKEN=... node backend/bin/scaffold-repo.mjs \
 *     --owner acme --repo acme-shuiguo --short-name acme --product shuiguo \
 *     --work-dir /tmp/acme-shuiguo
 *
 * 可选：`--owner-type user|org`，默认 user；`--remote-url <git 地址>`，默认
 * `https://github.com/<owner>/<repo>.git`，本机 git 要能推这个地址。
 * 推 GitHub 时用 GITHUB_TOKEN 做 HTTP 认证；用本地裸仓测试时传 --remote-url。
 */

import { createGithubApi } from '../lib/github-api.mjs'
import { scaffoldCustomerRepo } from '../lib/scaffold.mjs'

const USAGE = `用法：
  scaffold-repo.mjs --owner <owner> --repo <仓名> --short-name <客户简称> --product <软件简称> --work-dir <目录>
                    [--owner-type user|org] [--remote-url <git 地址>]

环境变量：GITHUB_TOKEN 必填。`

function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (!item.startsWith('--')) throw new Error(`不认识这个参数：${item}`)
    const name = item.slice(2)
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`缺少 ${item} 的值`)
    options[name] = value
    index += 1
  }
  return options
}

async function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(error.message)
    console.error(USAGE)
    process.exit(1)
  }

  const owner = options.owner
  const repoName = options.repo
  const shortName = options['short-name']
  const product = options.product
  const workDir = options['work-dir']
  const ownerType = options['owner-type'] || 'user'
  if (!owner || !repoName || !shortName || !product || !workDir) {
    console.error(USAGE)
    process.exit(1)
  }
  if (ownerType !== 'user' && ownerType !== 'org') {
    console.error(`--owner-type 只能是 user 或 org，收到 ${ownerType}`)
    process.exit(1)
  }

  const token = process.env.GITHUB_TOKEN
  if (!token) {
    console.error('缺少 GITHUB_TOKEN')
    process.exit(1)
  }

  const remoteUrl = options['remote-url'] || `https://github.com/${owner}/${repoName}.git`
  const gh = createGithubApi({
    token,
    apiBase: process.env.GITHUB_API_BASE || process.env.GITHUB_API || 'https://api.github.com',
  })

  try {
    const result = await scaffoldCustomerRepo({
      gh,
      owner,
      repoName,
      shortName,
      product,
      workDir,
      remoteUrl,
      ownerType,
    })
    if (!result.created) {
      console.log(`仓已存在，不重建：${owner}/${repoName}`)
      return
    }
    console.log(`建好了：${result.htmlUrl || `${owner}/${repoName}`}`)
    console.log(`初始提交：${result.commit}`)
    console.log(`标签：${result.labels.join('、')}`)
    console.log(`本地目录：${result.workDir}`)
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}

await main()
