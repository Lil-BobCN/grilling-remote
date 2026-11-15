import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

async function text(path) {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

async function isDir(path) {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function isFile(path) {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

function head(textValue, lines = 12) {
  return (textValue || '').split('\n').slice(0, lines).join('\n')
}

function sectionBody(textValue, heading) {
  if (!textValue) return null
  const marker = new RegExp(`^##\\s*${heading}\\s*$`, 'm')
  const match = marker.exec(textValue)
  if (!match) return null
  const rest = textValue.slice(match.index + match[0].length)
  const next = /^##\s/m.exec(rest)
  return (next ? rest.slice(0, next.index) : rest).trim()
}

export async function validateRequirement(dir, { finished }) {
  const missing = []
  const checks = { finished, kind: '', draftDone: false, acceptance: false, ticketsResolved: false, nextEmpty: false }

  if (!finished) {
    missing.push('上传页上的「已问完」还没勾。确认问完了，勾上再传一次。')
  }

  const draft = await text(join(dir, '需求草稿.md'))
  const map = await text(join(dir, 'map.md'))
  const acceptance = await isFile(join(dir, '验收场景.md'))
  checks.acceptance = acceptance
  if (!acceptance) {
    missing.push('缺验收场景。让 agent 按已经定下的内容起草验收场景，你确认后它会写进 验收场景.md。')
  }

  if (draft !== null) {
    checks.kind = 'small'
    const done = /^\s*Status:\s*已问完\s*$/m.test(head(draft))
    checks.draftDone = done
    if (!done) {
      missing.push('需求草稿还没写完。和 agent 说「继续」，把剩下的问题问完，它会改成「已问完」。')
    }
    return { passed: missing.length === 0, finished, missing, checks }
  }

  if (map === null) {
    checks.kind = 'unknown'
    missing.push('这个需求里找不到 需求草稿.md 或 map.md。确认传的是做完需求的那个文件夹。')
    return { passed: false, finished, missing, checks }
  }

  checks.kind = 'map'

  const issuesDir = join(dir, 'issues')
  const resolved = []
  if (await isDir(issuesDir)) {
    const entries = await readdir(issuesDir)
    const files = entries.filter((name) => name.endsWith('.md')).sort()
    for (const name of files) {
      const body = await text(join(issuesDir, name))
      resolved.push(/^\s*Status:\s*resolved\s*$/m.test(head(body)))
    }
    if (files.length === 0) {
      checks.ticketsResolved = false
      missing.push('地图里还没有拆出来的票。让 agent 先把要问的事写成票，做完再上传。')
    } else if (resolved.every(Boolean)) {
      checks.ticketsResolved = true
    } else {
      checks.ticketsResolved = false
      const names = files.filter((_, index) => !resolved[index])
      missing.push(`还有票没做完：${names.join('、')}。和 agent 说「继续」，把剩下的票做完再上传。`)
    }
  } else {
    checks.ticketsResolved = false
    missing.push('地图里没有 issues 文件夹。让 agent 先把要问的事写成票，做完再上传。')
  }

  const next = sectionBody(map, '接下来')
  if (next === null) {
    checks.nextEmpty = false
    missing.push('地图里没有「接下来」这一节。让 agent 按模板补齐地图，再上传。')
  } else if (next === '') {
    checks.nextEmpty = true
  } else {
    checks.nextEmpty = false
    missing.push('地图的「接下来」还有没做完的事。和 agent 说「继续」，做完它会清空这一节。')
  }

  return { passed: missing.length === 0, finished, missing, checks }
}
