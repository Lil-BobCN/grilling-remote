import { run, claudeCode } from '@ai-hero/sandcastle'
import { docker } from '@ai-hero/sandcastle/sandboxes/docker'

// 版本固定：@ai-hero/sandcastle@0.12.0。升级时一起改 Dockerfile、这里和 prompt.md。
// 模型不写死：从 .sandcastle/.env 的 SANDCASTLE_MODEL 取，没写就用 ANTHROPIC_MODEL。
const model = process.env.SANDCASTLE_MODEL || process.env.ANTHROPIC_MODEL
if (!model) throw new Error('先在 .sandcastle/.env 里写 SANDCASTLE_MODEL 或 ANTHROPIC_MODEL')

await run({
  agent: claudeCode(model),
  sandbox: docker({ imageName: process.env.SANDCASTLE_IMAGE }),
  promptFile: '.sandcastle/prompt.md',
})
