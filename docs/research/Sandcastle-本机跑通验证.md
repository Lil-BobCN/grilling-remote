# Sandcastle 本机跑通验证

> 验证对象：`@ai-hero/sandcastle@0.12.0`（github.com/mattpocock/sandcastle）
> 对应 Issue：#8「Sandcastle 接线：在这台 Mac 上真能跑通吗」
> 验证方式：在仓库外的临时目录里实际安装、实际执行，记录原始输出。未修改本仓库。

## 结论（能/不能/卡在哪）

**能跑，但要分两条路说清楚。**

| 路径 | 结果 | 卡点 |
| --- | --- | --- |
| `noSandbox()` 直接跑在本机 | ✅ **跑通** | 无。`run()` 真实调用 Claude Code，返回 `SANDCASTLE_OK` |
| `docker()` 走容器 | ⚠️ **半通**：镜像能构建、容器能起、容器内 claude 能正常出结果，但默认配置下跑不完一轮 | 两个环境约束，都不是 Sandcastle 的 bug：① colima 只把 `/Users/Admin` 共享进 VM，仓库放 `/tmp` 时容器里看到的是空目录；② 容器里没有凭证，报 `Not logged in` |

关键补充：`noSandbox()` 之所以能跑通，用的是这台机器**已经配好**的 Claude Code 凭证——不是 Anthropic 官方订阅，而是 `~/.claude/settings.json` 里的 `ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_BASE_URL`（指向 `api.deepseek.com` 的 Anthropic 兼容中转）。也就是说：**agent 这一环是通的，缺的只是「把凭证送进容器」和「仓库放在 colima 能挂到的路径」这两件事。**

## 环境检查

| 项 | 实测值 |
| --- | --- |
| 系统 | Darwin 25.5.0 arm64（MacBook-Pro.local） |
| Node | `v26.0.0` |
| npm | `11.12.1` |
| pnpm | `9.15.4`（本次用 npm 装，未用 pnpm） |
| Docker 客户端 | `29.5.2`（`/opt/homebrew/bin/docker`） |
| Docker Server | `29.2.1`，context=`colima`，Storage Driver `overlayfs` |
| Docker 守护进程 | **在跑**，`docker ps` 返回 13 个 running 容器 |
| colima | 运行中，`arch: aarch64`，`mountType: virtiofs`，socket `unix:///Users/Admin/.colima/default/docker.sock` |
| colima 共享目录 | **只有 `/Users/Admin`**（VM 内 `lima-xxx on /Users/Admin type virtiofs`） |
| gh | `2.95.0` |
| git | `2.50.1` |
| 本机 claude CLI | `/opt/homebrew/bin/claude`，`2.1.296` |
| 仓库 | `mattpocock/sandcastle`，8756 star，默认分支 `main` |

## 实际执行的命令与结果

所有操作都在 `TD=/tmp/scverify.ZYcpU8`（`mktemp -d` 建的临时目录）里做，验证结束后已删除。

### 1. 拉 README、确认包名与 API

```bash
gh api repos/mattpocock/sandcastle/readme --jq .content | base64 -d
```

关键事实（原文）：

- 安装：`npm install --save-dev @ai-hero/sandcastle`
- init：`npx @ai-hero/sandcastle init`
- 内置 provider：Docker / Podman / Vercel / `noSandbox()`（另有 `./sandboxes/daytona` 出现在包的 exports 里）
- 最小用法：

```typescript
import { run, claudeCode } from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";

await run({
  agent: claudeCode("claude-opus-4-8"),
  sandbox: docker(),
  promptFile: ".sandcastle/prompt.md",
});
```

- 凭证：`CLAUDE_CODE_OAUTH_TOKEN`（宿主跑 `claude setup-token`）或 `ANTHROPIC_API_KEY`，放 `.sandcastle/.env`

### 2. 安装

```bash
npm install @ai-hero/sandcastle --cache "$TD/.npm-cache"
# added 7 packages in 2s
```

