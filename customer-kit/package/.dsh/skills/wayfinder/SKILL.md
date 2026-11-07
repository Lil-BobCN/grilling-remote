---
name: wayfinder
description: Plan a huge chunk of work (more than one agent session can hold) as a shared map of decision tickets on your issue tracker, and resolve them one at a time until the way to the destination is clear.
---

A loose idea has arrived, too big for one agent session, and wrapped in fog: the way from here to the **destination** isn't visible yet. Wayfinding is about finding that way, not charging at the destination. This skill charts the way as a **shared map** on the repo's issue tracker, then works its **decision tickets** (questions whose resolution is a decision, not slices of a build to execute) one at a time until the route is clear.

In the customer workspace the tracker is local Markdown, with no GitHub and no git. Where this skill says issue, close, assignee, or comment, follow `docs/agents/issue-tracker.md` → "Wayfinder 用法" for the file equivalent.

The destination varies per effort, and naming it is the first act of charting: it shapes every ticket. It might be a spec to hand off and iterate on, a decision to lock before planning starts, or a change made in place like a data-structure migration. The map is domain-agnostic: engineering work, course content, whatever fits the shape.

## Plan, don't do

Wayfinder is **planning** by default: each ticket resolves a decision, and the map is done when the way is clear, with nothing left to decide before someone goes and does the thing. The pull to just do the work is usually the signal you've reached the edge of the map and it's time to hand off. An effort can override this in its **Notes**, carrying execution into the map itself, but absent that, produce decisions, not deliverables.

## Refer by name

