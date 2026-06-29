# ADR 0004 — Context Router as Primary Tool

## Status

Proposed.

## Context

The current harness injects multiple context blocks at prompt time. This can waste tokens when the prompt does not need persistent memory.

## Decision

PUNTAX v2 introduces `puntax_context` as the primary MCP tool and hook entrypoint for budget-aware context construction.

## Consequences

Positive:

- Reduces default prompt injection.
- Gives agents one obvious context entrypoint.
- Makes context budgets explicit.

Negative:

- Requires ranking logic.
- Early v0 may miss useful context until tuned.

## Implementation notes

- Start with existing brain files and hot files.
- Add event ledger/checkpoints as sources in phase 2.
- Add code map as source in phase 3.

