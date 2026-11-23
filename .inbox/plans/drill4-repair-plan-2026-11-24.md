# 第四次全链演练遗留修复方案

日期：2026-11-24
状态：已拍板并建票（2026-11-24）。6 个验证子代理已跑完（V25–V33），U1–U5 解除，U4 部分。代码实现待跑 implement-spec。
基线：`Lil-BobCN/drill4-repair-plan` @ `9334e0f`
范围：F7、F6、F11、I-0228 与 I-0236–I-0241、故障注入 4.3/4.4/4.5/4.7、第 5 次全链前置

## 一句话

F7 的根因是超时只让等待方失败，不杀子进程；新一轮又不检查同一票有没有管道在跑。F6 的未知写入口已经查明：一个验证 agent 自己改了主仓的 `.git/info/exclude`。修完这两件，加上 F11 和 I-0240，30 分钟超时才能安全恢复。

---

## 一、三栏

### 已核实事实

| 编号 | 事实 | 依据 |
| --- | --- | --- |
| V1 | 当前分支 `Lil-BobCN/drill4-repair-plan`，HEAD `9334e0f`，工作区干净 | `git status`、`git rev-parse` |
| V2 | 调度器 pid 72705 在跑，launchd 常驻；进程启动时的目录是 `/Users/Admin/Desktop/grilling`，这个目录现在不存在；启动脚本 `~/.afkfactory/bin/run-scheduler.sh` 里 `cd` 的是 `/Users/Admin/Desktop/grilling 远程` | `ps -p 72705`、`lsof -p 72705`、`launchctl print`、脚本全文 |
| V3 | `~/.afkfactory/env` 第 15 行是 `AFK_STEP_TIMEOUT_MS`，值为 `86400000` | `awk` 取键和值 |
| V4 | 步骤超时用 `Promise.race` 实现。超时抛错，但被包住的任务继续跑 | `factory/lib/scheduler.mjs:1390-1422` |
| V5 | 起 agent 的 `defaultExec` 没有 `signal`，也不在超时时杀子进程 | `factory/lib/agent-runner.mjs:61-90`；`factory/lib/sandcastle-runner.mjs:55-80` |
| V6 | 管道那一步超时后，只把错误写进当轮 runs 日志，不写作业表 | `factory/lib/scheduler.mjs:1850-1863` |
| V7 | 管道进入一张票只看四件事：票没关闭、没挂待验收、挂了 `Sandcastle`、最后一条评论以「点火完成」开头 | `factory/lib/pipeline.mjs:262-270` |
| V8 | 同一票的管道复用同一个工作树路径，路径按票分支拼 | `factory/lib/repo-workspace.mjs:136-138` |
| V9 | 释放或中止工作树时，未跟踪文件被移进 `.audit/archive/<时间戳>-<分支>/` | `factory/lib/repo-workspace.mjs:156-200`；调用点 `374-377`、`446-452`；`factory/lib/pipeline.mjs:357-378`、`447-470` |
| V10 | 全仓没有 `git clean` 调用 | `grep -rn "git clean"` 无结果 |
| V11 | 2026-11-22T23:03:32Z，一个验证 agent 在 `ticket-9` 工作树里用 `node -e` 往主仓 `.git/info/exclude` 追加了两行：`.audit/evidence/9/`、`.audit/9.tsv` | 会话记录 `~/.claude/projects/-Users-Admin--afkfactory-repos-demo-tanxin-yuyue-4--sandcastle-worktrees-ticket-9/f43748fa-7683-4a41-86b1-1e68b70742f5.jsonl`，首条提示词是「验证 agent 的作业说明」 |
| V12 | 主仓 `~/.afkfactory/repos/demo-tanxin-yuyue-4/.git/info/exclude` 的 mtime 是 2026-11-23 07:03（本地），内容就是 V11 那两行；另外两个客户仓没有这两行 | `ls -la`、逐个 `cat` |
| V13 | PR #601（`4fe8fa5`）已经在两处改成强制加入：`commitAuditFiles` 用 `git add -f -A -- .audit`；`commitEvidenceFiles` 用 `git add -f` | `factory/lib/pipeline.mjs:236-245`；`factory/lib/evidence.mjs:307-320` |
| V14 | `deploy/products/app.env.example` 是软链，指向 `../../backend/scaffold/.env.example`；`install.sh` 用 `[[ -f $HERE/$file ]]` 预检，断链时报「缺文件」 | `ls -la deploy/products/`；`deploy/products/install.sh:46-54` |
| V15 | 没有 spec 时调度器不拆票；`console.mjs` 的 spec 写回直接抛「手动步骤」；通知模板写「手动跑 to-spec」；`docs/工厂流程.md` 写「调度器不触发 to-spec」 | `factory/lib/scheduler.mjs:433-437`；`factory/lib/console.mjs:259`；`notifier/templates.py:61-62`；`docs/工厂流程.md:496` |
| V16 | I-0236 的版本来自 `backend/package.json`；I-0237 的第二次 `tar -C` 用相对路径；I-0238 读 `status.running ?? status?.result?.running`；I-0241 的 `bulletLines` 只认 `-` 和 `*` | `backend/server.mjs:11`；`deploy/backend/package.sh:66-70`；`factory/lib/console.mjs:191`；`backend/lib/parent-issue.mjs:37-47`、`98-105` |
| V17 | 启动配置只检查 `GITHUB_TOKEN` 是否为空，不校验有效性；运行中 GitHub 401/403 只作为普通错误进 runs 日志 | `factory/lib/config.mjs:485-491`；`factory/lib/github.mjs:11-20`；`factory/lib/scheduler.mjs:1792-1806` |
| V18 | `product-deploy` 健康检查失败时会恢复上一版镜像并重启；Mac 侧 `deployProduct` 整套重试两次，再发「出事 部署失败」，不自动调 `product-rollback` | `deploy/products/afk-product` 的 `cmd_deploy`、`restore_previous_image`；`factory/lib/deploy.mjs:236-310` |
| V19 | 导入失败有终态 `import_failed` / `needs_operator`，有 `operator_alert`，有重试命令 `backend/bin/retry-import.mjs` | `backend/lib/import.mjs:476-490`；`backend/bin/retry-import.mjs:1-24` |
| V20 | 中台关票按候选 PR 逐个核对 `headRefOid`；有不匹配的已合并 PR 时记录标「过期」；单测在 `中台/tests/test_close.py` | `中台/dtlib/close.py:60-130` |
| V21 | 地图 I-0208 共 45 张票，6 句根决定全部有票覆盖；当前 open 的是 I-0228、I-0236–I-0241 | `dt show I-0208`、`dt coverage I-0208` |
| V22 | 演示仓 `Lil-BobCN/demo-tanxin-yuyue-4` 当前 open：父工单 #1（待验收）、地图 #2、spec #7；没有 `Sandcastle` 标签 | `gh issue list` |
| V23 | 第 4 次演练 E30 那一轮：轮开始 22:21，22:51 超时；轮内验证 15 分钟、评审 5 分钟、修复 4 分钟；复验 22:48 起，23:16 前后才有证据提交 | `findings.md` E30 时间线 |
| V24 | `.audit/archive/20261122T225903Z-ticket-9/` 里有 E31 报缺的 `browser-trace.json` 和 5 张 v2 png；`20261122T230304Z-ticket-9/` 里有验证 agent 在 23:03:04 放的 `canary.txt`。这些文件只可能由 `archiveUntracked` 挪进来 | `find .audit/archive -type f`；V10 |
| V25 | `orca status --json` 返回 `result.app.running=true`、`result.app.pid`；没有顶层 `running`，也没有 `result.running`。Orca 版本 1.4.x | 只读运行 `orca status --json`，取键路径 |
| V26 | 本机 `gh` 当前登录 token 返回 200，`X-OAuth-Scopes` 含 `repo`、`workflow`、`read:org`、`gist`。工厂用的 `GITHUB_TOKEN` 是否同一枚还没验证 | `gh api -i user`，只看响应头 |
| V27 | macOS 的 tar 是 bsdtar 3.5.3。默认打包保留软链；加 `-h` 或 `--dereference` 后解包得到普通文件 | /tmp 里建软链，分别打包解包 |
| V28 | `claude -p` 2.1.328 在任务进行中不写 stdout。20 秒任务前 42.3 秒 0 字节，退出前 0.55 秒才输出 3 字节 `OK`。`--tools` 必须在提示词之后；工厂的 runner 已经是这个顺序 | 子代理按秒采样 stdout；`factory/lib/agent-runner.mjs:126-133` |
| V29 | macOS 上 `spawn(..., {detached:true})` 的子进程是进程组组长，`process.kill(-pid, 'SIGTERM'/'SIGKILL')` 能一次带走它和孙进程。普通 spawn 的子进程不是组长，负 pid 报 ESRCH，什么都没杀。父进程先退出后，detached 子进程 ppid 变 1，负 pid 整组杀仍有效 | 子代理在 /tmp 用 parent/child/grandchild 三个进程实测，ps 核对 |
| V30 | `kill(pid, 0)` 对已死进程抛 `ESRCH`（errno -3），对活进程返回 true；pid 会复用。`open(path,'wx')` 只判存在，文件不会因创建者退出而消失。`utimes` 能把 mtime 改成当前时间或更早；重复写同一个值 mtime 不变。mtime 精度是毫秒 | 子代理在 /tmp 实测 |
| V31 | 基线测试全绿：factory 571/571、backend 176/176、中台 `unittest` 102/102，两个 JS 测试也过。`pytest` 没装，中台测试要用 `python3 -m unittest discover -s 中台/tests -q` | 子代理在集成分支逐套跑，退出码 0 |
| V32 | 全量审计 1626 个会话、7 个仓：唯一成功的 `exclude` 写入是 ticket-9 验证 agent 在 2026-11-22T23:03:32Z 用 Bash `node -e` 写的两行。Edit/Write 对 `.git/info/exclude` 被敏感文件保护拦住；其他客户仓和 orca 克隆没有自定义行。写入后 canary 存活 55 秒 | 子代理审计会话 JSONL、逐仓查 `git check-ignore` |
| V33 | 自动 to-spec 试跑：按读取顺序用父工单 #1、点头、地图 #2、决定票、回传件、原型和模板代码写了一份七字段草案，和人工 spec #7 逐节对比。输入够用，草案能直接给拆票 agent；差的是提示词规则 | 子代理在 /tmp 写草案，逐节比对 |

