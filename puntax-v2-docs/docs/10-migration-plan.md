# 10 — Migration Plan

## Phase 1 — Reduce token burn using current architecture

Goal: reduce prompt and compaction cost without replacing storage.

Deliverables:

```text
memory injection policy changes
prompt budget config
precompact deterministic reducer stub
LLM threshold config
puntax_context v0 reading existing brain files
```

## Phase 2 — Event ledger + deterministic session reducer

Goal: make event ledger the canonical session substrate.

Deliverables:

```text
event schema
event writer
rolling-log bridge
checkpoint reducer
checkpoint reader
what_changed from ledger
```

## Phase 3 — Code map index

Goal: make context-layer a real local code intelligence layer.

Deliverables:

```text
code-map schema
file/symbol indexing
Tree-sitter parser integration or improved backend abstraction
LSP integration where available
indexed semantic_lookup
indexed impact_check
incremental refresh on edit
```

## Phase 4 — Permission governor

Goal: preserve `cf-approve` while adding policy, audit, and candidate rule accrual.

Deliverables:

```text
permission event logging
policy rule schema
risk classifier
candidate rule generation
permission_explain
safe integration with existing PermissionRequest
```

## Phase 5 — Optional LLM distillation

Goal: keep LLM learning where it has high value.

Deliverables:

```text
distill-precompact module
threshold trigger logic
memory proposal writer
/evolve uses typed memories and events
/retrospective uses checkpoints and selected evidence, not raw transcript by default
```

## Migration strategy

Use additive changes first:

```text
add new modules
mirror old data to new event ledger
keep existing MCP tools
add puntax_context
feature flag new injection policy
only remove broad injection after verification
```

## Rollback strategy

Each phase should be individually revertible:

```text
PUNTAX_ENABLE_CONTEXT_ROUTER=false
PUNTAX_PRECOMPACT_MODE=llm|deterministic
PUNTAX_EVENT_LEDGER=false
PUNTAX_PERMISSION_GOVERNOR=false
PUNTAX_CODE_MAP=false
```

## Compatibility matrix

```text
Claude Code:
  Full hook and MCP support.

Codex:
  MCP support depends on configured client; hook parity may be limited.
  Use AGENTS.md + MCP where hooks are missing.

QuadCode:
  Existing harness compatibility target.
  Prefer MCP and project-local context files for portability.
```