Every map and ticket is an issue, so it has a **name**: its title. In everything the human reads (narration, the map's Decisions-so-far), refer to it by that name, never by a bare id, number, or slug. A wall of `#42, #43, #44` is illegible; names read at a glance. The id and URL don't vanish; a name wraps its link, but they ride _inside_ the name, never stand in for it.

## The Map

The map is a single issue on this repo's issue tracker, labelled `wayfinder:map`, the canonical artifact. Its tickets are child issues of the map.

The map is an **index**, not a store. It lists the decisions made and points at the tickets that hold their detail; a decision lives in exactly one place, its ticket, so the map never restates it, only gists it and links.

**Where the map, its child tickets, blocking, and frontier queries physically live is tracker-specific.** The issue tracker should have been provided to you. In the customer workspace it is `docs/agents/issue-tracker.md`. Consult the tracker doc's "Wayfinder 用法" section for how _this_ repo expresses them. If no tracker has been provided, default to the local-markdown tracker.

### The map body

The whole map at low resolution, loaded once per session. In the customer workspace the **接下来** section lists the open tickets in the order the customer chose, and the ticket files hold the detail. In a tracker with queries, open tickets are not listed and are found by query.

```markdown
## Destination

<what reaching the end of this map looks like: the spec, decision, or change this effort is finding its way to. One or two lines; every session orients to it before choosing a ticket.>

## Notes

<domain; skills every session should consult; standing preferences for this effort>

## 接下来

<!-- customer workspace only: the open tickets in the order the customer chose, one line each: number, title, how it will be done, and "(等 NN 做完)" if blocked. wrap-up removes the line once the ticket is resolved. -->

- NN <ticket title> —— <how this one will be done, in one line>

## Decisions so far

<!-- the index: one line per closed ticket, enough to judge relevance, then zoom the link for the detail the ticket holds -->

- [<closed ticket title>](link): <one-line gist of the answer>

## Not yet specified

<!-- see "Fog of war": in-scope fog you can't ticket yet; graduates as the frontier advances -->

## Out of scope

<!-- see "Out of scope": work ruled beyond the destination; closed, never graduates -->
```

### Tickets

Each ticket is a **child issue** of the map; the tracker's issue id is its identity. Its body is the question, sized to one 100K token agent session:

```markdown
## Question

<the decision or investigation this ticket resolves>
```

Each ticket carries a `wayfinder:<type>` label, one of `research`, `prototype`, `grilling`, `task` (see [Ticket Types](#ticket-types)). In the customer workspace there are no labels: the type is the `Type:` line at the top of the ticket file, and the file has the headings `## Question`, `## 评论`, `## 结论` (skeleton in `docs/agents/issue-tracker.md`). `wayfinder:` labels are the only labels a map and its tickets carry, never a triage label like `ready-for-agent`: they are decisions, not implementation work.

A session **claims** a ticket by assigning it to the dev driving the map, **first**, before any work, so concurrent sessions skip it. That assignee _is_ the claim: an open, unassigned ticket is unclaimed.

Blocking uses the tracker's **native** dependency relationship: essential because it renders the frontier _visually_ in the tracker's own UI, so the human sees what's takeable without opening the map. Only a tracker that lacks native blocking falls back to a body convention. A ticket is **unblocked** when every ticket blocking it is closed; the **frontier** is the open, unblocked, unclaimed children, the edge of the known.

The answer isn't part of the body; it's recorded on resolution (see [Work through the map](#work-through-the-map)). Assets created while resolving a ticket are linked from the issue, not pasted in.

## Ticket Types

Every ticket is either **HITL** (human in the loop, worked _with_ a human who speaks for themselves) or **AFK**, driven by the agent alone. A HITL ticket only resolves through that live exchange; the agent never stands in for the human's side of it (a grilling agent that answers its own questions has broken this).

- **Research** (AFK): Reading documentation, third-party APIs, or local resources like knowledge bases to surface a fact a decision waits on. Resolved by a subagent that calls the Skill tool with "research". Use when knowledge outside the current working directory is required.
- **Prototype** (HITL): Raise the fidelity of the discussion by making a cheap, rough, concrete artifact to react to (an outline, a rough take, a stub, or UI/logic code) by calling the Skill tool with "prototype". Links the prototype as an asset. Use when "how should it look" or "how should it behave" is the key question. In the customer workspace, if the customer asks for a prototype but the map has no prototype ticket yet, gently tell them it can't be done yet and finish the current question first. Do not create a ticket on the spot and do not build one now. If they insist, follow the skip-step rule in `AGENTS.md`: after the third time they still insist, do it as they ask and note it. Do not hand off to a human for this.
- **Grilling** (HITL): Conversation. The default case. Always call the Skill tool twice, for "grilling" and "domain-modeling".
- **Task** (HITL or AFK): Manual work that must happen before a _decision_ can be made: nothing to decide, prototype, or research, but the discussion is blocked until it's done. Signing up for a service so its API can be judged, provisioning access, moving data so its shape can be seen. This is the one type that _does_ rather than decides, and it earns its place by unblocking a decision, not by delivering the destination. The agent drives it alone where it can (AFK); otherwise it hands the human a precise checklist (HITL). Resolved when the work is done; the answer records what was done and any resulting facts (credentials location, new URLs, row counts) later tickets depend on. In the customer workspace, if the customer says they can't do it or won't, reassure them and walk them through the steps one at a time. Only hand off to a human when they still can't after that.

## Fog of war

The map is _deliberately_ incomplete: don't chart what you can't yet see. Beyond the live tickets lies the **fog of war**: the dim view of decisions and investigations you can tell are coming but can't yet pin down, because they hang on questions still open. Resolving a ticket clears the fog ahead of it, graduating whatever's now specifiable into fresh tickets, one at a time, until the way to the destination is clear and no tickets remain.

The map's **Not yet specified** section is where that dim view is written down: the suspected question, the area to revisit later. It's the undiscovered frontier _toward_ the destination: everything here is in scope, just not sharp enough to ticket. Write as loosely or as fully as the view allows; it doubles as a signpost for collaborators reading where the effort is headed.

**Fog or ticket?** The test is whether you can state the question precisely now, _not_ whether you can answer it now.

- **Ticket when** the question is already sharp, even if it's blocked and you can't act on it yet.
- **Not yet specified when** you can't yet phrase it that sharply. Don't pre-slice the fog into ticket-sized pieces: it's coarser than a ticket, and one patch may graduate into several tickets, or none, once the frontier reaches it.

**Not yet specified** excludes what's already decided (Decisions so far), what's already a live ticket, and what's out of scope (the next section).

## Out of scope

Fog only ever gathers _toward_ the destination. The destination fixes the scope, so work beyond it is **out of scope**: it isn't fog, and it doesn't belong in **Not yet specified**. It gets its own **Out of scope** section on the map: work you've consciously ruled out of _this_ effort. Scope, not sharpness, lands it here.

Out-of-scope work never graduates (the frontier stops at the destination), so it returns only if the destination is redrawn, and then as a fresh effort, not a resumption.

Ruling something out of scope is a scoping act, not a step on the route. When a ticket that already exists turns out to sit past the destination (mis-scoped in while charting, or exposed by a resolution), **close it** (a closed ticket is unambiguously off the frontier) and leave one line in the **Out of scope** section: the gist plus why it's out of scope, linking the closed ticket. It stays out of **Decisions so far**, which records the route actually walked; a scope boundary isn't a step on it.

## Invocation

Two modes. Either way, **never resolve more than one ticket per session**, with the exception of research tickets.

### Chart the map

User invokes with a loose idea.

1. **Name the destination.** Call the Skill tool twice, for "grilling" and "domain-modeling", to pin down what this map is finding its way to: the spec, decision, or change. The destination fixes the scope, so it's settled first.
2. **Map the frontier.** Grill again, **breadth-first** this time: fan out across the whole space rather than deep on any one thread, surfacing the open decisions and the first steps takeable now. **If this surfaces no fog** (the way to the destination is already clear, the whole journey small enough for one session), you don't need a map. Stop and ask the user how they'd like to proceed.
3. **Create the map** (label `wayfinder:map`): Destination and Notes filled in, Decisions-so-far empty, the fog sketched into **Not yet specified**. In the customer workspace the map has six sections, and **接下来** is filled in after the customer has chosen the order.
4. **Create the tickets you can specify now** (in the customer workspace, say the second opening at the end of this file first) as child issues of the map, then wire blocking edges in a **second pass** (issues need ids before they can reference each other). Write cross-references in that pass too, with real ids: a placeholder `#<n>` auto-links to an unrelated issue. Wiring sorts them into the frontier and the blocked; everything you can't yet specify stays in the fog: the **Not yet specified** section.
5. **Fire the research subagents.** For each `research` ticket you just created, spin up a subagent with a fresh context window that calls the Skill tool with "research" to resolve it in parallel. In the customer workspace, write its findings to `.scratch/{需求名}/research/<name>.md` and leave a context pointer in the ticket's `## 结论`. Don't create a branch, don't push, don't open a PR.
6. In the customer workspace, show the customer the list: how many tickets, what each one does, in what order. Ask which should go first, and write the answer into **接下来** as the line order. Then use the `next` skill to name the first ticket and give the line to copy. Charting is one session's work; it hand-resolves nothing.

### Work through the map

User invokes with a map (URL or number). A ticket is **optional**: without one, you pick the next decision, not the user.

1. Load the **map**: the low-res view, not every ticket body.
2. Choose the ticket. If the user named one, use it. Otherwise take the first frontier ticket in order. **Claim it**: assign it to yourself before any work. In the customer workspace, the `next` skill chooses (it reads **接下来** in line order, not ticket numbers), and claiming means setting `Status: claimed`. Then say the opening line for the ticket (see the end of this file).
3. Resolve it as the type named on its `Type:` line (see [Ticket Types](#ticket-types)). In the customer workspace the type is that line at the top of the ticket file, not a label. **Zoom as needed**: fetch the full body of any related or closed ticket on demand; call the Skill tool for whichever skills the `## Notes` block names. If in doubt, call the Skill tool twice, for "grilling" and "domain-modeling".
4. Record the resolution: post the answer as a **resolution comment**, **close** the issue, and **append a context pointer** to the map's Decisions-so-far. In the customer workspace: run `map-gate` first, then write the answer under `## 结论`, add the line `产出文件：<relative path>` (or `无`), set `Status: resolved`, and add one line to Decisions so far. `wrap-up` then checks **接下来** and removes the line.
5. Add newly-surfaced tickets (create-then-wire); graduate any fog the answer has made specifiable, clearing each graduated patch from **Not yet specified** so it lives only as its new ticket. If the answer reveals that a ticket (this one or another) sits beyond the destination, **rule it out of scope** rather than resolving it on the route. If the decision invalidates other parts of the map, update or delete those tickets.

The user may run unblocked tickets in parallel, so expect other sessions to be editing the tracker concurrently.

## 客户工作区：第二段开场词和开工第一句

只在客户工作区用。对客户不说技能名。

### 第二段开场词

终点定完、拆票之前说。

> 终点定了。接下来我把它拆成一张一张的议题，一张议题代表一个任务。这些任务都做完，你要的东西就做成了。
>
> 一张议题就是一次对话，只定这一件事。这张做完，我提醒你新开一个对话，把我给你的那一行原样复制过来，接着下一张。
>
> 拆完我把清单给你看：一共几张、每张做什么、按什么顺序做。哪张要先做，你说，我按你说的排。
>
> 每张开头会写一句，这次是聊、看个样子、动手做，还是我去查。
>
> 这个做法最怕三件事，我提前说：
>
> 一，在一张议题里聊另一张的事。想到了就先说一声，我记到那张去，这张先做完。
>
> 二，说着说着拐到别处。拐了就拐了，你照说，我记下来，再拉回来。
>
> 三，在后面的议题里改前面已经定过的事。要改就说，我去改当初那一张，在地图上记一笔，不在新议题里悄悄改。
>
> 进度我写在这个文件夹里，你不用打开，也不用改。想改什么直接跟我说。

### 开工第一句

每张票开工时说一句，按 `Type:` 选。

| `Type:` | 对客户说 |
| --- | --- |
| `grilling` | 这张是 <编号>，要定的是 <一句话>。我一轮列出几个问题，每个带我的推荐答案，你自己答。 |
| `prototype` | 这张是 <编号>，要定的是 <一句话>。我先做个样子给你看，你看着改。 |
| `research` | 这张是 <编号>，要定的是 <一句话>。这个我去查，查完告诉你。 |
| `task` | 这张是 <编号>，要做的是 <一句话>。我带你一步一步做。 |
