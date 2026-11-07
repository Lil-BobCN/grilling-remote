---
name: grilling
description: Grill the user relentlessly about a plan, decision, or idea. Use when the user wants to stress-test their thinking, or uses any 'grill' trigger phrases.
---

## 客户模式

这个技能装在客户的工作文件夹里。对客户说日常简体中文，不要提“技能”“grilling”“wayfinder”这些词。

技术题照问，但在题旁加一句“这题偏技术，不懂就按我的推荐”。客户说不懂，就按推荐答案往下问，把这条记进 `.scratch/{需求名}/pending.md`，不要卡住。

推荐答案先联网查证，写出处。查不到就写“未核验”，把它当假设继续。

事实先自己查。查不到又不要紧的，写成假设，不要拿它卡住客户。

### 问题树

每轮提问前，先把本轮的每个问题登记进 `.scratch/{需求名}/问题树.md`，状态写 `未定`。客户答完，或记进 `pending.md` 之后，改这一行的 `当前结论` 和 `状态`。小需求和走地图的需求都登记。

文件是一张表，列是：编号、题、当前结论、出处、依赖、状态。

1. 编号按提问顺序递增，一个需求里不重复、不复用。
2. `依赖` 只写更小的编号，没有就写 `—`。
3. `状态` 只有六种：`未定`、`已答`、`客户不懂`、`待核实`、`作废`、`待补问`。
4. `题` 写短名。完整问法和客户原话留在 `出处` 指的文件里，树里不抄。
5. `当前结论` 写一句话。`客户不懂` 的写推荐答案，`待核实` 的写暂定答案。
6. 只登记要客户或运营者做决定的题。自己查得到的事实不单独成行；事实影响某个决定时，写进那个决定的 `当前结论` 或 `出处`。
7. `出处` 写文件和位置，例如 `需求草稿 第2段`、`pending.md 第1条`、`问答记录 第1轮 Q3`。`pending.md` 里的“依赖第 N 条”仍指那个文件里的条目号，树里的 `依赖` 用树的编号。
8. 每轮问答写进 `.scratch/{需求名}/问答记录.md`：按轮分节，题号用 `Q1`、`Q2`，客户原话照抄，处理另起一行。小需求不建这份，问答在 `需求草稿.md` 第 2 段。

---

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask the whole frontier in one round: number each question and give your recommended answer. Then wait for the user's answers before the next round.

Format a round like so:

```
❓ **Q1** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>

---

❓ **Q2** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>
```

Word each question so "yes" accepts your recommended answer.

Each round the user answers reshapes the tree: settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, etc.), dispatch a sub-agent with a fresh context window to find it; don't ask the user for anything you could look up yourself. Don't block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait for the sub-agent to report; ask the rest of the frontier now. The _decisions_ are the user's: put each to them and wait.

The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed. Do not act on it until the user confirms you have reached a shared understanding.