### 合理推测

| 编号 | 推测 | 依据 | 错了会怎样 |
| --- | --- | --- | --- |
| S1 | 验证 agent 写 exclude 的动机是保护证据不被挪走 | 该会话 thinking 原文：「exclude protected the file for 55s. So the cleaner is indeed git clean -fd」 | 动机判断错不影响修法，只影响作业说明怎么写 |
| S2 | 30 分钟的管道上限会误杀正常管道；单个 agent 也可能接近 28 分钟（复验跨度），30 分钟给 agent 的余量太薄 | V23 | 如果 agent 实际更快，30 分钟够用，可以不设 45 分钟上限 |
| S3 | 现在把超时恢复 30 分钟、不修 F7，会重现 E37 的两个修复者 | E13/E30/E36 四次超时，E37 两个 pid 作业说明逐字相同 | 如果新一轮在超时前就结束了，可能只是概率降低 |
| S4 | 第 5 次全链纯跑时间和第 4 次接近（8 小时左右） | 第 4 次 7 张票从首张关到末张关 8 小时 13 分 | 影响排期判断，不影响方案 |

### 假设与验证状态

| 编号 | 原假设 | 验证方法和结果 | 对方案的影响 |
| --- | --- | --- | --- |
| U1（已解除） | `claude -p` 不会持续往 stdout 写进度 | 实测：20 秒任务前 42.3 秒 0 字节，退出前 0.55 秒才出 `OK` | 空闲超时不可行；按硬上限设计，T1 不变 |
| U2（已解除） | 只有 `demo-tanxin-yuyue-4` 这一处 ignore 写入 | 审计 1626 个会话、7 个仓：唯一成功写入是 ticket-9 验证 agent 的 Bash `node -e`；Edit/Write 有敏感文件拦截；其他仓无自定义行 | T3 的检测覆盖所有客户仓的 common dir，重点盯 Bash 写入 |
| U3（已解除） | `detached: true` 加 `process.kill(-pid)` 能带走整棵子进程树 | 实测：detached child 是进程组组长，负 pid 杀整组；普通 spawn 的负 pid 报 ESRCH | 实现必须用 detached 起 agent；T1 已写 |
| U4（部分解除） | 租约在进程重启后能安全接管死进程留下的记录 | 已验证：`kill(pid,0)` 对死进程抛 ESRCH；`wx` 文件不会因进程退出消失；`utimes` 能更新 mtime；pid 会复用 | 接管逻辑仍要在 T2 的单测里验证；mtime 过期是 pid 复用的兜底 |
| U5（已解除） | 自动 to-spec 的质量 | 试跑：输入够，草案可用；提示词缺 5 条规则：验收项对应故事、非应用交付物写责任方、平台默认值要带、路径和代码片段自检、地图与代码冲突写 Further Notes | I-0240 的 `to-spec.md` 已补这些规则和验收 |
| U6 | F11 当时用的打包和上传命令 | 已查 findings 和 zsh 历史：没有传输命令；暂存包只含 `deploy/`；安装脚本只做 `ssh` 加 `sudo install.sh`。传输发生在 agent 会话里，命令没留痕 | 不影响 T4：新打包脚本按自包含设计，不依赖当时的命令 |

