# pstack 验证队和评审技能（Sandcastle 版）

结论：这是 pstack 的验证队和评审技能，改写成了能在 Sandcastle 容器里用的版本。不装 pstack 插件，只借它的剧本和技能原文。

## 用在哪

对应 `docs/工厂流程.md` 的 D3 验证、D4 评审、D5 合并，以及 E1 合并与抽样。第十八节「pstack 怎么接」是这个目录的来由。

## 先做一件事

填 `roles.md`。每个角色的 agent 和模型现在都是「待定」。没填时，技能用父会话的模型。

## 入口

`skills/poteto-mode/` 下没有 `SKILL.md`，所以没有东西会自动加载剧本。调度器给负责人的 brief 里，直接写剧本路径 `skills/poteto-mode/playbooks/autopilot-full.md`。

这些技能都带 `disable-model-invocation: true`。模型不会自己调，brief 里要点名。无头模式下能不能点名调用，没验。

英文正文里的 operator 指运营者，也就是跑这座工厂的人。

## 里面有什么

七项改写：

1. `skills/poteto-mode/playbooks/autopilot-full.md`：一个负责人从做到合一个 PR。验证队没写过这份代码。
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

调度器是普通程序，每 30 秒对账一次。它按推送、记录行、PR 状态、检查结果判断 agent 有没有卡住。agent 自己写的状态文字不作数。

## 合并规则

以 v4 为准。验证队和评审都过了，负责人自己合。过不了，停这条线，通知运营者，附现象和试过的办法。

只合验证者证明过的版本。绿灯 CI 本身不放行。

抽样看是运营者每天早上的事，这些技能里没有。

## 用 gh

PR 操作只用 `gh`。令牌只限当前客户仓。PR 正文按 `/pr` 的四栏写。`/pr` 来自上游 mattpocock-skills，不在这个目录里。

## 英文正文

技能和剧本正文保留英文原文。改了哪里、为什么改、和原文差几行，见 `CHANGES.md`。

## 没验的事

1. 容器里能不能并行跑。
2. 子 agent 能不能读到 `roles.md`。
3. `/pr` 在容器里能不能找到。

完整清单见 `CHANGES.md`。

## 许可

MIT，版权 Lauren Tan。见 `LICENSE` 和 `NOTICE.md`。