```bash
node -e "…package.json…"
# version: 0.12.0
# type: module
# bin: { sandcastle: dist/main.js }
# exports: ., ./sandboxes/{docker,vercel,podman,daytona,no-sandbox}
# 运行时依赖只有 @clack/prompts（其余打包进 dist）
```

> 注：直接 `npm install` 会撞 `npm error code EPERM … /Users/Admin/.npm/_cacache`。这是本次验证 shell 的文件沙箱不允许写 `~/.npm`，不是 npm 缓存损坏（`find ~/.npm ! -user Admin` 结果为 0）。用 `--cache` 指到临时目录即可。

### 3. 非交互 init（跳过了交互式提问）

```bash
npx --no-install @ai-hero/sandcastle init \
  --sandbox docker --template blank --agent claude-code \
  --issue-tracker custom --build-image false --install-template-deps false
```

输出：

```
◇  Scaffolding .sandcastle/ config directory...
◆  Init complete! Your custom issue tracker isn't configured yet — see the steps below before building.
│  1. Your custom issue tracker isn't wired up yet — runs hard-fail until you configure it.
```

生成 `.sandcastle/{Dockerfile,main.ts,prompt.md,.env.example,.gitignore,SETUP_ISSUE_TRACKER.md}`。

init 的每个交互问题都有对应 `--flag`，所以**不需要交互式跑**。注意：`--issue-tracker custom` 造出来的脚手架是「故意跑不通」状态，真用要选 `github-issues`。

### 4. 跑 noSandbox —— 三次才通

**第 1 次失败**（仓库还没有提交）：

```
>>> start mini noSandbox run
WorktreeError: fatal: ambiguous argument 'HEAD': unknown revision or path not in the working tree.
```

**第 2 次失败**（Sandcastle 要写宿主全局 git 配置，被文件沙箱拦）：

```
[Agent] Started on branch main
ExecError: Command failed (exit 255): git config --global --add safe.directory "/private/tmp/scverify.ZYcpU8"
error: could not lock config file /Users/Admin/.gitconfig: Operation not permitted
```

**第 3 次成功**（用 `GIT_CONFIG_GLOBAL` 把全局配置指到临时文件）：

```bash
export GIT_CONFIG_GLOBAL="$TD/.gitconfig"
./node_modules/.bin/tsx mini-nosandbox.mts
```

```json
>>> result: {
  "iterations": [{ "sessionId": "10e30464-6b1b-4a42-a044-67496b3bc3b0" }],
  "stdout": "SANDCASTLE_OK",
  "commits": [],
  "branch": "main",
  "logFilePath": "/private/tmp/scverify.ZYcpU8/.sandcastle/logs/main.log"
}
```

运行日志（`.sandcastle/logs/main.log`）：

```
Sandcastle Run
  Agent: claude-code
  Sandbox: no-sandbox
  Max iterations: 1
  Branch: main
Iteration 1/1
Setting up sandbox done (0.0s)
Agent started
SANDCASTLE_OK
Agent stopped
Collecting commits done (0.0s)
Reached max iterations (1).
```

结论：**本机 agent 链路是通的**，返回内容确实是模型给的。

### 5. Docker 镜像构建 —— 三次才通

**第 1 次失败**：buildx 要写 `~/.docker/buildx`，被拦。

```
■  Docker operation failed: docker build failed: ERROR: failed to build: failed to update builder last activity time:
│  open /Users/Admin/.docker/buildx/activity/.tmp-colima3112674520: operation not permitted
```

**第 2 次失败**：把 `DOCKER_CONFIG` 指到临时目录后，context 丢了。

```
failed to connect to the docker API at unix:///var/run/docker.sock; check if the path is correct and if the daemon is running
```

**第 3 次成功**：临时 `DOCKER_CONFIG` + 显式 `DOCKER_HOST` + 把 buildx 插件软链进临时的 `cli-plugins`。

