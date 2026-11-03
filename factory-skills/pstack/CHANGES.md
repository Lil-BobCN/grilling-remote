# 改写记录

> 2026-11-03 注：下文写的「v4 第八节」「v4 第十节」等，指的是 `docs/archive/流程 v4.md` 的章节号。v4 已并入 `docs/工厂流程.md`，章节号不同：v4 第八节对应正稿第十七节，v4 第十节对应正稿第十八节。

结论：9 个文件改过，10 个原样复制。`roles.md`、`README.md`、`NOTICE.md` 和本文件是新写的。`LICENSE` 原样保留。合并规则以 `docs/工厂流程.md` 为准。

来源：github.com/cursor/plugins 的 `pstack/`，提交 ae5650f，版本 0.15.36。本机副本在 /tmp/pstack-cursor-1103/pstack。

## 和原文的 diff 行数

下表数的是 `diff` 输出里以 `<` 和 `>` 开头的行。一行被改写，算删 1 行加 1 行。

| 文件 | 源行数 | 删 | 加 | 结论 |
| --- | --- | --- | --- | --- |
| `agents/comment-sicko.md` | 32 | 1 | 1 | 改过 |
| `skills/blast-radius/SKILL.md` | 50 | 6 | 4 | 改过 |
| `skills/correct/SKILL.md` | 32 | 1 | 1 | 改过 |
| `skills/create-verification-skill/references/feature-map-example/create-note.md` | 39 | 0 | 0 | 原样 |
| `skills/create-verification-skill/references/feature-map-example/README.md` | 47 | 0 | 0 | 原样 |
| `skills/create-verification-skill/references/feature-map-example/search.md` | 45 | 0 | 0 | 原样 |
| `skills/create-verification-skill/SKILL.md` | 44 | 5 | 5 | 改过 |
| `skills/in-your-own-words/SKILL.md` | 7 | 0 | 0 | 原样 |
| `skills/interrogate/SKILL.md` | 31 | 4 | 10 | 改过 |
| `skills/no-comments/SKILL.md` | 24 | 4 | 4 | 改过 |
| `skills/poteto-mode/playbooks/autopilot-full.md` | 25 | 8 | 16 | 改过 |
| `skills/principle-fix-root-causes/SKILL.md` | 21 | 0 | 0 | 原样 |
| `skills/principle-prove-it-works/SKILL.md` | 22 | 0 | 0 | 原样 |
| `skills/principle-redesign-from-first-principles/SKILL.md` | 16 | 0 | 0 | 原样 |
| `skills/principle-separate-before-serializing-shared-state/SKILL.md` | 16 | 0 | 0 | 原样 |
| `skills/show-me-your-work/references/decision-log-template.tsv` | 1 | 0 | 0 | 原样 |
| `skills/show-me-your-work/scripts/log.sh` | 42 | 0 | 0 | 原样 |
| `skills/show-me-your-work/SKILL.md` | 82 | 4 | 4 | 改过 |
| `skills/swarm/SKILL.md` | 41 | 4 | 4 | 改过 |

## 被引用项的取舍
结论：被引用的项里，6 个技能和 1 个 agent 文件一并带上，其余不装或删掉。

| 被引用项 | 判断 | 理由 |
| --- | --- | --- |
| arena | 不装 | 它读 `arena runners` 行，roles.md 没有这一行。interrogate 用到的句子已并进它的 Fan out 和 Verify。Phase C、D、E 本来就被 interrogate 跳过。 |
| principle-separate-before-serializing-shared-state | 原样装 | interrogate 引用，16 行，没有 Cursor 依赖。 |
| principle-prove-it-works | 原样装 | interrogate 引用，22 行，没有 Cursor 依赖。 |
| in-your-own-words | 原样装 | interrogate 引用，7 行，没有 Cursor 依赖。 |
| show-me-your-work | 装并改写 | autopilot-full 第 2 步要保留推送决策记录这条规则，绕不开。脚本和模板原样，没有运行。 |
| principle-fix-root-causes、principle-redesign-from-first-principles | 原样装 | no-comments 第 4 步引用，没有 Cursor 依赖。 |
| comment-sicko（agents/） | 装并改写 | no-comments 第 1 步要派它，绕不开。只改 `/how`、`/why` 那一句。 |
| ketchup、bro | 不装 | 它们在聊天里给人补进度。工厂里没有聊天，改成向 operator 发一条短通知，内容清单照原文。 |
| shipping | 绕开 | autopilot-full 第 3 步写明不叠栈，所以逐层落地的步骤用不上。patch-id 规则并进了第 5 步。 |
| opening-a-pr | 绕开 | 写 PR 正文改用 `/pr` 四栏，开 PR 只用 `gh`，开成 ready，不开草稿。 |
| babysit | 绕开 | 它依赖 watch-pr 脚本、Bugbot、Origin 和栈。等 CI 和先分类失败再重试的规则并进了第 2 步，用 `gh pr checks` 和 `gh pr view`。 |
| deslop | 删 | 没有对应物，只删这一句，不补替代。 |
| how、why | 不装 | 改成沿调用方和历史追符号，用 `git blame`、`git log`、`gh pr view`。 |
| architect | 不装 | 保留先画草图再停下的意思。 |
| unslop | 不装 | 只删引用，不补替代。 |
| maintain-verification-skill | 不装 | 改成每张票合并时更新功能地图，见 v4 第四节。 |
| poteto-mode | 不装 | 它的 Subagents 一节讲的是 Cursor 的模型选择，由 roles.md 代替。其余引用直接删。 |
| `/pr` | 不在本目录 | 它是上游 mattpocock-skills 的技能，v4 第六节 E1 用它写四栏正文。交叉引用检查对它记为例外。 |


## 原文与 v4 不一致的地方
结论：有 4 处。前 3 处以 v4 为准。第 4 处，v4 第十节自己指定以原文为准。