---

## 二、报告和现场的出入

1. **F6 的写入口不再是未知。** 最终报告写「`.git/info/exclude` 是谁写的，还没查清」。现场查到是一个验证 agent 在 2026-11-22T23:03:32Z 用 `node -e` 写的，会话记录和文件 mtime 对得上（V11、V12）。
2. **F6 的根因不止「和 F7 同源」。** 至少三件叠加：超时留下孤儿管道；工作树释放时把未提交证据归档走；验证 agent 用 ignore 绕开归档，反而让证据进了 git 的盲区。
3. **PR #601 的范围比报告写的大一点。** 除了 `commitAuditFiles`，`commitEvidenceFiles` 也已经是 `git add -f`（V13）。真正没修的是归档规则和 ignore 写入口。
4. **调度器的代码目录和报告不一致。** 报告只记了 pid 72705。这个进程启动时的目录现在不存在，重启会跑到 `grilling 远程` 下的 main。改完代码重启时，要先确认跑的是哪份代码。
5. **I-0240 票面引用的行号仍然成立。** `scheduler.mjs:433-437`、`console.mjs:259` 和当前代码一致。

---

## 三、F7 超时并发，附 F6

### 事故怎么发生的

1. 每 30 秒一轮。轮内按仓、按父工单串行执行。
2. 跑管道这一步包在 `runJobStep` 里。30 分钟到点，`Promise.race` 让等待方抛超时（V4）。
3. 管道本身和它起的 `claude` 子进程没有收到任何信号，继续跑（V5）。
4. 这一轮把超时写进 runs 日志，30 秒后下一轮开始（V6）。
5. 下一轮重新进同一张票，因为进票条件都还满足（V7）。
6. 两条管道用同一个工作树（V8），各派一个验证者或修复者。E37 的两个修复者 pid 37577、38415，作业说明逐字相同。
7. 并发下每次释放工作树，都会把未提交的证据挪进 `.audit/archive/`（V9）。另一条管道的验证者看到证据反复消失。
8. 验证者用 node 改了主仓 `.git/info/exclude`，把证据藏起来（V11）。之后 `git status` 看不到，普通 `git add` 加不进。门禁判 `evidence_not_ready`。

### 根因

一句话：超时不取消，管道没有独占，工作树释放又会把证据挪走。

分开是三件：

- **取消缺失**：超时只放弃等待，不杀子进程，也不阻止管道继续派 agent。
- **独占缺失**：进票前不检查同一票有没有管道在跑；进程重启后也没有记录可查。
- **证据规则缺失**：释放工作树时把 `.audit` 证据和普通未跟踪文件一起归档；验证 agent 用 ignore 绕开，工厂没有检测。

### 修法

#### 修法 A：超时真的取消

做法：

1. `runJobStep` 里建 `AbortController`。超时先 `abort()`，再抛 `StepTimeoutError`。任务函数收到 `signal`。
2. `createAgentRunner.run` 接收 `signal`，传给 `defaultExec`。
3. `defaultExec` 收到中止时，先 `SIGTERM`，5 秒后 `SIGKILL`。子进程用 `detached: true` 起，杀的时候杀整个进程组（`process.kill(-pid)`）。普通 spawn 的子进程不是进程组组长，负 pid 会报 ESRCH（V29）。
4. `createSandcastleRunner` 的 `exec` 同样处理。中止后按容器名或标签清理容器。
5. 管道在每个 agent 调用前、提交证据前、合并前检查 `signal.aborted`。中止时返回 `{ok:false, reason:'aborted'}`，不写验证或评审的失败行。
6. `runOnce` 捕获管道超时后，写一条 `pipeline` 作业行，reason 记「超时」，按退避重试。现在这条信息只进 runs，作业表和屏幕看不到（V6）。
7. 加一条轮次守卫：上一轮还有没结束的步骤时，不开下一轮。上一轮超时后，先等取消完成，再睡 30 秒。

取舍：

- 杀进程组要单独验证。搞错会把调度器自己带走（U3）。
- 中止时返回 `aborted`，不记失败行，避免把「被取消」写成「验证没过」，污染证据链。
- 容器清理需要知道容器命名规则；现有 `Sandcastle` 标签和 runner 的脚本名可以作为线索。

