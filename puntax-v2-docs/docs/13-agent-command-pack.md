# 13 — Agent Command Pack

This document provides copy-paste task prompts for a coding agent.

## Phase 1 prompt

```text
Implement PUNTAX v2 Phase 1. Read agent/AGENT_BRIEF.md and tasks/phase-1-reduce-token-burn.md. Do not implement later phases. Preserve current hooks and permissions. Add puntax_context v0, prompt budget config, and deterministic precompact reducer stub. Tests required.
```

## Phase 2 prompt

```text
Implement PUNTAX v2 Phase 2. Read tasks/phase-2-event-ledger.md and schemas/event.schema.json. Add event ledger writer/reader, bridge rolling-log events into ledger, and implement deterministic checkpoint reducer. Do not alter permission behavior except event logging.
```

## Phase 3 prompt

```text
Implement PUNTAX v2 Phase 3. Read tasks/phase-3-code-map.md and schemas/code-map.schema.sql. Convert active-indexer from placeholder to real file/symbol indexing. Use Tree-sitter or backend abstraction; keep regex fallback. Make semantic_lookup and impact_check use index when fresh.
```

## Phase 4 prompt

```text
Implement PUNTAX v2 Phase 4. Read tasks/phase-4-permission-governor.md and schemas/permission-rule.schema.json. Preserve cf-approve compatibility. Add permission audit events, risk classifier, candidate rule accrual, and permission_explain. Never auto-approve destructive operations.
```

## Phase 5 prompt

```text
Implement PUNTAX v2 Phase 5. Read tasks/phase-5-llm-distillation.md and schemas/memory.schema.json. Demote precompact-llm to optional distill-precompact. Add threshold triggers and typed memory proposals. Retrospective/evolve should prefer checkpoints/events over raw transcripts.
```

## Review prompt

```text
Review the current diff against agent/REVIEW_CHECKLIST.md. Focus on permission safety, token injection size, deterministic-first behavior, backward compatibility, and tests. Return blockers first, then non-blocking improvements.
```

