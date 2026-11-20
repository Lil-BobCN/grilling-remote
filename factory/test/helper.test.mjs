import assert from 'node:assert/strict'
import test from 'node:test'
import { helperCommand } from '../lib/helper.mjs'

test('AFK_HELPER 只写 ssh 时 helperCommand 报错，不会拼出 ssh preview-sweep', () => {
  assert.throws(() => helperCommand({ AFK_HELPER: 'ssh' }), /preview-sweep/)
})

test('helperCommand 认 AFK_HELPER、AFK_SERVER 和本机 afk-product 三种来源', () => {
  assert.deepEqual(helperCommand({ AFK_HELPER: '/opt/helper --flag' }), ['/opt/helper', '--flag'])
  assert.deepEqual(helperCommand({ AFK_SERVER: 'dev@host', AFK_SSH_KEY: '/tmp/key' }), [
    'ssh',
    '-i',
    '/tmp/key',
    'dev@host',
    'sudo',
    '-n',
    '/usr/local/sbin/afk-product',
  ])
  assert.deepEqual(helperCommand({}), ['afk-product'])
})

test('/usr/bin/ssh 这种绝对路径也按传输命令处理', () => {
  assert.throws(() => helperCommand({ AFK_HELPER: '/usr/bin/ssh' }), /preview-sweep/)
})
