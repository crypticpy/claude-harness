# 03 — Target Architecture

## High-level architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                    Agentic Harnesses                         │
│       Claude Code | Codex | QuadCode | other MCP clients      │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    PUNTAX Control Plane                      │
│                                                             │
│  hooks/unified/unified-hook.mjs                             │
│  ├─ Permission Governor                                     │
│  ├─ Context Router                                          │
│  ├─ Event Recorder                                          │
│  ├─ Session Reducer                                         │
│  └─ Quality / Verification Gates                            │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   PUNTAX Knowledge Plane                     │
│                                                             │
│  Event Ledger      Typed Memory       Code Map Index         │
│  JSONL/SQLite      JSONL/SQLite       SQLite + LSP/TS        │
│                                                             │
│  events            memories          files/symbols/edges     │
│  checkpoints       decisions         reads/chunks            │
│  permissions       gotchas           diagnostics             │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                     PUNTAX Tool Plane                        │
│                                                             │
│  MCP server exposes:                                        │
│  puntax_context, semantic_lookup, symbol_context,            │
│  impact_check, chunk_ref, brain_search, what_changed,        │
│  memory_write, index_status, refresh_index                   │
└─────────────────────────────────────────────────────────────┘
```

## Control plane

The control plane decides:

```text
what to allow
what to ask about
what to log
what to inject
what to retrieve
what to verify
when to distill
```

It should remain robust under failure. If memory/context hooks fail, the session continues. If permission evaluation fails closed for risky operations, it asks rather than allowing.

## Knowledge plane

The knowledge plane stores structured facts, not narrative chat history:

```text
Event ledger:
  tool calls, edits, test runs, errors, permissions, decisions

Typed memory:
  decisions, gotchas, conventions, API contracts, test commands, failure patterns

Code map:
  files, symbols, imports, calls, contains, references, tests, diagnostics
```

## Tool plane

The tool plane exposes the knowledge plane to agents through small MCP calls. The principal tool is `puntax_context`, which selects relevant context under a token budget.

## Data flow examples

### Before user prompt

```text
UserPromptSubmit
  -> puntax_context(mode=prompt, budget=300)
  -> inject only relevant memory/context
```

### Before edit

```text
PreToolUse(Edit|Write)
  -> identify file/symbol if possible
  -> puntax_context(mode=pre_edit, budget=1200)
  -> impact_check if non-additive change
  -> permission governor evaluates action
```

### After edit

```text
PostToolUse(Edit|Write)
  -> format-lint
  -> event ledger append
  -> refresh changed file in code map
  -> hot-file access update
  -> emit targeted test/impact hint
```

### Precompact

```text
PreCompact
  -> deterministic session reducer
  -> write checkpoint
  -> LLM distillation only if threshold triggers
```

## Storage tiers

Recommended storage layout:

```text
~/.claude/context-layer/global/
  global-memory.jsonl
  permission-rules.jsonl
  user-prefs.json

<repo>/.claude/context-layer/
  memories.jsonl
  events.jsonl
  checkpoints.jsonl
  permissions.jsonl
  hot-files.json
  file-insights.json
  conventions.json
  code-map.db

~/.claude/cache/context-layer/
  transient indexes
  temp responses
  stale distillation inputs
```

## Backward compatibility

PUNTAX v2 should read existing v1 files and write v2 files. Migration should be additive at first.

Compatibility adapters should support:

```text
lessons.jsonl -> typed memories
file-insights.json -> file memory entries
hot-files.json -> hot-file ranking source
conventions.json -> convention memory entries
hooks/unified/logs/*.jsonl -> event ledger seed
```