1. autopilot-full 步骤 5：原文只要求验证者证明过的版本才能合。v4 第六节 D5 和 E1 要求验证队和评审都过。已补一段：评审要在验证队验证过的同一个 head 上通过，高风险 PR 加 interrogate。过不了，当环境问题，停这条线，通知 operator，附现象和试过的办法。
2. autopilot-full 开头段：原文的 trunk 指主干。v4 里票先合进需求分支。已补一句：trunk 指这个 PR 要落到的分支。需求分支上的票由 merger 子 agent 合，落到主干的 PR 由它的 owner 合。
3. autopilot-full 步骤 6：原文由 root 复签。v4 第六节 D6 改成运营者复签。已改成 operator 的复签。
4. swarm 的 worker 只报 `ISSUES`，不改代码。v4 D3 写验证 agent 找到就修。v4 第十节写明 autopilot-full 第 2 到 7 步以原文为准。所以保留原文：验证者报问题，负责人修，修完再验。

## 组长补记
结论：下面六条在子 agent 的笔记里没有，由我补进 CHANGES.md。

1. `roles.md`：`interrogate reviewers` 一行的「谁读这一行」加上 blast-radius。原因：blast-radius 步骤 6 读这一行，原表没列。
2. `skills/no-comments/SKILL.md` 步骤 1：删掉了原句「Do not restate its rules.」。原因：按上下文，its 指被删掉的 Subagents 一节。那一节没了，这句就没有所指。验证组笔记没单独记这一条。
3. `agents/comment-sicko.md` 和两个 principle 技能：v4 第十节的借用清单没有它们。no-comments 要派 comment-sicko 并引用两个 principle 技能，所以一并带上。建议在清单里补三行。
4. 检查脚本对 interrogate 报「缺」的两处，是原文对 principle 技能的简称。对应目录都在，属误报。
5. `roles.md`：删掉 `root` 行和对应小节。原因：剧本组确认 autopilot-full 不读它。root 是运行剧本的父会话，不需要单独选模型。
6. `roles.md`：`reviewer` 行的读者加上 autopilot-full。原因：步骤 5 的评审段读这一行。

## 没解决的问题
结论：5 条。本次改写都没有动手，原因是改动会超出原文，或者要运营者来定。

1. 无人值守时，没有人能批准或回答。`correct` 的例外批准、`interrogate` 的意图不清、`no-comments` 的约束编码批准，只写了动作，没写通知渠道，也没写缺口记在哪。要定一个位置，比如 trail store 里的一类记录行。
2. `no-comments` 和 `comment-sicko` 在独立 worktree 里跑，看不到调用方没提交的改动，改动也取不回。要定：先把 scope 提交一次，还是让子 agent 把改动推到一个分支。两处默认基准都写 `main`，v4 里票的基准是需求分支，所以调用方必须传 scope。
3. 「每张票合并时更新功能地图」只写在 `create-verification-skill` 第 5 节。这个技能只在建仓时跑一次。票的完成标准要写在票模板或 `/implement` 的指令里，不在本目录范围内。
4. `autopilot-full` 周边有三个缺口。没有入口技能，brief 要直接写路径。shipping 里「合并后回读 PR，因为合并队列可能只是排上队」没并入。`show-me-your-work` 默认把日志放工作目录且不提交，和 `autopilot-full` 的 trail store 不一致，以后者为准。
5. 角色表有两处没写透。swarm 的 worker 数量由 Frame 的 shape 决定，`roles.md` 说一行填多个模型就各跑一份，两者怎么合没写。`blast-radius` 读 `interrogate reviewers` 行，该行没配置时只派一个子 agent，多模型就没有意义。

## 没验的事
结论：没有运行任何技能和脚本，包括 `log.sh`。只做了文本检查、grep 和 diff。下面是具体没验的事。

1. 容器里并行起子 agent。涉及 `swarm`、`interrogate`、`blast-radius` 步骤 6。
2. 子 agent 能不能读到 `roles.md`。装进客户仓后，`roles.md` 和 `agents/comment-sicko.md` 的相对路径对不对。
3. 调度器能不能读到 brief 指定的 trail store。
4. 带 `disable-model-invocation` 的技能，无头模式下能不能点名调用。`.claude/skills/verify-<app>/` 能不能被找到。
5. `/pr` 在容器里找不找得到。
6. `gh pr checks --watch`、`gh pr view --json mergeable,mergeStateStatus,headRefOid`、`gh run view --log-failed` 没在真实仓库里跑过。
7. 把调用方没提交的改动复制进每个攻击者的 worktree，在 Sandcastle 里怎么做。worktree 能不能从没推送的分支起步。
8. 每张票合并时能不能自动更新功能地图。
9. 回退到父会话模型时，`show-me-your-work` 里评审和干活的可能是同一个模型。靠一条记录行说明，这条路没验。

## 改写规则
结论：三个子 agent 按下面 11 条加 4 条合并规则改写。条目里的「改写规则第 N 条」指这里的序号。「组长」指本会话的主 agent。

1. Cursor 云端 agent、`environment` 选项、`subagent_type`、`Task` 工具、`run_in_background`、`cloud_base_branch`：换成 Sandcastle 容器里的子 agent。每个子 agent 一个 worktree（工作树）、一个容器。
2. 选模型：原文读 `~/.cursor/rules/pstack-models.mdc` 的某一行。改成读 `roles.md` 的对应行，没配置时用父会话的模型。默认模型名、slug 被拒绝时的退路、推理档位和快慢档建议，整段删。
3. PR：只用 `gh`，令牌只限当前客户仓。删 origin 和 Graphite 的全部文字。
4. operator：指运营者。放宽任何一道检查，要验证者的证明，再由运营者复签。关掉或只报警不拦的检查，一律拿掉。
5. 巡检：`/loop 1h` 改成调度器每 30 秒对账。保留按副作用判断卡住、不看状态文字的判据。
6. 去掉 bugbot、automations、`control-ui`、`control-cli`、`cursor-team-kit`、`deslop`。原来靠 control 技能驱动应用的地方，改用 `verify-<app>`。`deslop` 没有对应物，只删句子。
7. 云端 VM 会死，改成容器会死。推送决策记录的规则保留。
8. ketchup、bro 不装。汇报改成向 operator 发一条短通知，内容清单照原文。
9. 写 PR 正文改用 `/pr` 的四栏。
10. 验证技能放在客户仓的 `.claude/skills/verify-<app>/`。
11. how、why、architect、unslop、maintain-verification-skill 不装，按各笔记条目里写的办法改。

