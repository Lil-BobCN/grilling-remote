# Sandcastle docker 整链实测

> 验证对象：`@ai-hero/sandcastle@0.12.0`（工厂文档钉的版本）
> 对应 Issue：#216（中台 I-0031）
> 测试日期：2026-11-15

结论一句话：能跑通。worktree、容器内 agent、技能点名、提交回收都有可复现记录；带空格和中文的路径不坏。

## 结论

| 环节 | 结果 | 证据 |
| --- | --- | --- |
| 镜像构建 | 通 | `sandcastle docker build-image` 产出 `sandcastle:probe`，2.16 GB |
| worktree | 通，但要显式指定 | 默认 `docker()` 用 `head` 策略，直接挂仓库根目录，不建 worktree；传 `branchStrategy: { type: "branch", branch: "..." }` 才建 |
| 容器挂载 | 通 | 容器里 `/home/agent/workspace` 指向宿主的 `.sandcastle/worktrees/issue-T-3` |
| 容器内 agent | 通 | Claude Code 2.1.325，能连上宿主中转 |
| `/tdd`、`/code-review`、`/pr` | 通 | 运行日志有 red→green、双轴评审、四栏 PR 正文 |
| pstack 七项点名 | 通 | 六个斜杠技能和 `autopilot-full` 剧本都能在容器里读到 |
| 提交回收 | 通 | `run()` 返回 commit sha，分支保留，宿主 main 不动 |
| 空格和中文路径 | 通 | 挂载源是 `/Users/Admin/sc-probe/grilling 远程/样本 仓/.sandcastle/worktrees/issue-T-3` |

## 环境

| 项 | 实测值 |
| --- | --- |
| 系统 | Darwin 25.5.0 arm64 |
| Node / npm | v26.0.0 / 11.12.1 |
| Docker 客户端 | 29.5.2，context `colima` |
| Docker 服务端 | 29.2.1，colima 在跑 |
| 镜像 | `sandcastle:probe`，2.16 GB，基础镜像 `node:22-bookworm` |
| 容器内 Claude Code | 2.1.325 |
| 容器用户 | `agent`，UID 502 / GID 20，和宿主对齐 |
| 容器里的 agent 模型 | `ccs-claude-deepseek--deepseek-v4-flash[1M]` |

宿主的中转在 `http://127.0.0.1:15721`。容器里 `127.0.0.1` 指向容器自己，必须换成 `http://host.docker.internal:15721`。colima 能解析这个名字，不用加 `--add-host`。

## 复现步骤

1. 在一个有至少一个 commit 的 git 仓库里装包：

   ```bash
   npm install --save-dev @ai-hero/sandcastle@0.12.0 tsx
   npx @ai-hero/sandcastle init \
     --sandbox docker --template blank --agent claude-code \
     --issue-tracker custom --build-image false --install-template-deps false \
     --image-name sandcastle:probe
   ```

   生成的 `.sandcastle/` 五件套可直接用。`--issue-tracker custom` 的脚手架故意是坏的（`init` 输出里明说 run 会 hard-fail），本实测不用它的 issue tracker 层，自己写 `run()` 调用。

2. 写 `.sandcastle/.env`。Sandcastle 只转发这个文件里出现过的键，宿主环境变量不会自动继承：

   ```bash
   ANTHROPIC_AUTH_TOKEN=...
   ANTHROPIC_BASE_URL=http://host.docker.internal:15721
   ANTHROPIC_DEFAULT_HAIKU_MODEL=...
   ANTHROPIC_DEFAULT_SONNET_MODEL=...
   ANTHROPIC_DEFAULT_OPUS_MODEL=...
   GIT_AUTHOR_NAME=Sandcastle Probe
   GIT_AUTHOR_EMAIL=probe@example.com
   GIT_COMMITTER_NAME=Sandcastle Probe
   GIT_COMMITTER_EMAIL=probe@example.com
   ```

   最后四个键是给容器里的 `git commit` 用的。镜像里没配全局 git 身份，这次靠这四个键提交；不配时会不会失败，没单独测。

