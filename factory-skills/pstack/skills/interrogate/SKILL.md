---
name: interrogate
description: "Use for \"interrogate\", \"adversarial review\", \"multi-model review\", \"challenge this\", \"stress test this code\", \"find blind spots\", or \"tear this apart\". Adversaries try to break a change or design, and only findings proven by a run survive."
disable-model-invocation: true
---

# Interrogate

Adversaries try to break a change or a design. A finding survives only when a run proves it. Report the findings. Do not apply fixes.

## Frame

The scope is what the user names. Otherwise it is the branch diff from its merge base with the base branch, through the working tree. State the intent with the **in-your-own-words** skill, from the user's message, the commits, and the PR description. Ask the caller when the intent is unclear. If no one can answer, record a gap and notify the operator.

## Fan out

Pick the adversaries from the `interrogate reviewers` line in `roles.md`. Spawn one adversary for each model on the line. If the file or the line is missing, or the line is not configured, spawn one adversary on the parent session's model.

Give each adversary its own output location (its own worktree), per the **separate-before-serializing-shared-state** principle skill. Copy the scope's uncommitted changes into each worktree.

Spawn all adversaries at the same time, each as a sub-agent in its own worktree and its own container, running in the background. Give each adversary the scope, the intent, its own output path, and this brief:

> Break this change. Prove each finding with a run against the real code, such as a failing test, a repro script, or command output that shows the wrong behavior. For a design or plan, run a prototype or probe the current tree. Keep repros in your own worktree. Report each finding with a title, the exact command, the output it printed, and the output the intent requires. Leave out anything you did not run. That covers style, naming, structure, and risks that need a future change to matter. No findings is a valid result.

If an adversary produces no output, proceed with N-1 and note the dropout.

## Verify

Verify each finding like any other output, per the **prove-it-works** principle skill, by rerunning its command. Keep a finding when the output shows the failure and the failure breaks the intent. Drop the rest. Merge findings that share a root cause.

Adversaries find different failures, so the verdict keeps every verified finding, not one adversary's list.

## Output

- **Intent**: the restatement.
- **Findings**: for each verified finding, the command, its output, how it breaks the intent, and the adversaries that found it. Say "no verified findings" when none survive.
- **Dropped**: for each adversary, the count of dropped findings and why.