合并规则，以 v4 为准：

1. 验证队和评审都过了，由负责人自己合。过不了，停这条线，通知 operator，附现象和试过的办法。
2. 保留合并门：只合验证者证明过的版本，绿灯 CI 本身不放行。
3. 票合进需求分支，由合并者子 agent 做。需求分支的 PR 合进主干，由它的 owner 做。原文的 trunk 指这个 PR 要落到的分支。
4. 各角色的行名见 `roles.md` 第一列。

## 关键词检查
结论：技能、agent 文件、`roles.md`、`README.md` 里没有命中。九个关键词只在下面两处出现。

1. `NOTICE.md`：来源仓库地址 github.com/cursor/plugins，以及「依赖 Cursor 的部分」这句说明。这是署名和来源说明，保留。
2. `CHANGES.md`：条目逐字引用原句，原句里有这些词。引用是为了写明改了什么，保留。文件开头的来源地址同理。

另有一处 VM 在 `skills/create-verification-skill/SKILL.md` 第 40 行。它不在九个关键词里，指一类和真实目标不同的替身环境，保留理由见该文件的条目。

## 逐文件记录

每节写源路径、行数、结论、diff、条目、与 v4 冲突和没验。条目里的原句和新句逐字引用，所以这一部分会出现 Cursor 相关的词。

### roles.md
- 源：无，新写。依据 `docs/工厂流程.md` 第十七节。
- 结论：新增。
- 内容：第八节的 10 个角色全部在表里，agent 和模型都写「待定」。没有写任何模型名。
- 行名：`owner`、`reviewer`、`interrogate reviewers`、`swarm workers`、`merger` 是技能读的行。其余 5 个角色这七项不读，行名留空，用一个短横线占位。
- 改动：起草时多一行 `root`，后来删掉，见「组长补记」第 5 条。`reviewer` 行的读者加了 autopilot-full。`interrogate reviewers` 行的读者加了 blast-radius。
- 没验：技能能不能读到这份文件。

### README.md
- 源：无，新写。
- 结论：新增。中文，先说结论。写了用在哪、入口、里面有什么、合并规则和没验的事。

### NOTICE.md
- 源：无，新写。
- 结论：新增。写了来源仓库、提交 ae5650f、版本 0.15.36、许可、版权、改写日期 2026-11-03 和改写者。

### LICENSE
- 源：/tmp/pstack-cursor-1103/pstack/LICENSE，21 行。
- 结论：原样。
- diff：删 0 行，加 0 行。

### skills/create-verification-skill/SKILL.md
- 源：/tmp/pstack-cursor-1103/pstack/skills/create-verification-skill/SKILL.md，44 行。
- 结论：改过。
- diff：删 5 行，加 5 行。
- 条目：
  1. 原句：第 9、25、36 行各有一处 `.cursor/skills/verify-<app>/`。
     新句：`.claude/skills/verify-<app>/`。三句其余部分不动。
     原因：改写规则第 10 条。客户仓里验证技能放在 `.claude/skills/`。
  2. 原句：标题「## 5. Offer the maintenance loop」。正文「Point the user at `/maintain-verification-skill` for keeping the map honest as the app changes. Suggest a cadence only if they ask.」
     新句：标题「## 5. Keep the map accurate」。正文「The map stays accurate because every ticket updates it when it merges. Updating the map is part of each ticket's definition of done.」
     原因：组长已定。`/maintain-verification-skill` 不装。依据是 v4 第四节：功能地图每张票合并时更新，是票的完成标准之一。不提频率。v4 的章节号没写进技能正文，因为客户仓里的 agent 读不到 v4。
  3. 没改：第 40 行「a container in place of a fresh VM, a local stack in place of a remote one」。
     原因：这里的 VM 泛指一种和真实目标不同的环境，不是云端 VM 产品。这条规则对 Sandcastle 容器同样成立：在替身里证明过，就要列出替身做了而真实目标不会做的步骤。自检的 grep 只命中这一处。
  4. 没改：frontmatter 的 description 里的「make a control skill for this repo」。
     原因：它是触发短语，不指向 control-ui 或 control-cli。description 能不改就不改。
- 与 v4 冲突：无。
- 没验：没有跑生成出来的技能。「每张票合并时更新地图」由谁来做，这个文件没写。要看票的完成标准和 implement 技能，都不在验证组名下。

### skills/create-verification-skill/references/feature-map-example/README.md
- 源：/tmp/pstack-cursor-1103/pstack/skills/create-verification-skill/references/feature-map-example/README.md，47 行。
- 结论：原样。
- diff：删 0 行，加 0 行。
- 条目：无。示例里的 `control-notes` 是示例应用 Notes 自己的驱动命令，不是 Cursor 的东西，按组长说明原样保留。
- 与 v4 冲突：无。
- 没验：无。

### skills/create-verification-skill/references/feature-map-example/create-note.md
- 源：/tmp/pstack-cursor-1103/pstack/skills/create-verification-skill/references/feature-map-example/create-note.md，39 行。
- 结论：原样。
- diff：删 0 行，加 0 行。
- 条目：无。理由同上。
- 与 v4 冲突：无。
- 没验：无。

### skills/create-verification-skill/references/feature-map-example/search.md
- 源：/tmp/pstack-cursor-1103/pstack/skills/create-verification-skill/references/feature-map-example/search.md，45 行。
- 结论：原样。
- diff：删 0 行，加 0 行。
- 条目：无。理由同上。
- 与 v4 冲突：无。
- 没验：无。