```bash
export DOCKER_CONFIG="$TD/.dockerconfig"
export DOCKER_HOST="unix:///Users/Admin/.colima/default/docker.sock"
ln -s /opt/homebrew/lib/docker/cli-plugins/docker-buildx "$TD/.dockerconfig/cli-plugins/"
npx --no-install @ai-hero/sandcastle docker build-image --image-name sandcastle:verify
# ◆  Build complete!
```

实测镜像：`sandcastle:verify`，**2.1GB**，created `22:16:41`（构建约 2 分钟，含拉 `node:22-bookworm`）。

容器内自检：

```bash
docker run --rm --entrypoint sh sandcastle:verify -lc 'which claude; claude --version; git --version; id'
# /home/agent/.local/bin/claude
# 2.1.316 (Claude Code)
# git version 2.39.5
# uid=502(agent) gid=20(dialout) groups=20(dialout)
```

镜像是对的：agent 用户 UID 已对齐宿主 502。

### 6. 跑 docker() —— 卡在挂载

```bash
./node_modules/.bin/tsx mini-docker.mts   # sandbox: docker({ imageName: "sandcastle:verify" })
```

```
[Agent] Started on branch main
ExecError: Command failed (exit 128): git rev-parse --abbrev-ref HEAD
fatal: not a git repository (or any parent up to mount point /home/agent)
Stopping at filesystem boundary (GIT_DISCOVERY_ACROSS_FILESYSTEM not set).
```

定位——colima 的 VM 里根本看不到 `/tmp`：

```bash
colima ssh -- mount | grep virtiofs
# lima-bb13f63c on /Users/Admin type virtiofs (rw,relatime)

docker run --rm -v /tmp/scverify.ZYcpU8:/x --entrypoint sh sandcastle:verify -lc 'ls -la /x'
# total 8        ← 空目录
# fatal: not a git repository
```

换成 `$HOME` 下的路径就正常：

```bash
docker run --rm -v "$HOME/Desktop/grilling 远程:/y" --entrypoint sh sandcastle:verify -lc 'ls /y; git -C /y rev-parse --abbrev-ref HEAD'
# AGENTS.md
# docs
# main
```

**所以：仓库放在 `/tmp` 一定跑不通；放在 `/Users/Admin` 下才能挂进容器。**

### 7. 容器内凭证 —— 卡点就在这

容器里什么都不给，直接跑 claude：

```
Not logged in · Please run /login
```

网络是通的（不是墙的问题）：

```bash
docker run --rm --entrypoint sh sandcastle:verify -lc 'curl -s -o /dev/null -w "%{http_code}\n" --max-time 15 https://api.anthropic.com/v1/models'
# 401（可达，只是没鉴权）
```

把本机现有的 relay 凭证注入容器再跑：

```bash
docker run --rm -e ANTHROPIC_AUTH_TOKEN -e ANTHROPIC_BASE_URL \
  -v "$HOME/Desktop/grilling 远程:/y:ro" --entrypoint sh sandcastle:verify \
  -lc 'cd /y && claude -p "Reply with exactly CONTAINER_OK" --model claude-haiku-4-5-20251001'
# CONTAINER_OK
```

**结论：容器这一层完全没问题，只缺凭证。**

### 8. 凭证是怎么被读进去的（源码确认）

`dist/index.js` 的 `resolveEnv`：

```js
const sandcastleEnv = yield* parseEnvFile(join(repoDir, ".sandcastle", ".env"));
for (const key of Object.keys(sandcastleEnv)) {
  const value = sandcastleEnv[key] || process.env[key];
  ...
}
```

**只遍历 `.sandcastle/.env` 里出现过的 key**，再回退到 `process.env`。所以宿主的 `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` 不会自动带进沙箱——必须在 `.sandcastle/.env` 里显式写出来。

### 9. Node 26 / ESM / tsx 兼容性