3. 构建镜像：

   ```bash
   npx @ai-hero/sandcastle docker build-image --image-name sandcastle:probe
   ```

   约 4 分钟（含拉 `node:22-bookworm`）。产物 2.16 GB，包含 `git`、`curl`、`jq`、Claude Code CLI。

4. 跑一张样例票。最小调用：

   ```ts
   import { run, claudeCode } from "@ai-hero/sandcastle";
   import { docker } from "@ai-hero/sandcastle/sandboxes/docker";

   const result = await run({
     agent: claudeCode("ccs-claude-deepseek--deepseek-v4-flash[1M]"),
     sandbox: docker({ imageName: "sandcastle:probe" }),
     promptFile: ".sandcastle/prompt-branch.md",
     branchStrategy: { type: "branch", branch: "issue-T-3" },
   });
   ```

   prompt 的第一行写 `/tdd` 加空行，后面接票的内容。Claude Code 会把第一行当斜杠命令展开。

   跑完 `result.commits` 里有 commit sha，宿主仓库的分支上能看到提交，main 不动。

## 实测记录

### 1. 默认策略：不建 worktree

`docker()` 不传 `branchStrategy` 时用 `head` 策略。容器直接挂仓库根目录：

```text
Source: /Users/Admin/sc-probe/plain
Destination: /home/agent/workspace
```

agent 在仓库里原地提交，`run()` 返回 `commits: [{ sha: "fb2dbc6..." }]`，宿主 main 上多一个提交。这一轮验证了「镜像能起、agent 能跑、提交能收」，但没有 worktree。

### 2. branch 策略：worktree 挂载

传 `branchStrategy: { type: "branch", branch: "issue-T-3" }` 后：

```text
$ git worktree list
/Users/Admin/sc-probe/plain/.sandcastle/worktrees/issue-T-3   [issue-T-3]

$ docker inspect <容器> --format '{{json .Mounts}}'
[{"Source":"/Users/Admin/sc-probe/plain/.sandcastle/worktrees/issue-T-3",
  "Destination":"/home/agent/workspace", ...}]
```

agent 在 worktree 里跑测试、提交。`run()` 返回：

```json
{ "commits": [{ "sha": "9080bf0614a98e3616a410cdd420812928a760c5" }], "branch": "issue-T-3" }
```

宿主 main 停在 `511d4f0`，新提交在 `issue-T-3` 分支上。跑完 worktree 被清掉，分支保留。

日志里能看到完整的执行链：

```text
Setting up sandbox done (0.2s)
Agent started
Bash(npm test ...)                    ← red，缺 subtract 导出
Bash(npm test ...)                    ← green，3/3 通过
Agent(Standards review of T-3 diff)   ← /code-review 的两个子 agent
Agent(Spec review of T-3 diff)
Bash(git commit -m "feat: T-3 subtract")
Agent stopped
Collecting commits done (0.0s)
```

### 3. 带空格和中文路径

同样的步骤在 `/Users/Admin/sc-probe/grilling 远程/样本 仓` 里重跑一遍：

```text
Source: /Users/Admin/sc-probe/grilling 远程/样本 仓/.sandcastle/worktrees/issue-T-3
Destination: /home/agent/workspace
```

结果：`commits: [{ sha: "e2a513ebefef1c5a9d24bcbc229368f099d93d90" }]`，分支 `issue-T-3`，宿主 main 不动。

为什么不会坏：Sandcastle 不拼 shell 字符串。它调用 `execFile("docker", ["run", "-d", ..., "-v", hostPath + ":" + sandboxPath, ...])`，参数以数组传给进程，空格和中文都不需要引号。源码在 `node_modules/@ai-hero/sandcastle/dist/chunk-CP3TYXZA.js` 第 60 到 100 行。

`-v` 的格式是 `宿主路径:容器路径:标签`，路径里带冒号会有歧义；本仓库路径没有冒号，这一条没实测。

### 4. 技能点名

