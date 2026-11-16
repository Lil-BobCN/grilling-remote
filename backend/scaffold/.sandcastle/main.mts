import { run, claudeCode } from '@ai-hero/sandcastle'
import { docker } from '@ai-hero/sandcastle/sandboxes/docker'

// 版本固定：@ai-hero/sandcastle@0.12.0。升级时一起改 Dockerfile、这里和 prompt.md。
await run({
  agent: claudeCode('claude-sonnet-5-5'),
  sandbox: docker(),
  promptFile: '.sandcastle/prompt.md',
})