#### 修法 B：同一票只允许一条管道

做法：

1. 在票工作树准备之前，抢一张票的租约。租约文件放 `$AFK_LOCK_DIR/<owner>__<repo>__ticket-<n>.lock`，内容写 pid 和启动时间。
2. 租约带心跳。管道每 60 秒更新一次文件 mtime，同时更新作业表里 `action=pipeline` 那一行的 `lastBeat`。
3. 抢不到租约时返回 `{skipped:'busy'}`，这一轮不动这张票。日志写一行「票 #N 已有管道在跑」。
4. 进程重启后的接管规则：租约里的 pid 不存活，或 mtime 超过 10 分钟没有心跳，才允许接管。接管时写一条说明。pid 会复用，mtime 过期是兜底；心跳要写当前时间，重复写同一个值 mtime 不变（V30）。
5. 同一进程内再维护一个内存集合，防止同一进程里两轮重叠时重复进票。
6. `routeRepo` 或管道入口在看到 `pipeline` 行处于运行中时，直接跳过这张票。作业行是屏幕上能看到的那个来源（V21、V6）。

取舍：

- 租约文件是跨进程的真相，作业行是给人看的。两处要一起更新，否则屏幕和实际不一致。
- 心跳间隔和过期阈值要留余量。管道本来就可能跑一小时，过期太短会抢走活管道。
- 如果不想引入租约文件，只靠内存集合也能挡住同进程重入，但挡住进程重启后的孤儿。不推荐。

#### 修法 C：F6 归档规则和 ignore 写入口

做法：

1. `release` 和 `abort` 不再归档 `.audit/**`。释放前先把 `.audit` 强制提交到票分支；提交失败就保留工作树，报 `worktree_dirty`。
2. 只归档 `.audit` 以外的未跟踪文件。归档记录写清来源工作树、分支和时间。
3. 管道开始时记下 common dir 的 `info/exclude` 哈希和 mtime。结束时变了，写一条 `evidence_ignored` 日志，把新增行原样记下来。
4. 用 `git status --ignored --porcelain -- .audit` 找被忽略的证据，全部强制加入。PR #601 已经覆盖 `.audit`，这里补的是检测和告知。
5. 验证、评审、修复三份作业说明各加一条：不得修改 `.git/info/exclude` 和 `.gitignore`；证据由工厂提交。发现问题写进结论，不自己藏文件。
6. 不自动回滚 exclude。改 git 元数据风险高，先检测、记录、交给人。

取舍：

- 强制提交 `.audit` 会把验证者的临时文件带进分支。需要先约定：证据目录只放证据，临时文件放 `.tmp-*` 并加进 `.gitignore`（修复者已经这样做过，E39 的 `27dbde4`）。
- 检测 exclude 会误报人工修改。日志级别用 warning，不挡合并。
- 归档规则改窄后，工作树可能更容易保留现场，需要人处理。这是有意的：证据不能丢。

### 影响面

- `factory/lib/scheduler.mjs`、`agent-runner.mjs`、`sandcastle-runner.mjs`、`pipeline.mjs`、`repo-workspace.mjs`、`evidence.mjs`、`job.mjs`、`lock.mjs`。
- `factory/agents/verify.md`、`review.md`、`fixer.md`。
- 测试：`factory/test/scheduler.test.mjs`、`pipeline.test.mjs`、`repo-workspace.test.mjs`、`agent-runner.test.mjs`、`evidence.test.mjs`。
- 不影响客户产品代码，不影响中台数据。

### 测试方式

1. **取消单测**：把 agent 命令换成一个睡很久的脚本，`AFK_STEP_TIMEOUT_MS=2000`。断言：`runOnce` 返回；子进程 pid 不存在；作业行 reason 含「超时」；下一次跑只派一个 agent。
2. **并发单测**：两个 `runOnce` 同时进同一票，第二个返回 `skipped:'busy'`，runner 只被调用一次。
3. **接管单测**：租约文件的 pid 写一个不存在的进程，下一次跑能接管并写说明。
4. **归档单测**：工作树里有未提交的 `.audit` 证据和普通临时文件。释放后，证据在票分支上，临时文件在 `.audit/archive/`，证据目录没被挪走。
5. **ignore 单测**：往 common dir 的 exclude 写入 `.audit/evidence/<票>/`，跑一遍管道，断言证据仍然进分支，日志有 `evidence_ignored`。
6. **真实注入**：在 scratch 客户仓跑一次，把 agent 命令换成会卡住的 wrapper。用 `ps` 和 `docker ps` 核对没有孤儿；父工单有 needs-info；恢复后只有一条管道。

### 验收条件

- 超时后 5 秒内，相关 agent 进程和容器都不在了。
- 超时后下一轮不会为同一票再派第二个管道；日志有 `busy` 或「接管」记录。
- 超时写进作业表 `pipeline` 行，屏幕和 `status` 看得到。
- 被 ignore 的 `.audit` 证据仍能进票分支；`release` 不再移动 `.audit`。
- 现有测试全过；新增上述五类测试。

### 恢复 30 分钟超时和验证

先拍板超时语义（见第十一节第 1 题）。推荐：

- `AFK_STEP_TIMEOUT_MS=1800000`：约束非 agent 步骤。
- `AFK_AGENT_TIMEOUT_MS=2700000`（45 分钟）：单个 agent 的硬上限。依据 V23：管道整体超过 30 分钟是常态，复验跨度接近 28 分钟，30 分钟给 agent 的余量太薄。
- `AFK_PIPELINE_TIMEOUT_MS=7200000`（2 小时）：一条管道的总上限。

恢复步骤：

