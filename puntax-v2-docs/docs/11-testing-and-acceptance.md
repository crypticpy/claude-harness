# 11 — Testing and Acceptance Criteria

## Test philosophy

Test deterministic components heavily. Avoid LLM calls in tests.

## Unit tests

### Context router

- returns empty/minimal context for irrelevant prompt
- ranks high-severity relevant memory above low-severity memory
- respects budgetTokens
- includes source IDs
- degrades when memory files are missing/corrupted

### Event ledger

- appends valid events
- rejects or sanitizes invalid events
- reads events by session/project/file
- handles corrupted JSONL lines
- creates stable event IDs

### Session reducer

- computes working files from events
- computes changed files from edit events
- records failures from error events
- identifies open loops
- does not call LLM by default

### Permission governor

- denies destructive auto-accrual
- creates candidate only after repeated safe approvals
- never activates LLM-proposed rules
- logs decisions
- handles unknown actions as ask/escalate

### Code map

- indexes files and symbols
- detects stale file hashes
- resolves file summaries from index
- falls back when index is stale/missing
- impact_check uses indexed edges when present

## Integration tests

- MCP `tools/list` includes expected tools.
- MCP `tools/call` for `puntax_context` returns compact context.
- Hook modules import successfully under Node 20+.
- Post-edit flow records event and updates changed file index.
- Precompact deterministic mode writes checkpoint with no LLM key.

## Regression tests

- Existing `semantic_lookup` still works.
- Existing `brain_search` still works.
- Existing settings template remains valid JSON.
- Existing install script does not fail if optional components are absent.

## Acceptance criteria by phase

### Phase 1

- Routine prompt injection reduced.
- `puntax_context` v0 works from existing brain files.
- Precompact can run deterministic mode without LLM.

### Phase 2

- Tool/edit/permission events are written to event ledger.
- Checkpoints can reconstruct session state.
- `what_changed` can read from events.

### Phase 3

- Active indexer writes real file/symbol rows.
- `impact_check` can use code-map edges.
- Staleness is detected.

### Phase 4

- Permission decisions are audited.
- Candidate rule accrual works safely.
- Risky commands never auto-promote.

### Phase 5

- LLM distillation is threshold-based.
- Distilled memory is labeled lower confidence.
- Retrospective uses checkpoints/events before raw transcript.

