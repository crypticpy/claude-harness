# ADR 0002 — Permission Governor Separation

## Status

Proposed.

## Context

The current harness uses `cf-approve` for permission requests. PUNTAX v2 adds memory, context routing, and possible auto-accrual of safe permissions.

## Decision

Permission policy remains separate from memory/context routing. Memory may produce candidate rule suggestions, but active permission rules require deterministic validation or explicit user approval.

## Consequences

Positive:

- Prevents context poisoning from changing safety policy.
- Keeps user trust in the harness.
- Makes permission decisions auditable.

Negative:

- More modules to maintain.
- Candidate promotion flow requires careful UI/command design.

## Implementation notes

- Log every permission decision as an event.
- Candidate rules are inactive by default.
- Destructive operations never auto-promote.

