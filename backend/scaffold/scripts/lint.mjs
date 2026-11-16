/**
 * 无依赖检查。两件事：
 * 1. src 下不准出现「临时」「先这样」「TODO」三类注释词。
 * 2. 功能目录之间只能从 index.mjs 进，不能直接引用别的功能的内部文件。
 */
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = join(root, 'src')
const BANNED = ['临时', '先这样', 'TODO']
const FEATURES = '/src/features/'

async function walk(dir) {
  const rows = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) rows.push(...(await walk(full)))
    else if (entry.isFile() && entry.name.endsWith('.mjs')) rows.push(full)
  }
  return rows
}

const problems = []
const files = await walk(srcDir)

for (const file of files) {
  const name = relative(root, file)
  const lines = (await readFile(file, 'utf8')).split('\n')
  lines.forEach((line, index) => {
    for (const word of BANNED) {
      if (line.includes(word)) problems.push(`${name}:${index + 1} 出现禁用词「${word}」`)
    }
    for (const match of line.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const spec = match[1]
      if (spec.startsWith('node:')) continue
      const target = resolve(dirname(file), spec).replaceAll('\\', '/')
      const at = target.indexOf(FEATURES)
      if (at === -1) continue
      const after = target.slice(at + FEATURES.length)
      const feature = after.split('/')[0]
      if (after !== `${feature}/index.mjs`) {
        problems.push(`${name}:${index + 1} 不能直接引用功能内部文件：${spec}`)
      }
    }
  })
}

if (problems.length) {
  console.error(problems.join('\n'))
  process.exit(1)
}

console.log(`lint：${files.length} 个文件通过`)