在同一个镜像里跑 `skills-probe.sh`，逐个从 stdin 发 `/技能名`：

| 技能 | 结果 | 读到的路径 |
| --- | --- | --- |
| `tdd` | 通 | `.claude/skills/tdd/SKILL.md` |
| `code-review` | 通 | `.claude/skills/code-review/SKILL.md` |
| `pr` | 通 | `.claude/skills/pr/SKILL.md` |
| `swarm` | 通 | `.claude/skills/swarm/SKILL.md` |
| `interrogate` | 通 | `.claude/skills/interrogate/SKILL.md` |
| `blast-radius` | 通 | `.claude/skills/blast-radius/SKILL.md` |
| `create-verification-skill` | 通 | `.claude/skills/create-verification-skill/SKILL.md` |
| `correct` | 通 | `.claude/skills/correct/SKILL.md` |
| `no-comments` | 通 | `.claude/skills/no-comments/SKILL.md` |
| `autopilot-full`（剧本，不是斜杠技能） | 通 | `factory-skills/pstack/skills/poteto-mode/playbooks/autopilot-full.md` |

`swarm`、`interrogate`、`blast-radius`、`create-verification-skill`、`correct`、`no-comments` 都带 `disable-model-invocation: true`。点名调用仍然有效，因为 prompt 第一行的 `/技能名` 被 Claude Code 当成用户调用展开，不走模型自己选技能那条路。

技能文件必须提交进仓库。branch 策略的 worktree 只包含已提交的文件，放在宿主的全局 `~/.claude/skills` 里进不去。

## 失败点和限制

1. **默认策略没有 worktree。** 工厂要「一票一个 worktree」，就必须显式传 `branchStrategy`。不传时 agent 在原地改仓库，和宿主其他操作会互相踩。
2. **凭证要显式写进 `.sandcastle/.env`。** 宿主已有的环境变量不会自动进容器（`resolveEnv` 只遍历 `.env` 里出现过的键）。缺凭证时容器里的 agent 报 `Not logged in`，这是上一份验证稿的记录，本票未重测。
3. **中转地址要写 `host.docker.internal`。** 写 `127.0.0.1` 会连到容器自己。colima 能解析 `host.docker.internal`，不用改 Docker 配置。
4. **容器里没配全局 git 身份。** 这次用 `GIT_AUTHOR_*` / `GIT_COMMITTER_*` 补上；不补时是否失败，没单独测。
5. **`init --issue-tracker custom` 的脚手架是故意坏的。** 不走它的 issue tracker 层时，自己写 `run()` 调用，别在这个脚手架上改。
6. **跑 head 策略时宿主不能并发改仓库。** 实测中宿主在 agent 跑的时候提交了一次，把 agent 的改动混进了宿主的提交，agent 只能用 reflog 拆回去。用 branch 策略可以避开这个问题。
7. **`commit` 为空不报错。** 样例票已经做过时，`run()` 返回 `commits: []`，退出码仍是 0。调度器要按「票有没有产生新提交」判断，不能只看命令成功。
8. **模型额度是这台机器的限制，不是 Sandcastle 的。** 中转里 `ccs-claude-my-claude--*` 三个模型余额为负，只有 `ccs-claude-deepseek--deepseek-v4-flash[1M]` 能用。本实测全部用它跑完。
9. **镜像占 2.16 GB。** 每台跑工厂的机器都要留这份磁盘。

## 和票面 Success condition 的对应

| 要求 | 记录位置 |
| --- | --- |
| 一条命令跑完一张样例票并产出提交 | 上面第 4 步的 `run()` 调用；`result.commits` 有 sha |
| worktree | 第 2 节，`git worktree list` 和 `docker inspect` |
| 挂载 | 第 2、3 节，`Source → Destination` |
| 容器 | 第 2 节日志，`Setting up sandbox done` |
| 技能调用 | 第 4 节表格 |
| 提交回收 | 第 2、3 节，分支上的 `feat:` 提交 |
| 空格和中文路径 | 第 3 节 |
| 失败点 | 上一节 |
