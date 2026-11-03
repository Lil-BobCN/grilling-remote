---
name: to-questionnaire
description: Turn a decision the customer can't fully answer into a questionnaire for a third person, written as data for a one-time web page.
disable-model-invocation: true
---

Turn something the user can't answer alone into a **questionnaire** for one other person to fill in. The recipient holds knowledge the user lacks; the questionnaire pulls it out of them.

Here the user is the customer. The recipient is a third person, such as a partner, an accountant, or a friend who knows the tech. The platform shows the questionnaire to the recipient on a one-time web page. You do not make the link and you do not send anything.

**Grill the send, not the subject.** Interview the user only about the _send_, which they can always answer: who it goes to, and what they need back. The questions in the questionnaire then target the **gap** between what the recipient knows and what the user needs.

1. **Who is it going to?** Ask, in one exchange, the recipient's role, expertise, and relationship to the user. This fixes the questionnaire's tone and how much context it must carry. Done when you know who the recipient is and what they know that the user doesn't.

2. **What do you need back?** Ask, in one exchange, the specific decisions or facts the user can't resolve alone and needs from this person. Done when you have a concrete list of what the user must walk away able to do or decide.

3. **Write the questionnaire.** Draft questions aimed at the gap from steps 1 and 2. Write it as JSON to `questionnaire.json` in the current directory, which is the session directory, and report the path. Done when the file exists and every item the user named in step 2 is covered by a question.

Order questions most-important-first, since async means you may only get one pass. Group them under section headings by theme once there are more than a handful. Every question is one idea, never compound. Add a one-line _why this matters_ only where the question could be misread or invite a throwaway answer.

## 网页版附加规则

下面是我们加的，原文没有。原文在 `factory-skills/clarify/original/to-questionnaire.md`，一个字没改。原文输出 Markdown 文件，网页版改成输出 JSON。其余做法照原文。

1. 全程用中文。问客户的两个访谈问题用人话，不出现技术词。问卷里的题，按对方的身份和行话来写。
2. 访谈两问各问一次。每问带推荐答案，措辞让答「是」就等于接受。
3. 不写 Markdown，不写 `to-questionnaire-*.md`。只写 `questionnaire.json`，不写别的文件。
4. 字段如下。这是草案，来自地图 #16，要在 #16 里验。

```json
{
  "title": "问卷标题",
  "purpose": "一句话：为什么问，答案用来定什么。",
  "from": "客户的称呼",
  "to": "对方的称呼和角色",
  "context": "给没参与过的人看的一段背景，不超过 120 字。",
  "how_to_answer": "大约几分钟。说不准就选「不确定」，不要跳过。",
  "sections": [
    {
      "heading": "主题",
      "questions": [
        {"id": "T1", "title": "只问一件事的问题", "why": null, "kind": "text"}
      ]
    }
  ],
  "closing": "还有什么我们没问到、但你觉得应该知道的？"
}
```

5. `from` 和 `to` 只写称呼和角色。不写手机号、邮箱、身份证这类个人信息。
6. 只问被转过来的那几题。对方看不到客户的其他答案。`context` 里不要带客户的价格、成本这类内容，除非客户在第 2 问里明说要给对方看。
7. 收到回答后，只把答案并回原来的待问清单，对应的题标为已答。不要重新访谈。
