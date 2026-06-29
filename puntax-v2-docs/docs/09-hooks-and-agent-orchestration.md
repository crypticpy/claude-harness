# 09 — Hooks and Agent Orchestration

## Target hook flow

```text
SessionStart
  -> inject tiny project profile once
  -> recover checkpoint if resume/compaction

UserPromptSubmit
  -> puntax_context(mode=prompt, budget=300)
  -> inject only returned context

PreToolUse: Read/Grep/Glob
  -> optionally nudge to semantic_lookup/context router
  -> do not block unless tool use is pathological

PreToolUse: Edit/Write
  -> puntax_context(mode=pre_edit, budget=1200)
  -> impact_check required for non-additive edits
  -> permission governor remains authoritative

PostToolUse: all tools
  -> append event ledger entry
  -> record file/symbol access

PostToolUse: Edit/Write
  -> format-lint
  -> refresh changed file index
  -> update hot-file intelligence
  -> emit targeted tests/hints

PreCompact
  -> deterministic reducer
  -> optional LLM distillation on threshold

Stop
  -> quality gates
  -> verification
  -> checkpoint final state
```

## UserPromptSubmit policy

Do not inject all brain content.

Allowed injection:

```text
small project profile once per session
resume checkpoint after compaction
high-severity relevant memory
budget warning if near compaction
```

Not allowed by default:

```text
full session narrative
all milestones
all lessons
all hot files
large file summaries
```

## PreToolUse edit policy

Before non-additive edits:

```text
1. identify file and likely symbol
2. call/use puntax_context(mode=pre_edit)
3. ensure impact_check was run or explicitly skipped as additive/new-file
4. route permission request separately
```

## Post-edit policy

After edit:

```text
format edited file
record event
update code map for edited file
refresh hot-file intelligence if threshold met
suggest tests based on file/symbol/test memory
```

## Sub-agent policy

Keep current discipline:

```text
single-agent default
sub-agent only for independent workstreams
or bounded >10-file exploration
or explicit review command
```

When sub-agents are used, they should call `puntax_context` first and return:

```text
files read
symbols inspected
hypothesis
recommended next files/tests
no full source dumps
```

## Agent handoff payload

For sub-agent tasks, use this shape:

```markdown
Objective: <one bounded question>
Owned paths: <exclusive path set>
Do not edit outside: <paths>
Context budget: <tokens>
Required tools first: puntax_context, semantic_lookup/symbol_context as needed
Return:
- Findings
- Evidence paths/lines
- Risks
- Recommended next action
```

