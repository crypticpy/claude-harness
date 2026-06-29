# ADR 0001 — Deterministic-First Memory

## Status

Proposed.

## Context

The current harness uses LLM calls at compaction time to produce narrative memory and trace diagnosis. This preserves continuity but costs tokens and depends on model interpretation.

## Decision

PUNTAX v2 will use deterministic event capture and session reduction as the default memory mechanism. LLM distillation becomes optional and threshold-triggered.

## Consequences

Positive:

- Lower routine token burn.
- More auditable memory.
- Better resilience without API keys.
- Easier testing.

Negative:

- Less nuanced narrative memory by default.
- Requires event schema and reducer implementation.

## Implementation notes

- Keep `precompact-llm.mjs` but demote it to `distill-precompact.mjs` or equivalent.
- Add `precompact-reducer.mjs` as default.
- Preserve existing memory reads during migration.

