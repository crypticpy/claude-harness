---
name: plan
description: Produce a short implementation plan before coding. Scale planning effort to task size.
model: opus
argument-hint: <task description>
---

You are planning before implementation for: $ARGUMENTS

## When to plan vs. skip

- If the task fits in ≤3 file edits with an obvious approach, skip this entire command and implement directly.
- If the task is ambiguous, affects ≥4 files, or crosses subsystem boundaries, produce a plan using the rest of this file.

If you are unsure, use `AskUserQuestion` once to clarify, then decide.

## Step 1: Understand the task

State the task in one paragraph. Call out explicit scope and what you will not touch.

## Step 2: Gather context

Read the files and symbols needed to produce the plan. Prefer the `context-layer` MCP tools (`semantic_lookup`, `symbol_context`, `impact_check`) over blanket file reads.

If the task requires understanding >10 unfamiliar files (>5 in orchestrator mode — see CLAUDE.md "Orchestrator mode"), dispatch **one** `Explore` sub-agent per independent area of the codebase (architecture, existing similar feature, test patterns). Give each a bounded question and instruct it to return file paths and a short hypothesis, not full contents. Spawn them with `model: "opus"` — never sonnet (billing bug, see CLAUDE.md "Orchestrator mode"). Do not dispatch more than 3 Explore agents for any task.

If the task only requires reading a handful of files, read them directly — do not spawn explorers.

## Step 3: Write the plan

Call `create_plan` with this structure. Keep the plan under 7 steps total.

```markdown
# Plan: <task title>

## Summary
<2 sentences: what will change, why.>

## Scope
- **In**: <bullet list>
- **Out**: <bullet list — things that look related but are not this task>

## Steps
1. <step>
2. <step>
...

## Parallel execution (only if applicable)
If ≥2 of the steps above touch disjoint files and have no data dependency, note which can run in parallel via sub-agents, one agent per step. Assign each a file set it owns exclusively. If the steps share any file, run them sequentially — do not use sub-agents.

If the task is small enough that a single agent will finish in one turn, omit this section.

## Testing
<Which tests to run or add. One line per item. Do not design a full test matrix.>

## Open questions
<Only if there are real ambiguities that require the user. If none, omit this section.>
```

Do not include: risk tables, rollback plans, workstream matrices, file-ownership matrices, time estimates, or phase review gates.

## Step 4: Confirm

After writing the plan, stop. Tell the user the plan is ready and ask them to confirm or edit. Do not begin implementation until they confirm.

When they confirm, re-read the plan (they may have edited it) and proceed.

## Rules

- Do not spawn sub-agents for tasks that would fit in one or two tool calls.
- Do not plan for features the user did not ask for.
- Do not propose future-proofing, extensibility, or scalability unless the user named it as a requirement.
- Stop condition: user confirms the plan, or the task turns out to be small enough that you skip planning entirely.
