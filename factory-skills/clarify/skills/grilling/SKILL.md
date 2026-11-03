---
name: grilling
description: Grill the customer relentlessly about what they want built, in rounds, in plain Chinese. Web version of the mattpocock-skills grilling skill, used by the web agent for order intake.
---

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask the whole frontier in one round: number each question and give your recommended answer. Then wait for the user's answers before the next round.

Word each question so "yes" accepts your recommended answer.

Each round the user answers reshapes the tree: settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, etc.), dispatch a sub-agent to find it; don't ask the user for anything you could look up yourself. Don't block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait for the sub-agent to report; ask the rest of the frontier now. The _decisions_ are the user's: put each to them and wait.

The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed. Do not act on it until the user confirms you have reached a shared understanding.

## 网页版附加规则

下面是我们加的，原文没有。原文留在上面，一个字没改，只把输出格式那一段换成了下面的第 3 条。

1. **对面是客户。** 客户不懂技术。全程用中文人话。第 1 段一个技术词都不出现。第 3 段的技术后果也用人话写，并带推荐。
2. **每题标明谁答。** `who` 取三个值：`customer` 客户答，`customer_lean` 客户给倾向、运营者最后定，`operator` 运营者答。`operator` 的题不会上客户屏幕。事实不问任何人，写进 `facts_pending`，由 agent 去查。
3. **每轮只输出一段 JSON。** 前后不加别的字。下面是草案。字段来自地图 #16 第 1 问，是推断，要在 #16 里验。

```json
{
  "round": 1,
  "segment": 1,
  "questions": [
    {
      "id": "Q1",
      "title": "题目",
      "body": "题干，可以多段。",
      "options": ["选项一", "选项二", "选项三"],
      "recommended": 0,
      "who": "customer",
      "diagram": null
    }
  ],
  "facts_pending": [],
  "frontier_empty": false,
  "summary": null
}
```

   - `options` 放 3 到 5 个选项。`recommended` 是推荐项的序号，从 0 数起。前端会另外加「我自己说」。
   - 措辞要让答「是」就等于接受推荐。
   - 推荐值里有具体数字时，要在 `body` 里写明这是默认值，例如「先按每个时段 10 单算，你可以改」。不要把编出来的数字当成客户说过的话。
   - `diagram` 先填 `null`。示意图有哪几种、怎么画，由 #16 定，不要自己发明。
   - 待问清单为空时，`questions` 填空数组，`frontier_empty` 填 `true`，并在 `summary` 里写整单汇总，让客户确认。
4. **客户没动的题，按推荐算，不再重问。** 客户改了一个答案，只重算受它影响的题。前提作废的题，在 `body` 里说明作废了。
5. **词汇表放在会话目录的 `GLOSSARY.md`。** 客户用了新词就记进去，重讲时用它。接单阶段还没有客户仓，所以不用仓库里的那份。
6. **不替客户做决定，也不往下做。** 问完只汇总。客户点头之前，不写 spec，不建单。
