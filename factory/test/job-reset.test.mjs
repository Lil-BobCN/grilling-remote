import assert from 'node:assert/strict'
import test from 'node:test'
import { run as runJobReset } from '../bin/job-reset.mjs'

test('job-reset 清掉指定作业的 attempt 和 stop', async () => {
  const calls = []
  const jobs = {
    async recordSuccess(args) {
      calls.push(args)
      return { attempt: 0, stop: '' }
    },
  }
  await runJobReset(
    ['--owner', 'acme', '--repo', 'demo', '--parent', '42', '--action', 'to-spec'],
    { jobs, out: () => {} },
  )
  assert.equal(calls.length, 1)
  assert.equal(calls[0].owner, 'acme')
  assert.equal(calls[0].repo, 'demo')
  assert.equal(calls[0].parent, 42)
  assert.equal(calls[0].action, 'to-spec')
  assert.ok(calls[0].now instanceof Date)
})
