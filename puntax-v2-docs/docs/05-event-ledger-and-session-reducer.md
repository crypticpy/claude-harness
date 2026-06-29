# 05 — Event Ledger and Session Reducer

## Goal

Replace routine LLM transcript summarization with deterministic event capture and checkpoint reduction.

## Why

The current `precompact-llm.mjs` reads a large transcript slice and asks an LLM to produce memory and diagnosis. This is useful but expensive. Most events are already structured or can be cheaply structured.

## Event ledger

The event ledger is append-only. It records operational facts:

```text
tool calls
edits
file reads
symbol lookups
permission decisions
test runs
lint/typecheck results
errors
decisions
memory writes
checkpoints
```

See `schemas/event.schema.json`.

## Minimal event fields

```json
{
  "id": "evt_...",
  "sessionId": "...",
  "ts": "2026-06-29T12:00:00.000Z",
  "kind": "edit",
  "tool": "Edit",
  "projectDir": "/repo",
  "files": ["src/foo.ts"],
  "symbols": ["FooService.handle"],
  "outcome": "ok",
  "summary": "Edited FooService.handle",
  "evidence": { "diffHash": "..." }
}
```

## Reducer

The reducer reads events since the last checkpoint and writes a deterministic checkpoint.

Checkpoint fields:

```json
{
  "sessionId": "...",
  "checkpointIndex": 4,
  "goal": "...",
  "workingFiles": [],
  "changedFiles": [],
  "symbolsTouched": [],
  "testsRun": [],
  "failures": [],
  "decisions": [],
  "openLoops": [],
  "nextActions": [],
  "risk": "low"
}
```

## Signals retained from v1

Keep the useful signals already computed in `precompact-llm.mjs`:

```text
totalTurns
totalToolCalls
toolErrors
retryPatterns
explorationSpirals
contextSwitches
permissionDenials
errorMessages
```

But use them first to produce deterministic diagnosis.

## LLM distillation thresholds

Only call an LLM if one or more thresholds trigger:

```text
high-severity error occurred
permission denial repeated
retryPatterns >= 2
explorationSpirals >= 1
changedFiles >= 6
toolErrors >= 3
user explicitly requests /evolve or /retrospective
manual memory cleanup requested
```

## Precompact behavior

Default:

```text
PreCompact
  -> read event ledger
  -> produce checkpoint
  -> write checkpoints.jsonl
  -> no LLM
```

Threshold-triggered:

```text
PreCompact
  -> produce deterministic checkpoint
  -> call distill-precompact.mjs with checkpoint + selected evidence only
  -> write typed memory proposals
```

## Migration from rolling log

Current `rolling-log.mjs` entries can seed the event ledger. Do not remove rolling logs immediately. Add an event writer and mirror tool events into the ledger.

## Acceptance criteria

- Routine precompact runs without LLM.
- Checkpoints preserve working files and open loops.
- Corrupted events do not crash hooks.
- Event ledger can be replayed into a checkpoint.
- LLM distillation can be disabled globally.