- Node 26 原生 ESM 直接 `import('@ai-hero/sandcastle')` 成功，导出：`run, interactive, createSandbox, createWorktree, claudeCode, codex, copilot, cursor, opencode, pi, Output, …`
- `tsx v4.23.15` + Node v26.0.0 跑 `.mts` 正常，无警告
- 包本身 `"type": "module"`，与 Node 26 无冲突
- 唯一坑：**tsx 不在依赖里**，`npx tsx` 会现拉；本机 `NODE_ENV=production`，直接 `npm install -D tsx` 会被静默跳过（日志说 `up to date` 但 `node_modules/tsx` 不存在），要加 `--include=dev` 才装上

## 需要运营者提供什么

按优先级：

1. **一处能用的凭证**，二选一：
   - `CLAUDE_CODE_OAUTH_TOKEN`（宿主跑 `claude setup-token` 拿，走 Claude 订阅）
   - `ANTHROPIC_API_KEY`（走 Anthropic 计费）

   如果继续沿用这台机器现在的 DeepSeek 中转，则要写两个键：`ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_BASE_URL`。注意 Sandcastle 官方只认前两个名字，后两个能生效是因为 `resolveEnv` 会转发 `.env` 里所有键——但模型名会被中转方改写，`claudeCode("claude-opus-4-8")` 这种官方模型名在中转下不一定存在，得换成中转支持的模型名。

2. **仓库位置**：必须在 `/Users/Admin` 下面（例如 `/Users/Admin/code/...`）。当前工作目录 `/Users/Admin/Desktop/grilling 远程` 在这个范围内，**位置本身没问题**。

3. **一个真实 git 仓库，且至少有一个 commit**——空仓库会在 `git rev-parse HEAD` 直接炸（见第 4 节第 1 次失败）。

4. **不需要**：Docker sudo 权限、Docker Desktop、额外装 Docker。colima 已经在跑，无需动它。

## 风险与下一步

**风险**

- **路径带空格和中文**。`/Users/Admin/Desktop/grilling 远程` 里有空格。我用 `docker run -v` 手测能挂上，但 Sandcastle 自己拼 `docker run` 命令行时是否正确加引号，**本次没验证到**（原因见下）。这是最可能在真实运行时炸的细节，建议先在无空格路径下跑通，再回头试原地跑。
- **本次 docker() 没能完整跑完一轮**。不是 Sandcastle 的问题，是验证环境限制：我的文件沙箱不允许在 `$HOME` 下新建临时仓库（`mkdir ~/Desktop/_scverify_probe` → `Operation not permitted`），而 colima 的共享目录又只覆盖 `$HOME`，两件事卡在一起，导致我无法构造一个「既在 `$HOME` 下、又不污染本仓库」的容器路径测试。已用等价的 `docker run` 手工验证了挂载和鉴权两环，但 `docker() → 建 worktree → 容器内 agent → 回收集提交` 的整链没走完。
- **沙箱环境会拦三处宿主写操作**：`~/.npm`、`~/.gitconfig`、`~/.docker/buildx`。运营者在自己终端跑不会遇到；但如果把 Sandcastle 放进 CI 或自动化 agent 里，同样要处理 `git config --global --add safe.directory` 这一步的写权限。
- **`--issue-tracker custom` 的脚手架是故意坏的**，`init` 输出里明说「runs hard-fail until you configure it」。真要接 GitHub Issues，得选 `github-issues` 并让 `gh` 有该仓库权限。
- **镜像占 2.1GB**。本次验证结束后已把 `sandcastle:verify` 删掉，没在机器上留东西；要复现就重新 `init`（默认会 build）或 `npx @ai-hero/sandcastle docker build-image`。

**下一步（建议顺序）**

1. 先在 `.sandcastle/.env` 里填凭证，用 `noSandbox()` 把「issue → prompt → agent → 提交」这条业务链跑通。这条已经证明可行，风险最低。
2. 再把仓库挪到无空格路径（如 `/Users/Admin/code/grilling-remote`），切 `docker()`，验证 worktree 挂载与回收集提交。
3. 最后回头验证原地路径（带空格）能否直接跑 docker()。
4. 想省 GITHUB label 配置，就先别用 `init --issue-tracker custom`，用 `github-issues` 或干脆手写 `run()` 调用绕开 issue tracker 层。
