# 07 — Typed Memory Model

## Goal

Convert project memory from broad narrative summaries into typed, queryable, provenance-backed records.

## Current v1 memory files

```text
lessons.jsonl
conventions.json
file-insights.json
hot-files.json
user-prefs.json
session-memory JSON
```

These should remain readable during migration.

## Typed memory kinds

```text
decision
  A design or implementation decision.

gotcha
  A known hazard and how to avoid it.

convention
  A style, naming, structure, test, import, or workflow convention.

api_contract
  A local API, schema, CLI, or function contract that should not be broken.

test_command
  A verified command for checking a subsystem.

failure_pattern
  A repeated error or workflow failure.

user_preference
  A durable user preference, if explicitly given or safely inferred.

project_fact
  A stable fact about the repository.

permission_rule_candidate
  A proposed permission rule, not active policy.
```

See `schemas/memory.schema.json`.

## Required fields

```text
id
projectId
kind
scope
text
severity
confidence
provenance
createdAt
```

## Confidence values

```text
observed        derived directly from event/test/source
user_confirmed explicit user statement
inferred        deterministic inference
llm_distilled   LLM distillation, requires lower authority
imported        migrated from v1 file
```

## Memory authority order

```text
explicit user instruction
source files/tests/diagnostics
typed observed memory
user-confirmed memory
inferred memory
llm-distilled memory
legacy imported memory
```

## Injection policy

Do not inject all memory.

Memory can be injected automatically only when:

```text
severity is high
AND memory is relevant to prompt/file/symbol
AND budget allows
AND memory is not expired
```

Otherwise expose through `brain_search` or `puntax_context`.

## Migration adapters

```text
lessons.jsonl
  -> gotcha, failure_pattern, project_fact, or session_summary depending on type/severity

conventions.json
  -> convention

file-insights.json
  -> project_fact scoped to file

hot-files.json
  -> ranking signal, not necessarily memory

user-prefs.json
  -> user_preference if explicit enough
```

## Memory write policy

The agent may write memory through `memory_write` or existing `mistake_log` / `session_summary`, but:

- It must include source/provenance.
- It must not claim certainty without evidence.
- It must not store secrets.
- It must not store raw transcripts.
- It must not write active permission policy.

## Expiration policy

Suggested defaults:

```text
failure_pattern: 180 days unless repeated
project_fact: no expiration if source-backed
convention: no expiration if source-backed
user_preference: no expiration if user-confirmed
test_command: 90 days unless revalidated
llm_distilled: 90 days unless confirmed
```