### skills/blast-radius/SKILL.md
- 源：/tmp/pstack-cursor-1103/pstack/skills/blast-radius/SKILL.md，50 行。
- 结论：改过。
- diff：删 6 行，加 4 行。删的 6 行里有 1 行是空行。
- 条目：
  1. 原句：「Companion to `how` and `why`. `how` tells you what the code does. `why` tells you why it's shaped that way. Blast radius tells you what it breaks somewhere else.」
     新句：删除，连同后面一个空行。
     原因：组长让在改写和删除里选一个。这段靠 how 和 why 来介绍自己，两个技能都不装。下一段「Listing the callers is not the job.」已经讲清用途。再写一句是重复。
  2. 原句：步骤 1「Use `why` step 2 to pull the PR and commits.」
     新句：「Use `git log` and `gh pr view` to pull the PR and commits.」
     原因：组长已定。
  3. 原句：步骤 4「Same rules as `why`. Cite a real `file:line`, a search that finds nothing is still an answer, and never make up a caller or an API.」
     新句：「Cite a real `file:line`, a search that finds nothing is still an answer, and never make up a caller or an API.」
     原因：`why` 不装。规则在这句后半段已经写全，所以只删前半句。这一条组长没点到，我按 改写规则第 11 条加的。
  4. 原句：步骤 6「For a big or wide change, run it as an `arena`. Ask more than one model the same question and merge the answers. Different models catch different real bugs.」
     新句：「For a big or wide change, follow the **swarm** skill. Give the same question to several sub-agents with the same brief, one per model. Read the `interrogate reviewers` line in `roles.md` for the models. If the file or the line is missing, or the line is not configured, use the parent session's model. Merge the answers. Different models catch different real bugs.」
     原因：组长已定。`arena` 不装。读 roles.md 的两句用 改写规则第 2 条的固定写法。swarm 技能已在 skills/swarm/ 下。
  5. 原句：结尾「Write it through `unslop`, cite real code, and strip anything private before it goes anywhere public.」
     新句：「Cite real code, and strip anything private before it goes anywhere public.」
     原因：`unslop` 没有对应物，只删它，不补替代（改写规则第 6 条）。Cite 改成大写，因为它成了句首。
- 与 v4 冲突：无。
- 没验：没实测 swarm 能按「同一份 brief，每个模型一个子 agent」派发。swarm 第 3 步读 `swarm workers` 行，这里读 `interrogate reviewers` 行，两处不一致，见「没解决的问题」。

### skills/correct/SKILL.md
- 源：/tmp/pstack-cursor-1103/pstack/skills/correct/SKILL.md，32 行。
- 结论：改过。
- diff：删 1 行，加 1 行。
- 条目：
  1. 原句：「Exceptions go on the offending line with a reason, an expiry date, and a human's approval.」
     新句：「Exceptions go on the offending line with a reason, an expiry date, and the operator's approval.」
     原因：组长已定。放宽检查归 operator（改写规则第 4 条）。其余原样。
- 与 v4 冲突：无。
- 没验：无人值守时 operator 不在场，这条例外怎么拿到批准，技能里没写。组长要求基本原样，所以没加。见「没解决的问题」。

### skills/no-comments/SKILL.md
- 源：/tmp/pstack-cursor-1103/pstack/skills/no-comments/SKILL.md，24 行。
- 结论：改过。
- diff：删 4 行，加 4 行。
- 条目：
  1. 原句：步骤 1「Spawn `Task` with `subagent_type: "comment-sicko"`. Pass the scope. Pick each subagent's reasoning level and fast or standard speed for the job, per the Subagents section of the **poteto-mode** skill. Do not restate its rules.」
     新句：「Spawn a sub-agent in its own worktree and its own container, briefed with `agents/comment-sicko.md`. Pass the scope. Read the `reviewer` line in `roles.md` for its model. If the file or the line is missing, or the line is not configured, use the parent session's model.」
     原因：改写规则第 1、2 条，组长已定。推理档位那句整句删，对 poteto-mode 的引用随之没了。
  2. 原句：步骤 2「Before accepting thin `IMPORTANT` or `do not remove` kills or keeps, run `/how` or `/why` on their symbol.」
     新句：「Before accepting thin `IMPORTANT` or `do not remove` kills or keeps, trace their symbol through its callers and its history (`git blame`, `git log`, `gh pr view`).」
     原因：改写规则第 11 条。步骤 2 其余句子不动。
  3. 原句：步骤 3「If any fix needs a shape, run `/architect` once for the accepted set and surrounding code. Stop at the sketch. Architect shapes. Step 4 implements.」
     新句：「If any fix needs a shape, sketch it once for the accepted set and surrounding code. Stop at the sketch. Step 4 implements.」
     原因：不再引用 architect，保留先画草图再停下的意思。「Architect shapes.」是在解释被删掉的技能，一并删。
  4. 原句：步骤 6「Report the deletion count, restored comments, reruns, architect sketch, fixes, encoding offers, encodings, unenforced constraints, and other open work.」
     新句：把「architect sketch」改成「sketch」，其余不动。
     原因：同上。
  5. 没改：步骤 5「Wait for interactive approval. Unattended and eval require caller pre-approval. If approved, encode then delete. Otherwise delete, report the constraint open, and sketch out-of-scope work.」
     原因：组长要求保持原文。工厂里通常无人值守。没有调用方预先批准，就走「删除，并记为未决」这条路。这意味着约束注释在没批准时会被删掉，不会被编码。
  6. 引用的 principle-fix-root-causes 和 principle-redesign-from-first-principles 都已在 skills/ 下。`/no-comments` 是它自己。
- 与 v4 冲突：无。
- 没验：`agents/comment-sicko.md` 和 `roles.md` 是相对 pstack 根目录的写法。装进客户仓以后路径对不对，没验。子 agent 在独立工作树里跑，它的改动怎么回到调用方，见「没解决的问题」。

### agents/comment-sicko.md
- 源：/tmp/pstack-cursor-1103/pstack/agents/comment-sicko.md，32 行。
- 结论：改过。
- diff：删 1 行，加 1 行。
- 条目：
  1. 原句：「If its claim is not obvious there, I run `/how`, `/why`, or both from the **how** and **why** skills on the named symbol or call.」
     新句：「If its claim is not obvious there, I trace the named symbol or call through its callers and its history (`git blame`, `git log`, `gh pr view`).」
     原因：改写规则第 11 条。保持第一人称。人设和语气整段保留。frontmatter 的 name 和 description 不动。
