# 02 — Current Harness Assessment

This document maps the current harness to the PUNTAX v2 target design.

## Existing strengths

### Unified hook routing

`hooks/unified/unified-hook.mjs` is the correct control-plane shape. It routes:

```text
prompt        -> context-report, skill-activation, session-memory, edit-history
precompact    -> precompact-llm
post-edit     -> format-lint, rolling-log, impact-hint
post-tool     -> rolling-log
stop          -> quality-gates, verification-check
session-start -> session-start context injection
```

This should remain, but the routed modules should change.

### Permission path

`settings.template.json` routes `PermissionRequest` through `cf-approve permission`. This is a core safety layer and should remain independent.

### MCP context-layer

`plugins/context-layer/src/mcp-server.ts` already exposes the right tool concepts:

```text
semantic_lookup
impact_check
symbol_context
chunk_ref
brain_search
mistake_log
session_summary
what_changed
```

This is the correct tool-plane starting point.

### Persistent brain

The project-local `.claude/context-layer` brain uses:

```text
lessons.jsonl
conventions.json
file-insights.json
hot-files.json
user-prefs.json
```

This is preferable to a single unstructured memory blob.

### Hot-file auto-learning

`plugins/context-layer/src/learn/file-tracker.ts` tracks file access frequency, decay, auto-promotes hot files, and caches deterministic file intelligence. This should become a first-class signal for context routing.

## Existing weaknesses

### LLM summarization is still central

`precompact-llm.mjs` condenses up to 500,000 transcript characters and uses an LLM for memory + diagnosis. This is expensive and should become optional.

### Always-on memory injection is too broad

`session-memory.mjs` injects narrative memory at prompt time. This should be replaced by relevance-based context routing.

### Code intelligence is not yet semantic enough

`parser.ts` is regex-based for TypeScript and Python. `active-indexer.ts` currently verifies file readability but does not populate a real symbol/edge index. `symbol-context.ts` uses parser/cache, not actual LSP calls.

### Storage paths are inconsistent

The harness currently mixes:

```text
~/.claude/plugins/context-layer/data/context.db
~/.claude/context-layer fallback
<repo>/.claude/context-layer project brain
hooks/unified/logs and memories under ~/.claude
```

PUNTAX v2 should define explicit storage tiers.

## Re-authoring thesis

Do not discard v1. Refactor it into:

```text
v1 hooks                 -> PUNTAX control plane
rolling-log              -> event ledger seed
precompact-llm           -> optional distiller
session-memory           -> resume-only memory injection
context-layer MCP        -> PUNTAX tool plane
brain files              -> typed memory store
file-tracker hot files   -> context router ranking signal
impact-check             -> indexed graph/edge query with scan fallback
```

