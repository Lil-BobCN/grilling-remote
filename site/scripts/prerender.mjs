import { existsSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = path.resolve(import.meta.dirname, '..')
const distDir = path.join(root, 'dist')
const ssrDir = path.join(root, '.ssr')

const pages = [
  ['index.html', 'home'],
  ['download.html', 'download'],
  ['skills.html', 'skills'],
  ['tutorial.html', 'tutorial'],
]

const entry = ['entry-server.js', 'entry-server.mjs']
  .map((name) => path.join(ssrDir, name))
  .find((file) => existsSync(file))

if (!entry) {
  throw new Error(`找不到 SSR 入口，检查 ${ssrDir}`)
}

const { renderPage } = await import(pathToFileURL(entry).href)

for (const [file, page] of pages) {
  const filePath = path.join(distDir, file)
  const html = await readFile(filePath, 'utf8')
  if (!html.includes('<!--app-html-->')) {
    throw new Error(`构建产物缺少预渲染标记：${file}`)
  }
  const markup = renderPage(page)
  await writeFile(filePath, html.replace('<!--app-html-->', () => markup))
  console.log(`预渲染 ${page} → dist/${file}`)
}

await rm(ssrDir, { recursive: true, force: true })