- 与 v4 冲突：无冲突。v4 第十节借的清单没有列 comment-sicko。因为 no-comments 要派它才带上。建议清单补一行。
- 没验：它没收到 scope 时默认比较 `main`，见「没解决的问题」。

### skills/principle-fix-root-causes/SKILL.md
- 源：/tmp/pstack-cursor-1103/pstack/skills/principle-fix-root-causes/SKILL.md，21 行。
- 结论：原样。
- diff：删 0 行，加 0 行。
- 条目：无。全文读过，没有 Cursor 依赖。正文里的 why 是英文单词，不是技能引用。
- 与 v4 冲突：v4 第十节清单没列它。no-comments 步骤 4 引用它，所以带上。
- 没验：无。

### skills/principle-redesign-from-first-principles/SKILL.md
- 源：/tmp/pstack-cursor-1103/pstack/skills/principle-redesign-from-first-principles/SKILL.md，16 行。
- 结论：原样。
- diff：删 0 行，加 0 行。
- 条目：无。全文读过，没有 Cursor 依赖。
- 与 v4 冲突：同上。
- 没验：无。


### arena 的处理
- 结论：不装 arena。
- 原因：arena 读 `arena runners` 那一行，roles.md 里没有对应行，装了也读不到。
- 并进 interrogate 的有：Phase A 第 3 步的选模型，第 4 步的独立输出位置，Phase B 的后台并行起子 agent，dropout 那一句，Phase F 的验证引用。
- 没带的有：Phase C、D、E。interrogate 原文本来就跳过它们。
- 没选另装裁剪版：会多一个技能，还要在 roles.md 里为它找一行，现在没有这一行。
- 引用的两个 principle 技能原样复制进 skills/，见下面两节。

### skills/swarm/SKILL.md
- 源：/tmp/pstack-cursor-1103/pstack/skills/swarm/SKILL.md，41 行。
- 结论：改过。
- diff：删 4 行，加 4 行。
- 条目：

1. Phase A 第 3 步，选模型。
   - 原句：「Pick the worker model from the `swarm workers` line in `~/.cursor/rules/pstack-models.mdc`. If the rule or that line is missing, use [默认模型名]. [...] If the Task tool rejects a slug, use the default and say so. [...] For a model race, name each arm's model up front. Pick each subagent's reasoning level and fast or standard speed for the job, per the Subagents section of the **poteto-mode** skill.」
   - 新句：「Pick the worker model from the `swarm workers` line in `roles.md`. If the file or the line is missing, or the line is not configured, use the parent session's model. For a model race, name each arm's model up front.」
   - 原因：照替换对照第 2 条。默认模型名、auto 和 inherit-parent 的写法、slug 被拒绝的退路、推理档位建议、poteto-mode 的引用，整段删。For a model race 那句按要求保留。

2. Phase B 第一段，起 worker。
   - 原句：「Spawn all N workers in one message with `subagent_type: generalPurpose`, `environment: "cloud"`, `run_in_background: true`, and the step 3 model, left unset for `auto` or `inherit-parent`. Use `environment: "local"` only when the worker needs access to something on the user's computer.」
   - 新句：「Spawn all N workers at the same time, each as a sub-agent in its own worktree and its own container, running in the background on the step 3 model.」
   - 原因：照第 1 条。同时起 N 个、后台并行的意思保留。local 那句删。

3. Phase B 第二段，非默认分支。
   - 原句：「When a worker must start from a non-default pushed branch, pass `cloud_base_branch`.」
   - 新句：「When a worker must start from a non-default branch, start its worktree from that branch.」
   - 原因：照第 1 条。worktree 从分支起步，我判断不要求分支已推送，所以去掉 pushed。这一点没验。

4. Phase D，汇报。
   - 原句：「Return one consolidated in-chat report with a result table, issue one-liners, gaps or dropouts, and the race rule when used.」
   - 新句：「Return one consolidated report to the caller with a result table, issue one-liners, gaps or dropouts, and the race rule when used.」
   - 原因：无人值守，没有聊天窗口。交给调用方，结构不变。

- 其余句子逐字不变，包括 Every brief stands alone 起的整段和 If a worker drops out 那句。
- 与 v4 冲突：无。有一处要注意。v4 D3 写验证 agent 找到就修，swarm 原文的 worker 只报 ISSUES，不修。我没改。修的动作由 autopilot-full 的负责人做，请剧本组确认。
- 没验：见本文「没验的事」。

### skills/interrogate/SKILL.md
- 源：/tmp/pstack-cursor-1103/pstack/skills/interrogate/SKILL.md，31 行。
- 结论：改过。
- diff：删 4 行，加 10 行。
- 条目：

1. Frame，意图不清时。
   - 原句：「Ask the user when the intent is unclear.」
   - 新句：「Ask the caller when the intent is unclear. If no one can answer, record a gap and notify the operator.」
   - 原因：照第 4 条。无人值守时改问调用方，没人能答就记缺口并通知 operator。

2. Fan out，选模型。
   - 原句：「Run Phase A steps 3 and 4 and Phase B of the **arena** skill, with four changes. Read the `interrogate reviewers` line in place of `arena runners`. [...] Spawn each adversary as `generalPurpose`.」
   - 新句：「Pick the adversaries from the `interrogate reviewers` line in `roles.md`. Spawn one adversary for each model on the line. If the file or the line is missing, or the line is not configured, spawn one adversary on the parent session's model.」
   - 原因：arena 不装，不能再引用它。照第 2 条读 roles.md。roles.md 写明一行填几个模型就派几个，所以一个模型派一个。没配置时用父会话的模型。generalPurpose 按第 1 条删。