1. T1、T2、T3 合并进 main。
2. 确认演示仓没有 `Sandcastle` 标签，没有进行中的管道（V22）。
3. 改 `~/.afkfactory/env` 第 15 行为 `AFK_STEP_TIMEOUT_MS=1800000`，按需加 `AFK_AGENT_TIMEOUT_MS`、`AFK_PIPELINE_TIMEOUT_MS`。
4. 重启 scheduler：`launchctl kickstart -k gui/$(id -u)/com.afkfactory.scheduler`。重启前确认 launchd 的脚本 `cd` 到的是 main 所在目录。
5. 启动日志打印生效的三个超时值（T1 的验收项，值不是秘密）。
6. 跑 `node factory/bin/scheduler.mjs --once --customers customers.json --owner Lil-BobCN --dry-run`，确认没有新的超时或孤儿。
7. 跑一次受控超时注入：agent 命令换成睡过 `AFK_AGENT_TIMEOUT_MS` 的 wrapper，验证进程被杀、作业行有记录、下一轮单管道。注入完恢复 `AFK_AGENT_COMMAND`。

不要用 `ps eww` 看进程环境，会带出 token。用启动日志。

---

## 四、F11 重装 helper 的打包步骤

### 根因

`deploy/products/app.env.example` 是软链，指向 `../../backend/scaffold/.env.example`（V14）。只打包 `deploy/` 时，tar 默认保留软链，解包后目标不存在。`install.sh` 的 `[[ -f ]]` 预检失败，报「缺文件」，安装停下。

### 可选修法

| 方案 | 做法 | 取舍 |
| --- | --- | --- |
| A（推荐） | 新增 `deploy/products/package.sh`：从仓库根打 `deploy/products`、`deploy/lib`、`backend/scaffold/.env.example`，保持相对路径；解包后软链能解析 | 包依赖目录布局；要在文档里写清「在仓库根解包」 |
| B | 打包时解引用软链（tar 加 `-h` / `--dereference`），`app.env.example` 变成普通文件 | 包自包含；目标文件的内容和软链不再一一对应，靠指纹比对 |
| C | 把 `deploy/products/app.env.example` 改成普通文件，两边同步维护 | 单源破坏，两份会漂移 |
| D | 只改 `install.sh`：预检时 `readlink -f`，断链给明确提示 | 只改善报错，不解决缺文件 |

推荐 A，B 作为备选。A 和 B 可以一起做：打包脚本默认解引用，同时在 README 写清布局。

同时改 `install.sh` 的预检：

- 断链时提示「`app.env.example` 是软链，目标不存在；用 `deploy/products/package.sh` 打包」。
- 其余缺文件提示不变。

### 影响面

- `deploy/products/package.sh`（新增）、`deploy/products/install.sh`、`deploy/products/README.md`、`docs/运维手册.md`。
- `deploy/test/deploy-selftest.sh` 加一条打包和安装冒烟。
- 不影响成品运行，不影响已有安装。

### 测试方式

1. 在仓库根跑 `bash deploy/products/package.sh /tmp/helper.tgz`。
2. 解包到空目录，断言 `deploy/products/app.env.example` 是普通文件、非空，或软链能解析。
3. 用环境变量把安装根指到临时目录，跑一遍 `install.sh` 的文件预检（不装 Docker、不动 `/data`）。
4. 删掉 `backend/scaffold/.env.example` 再打包，断言脚本报错并指出缺哪个文件。

### 验收条件

- 用打包脚本产出的包，在空机上能一次装完，`app.env.example` 存在且非空。
- 断链时 `install.sh` 给出可执行的下一步，不是只报「缺文件」。
- 自测覆盖打包、解包、预检三步。

---

## 五、issue tracker 遗留

### 总表

根因以票面为准。I-0236–I-0241 的「根因」和「证据」两节都写到了文件和行号，本方案只写修法、取舍和验收，不重抄票面。

| 票 | 现在的问题 | 修法 | 影响面 | 验收 |
| --- | --- | --- | --- | --- |
| I-0228 | 第 3 次演练的验收票，验收条件没提 30 分钟超时和 4.3–4.7 | 按第七节成功标准改写验收条件，作为第 5 次全链票；挂在全部前置票之后 | 票面 | 见第七节 |
| I-0236 | 健康检查的 version 来自 `backend/package.json`，发布不改它 | 让 `backend/server.mjs` 优先读同目录 `release.json` 的 version，读不到再用 `package.json` | 后端启动一处 | 发布 rc.6 后 health 回 rc.6；回滚后回旧版本；200/401 契约不变 |
| I-0237 | `package.sh` 第二次 `tar -C` 用相对路径，在 `$META` 下解析 | 入口处把 `$SRC` 转成绝对路径 | 打包脚本一处 | 文档命令在仓库根直接跑通；绝对路径仍可用 |
| I-0238 | `console open` 读错 Orca 字段 | `status.running ?? status?.result?.running ?? status?.result?.app?.running` | 控制台一处 | 两种返回结构都有测试；Orca 没开仍报原错误 |
| I-0239 | 人工点没有对话载体 | 先 grill 定形态；本轮只做设计，不实现（见下） | 工厂流程入口 | 见下 |
| I-0240 | to-spec 仍是手动步骤 | 调度器自动跑 to-spec（见下） | 调度器、作业、通知、文档 | 见下 |
| I-0241 | 编号列表的验收场景导入后变成「- 无」 | 给验收条件单独写解析器，认 `-`、`*`、`1.`、`1)`；不动 `bulletLines` 的其他调用方 | 导入一处 | 三种写法结果一致；已有父工单重跑导入能补齐；不重复建单 |

I-0236 的取舍：读 `release.json` 不改打包，回滚也跟着走；如果发布包没有 `release.json`（旧包），回退到 `package.json`，行为和现在一样。

I-0237 的取舍：只转绝对路径，不改包内容和版本号规则。

I-0238 的取舍：兼容三种字段，不重写 Orca 调用。

I-0241 的取舍：不改 `bulletLines`，避免把地图的 Decisions、Out of scope 也放宽，影响其他解析。

### I-0240：to-spec 自动推进

**现状**

