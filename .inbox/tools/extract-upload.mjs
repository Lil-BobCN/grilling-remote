// 用后端导入流程同一个脚本解开回传 zip，输出到 --out。
// 用法：node .inbox/tools/extract-upload.mjs <package.zip> <outDir>
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const [zipPath, outDir] = process.argv.slice(2)
if (!zipPath || !outDir) {
  console.error('用法：node .inbox/tools/extract-upload.mjs <package.zip> <outDir>')
  process.exit(2)
}

const script = resolve('backend/py/checkzip.py')
const stdout = execFileSync('python3', ['-I', script, 'inspect', resolve(zipPath), resolve(outDir)], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
})
process.stdout.write(stdout)