3. Fan out，输出位置。
   - 原句：「Give each candidate its own output location (a git worktree where possible, otherwise `/tmp/arena-<slug>/candidate-<n>/`), per the **separate-before-serializing-shared-state** principle skill.」「Copy the scope's uncommitted changes into each worktree.」
   - 新句：「Give each adversary its own output location (its own worktree), per the **separate-before-serializing-shared-state** principle skill. Copy the scope's uncommitted changes into each worktree.」
   - 原因：容器里每个攻击者本来就有自己的 worktree，/tmp 退路用不上。principle 技能原样复制进了 skills/，引用保留。第二句逐字保留。

4. Fan out，起子 agent。
   - 原句：「Spawn all N subagents in one message with `run_in_background: true`, each with the task, the path to the shared grounding, its own output path, and instructions to produce the artifact and a short rationale [...]」
   - 新句：「Spawn all adversaries at the same time, each as a sub-agent in its own worktree and its own container, running in the background. Give each adversary the scope, the intent, its own output path, and this brief:」
   - 原因：照第 1 条。arena 的 task、shared grounding、rationale 在 interrogate 原文里本来就被换掉，所以改成 scope、intent、输出位置加 brief。brief 引用块逐字不变，已用 diff 核对。

5. Fan out，掉线。
   - 原句：「If a candidate produces no output, proceed with N-1 and note the dropout.」
   - 新句：「If an adversary produces no output, proceed with N-1 and note the dropout.」
   - 原因：按要求逐字保留，只换主语。放在 brief 之后、Verify 之前。

6. Verify，复跑。
   - 原句：「Verify each finding per arena Phase F by rerunning its command.」
   - 新句：「Verify each finding like any other output, per the **prove-it-works** principle skill, by rerunning its command.」
   - 原因：arena Phase F 的原句是「Verify the synthesized artifact like any other output, per the **prove-it-works** principle skill.」。取其中 like any other output 和引用。synthesized artifact 在这里不适用，所以没取。principle-prove-it-works 原样复制进了 skills/。

7. Verify，跳过的阶段。
   - 原句：「Skip arena Phases C, D, and E. Adversaries find different failures, so the verdict keeps every verified finding, not one adversary's list.」
   - 新句：「Adversaries find different failures, so the verdict keeps every verified finding, not one adversary's list.」
   - 原因：arena 不装，没有 Phase C、D、E 可跳。后半句保留，它解释了为什么保留全部已验证的发现。

- Output 一节逐字不变。
- 其余句子逐字不变。
- 与 v4 冲突：无。v4 D4 写「不同模型各自去攻击，只留跑一遍能证明的问题」，做法一致。
- 没验：见本文「没验的事」。

### skills/in-your-own-words/SKILL.md
- 源：/tmp/pstack-cursor-1103/pstack/skills/in-your-own-words/SKILL.md，7 行。
- 结论：原样。
- diff：删 0 行，加 0 行。cmp 核对一致。
- 条目：无。
- 与 v4 冲突：无。
- 没验：无。

### skills/principle-separate-before-serializing-shared-state/SKILL.md
- 源：/tmp/pstack-cursor-1103/pstack/skills/principle-separate-before-serializing-shared-state/SKILL.md，16 行。
- 结论：原样。
- diff：删 0 行，加 0 行。cmp 核对一致。
- 条目：无。引用它的是 interrogate 的输出位置那句。没有 Cursor 依赖，所以复制。
- 与 v4 冲突：无。
- 没验：无。

### skills/principle-prove-it-works/SKILL.md
- 源：/tmp/pstack-cursor-1103/pstack/skills/principle-prove-it-works/SKILL.md，22 行。
- 结论：原样。
- diff：删 0 行，加 0 行。cmp 核对一致。
- 条目：无。引用它的是 interrogate 的 Verify。没有 Cursor 依赖，所以复制。它提到 show-me-your-work，该技能由剧本组写，目录已在 skills/ 下。
- 与 v4 冲突：无。
- 没验：show-me-your-work 的内容我没读，只确认目录存在。


