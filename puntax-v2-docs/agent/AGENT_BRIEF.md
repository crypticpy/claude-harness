# Agent Brief: Implement PUNTAX v2 in `claude-harness`

You are modifying the existing `crypticpy/claude-harness` repository. The goal is a v2 metamorphosis of the harness into PUNTAX: **Permissioned Unified Navigation & Token-Aware eXecution**.

## Mission

Keep the existing safety and permission model, but reduce token burn and reduce dependence on LLM summarization. Preserve project memory benefits by moving memory capture and retrieval toward deterministic, typed, auditable data structures.

## Current system landmarks

Use these existing modules as anchor points:

```text
settings.template.json
  Current hook registration and PermissionRequest routing.

hooks/unified/unified-hook.mjs
  Current event router for prompt, precompact, post-edit, post-tool, stop, session-start.

hooks/unified/modules/precompact-llm.mjs
  Current combined LLM precompact memory + diagnosis path. This should be demoted.

hooks/unified/modules/session-memory.mjs
  Current read-side session-memory injection.

hooks/unified/modules/rolling-log.mjs
  Current rolling tool operation log. This becomes the seed of the event ledger.

plugins/context-layer/src/mcp-server.ts
  Current local MCP server. Add `puntax_context` here or a new compatible server module.

plugins/context-layer/src/tools/semantic-lookup.ts
  Current deterministic file-card lookup. Keep, but rename mental model from AI summary to structural summary.

plugins/context-layer/src/tools/impact-check.ts
  Current scan-based impact checker. Eventually use indexed edges first.

plugins/context-layer/src/tools/symbol-context.ts
  Current symbol lookup using parser/cache. Eventually become LSP-backed.

plugins/context-layer/src/indexer/active-indexer.ts
  Currently mostly placeholder. Convert into real file/symbol/edge indexing.

plugins/context-layer/src/learn/file-tracker.ts
  Current hot-file auto-learning. Keep and strengthen.

plugins/context-layer/src/tools/brain-tools.ts
  Current brain_search, mistake_log, session_summary. Evolve to typed memory.
```

## Non-negotiables

1. **Do not weaken permissions.** `PermissionRequest` remains independent from memory and context routing.
2. **Do not let LLM output become an active permission rule.** LLMs may propose; deterministic validation or user approval activates.
3. **Do not inject large memory by default.** Context is routed and budgeted.
4. **Do not block user work if hooks fail.** Maintain graceful degradation.
5. **Do not replace source of truth.** Source files, tests, compiler/LSP diagnostics, and explicit user instructions outrank memory.
6. **Do not implement all phases in one change.** Follow the phase tasks.

## First target

Implement `puntax_context` as a small, deterministic context router. It should return a concise context block based on:

```text
prompt/task text
current project path
session checkpoint if present
hot files
high-severity typed memories
recent event ledger entries
optional file/symbol inputs
budgetTokens
mode: prompt | pre_edit | resume | debug | review | architecture
```

Initial version may read existing brain files directly. Later versions should read the event ledger and typed memory table.

## Expected coding style

- Keep changes surgical.
- Prefer TypeScript modules with explicit types.
- Add tests for deterministic behavior.
- Avoid new external services.
- Avoid network access.
- Prefer SQLite / JSONL / deterministic local files.
- Keep MCP responses compact.