- 调度器只有看到 spec 才拆票；没有 spec 就返回空（V15）。
- console 的 spec 待办没有写回命令。
- 通知模板写「手动跑 to-spec」。
- 文档写「调度器不触发 to-spec」。
- 第 4 次演练因此停在拆票之前，由主会话代跑。

**修法**

1. 新增 `factory/agents/to-spec.md`。读取顺序照 `docs/工厂流程.md` 的 to-spec 一节：父工单五段、最新 `点头：补缺口`、最新 `改口：`、地图、仓库文件。输出七字段 spec issue，标题带需求名，挂 `ready-for-agent`。不建子票，不改代码。提示词写清五条规则：每条客户确认的验收项要有对应故事，包括只在决定票里出现的行为；非应用产出的交付物写清责任方；平台部署默认值（每成品独立 database 和 role、香港服务器、容器）带进 spec 或引用平台文档；正文不写文件路径和代码片段，交稿前自检；地图和代码冲突写进 Further Notes，影响实现时停下报运营者。
2. `factory/lib/scheduler-jobs.mjs` 加 `createToSpec`，形状照 `createDecompose`：跑前查 spec 是否存在，存在就跳过；跑后校验 spec issue 的标题、标签和需求名；失败返回原因。
3. 路由：`排队中` + 最新关口 `点头：补缺口` + 没有 spec → `runToSpec`，不再 `wait`。
4. 作业：`action=to-spec`，失败按 attempt 退避，到上限写 stop 并挂 needs-info。
5. 通知：事件文案改成「工厂开始跑 to-spec」；`notifier/templates.py` 和测试同步改。事件 key 可以保留原名，避免重复通知。
6. `console.mjs` 的 spec 待办改成「正在跑 / 失败可重试」，写回命令改为触发重跑。
7. 文档：`docs/工厂流程.md` 的 104、119、198、251、496 行改成「调度器自动跑」。

**取舍**

- 自动 spec 没有人工复核。缓解：spec issue 可见；拆票遇到冲突会停；第 5 次演练专门看 spec 质量。
- 如果想给运营者一个改 spec 的窗口，可以让 spec 出来后等一轮再拆票。代价是多 30 秒，收益小，暂不做。
- 另一个选项是改根决定，保留 to-spec 为第 4 个人工点。这样达不到「只保留三个人工点」，不推荐。

**测试**

- 决策单测：`排队中` + `点头：补缺口` + 没有 spec，决策是 `runToSpec`。
- 幂等：spec 已存在时不重复建。
- 失败：runner 失败写作业行，父工单挂 needs-info；摘标签后重试。
- 通知模板测试同步更新。
- 试跑：用 `demo-tanxin-yuyue-4` 的父工单、地图、决定票生成一份草案，和 spec #7 对比，五条规则逐条有体现。

**验收**

- I-0240 原文的四条验收。
- 草案里客户确认的每条验收项都有对应故事；正文没有文件路径和代码片段；平台默认值有出处；地图和代码冲突有记录。
- 第 5 次演练里 to-spec 由工厂跑完，运营者没有代跑。

### I-0239：人工点的对话载体

**现状**

补缺口和拆票都是「一次性 agent 出提案，运营者在 GitHub 评论或 console answer 写回」。没有同一处会话，追问和上下文都接不上。

**修法选项**

| 方案 | 做法 | 改动 | 取舍 |
| --- | --- | --- | --- |
| A（推荐先 grill） | `console open` 起一个交互式 agent 终端，brief 带当前关口和写回命令；答完由 agent 写回 | console、作业说明 | 上下文不持久；要处理并发和权限 |
| B | 中台网页加人工点会话面板 | 中台服务、前端、鉴权 | 成本高，跨两个系统 |
| C | 不做会话，只把提案和写回入口做清楚 | 文案、I-0238 | 成本最低，但追问仍没有地方 |

**建议**

- 本轮只做 grill 和一张原型票，不把 I-0239 放进第 5 次演练的硬性条件。
- 三个人工点的数量由 I-0240 决定；I-0239 影响的是操作体验。
- 第 5 次演练后再定形态，避免在关键修复期动整个入口。
- 载体方案写在 `.inbox/plans/iteration-2026-11-24.md`：Orca 交互终端、现有 CLI 写回、父工单摘要。

**验收**

- 一个入口能看题、追问、回答、确认、留痕。
- 运营者不用记命令。
- 现有的 console 最小入口不回退。

---

## 六、故障注入 4.3、4.4、4.5、4.7

### 4.3 换错 token

**现在会怎样**：启动只查 token 是否为空（V17）。换成无效 token，调度器照常起，每一轮 GitHub 调用失败，只写 runs 日志。父工单没有 needs-info，也没有通知。运营者只能从日志发现。

**先修代码（T5）**：

1. 启动时调一次 `GET /user`。401 直接退出，报键名和文件；网络错误只警告，不退出。
2. 运行中把 401 归为 `auth-failed`，写 `pipeline` 或对应动作的 stop，挂 needs-info，发「出事」通知。403 的权限错误同样处理。
3. 同一故障只通知一次，key 稳定。

**怎么注**：

1. 用一个没有仓库权限的 token，对 scratch 客户仓跑 `--once`。期望退出码非 0，报 `GITHUB_TOKEN`。
2. 用 `--loop` 跑一轮，把 token 换成只有读权限的。期望父工单 needs-info、通知一条、作业表 stop。
3. 恢复真 token，摘 needs-info。期望下一轮继续，没有重复评论或 PR。

**证据**：启动 stderr、作业表那一行、父工单标签、通知记录、恢复后的 runs。

### 4.4 部署后 502

**现在会怎样**：`product-deploy` 起新镜像后等 30 秒；没应答就恢复上一版镜像并重启（V18）。Mac 侧整套重试两次，再发「出事 部署失败」，finish 写 needs-info。没有自动 `product-rollback`。

**怎么注**：