### skills/poteto-mode/playbooks/autopilot-full.md
- 源：/tmp/pstack-cursor-1103/pstack/skills/poteto-mode/playbooks/autopilot-full.md，25 行。
- 结论：改过。开头段只改一句，步骤 1、3、7 原样。
- diff：删 8 行，加 16 行。
- 条目：
  1. 开头段的 patch-id 引用
     - 原句：「The patch-id rule in `playbooks/shipping.md` can carry a lane's result」
     - 新句：「The patch-id rule in step 5 can carry a lane's result」，段尾加「Trunk means the branch a PR lands on: the integration branch for a ticket PR, the main branch for the integration branch's own PR.」
     - 原因：shipping 步骤 3 不到 10 行，并进步骤 5。trunk 的定义取自 改写规则中的合并规则第 3 条。
  2. 步骤 2 的 forge 四句
     - 原句：「Resolve the forge once for the program. GitHub CLI (`gh`) is the default. If `command -v origin` succeeds ... Never require Graphite (`gt`).」
     - 新句：「Use `gh` for every PR operation. The `gh` token covers only the current client repo.」
     - 原因：改写规则第 3 条。origin 和 Graphite 的文字全删。
  3. 步骤 2 的 owner 句
     - 原句：「Each owner is a Cursor cloud agent that builds, opens its PR per `playbooks/opening-a-pr.md`, proves the change on the real artifact, babysits to green per `playbooks/babysit.md`, and merges once steps 4 and 5 clear it.」
     - 新句：「Each owner is a sub-agent in its own worktree and its own container that builds, writes its PR body with `/pr`, opens the PR through `gh` as ready and never as a draft, proves the change on the real artifact, waits for green CI per the CI rules below, and merges once steps 4 and 5 clear it.」后面加两句，读 `owner` 行，缺行或没配置就用父会话的模型。
     - 原因：opening-a-pr 绕开，PR 正文走 `/pr` 四栏。「开成 ready，不开 draft」取自 opening-a-pr 的 Readiness 一段，不带 origin 的写法。babysit 绕开，改指向下面新加的 CI 段（条目 7）。
  4. slop-strip 一句
     - 原句：「The code is ready only after the slop-strip (the `deslop` skill from the `cursor-team-kit` plugin (`/deslop`)) and the `/no-comments` pass」
     - 新句：「The code is ready only after the `/no-comments` pass」
     - 原因：deslop 没有对应物，只删，不补替代。改写规则第 6 条。
  5. bots 一词
     - 原句：「so CI and bots run alongside the work」
     - 新句：「so CI runs alongside the work」
     - 原因：bugbot 已去掉。
  6. merge-ready 句里的 babysit
     - 原句：「merge-ready once self-proof, CI, and babysit are done」
     - 新句：「merge-ready once self-proof and CI are done」
     - 原因：babysit 剧本不装。
  7. 新加的 CI 段，放在步骤 2 第二段
     - 原句：无，新增。内容取自 babysit 步骤 6 和 7。
     - 新句：以「Wait for green CI with `gh pr checks <pr> --watch`」开头，共 7 句。先等检查，再用 `gh pr view` 回读合并状态，再分类失败，再决定要不要重跑。
     - 原因：组长 要求把「等 CI」和「先分类失败再重试」并进引用处。
     - 三处是我自己的译法：babysit 的「one fresh build, never a job retry」写成「one fresh run of the whole workflow, never a retry of one job」。原文的「child logs」写成 `gh run view <run-id> --log-failed`。原文的「the forge agrees the PR can merge」对应 `mergeable,mergeStateStatus`。这三处没在真实仓库里跑过。
  8. 云端 VM 会死
     - 原句：「Assume the VM dies. ... in the root agent's store (path in the system prompt)」
     - 新句：「Assume the container dies. ... in the trail store named in your brief」
     - 原因：改写规则第 7 条。推送决策记录、force-push、`--force-with-lease` 那几句原样保留。
  9. 记录子 agent 的用途
     - 原句：「so the root can probe it if the parent dies」
     - 新句：「so the scheduler and the root can check it if the parent dies」
     - 原因：巡检改由 scheduler 做，它要读到这份记录。
  10. 步骤 4 的验证手段和模型
      - 原句：「through its control skill (such as `control-ui` or `control-cli` from `cursor-team-kit`) or a named driver」
      - 新句：「through the repo's `verify-<app>` skill (made by `create-verification-skill`) or a named driver」。另在 swarm 句后加「Read the `swarm workers` line in `roles.md` for their models, with the same fallback.」
      - 原因：改写规则第 6 条，control 技能全部去掉。模型按角色表 `swarm workers` 行取。
  11. 步骤 5 新加评审段
      - 原句：无，新增。
      - 新句：「The review must pass too, on the same head the swarm verified, so the owner merges only when both pass.」，读 `reviewer` 行，高风险档加 interrogate，过不了就当环境问题，停这条线，通知 operator，附现象和试过的办法。
      - 原因：v4 第六节 D5、E1 和 改写规则中的合并规则第 1 条。见「与 v4 冲突」。
  12. 步骤 5 新加 patch-id 段
      - 原句：shipping 步骤 3 整段，共 8 句。
      - 新句：除第一句外逐字保留。第一句原为「a chain rebase moves every PR above it to a new SHA」，改为「a rebase moves the PR to a new SHA」。
      - 原因：autopilot-full 开头段明确引用这条规则，所以要留住。栈不用，所以去掉 chain 和 above it。
  13. 步骤 5 新加合并者段
      - 原句：无，新增。
      - 新句：「A ticket PR whose base is the integration branch is merged by the merger sub-agent, not by its owner, and the same rules bind it.」，读 `merger` 行。最后一句：落到主干的 PR 由 owner 自己合。
      - 原因：v4 D5 和 改写规则中的合并规则第 3 条。
  14. 步骤 6 的复签人
      - 原句：「needs a verifier's proof and then your fresh countersign」
      - 新句：「needs a verifier's proof and then the operator's fresh countersign」
      - 原因：改写规则第 4 条，复签人由 root 改成 operator。
  15. 删一句
      - 原句：「Under a grant that covers approvals, that countersign is the approval, and the owner's record of it points at your countersign for a lane to check.」
      - 新句：删，不补。
      - 原因：这句说 root 的复签在授权范围内就是批准。新设定里复签的是 operator，工厂也没有「授权涵盖批准」这个说法，句子不成立。「A disabled or soft-failed check always comes out」和「Never give or bypass an approval the forge enforces」两句保留。
  16. 巡检的启动和每一圈
      - 原句：「arm `/loop 1h` to audit until no delegated work is left」和「Each tick re-reads this playbook from trunk and fixes drift ... by having its owner record it」
      - 新句：「the scheduler reconciles every 30 seconds until no delegated work is left」。加一句「The scheduler is a plain program, not an agent, so it reads side effects only: pushes, trail rows, PR state, and check results.」。每圈改为「compares every PR head and every running agent against the trail and tells you about any gap」。
      - 原因：scheduler 读不了剧本，也不能让 owner 补记录，所以改成程序做得到的版本：比对记录，发现缺口就通知 root。原文的判据整段保留：按副作用判断卡住，不看状态文字。卡住的三种情形，以及第一圈前没推送没写记录的 owner，也保留。
  17. 等回答的 agent 和收尾通知
      - 原句：「One waiting on you or the operator is not stuck, so answer it.」「ends by catching them up per the **ketchup** skill」
      - 新句：「One waiting on you or the operator is not stuck. The scheduler does not answer it. It notifies you, or the operator when only the operator can answer, and you answer what you can.」「ends with a short notice to the operator」。另加一句：scheduler 发现卡住的 agent 立刻通知 root。
      - 原因：需要判断力或需要 operator 回答的事，scheduler 只通知，不自己答。ketchup 不装，改写规则第 8 条。
  18. Reply 句
      - 原句：「catch the operator up per the **ketchup** skill, covering」
      - 新句：「report to the operator in one short notice, covering」
      - 原因：改写规则第 8 条。内容清单原样保留。不写每天早上抽样。
