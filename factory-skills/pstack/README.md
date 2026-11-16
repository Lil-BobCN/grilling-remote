# pstack 验证队和评审技能（Sandcastle 版）

结论：这是 pstack 的验证队和评审技能，改写成了能在 Sandcastle 容器里用的版本。不装 pstack 插件，只借它的剧本和技能原文。

## 用在哪

对应 `docs/工厂流程.md` 的 D3 验证、D4 评审、D5 合并，以及 E1 合并与抽样。第十八节「pstack 怎么接」是这个目录的来由。

## 先做一件事

读 `roles.md`。十个角色的 agent 和模型已经填好，统一用 Claude Code 和 DeepSeek Flash。空格子用父会话的模型。角色表怎么读、回退怎么算，见 `roles.md` 开头。

## 入口

`skills/poteto-mode/` 下没有 `SKILL.md`，所以没有东西会自动加载剧本。调度器给实现者（owner）的 brief 里，直接写剧本路径 `skills/poteto-mode/playbooks/autopilot-full.md`。

这些技能都带 `disable-model-invocation: true`。模型不会自己调，brief 里要点名。无头模式下能不能点名调用，没验。

英文正文里的 operator 指运营者，也就是跑这座工厂的人。

## 里面有什么

七项改写：

1. `skills/poteto-mode/playbooks/autopilot-full.md`：一个实现者从做到合一个 PR。验证队没写过这份代码。
2. `skills/swarm`：同时起 N 个子 agent，各自验证，汇总成一份报告。
3. `skills/interrogate`：不同模型各自攻击这份改动，只留跑一遍能证明的问题。
4. `skills/blast-radius`：找出改动在别处会弄坏什么，并用运行证明那一条关键事实。
5. `skills/create-verification-skill`：给客户仓生成 `verify-<app>` 验证技能和功能地图。
6. `skills/correct`：把 agent 反复犯的错，改成仓库里的检查。
7. `skills/no-comments`：派一个子 agent 清注释，再修它报出的问题。

因为这七项引用而一并带上的文件：

1. `agents/comment-sicko.md`：`no-comments` 要派它。
2. `skills/show-me-your-work`：`autopilot-full` 用它记决策。
3. `skills/in-your-own-words`：`interrogate` 引用。
4. `skills/principle-prove-it-works` 和 `skills/principle-separate-before-serializing-shared-state`：`interrogate` 引用。
5. `skills/principle-fix-root-causes` 和 `skills/principle-redesign-from-first-principles`：`no-comments` 引用。

不装的有 arena、shipping、opening-a-pr、babysit、ketchup 等。取舍和原因见 `CHANGES.md`。

## 容器里怎么跑

每个子 agent 一个 worktree（工作树）、一个容器。容器会死，所以决策记录要随时推送。

容器要的凭证、客户仓的技能目录、主机 agent 的权限，见 `docs/工厂流程.md` 的「执行侧：角色、权限和工具」一节。

trail store 固定在票分支的 `.audit/<票号>.tsv`，随分支推送。需要运营者拍板的记录写成 `phase=gate` 的行：问的行 `result=open`，答的行 `result=answered`，运营者说先搁置写 `parked`。共享的 gate 行由实现者写，验证者只把问题报给实现者。

调度器是普通程序，每 30 秒对账一次。它按推送、记录行、PR 状态、检查结果判断 agent 有没有卡住。记录行就是 `.audit/<票号>.tsv` 里的行。一条等运营者的 `open` 行不算卡住。agent 自己写的状态文字不作数。

## 合并规则

以 v4 为准。验证者只报问题，实现者修，原验证者复验。验证队和评审都过了，实现者自己合。过不了，停这条线，通知运营者，附现象和试过的办法。

只合验证者证明过的版本。绿灯 CI 本身不放行。

抽样看是运营者每天早上的事，这些技能里没有。

## 用 gh

PR 操作只用 `gh`。令牌只限当前客户仓。PR 正文按 `/pr` 的四栏写。`/pr` 来自上游 mattpocock-skills，不在这个目录里。

## 英文正文

技能和剧本正文保留英文原文。改了哪里、为什么改、和原文差几行，见 `CHANGES.md`。

## 没验的事

1. 容器里能不能并行跑。
2. 子 agent 能不能从 `.claude/skills/` 里的技能读到 `factory-skills/pstack/roles.md`。
3. `/pr` 在容器里能不能找到。
4. 调度器读 trail store 的实测归调度器实现票（to-spec），验收条件见 `docs/通知.md`。

完整清单见 `CHANGES.md`。

## 许可

MIT，版权 Lauren Tan。见 `LICENSE` 和 `NOTICE.md`。