1. 在 scratch 成品上造一个坏镜像：启动即退出，或监听错端口。
2. 跑 `sudo afk-product product-deploy <scratch 地址> --image <坏镜像>`。
3. 看：命令非 0；`.env` 的 IMAGE 回到旧值；旧容器起来；`product-status --check` 200。
4. 走 Mac 侧部署：`factory/bin/deploy.mjs` 对 scratch 仓跑两次失败，发通知，finish 写 needs-info。
5. 恢复：部署好镜像，`product-status --check` 200；摘 needs-info；finish 重试成功。

**不要用已交付的 demo 地址。**

**证据**：helper 输出、`docker ps`、健康码、通知、作业表。

### 4.5 坏包 import_failed

**现在会怎样**：导入失败写订单终态和 `operator_alert`，有重试命令（V19）。

**怎么注**：

1. 在本地或 scratch 后端实例上，把坏 zip 放进上传目录（缺 meta、坏 JSON、超大文件各一次），跑一轮导入。
2. 看：订单状态 `import_failed` 或 `needs_operator`；`operator_alert` 有原因；没有建仓、没有父工单；通知有；快照按失败状态保留或清理。
3. 恢复：`node backend/bin/retry-import.mjs --order <scratch 单号>`；下一轮导入成功；不重复建单。

**证据**：订单 JSON、上传 meta、导入日志、通知、重试输出。

### 4.7 两个 merged PR

**现在会怎样**：中台按候选 PR 逐个核对 `headRefOid`；匹配才关票，不匹配标「过期」（V20）。单测已有。

**怎么注**：

1. 在 scratch 客户仓建一张票，开两个 PR，分别基于两个 head，都合并。
2. `dt close prepare` 记录的 SHA 等于其中一个的 head。期望：匹配的那个触发关票，四条评论只写一次。
3. 反向：记录 SHA 不匹配任何一个。期望：记录标「过期」，屏幕出「关票 SHA 不符」，票不关。
4. 恢复：作废过期记录，或用正确 SHA 重新 prepare。

**证据**：中台事件流、屏幕信号、PR 时间线、关票评论。

---

## 七、第 5 次全链

### 前置条件

1. T1、T2、T3 合并；T4、T5 合并；I-0236、I-0237、I-0238、I-0240、I-0241 合并；I-0228 的验收条件改好。
2. 集成分支上三套测试全绿：factory 571、backend 176、中台 `python3 -m unittest discover -s 中台/tests -q` 102（V31）。
3. 调度器从 main 重启，启动日志显示 `AFK_STEP_TIMEOUT_MS=1800000` 和 agent、管道两个上限。
3. 环境清场：演示仓没有 `Sandcastle` 标签；没有残留容器和工作树；`jobs.json` 没有已知之外的 stop；中台和 orca 在线。
4. token：PAT 带 `workflow`；GitHub App 有建仓和推送权限；用 scratch 仓做一次推送冒烟。
5. helper：用新的打包脚本重装；`check.sh --templates-only` 通过；`product-status --check` 返回 200。
6. 演练包：验收场景用编号列表，专门触发 I-0241 的修复；至少一张有界面的票，保证验证证据有用。
7. 故障注入计划：4.3、4.4、4.5、4.7 的时间点、恢复人、备份都定好。4.4 和 4.5 只在 scratch 环境做。
8. 人和记录：调度者和记录员分开，记录员独占记录文件。这是第 4 次演练验证过的分工。

### 成功标准

1. 交付地址 200，父工单 待验收。
2. 人工点只有上传、补缺口点头、拆票点头。其他人工动作逐条记录，数量为 0 才算达标。
3. 30 分钟超时全程生效。没有因超时产生的第二条管道，没有孤儿进程或容器。
4. 4.3、4.4、4.5、4.7 各有证据：失败可见，能恢复，重试不产生重复副作用。
5. 没有重复 PR，没有残留工作树或容器，交付树没有垃圾文件。
6. I-0228 原来要求的 finding 覆盖继续有效：每条有测试或运行证据。
7. 演练记录、最终报告、地图覆盖表三处更新。

---

## 八、票的拆法

### 挂哪张图

挂 I-0208，不新开图。

理由：

- I-0208 的 Destination 就是「下一次全链只留三个人工点」，和这批工作同一个目标。
- 6 句根决定已经分好，新票直接 `covers` 到对应句。
- 现在 45 张，加 6 张是 51 张，离 80 张的归档线还远（V21）。
- 新开图要搬 8 张 open 票，覆盖表会分叉，收益是「按演练分家」，代价大于收益。

### 新建哪些票（已建，2026-11-24 重构后）

| 工作名 | 中台号 | 标题 | 类型 | covers | 依赖 | 来源 |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | I-0254 | 管道超时取消子任务，同一票只允许一条管道（含 runner 显式传模型） | task | #2、#3 | 无 | F7、I-0207 |
| T2 | I-0256 | 工作树归档只收非证据文件，堵住 ignore 写入口 | task | #2、#3 | T1 | F6 |
| T3 | I-0257 | helper 打包脚本和 install.sh 预检 | task | #6 | 无 | F11 |
| T4 | I-0258 | token 无效时启动失败、运行中停线并通知 | task | #4、#2 | 无 | 4.3 |
| T5 | I-0259 | 补做 4.4、4.5、4.7 故障注入并留证 | task | #2、#6 | T1、T2 | 报告 |
| — | I-0255 | 已并入 I-0254 | — | — | — | — |
| — | I-0207 | 已并入 I-0254 | — | — | — | — |

代码票 9 张：I-0254、I-0256、I-0257、I-0258、I-0240、I-0236、I-0237、I-0238、I-0241。I-0259 是注入，不进代码批次，由同一个 agent 在 scratch 环境做。

已有票：I-0236、I-0237、I-0238、I-0240、I-0241 进批次；I-0240 被 I-0254 挡住；I-0239 留作第 5 次测试后的迭代；I-0228 是第 5 次全链。

### 依赖顺序

