#!/usr/bin/env node
/**
 * 重置一个作业的重试状态，让调度器下一轮重新跑。给控制台「失败可重试」用。
 *
 *   node factory/bin/job-reset.mjs --owner <o> --repo <r> --parent <父工单号> --action to-spec
 */
import { pathToFileURL } from 'node:url'
import { createJobStore, defaultJobsPath } from '../lib/job.mjs'

function option(argv, name) {
  const index = argv.indexOf(name)
  if (index === -1) return ''
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`缺 ${name} 的值`)
  return value
}

export async function run(argv = process.argv.slice(2), { jobs, out = console.log } = {}) {
  const owner = option(argv, '--owner')
  const repo = option(argv, '--repo')
  const parent = Number(option(argv, '--parent'))
  const action = option(argv, '--action')
  if (!owner || !repo || !Number.isInteger(parent) || !action) {
    throw new Error('用法：job-reset.mjs --owner <o> --repo <r> --parent <号> --action <动作>')
  }
  const store = jobs || createJobStore({ filePath: process.env.AFK_JOBS_FILE || defaultJobsPath() })
  if (!jobs) await store.load()
  await store.recordSuccess({ owner, repo, parent, action, now: new Date() })
  out(JSON.stringify({ ok: true, owner, repo, parent, action }))
  return { ok: true }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