- 与 v4 冲突：有 1 处。原文步骤 5 只要求验证者证明过的版本才能合。v4 D5、E1 另要求评审也过。按 v4 加了评审段，评审要过的是验证队验证的同一个 head。
- 没验：
  1. `gh pr view --json mergeable,mergeStateStatus,headRefOid` 和 `gh run view --log-failed` 没在真实仓库里跑过。
  2. scheduler 能不能读到 brief 指定的 trail store，没验。
  3. roles.md 的 owner、swarm workers、reviewer、merger 四行现在都是待定，只走过回退到父会话模型这一条路。
  4. 步骤 4 保留了「the PR below it in a stack」，栈在新设定里不用。我没改，因为 组长 说步骤 4 尽量原样。

### skills/poteto-mode/playbooks/shipping.md
- 源：/tmp/pstack-cursor-1103/pstack/skills/poteto-mode/playbooks/shipping.md，12 行。
- 结论：不装。步骤 3 的 patch-id 规则并进 autopilot-full 步骤 5，见上面条目 12。
- diff：目标文件不存在。我先复制过一份，已删。
- 条目：
  1. 丢掉的步骤：步骤 1（每个 PR 一个验证者，贴 PASS、PASS+NOTES、FAIL）、步骤 2（只落地从栈底起连续的已验证一段）、步骤 4（自底向上逐个合，合并后把子 PR 改基到主干）、步骤 5（落地期间不动栈，watch-pr 的 queued 模式）、步骤 6（停在天花板）、Reply 一段。
  2. 原因：autopilot-full 步骤 3 写明各 PR 并行、不叠栈，v4 也没有栈。步骤 1 的验证职责由 autopilot-full 步骤 4 的验证队承担。
  3. 步骤 4 里「合并命令可能只是排进合并队列，所以要回读 PR」这条没并入，见没解决的问题。
- 与 v4 冲突：无。
- 没验：无。

### skills/poteto-mode/playbooks/opening-a-pr.md
- 源：/tmp/pstack-cursor-1103/pstack/skills/poteto-mode/playbooks/opening-a-pr.md，34 行。
- 结论：不装，绕开。
- diff：目标文件不存在。
- 条目：
  1. 丢掉的内容：Worktree、Commits、`/deslop` 和 `/technical-writing` 和 `/unslop` 的调用、Titles、Descriptions 六个小节、Forge、Built-in PR tool、Size and stacks、Babysit 段、子 agent 的豁免段。
  2. 留下的内容：Readiness 的「开成 ready，不开 draft」，已写进 autopilot-full 步骤 2。
  3. 原因：PR 正文改用 `/pr` 四栏，改写规则第 9 条。其余内容依赖 origin、栈、内置 PR 工具或 deslop。
- 与 v4 冲突：无。
- 没验：无。

### skills/poteto-mode/playbooks/babysit.md
- 源：/tmp/pstack-cursor-1103/pstack/skills/poteto-mode/playbooks/babysit.md，24 行。
- 结论：不装，绕开。步骤 7 和步骤 6 的核心判断并进 autopilot-full 步骤 2。
- diff：目标文件不存在。
- 条目：
  1. 留下的内容：步骤 7「先分类 CI 失败再重试，只重试一次」。步骤 6「以 forge 的合并判断为准，不看绿灯清单」。
  2. 丢掉的内容：步骤 1 的四种模式和 forge 选择。步骤 2 的合并前沿。步骤 3 的一栈一个 babysitter。步骤 4 的禁止改栈。步骤 5 的冲突、评论、CI 顺序。步骤 6 的 watch-pr 脚本、`/loop` 动态模式、READY 和 WAITING 等判定。步骤 8 的 bugbot 分诊。步骤 9 的人工界线和 rubric 回写。
  3. 原因：它依赖 watch-pr 脚本、bugbot、Origin 和栈，这些在新设定里都没有。
- 与 v4 冲突：无。
- 没验：无。

### skills/show-me-your-work/SKILL.md
- 源：/tmp/pstack-cursor-1103/pstack/skills/show-me-your-work/SKILL.md，82 行。
- 结论：改过。frontmatter 没动，`disable-model-invocation: true` 保留。
- diff：删 4 行，加 4 行。
- 条目：
  1. unslop 引用
     - 原句：「(the **unslop** skill applies to log text too)」
     - 新句：删。
     - 原因：改写规则第 11 条，不替代。
  2. encode-lessons-in-structure 引用
     - 原句：「(the **encode-lessons-in-structure** principle skill)」
     - 新句：删。
     - 原因：这个 principle 技能不在借的清单里，不装。
  3. transcript 审计
     - 原句：「Read this run's transcript under the active workspace's `agent-transcripts/` directory ... Don't glob across `~/.cursor/projects/*/`.」
     - 新句：「Read this run's transcript at the path your brief names. Read no other transcript, because that reads unrelated private chats. If the brief names no path, check the log against the git history and the PR state instead, and add a row that says the transcript audit did not run.」
     - 原因：组长 的指示。「不读别人的私聊」这层意思保留。
  4. 跨模型评审
     - 原句：「spawn a subagent on a different model family from the one that did the work.」
     - 新句：「spawn a subagent on a different model from the one that did the work. Read the `interrogate reviewers` line in `roles.md` for its model, and take one that differs from the model that did the work. If the file or the line is missing, or the line is not configured, use the parent session's model and add a row that says the independence check did not run.」
     - 原因：组长 的指示。「model family」改成「model」，因为角色表只配模型，不分族。
  5. 推理档位句
     - 原句：「Pick each subagent's reasoning level and fast or standard speed for the job, per the Subagents section of the **poteto-mode** skill.」
     - 新句：删。
     - 原因：改写规则第 2 条，推理档位和快慢档建议整段删，对 poteto-mode 的引用也删。
- 与 v4 冲突：无。
- 没验：回退到父会话模型时，「reviewed by <model>」仍要写模型名。这时评审和干活的可能是同一个模型，靠那条记录行说明。

### skills/show-me-your-work/references/decision-log-template.tsv 和 skills/show-me-your-work/scripts/log.sh
- 源：同路径，分别 1 行和 42 行。
- 结论：原样复制。
- diff：删 0 行，加 0 行。
- 与 v4 冲突：无。
- 没验：log.sh 按要求没运行。