```
I-0254 → I-0256
I-0257、I-0258、I-0236、I-0237、I-0238、I-0241  并行
I-0240 等 I-0254
I-0259 等 I-0254、I-0256
I-0228 等上面全部关闭
```

I-0254 一个票里做取消和互斥，两半一起验收。I-0256 依赖它的并发测试场景，排在后面。I-0240 改调度器和通知，和 I-0254 有文件重叠，合并时排在它之后。

### 建票结果

2026-11-24 已建 I-0254–I-0259。I-0255 和 I-0207 已并入 I-0254；I-0205 已关；I-0166、I-0167、I-0200 已关。代码批次 9 张，加 I-0259 注入。I-0228 的验收条件已改写。I-0240 的票面补了修法、测试和验收。I-0239 留作第 5 次测试后的迭代种子。

集成分支：`Lil-BobCN/drill4-repair-plan`（当前分支）。票面已经写进实现约定，地图评论 C-1305 也记了。

每张票正文按现有格式写：现象、根因、期望、验收条件、边界、实现约定。根因带文件和行号，implement-spec 不用再回头查现场。

---

## 九、执行顺序

| 阶段 | 做什么 | 完成条件 |
| --- | --- | --- |
| 0 | 拍板第十一节的问题；建 T1–T6；连依赖；改 I-0228 验收条件；备份 `env` 和 `jobs.json` | 票面完整，依赖可见。建票和改票 2026-11-24 已完成；基线测试已跑（V31）；备份还没做 |
| 1 | T1 取消 | 单测和受控注入过，孤儿进程为 0 |
| 2 | T2 租约 | 并发测试过，第二条约会跳过 |
| 3 | T3 归档和 ignore | 并发场景下证据不丢，ignore 有日志 |
| 4 | T4、T5、I-0236、I-0237、I-0238、I-0241 并行；I-0240 一条线 | 各票验收过 |
| 5 | 恢复 30 分钟超时，重启调度器，`--once` 冒烟 | 启动日志显示三个上限；无超时 |
| 6 | T6 补做 4.4、4.5、4.7；4.3 在 T5 后补 | 四条注入各有证据 |
| 7 | 第 5 次全链 | 第七节成功标准 |
| 8 | 第 5 次测试后：I-0239 载体迭代；更新记录、报告、地图 | 文档一致 |

---

## 十、风险清单

| 风险 | 触发条件 | 后果 | 缓解 |
| --- | --- | --- | --- |
| 重启调度器跑到旧目录 | launchd 脚本 `cd` 的目录不对 | 新代码没生效，演练仍用旧逻辑 | 重启前查启动脚本和 `git log`，启动日志打印版本和超时 |
| 杀进程组杀到自己 | `detached` 和负 pid 用错 | 调度器退出，整轮中断 | 已实测（V29）：detached child 是独立进程组组长，杀它不影响 parent；实现按 T1 |
| 租约误判 | 心跳写失败、时钟漂移、pid 复用 | 活管道被抢，重复 agent | `kill(pid,0)` 加 mtime 过期双条件（V30）；接管写日志；屏幕可见 |
| 30 分钟误杀有效工作 | agent 单次超过 30 分钟 | 未提交的修复丢失，重试变慢 | 已确认 `claude -p` 不流式输出（V28），按 agent 级 45 分钟上限；先观察第 5 次的 agent 时长 |
| 自动 to-spec 质量差 | 输入冲突或仓库信息乱 | 拆票基于坏 spec | 试跑可用（V33）；I-0240 已补 5 条提示词规则；spec 可见；拆票遇冲突会停 |
| 4.4、4.5 注入影响真实环境 | 用了正式成品或客户订单 | 客户地址不可用、订单被改 | 只用 scratch 成品、本地后端、独立中台 home |
| 打包脚本漏文件 | 新增文件没进清单 | 服务器安装失败 | 安装预检加自测；打包后解包核对 |
| I-0208 票数增长 | I-0239 grill 再拆票 | 接近 80 张归档线 | 先按 51 张规划；到 80 前归档已关闭票 |
| 报告和现场再次不一致 | 文档只改一处 | 下一个 agent 读错 | 本方案第二节列出的出入，合票时一起改文档 |

---

## 十一、拍板结果（2026-11-24）

用户按推荐拍板。实施按下面的选择执行。

| 问题 | 决定 |
| --- | --- |
| 超时语义 | 步骤 30 分钟、单个 agent 45 分钟、一条管道 2 小时 |
| I-0240 | 修，调度器自动跑 to-spec |
| I-0239 | 本轮只 grill 和开原型票，不实现，不挡第 5 次 |
| 新票挂哪张图 | I-0208 |
| I-0228 | 改验收条件，作为第 5 次全链票 |
| 4.4、4.5、4.7 | 一张票，I-0259 |
| 30 分钟恢复 | I-0254、I-0255、I-0256 合并后，I-0259 之前 |
| 建票 | 2026-11-24 已建 I-0254–I-0259 |

用户另加一条要求：先把 bug 和根因查清，再用 `/to-tickets` 的拆法建票，最后跑 implement-spec 自动修。根因已经写进每张票的正文，带文件和行号。

---

## 附：证据索引

- 演练记录：`docs/research/第四次全链演练记录.md`
- 最终报告：`docs/research/第四次全链演练最终报告.md`
- 记录员原始发现：`$TMPDIR/afk-handoff/drill-fourth-resume/findings.md`（F1–F11，E1–E62）
- ignore 写入会话：`~/.claude/projects/-Users-Admin--afkfactory-repos-demo-tanxin-yuyue-4--sandcastle-worktrees-ticket-9/f43748fa-7683-4a41-86b1-1e68b70742f5.jsonl`
- 现场文件：`~/.afkfactory/repos/demo-tanxin-yuyue-4/.git/info/exclude`
- 作业表：`~/.afkfactory/jobs.json`
- 调度日志：`~/.afkfactory/logs/drill-fourth-resume-runs.jsonl`
- 票：I-0208、I-0228、I-0236–I-0241、I-0254–I-0259
