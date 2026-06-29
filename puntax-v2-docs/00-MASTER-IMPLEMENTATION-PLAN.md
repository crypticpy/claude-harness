# PUNTAX v2 — Master Implementation Plan

> **PUNTAX** = Permissioned Unified Navigation & Token-Aware eXecution.
> This is the executable plan for transforming `claude-harness` into PUNTAX v2.
> It is grounded in (a) the full `puntax-v2-docs` design bundle and (b) a ground-truth
> assessment of what is actually built in this repo today (2026-06-29).

---

## 1. Goal & North Star

Convert the harness from an **LLM-summarization + broad-injection** model into a
**deterministic-first, budget-aware context fabric** — _without weakening safety and
without throwing away the working v1 system._

**The single sentence:** by default, the harness should construct the smallest relevant
context for the task from structured facts (events, typed memory, a code map), call no
LLM on routine compaction, and route every action through an auditable permission layer —
reserving LLM distillation for high-value, threshold-triggered moments.

### Measurable success criteria (definition of "v2 done")

| Dimension                    | v1 today                                         | v2 target                                                                                                                                               |
| ---------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Routine prompt injection     | Always-on `session-memory` + context-report      | ≤300 tokens, relevance-gated; near-zero when nothing matches                                                                                            |
| Routine `PreCompact`         | Always 1 LLM call (≤500KB transcript)            | Deterministic reducer, **0 LLM calls**; LLM only on threshold                                                                                           |
| Session continuity substrate | LLM narrative memory JSON                        | Append-only **event ledger** + deterministic **checkpoints**                                                                                            |
| Code intelligence            | Regex parser, scan-based impact                  | **Code-map index** (SQLite) + Tree-sitter + LSP, scan fallback                                                                                          |
| Memory                       | Untyped `lessons.jsonl` narratives               | **Typed, provenance-backed** memories with confidence tiers                                                                                             |
| Permission                   | `cf-approve` (LLM-gated, at `PermissionRequest`) | **Unchanged** — cf-approve already gates/denies destructive actions and works fine; v2 only passively mirrors permission outcomes into the event ledger |
| Tests                        | **None**                                         | Vitest suite covering reducers/rankers/policy/parsers; no network/LLM in tests                                                                          |
| Rollback                     | n/a                                              | Every phase behind a `PUNTAX_*` flag, individually revertible                                                                                           |

### Non-negotiables (carried verbatim from the brief)

1. Do not weaken permissions. The permission path stays independent of memory/context.
2. The permission layer is **cf-approve, left exactly as-is** — it already LLM-gates and denies destructive actions at `PermissionRequest`. v2 adds **no** governor, veto, rule store, or candidate accrual; it only _observes_ permission outcomes (passive ledger audit). No PUNTAX component activates permission policy.
3. Do not inject large memory by default. Context is routed and budgeted.
4. Non-permission hooks **fail open**; permission failures **fail closed** for risky ops.
5. Source files, tests, diagnostics, and explicit user instructions outrank memory.
6. Ship phase-by-phase. Additive first; remove old paths only after parity is proven by tests.

---

## 2. Ground Truth: What's Already Built (and what isn't)

This reshapes the doc bundle's effort assumptions. Most of the harness is **real,
production-grade code**, not placeholder.

**Already complete (keep, reconfigure — do not rebuild):**

- `hooks/unified/unified-hook.mjs` — event router, 8 event types, graceful fail-silent.
- `hooks/unified/modules/precompact-llm.mjs` — **already does single-pass signal extraction**
  (toolErrors, retryPatterns, explorationSpirals, contextSwitches, permissionDenials) before the LLM call.
  → This is the seed of both the deterministic reducer (Phase 2) and the threshold gate (Phase 5).
- `rolling-log.mjs` — append-only JSONL tool-op log + file-edits DB. → Seed of the event ledger (Phase 2).
- `session-memory.mjs` (read), `session-start.mjs`, `context-report.mjs`, `llm-call.mjs` (OpenAI Responses API, GPT-5 models, config-driven).
- `plugins/context-layer` MCP server + ~8 tools (`semantic_lookup`, `impact_check`, `symbol_context`,
  `chunk_ref`, `brain_search`, `mistake_log`, `session_summary`, `what_changed`) — clean `TOOLS` array + switch dispatch.
- `storage/sqlite.ts` — working better-sqlite3 backend (WAL, prepared statements) — **but global path & a different schema** (see §4).
- `learn/file-tracker.ts` — working hot-file auto-learn with decay + file locking.

**Genuinely placeholder / missing (the real builds):**

- `plugins/context-layer/src/lsp/` — **types & cache only, no LSP client.** ← single largest piece of v2.
- `indexer/active-indexer.ts` + `parser.ts` — regex parser; indexer does not populate a real symbol/edge graph.
- `impact_check` — regex full-scan, re-scans every call (no cached import graph).
- **No test suite** — `package.json` has `"test": "vitest"` but zero test files. ← cross-cutting blocker.
- **No PUNTAX config namespace, no feature flags, no event ledger, no typed memory.** (Permissions are _not_ a gap — cf-approve already covers them; see Phase 4.)

**Inconsistent storage tiers** (a v2 design decision, see §4): current SQLite lives at the
**global** `~/.claude/plugins/context-layer/data/context.db`; brain files live **project-local**
at `<repo>/.claude/context-layer/`; hook logs/memories live under `~/.claude/hooks/unified/`.

---

## 3. Target Architecture (three planes)

```
Agentic harness (Claude Code / Codex / QuadCode)
        │
        ▼
CONTROL PLANE  — hooks/unified/unified-hook.mjs
   Permission pass-through (cf-approve, unchanged) · Context Router entry · Event Recorder · Session Reducer · Quality/Verify gates
        │
        ▼
KNOWLEDGE PLANE
   Event Ledger (events.jsonl) · Typed Memory (memories.jsonl) · Code Map (code-map.db) · Checkpoints (checkpoints.jsonl)
        │
        ▼
TOOL PLANE — context-layer MCP server
   puntax_context (primary) · semantic_lookup · symbol_context · impact_check · chunk_ref ·
   brain_search · what_changed · memory_write · index_status · refresh_index · permission_explain · session_checkpoint
```

---

## 4. Cross-Cutting Decisions (resolve once, in Phase 0)

These span all phases. Decide them before writing phase code.

**D1 — Config & feature flags (single source of truth across two runtimes).**
Hooks (`.mjs`) and the MCP server (compiled TS) are **separate processes**. The common
denominator is **environment variables**, which the rollback strategy already specifies.

- Detailed budgets/thresholds live in a `puntax` block added to `hooks/unified/config.json`
  (hooks read it directly; the MCP server reads the same file by resolving repo root from `projectDir`).
- Master on/off per subsystem via env flags both runtimes honor:
  `PUNTAX_CONTEXT_ROUTER=`, `PUNTAX_EVENT_LEDGER=`, `PUNTAX_PRECOMPACT_MODE=deterministic|llm`,
  `PUNTAX_CODE_MAP=`, `PUNTAX_LLM_DISTILLATION=`. (No permission flag — the permission layer is unchanged.)
- Defaults: new behavior **off** until its phase passes acceptance, then flipped on by default with the flag retained for rollback.

**D2 — Storage tiers (fix the inconsistency).** Adopt the doc's layout:

- `<repo>/.claude/context-layer/` → `events.jsonl` (incl. `permission` audit events), `checkpoints.jsonl`, `memories.jsonl`,
  `code-map.db`, plus existing `hot-files.json` / `file-insights.json` / `conventions.json` / `lessons.jsonl`.
- `~/.claude/context-layer/global/` → `global-memory.jsonl`, `user-prefs.json`. (No `permission-rules.jsonl` — there is no PUNTAX rule store.)
- `~/.claude/cache/context-layer/` → transient indexes / temp.
- The **code map gets a new project-local `code-map.db`** with the schema in `schemas/code-map.schema.sql`
  (tables `projects/files/symbols/edges/reads/chunks/diagnostics/index_runs`). This is **distinct** from the
  existing global `context.db` (`file_index/context_reads/code_chunks`); do not try to overload it. Keep the
  old db working during migration; migrate readers tool-by-tool.

**D3 — Test harness is a Phase 0 prerequisite, not a per-phase afterthought.** Stand up Vitest
(already a devDep) with a `tests/` tree and fixtures before Phase 1, because every phase's
acceptance gate is "tests prove parity." Shared reducer/ranker/parser logic that hooks and the
MCP server both use should live in plain `.js`/`.ts` modules that are unit-testable in isolation.

**D4 — Backward compatibility contract.** Preserve all existing hook event names and MCP tool
names. New tools are additive. Existing brain files remain readable. `settings.template.json`
stays valid JSON. `install.sh` must not fail if optional components are absent.

---

## 5. Phase 0 — Foundations (prerequisite)

**Goal:** config/flags + test harness + storage-tier scaffolding, with zero behavior change.

**Deliverables**

- `puntax` block in `hooks/unified/config.json` (budgets, precompact thresholds, codeMap — all defaulting safe/off) mirroring `schemas/puntax-config.example.json`. (Omit the `permissionGovernor` block — permissions are untouched in v2.)
- A tiny shared config loader usable from both `.mjs` hooks and TS (`readPuntaxConfig(projectDir)`), honoring `PUNTAX_*` env overrides.
- Vitest config + `tests/` tree + fixtures (sample transcript JSONL, sample brain files, a temp-repo helper).
- Storage path helper (`resolveContextDir(projectDir)`) implementing the §4 tier layout; create dirs lazily, never outside the repo without permission.

**Acceptance:** `npm test` runs (green, even if trivial); hooks still load under Node ≥20; no runtime behavior changes with all flags at defaults.
**Effort:** SMALL (1–2 days). **Rollback:** inert by construction.

---

## 6. Phase 1 — Reduce Token Burn (`puntax_context` v0 + deterministic precompact stub)

**Goal:** cut default prompt + precompact cost using existing storage; introduce the primary tool.

**Files**

- _New_ `plugins/context-layer/src/tools/puntax-context.ts` — `puntax_context` v0. Reads existing
  brain files (lessons, file-insights, conventions, hot-files, user-prefs). Implements the ranking
  from `docs/08` (`fileMatch*5 + symbolMatch*5 + severity + confidence + recency + hotFile − tokenCost`),
  returns the compact `{ context, sources[], nextTools[], confidence, omitted }` shape under `budgetTokens`.
- _Modify_ `mcp-server.ts` — register `puntax_context` in `TOOLS` + dispatch (follow existing pattern).
- _New_ `plugins/context-layer/src/context/ranker.ts` — pure, unit-tested ranking/budget logic.
- _New_ `hooks/unified/modules/precompact-reducer.mjs` — deterministic checkpoint stub: reuse the
  signal-extraction already in `precompact-llm.mjs`, write a checkpoint, **no LLM**.
- _Modify_ `unified-hook.mjs` precompact branch — run reducer first; LLM path gated by `PUNTAX_PRECOMPACT_MODE`.
- _Modify_ prompt path (`session-memory.mjs` / router) — inject broad memory **only** on resume/compaction/relevant prompt; otherwise near-zero.

**Key contract:** `PuntaxContextInput/Output` per `docs/08`; modes `prompt|pre_edit|resume|debug|review|architecture` with budgets from config (300/1200/1500/2000/3000/3000).

**Acceptance:** router returns high-severity matching memory, omits irrelevant memory, respects budget, degrades on missing/corrupt files; precompact writes a checkpoint **with no API key**; existing `brain_search`/`semantic_lookup`/`impact_check` unchanged; permission flow untouched.
**Effort:** SMALL–MEDIUM (3–5 days). **Rollback:** `PUNTAX_CONTEXT_ROUTER=false`, `PUNTAX_PRECOMPACT_MODE=llm`.

---

## 7. Phase 2 — Event Ledger + Deterministic Session Reducer

**Goal:** make structured events the canonical session substrate.

**Files**

- _New_ `hooks/unified/modules/event-writer.mjs` — append-only writer + corrupted-line-tolerant reader; stable `evt_*` ids; validates against `schemas/event.schema.json` (kinds: tool_call/read/edit/write/test/lint/diagnostic/error/permission/decision/memory/checkpoint/index).
- _Modify_ `rolling-log.mjs` (post-tool/post-edit) — mirror tool/edit/error/test events into `events.jsonl` (keep rolling log running in parallel).
- _Upgrade_ `precompact-reducer.mjs` — reduce events since last checkpoint into the `docs/05` checkpoint shape (workingFiles, changedFiles, symbolsTouched, testsRun, failures, decisions, openLoops, nextActions, risk) → `checkpoints.jsonl`.
- _Modify_ `what_changed` (TS tool) — prefer the event ledger; fall back to git/rolling-log.
- _New_ MCP `session_checkpoint` — return the latest deterministic checkpoint.

**Acceptance:** valid JSONL written; reducer reconstructs working/changed files; corrupted lines skipped; no LLM; rolling log still available; event replay → checkpoint is deterministic.
**Effort:** MEDIUM (4–6 days). **Rollback:** `PUNTAX_EVENT_LEDGER=false` (reducer falls back to transcript-signal stub from Phase 1).

---

## 8. Phase 3 — Code Map Index (the big build: SQLite + Tree-sitter + LSP)

**Goal:** turn context-layer into a real local code-intelligence index. This is the largest phase.

**Files**

- _New_ `plugins/context-layer/src/storage/code-map.ts` + `code-map.schema.sql` — project-local `code-map.db` per `schemas/code-map.schema.sql`.
- _Rewrite_ `indexer/active-indexer.ts` — populate `files/symbols/edges`; staleness via `hash`+`mtime`+`indexed_at`; write `index_runs`.
- _New_ backend abstraction `indexer/backends/{treesitter,regex}.ts` — Tree-sitter for outlines/spans/imports/containment; **regex kept as fallback only**; edge kinds `contains/imports/exports/calls/references/extends/implements/tests`.
- _New_ `lsp/client.ts` + per-language server manager — real LSP over stdio for definition/references/diagnostics/hover/document-symbols. Baseline: TypeScript, Python, then Go/Rust. Use the existing `lsp/cache.ts`. **(1–2 weeks on its own.)**
- _Modify_ `semantic_lookup` / `symbol_context` / `impact_check` — query index when fresh (LSP → Tree-sitter → regex confidence tiers); scan fallback labeled `stale`/lower-confidence.
- _New_ MCP `refresh_index`, `index_status`. _Modify_ post-edit hook — incremental refresh of the changed file.

**Acceptance:** indexer writes real file/symbol rows; `semantic_lookup` answers from index without re-reading fresh files; `impact_check` uses indexed edges first; stale files detected by hash; fallback scan still works.
**Effort:** LARGE (2–3 weeks; LSP dominates). **Rollback:** `PUNTAX_CODE_MAP=false` → existing regex/scan tools.
**Sequencing note:** ship in sub-steps — (3a) schema+indexer+Tree-sitter+indexed lookups, (3b) LSP client, (3c) incremental refresh — each independently shippable.

---

## 9. Phase 4 — Permissions: Leave As-Is (passive audit only)

**Goal (user-directed):** **change nothing about the permission layer.** `cf-approve` already
LLM-gates and denies possible destructive actions, and it already fires exactly at the harness's own
`PermissionRequest` decision points. It works fine. v2 does **not** add a governor, a safety veto, a
risk classifier, a rule store, or candidate-rule accrual. The current permissions profile is preserved
verbatim.

> This is a deliberate departure from the bundle's `tasks/phase-4-permission-governor.md` and
> `docs/04`. After review, the "governor" they describe largely re-implements behavior `cf-approve`
> already provides at the same surface — so building it would add risk and maintenance for no gain.

**The only v2 touch — passive observation (belongs to the Phase 2 event ledger):**

- The existing `PermissionRequest` → `cf-approve` wiring in `settings.template.json` stays **unchanged**.
  We do not interpose any PUNTAX module in the decision path.
- A `permission` event is recorded **after the fact** — mirroring the decision cf-approve made
  (`{ kind: "permission", tool, decision, risk, commandHash }` per `schemas/event.schema.json`) — so
  checkpoints, `what_changed`, and the Phase 5 distillation thresholds (e.g. repeated permission
  denials) can see it. This is read-only telemetry; it never re-evaluates or overrides a decision.
- Capture it via the existing `PostToolUse`/event-writer path (or a non-blocking observer), **not** by
  routing `PermissionRequest` through a hook that could alter the outcome.

**Files**

- _No change_ to `settings.template.json` `PermissionRequest` routing; _no_ new permission modules.
- _Reuse_ the Phase 2 `event-writer.mjs` to append `permission` events from observed outcomes.

**Acceptance:** `settings.template.json` permission wiring is byte-for-byte unchanged; cf-approve remains
the sole permission authority; permission outcomes appear as `permission` events in the ledger; no PUNTAX
code can allow/deny/alter a permission decision.
**Effort:** XS (folds into Phase 2; ~0.5 day for the `permission` event mapping). **Rollback:** governed
by `PUNTAX_EVENT_LEDGER` (no separate permission flag — there is no permission behavior to roll back).

---

## 10. Phase 5 — Optional LLM Distillation + Typed Memory

**Goal:** keep LLM learning where it's valuable; remove routine summarization dependence.

**Files**

- _Rename/demote_ `precompact-llm.mjs` → `distill-precompact.mjs` (keep an alias for compatibility). Precompact now: reducer first → LLM **only** if a threshold trips (toolErrors≥3, retryPatterns≥2, explorationSpirals≥1, changedFiles≥6, repeated permission denial, or explicit `/evolve`·`/retrospective`).
- _New_ `memory_write` MCP tool — typed memory per `schemas/memory.schema.json` (kind/scope/severity/confidence/provenance); distilled memories tagged `confidence: llm_distilled`; invalid LLM output discarded (no poisoning).
- _New_ migration adapters — `lessons.jsonl`→gotcha/failure_pattern/project_fact; `conventions.json`→convention; `file-insights.json`→file-scoped project_fact; `user-prefs.json`→user_preference.
- _Modify_ `/evolve` (`self-evolution.mjs`) and `/retrospective` (`deep-retrospective.mjs`) — consume checkpoints/events/typed memory first; raw transcript only as last resort.

**Acceptance:** routine precompact uses no LLM; threshold-triggered distillation works against a **mocked** LLM; distilled memory is lower-confidence and provenance-tagged; existing no-API-key graceful behavior preserved.
**Effort:** SMALL–MEDIUM (3–5 days; signal extraction already exists). **Rollback:** `PUNTAX_LLM_DISTILLATION=false`.

_Optional polish:_ the `/puntax …` maintenance command pack from `docs/12` (status/checkpoint/memory search/prune/permissions review/index refresh/distill).

---

## 11. Sequencing, Dependencies, Effort

```
Phase 0 (foundations)  ──┬─► Phase 1 (router + precompact stub)
                         │        │
                         │        ├─► Phase 2 (event ledger + reducer; incl. Phase 4 permission-event mapping)  ──► Phase 5 (distillation)
                         │        │
                         │        └─► Phase 3 (code map / LSP)  ─────────► (feeds richer puntax_context)
```

- **Strictly ordered:** 0 → 1 → 2 → 5. Phase 5's quality depends on Phase 2 checkpoints/events.
- **Phase 4 is folded into Phase 2** — it is just the `permission` event-mapping (passive audit); there is no standalone permission build.
- **Parallelizable:** Phase 3 (code map) is independent of the 1→2→5 chain and is the long pole.
- **Total effort:** ~4–6 weeks single-threaded; ~3–4 weeks if Phase 3 runs in parallel with the 1→2→5 chain. Phase 3/LSP is the critical path.

---

## 12. Risks & Mitigations

| Risk                                                  | Mitigation                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LSP lifecycle complexity (Phase 3) blows the timeline | Ship 3a (Tree-sitter index) first — it delivers most value; LSP (3b) is additive and flag-gated                                                                                                                                                                                  |
| Two-runtime config drift (hooks vs MCP)               | Single `puntax` config block + `PUNTAX_*` env flags honored by both; one loader, tested                                                                                                                                                                                          |
| Permission behavior accidentally changed              | v2 touches **nothing** in the permission path — `settings.template.json` `PermissionRequest` wiring is unchanged and cf-approve stays the sole authority; the only addition is read-only `permission` telemetry; a regression test asserts the wiring is byte-for-byte identical |
| Context poisoning via memory                          | Every memory carries provenance; LLM memory lower-confidence; injected memory treated as quoted data; source/tests outrank memory                                                                                                                                                |
| Storage migration breaks existing tools               | New `code-map.db` is separate from `context.db`; migrate readers tool-by-tool behind flags; old paths kept until parity tests pass                                                                                                                                               |
| No existing tests → regressions invisible             | Phase 0 stands up Vitest before any behavior change; each phase gate is test-proven parity                                                                                                                                                                                       |

---

## 13. Verification Strategy (per `docs/11`)

- **Unit (no network/LLM):** ranker/budget, event validate+replay, reducer (working/changed/openLoops), `permission` event mapping (observed outcome → ledger entry, no decision logic), code-map freshness/fallback, migration adapters.
- **Integration:** MCP `tools/list` includes new tools; `puntax_context` returns compact context; hooks import under Node ≥20; post-edit records event + refreshes index; precompact deterministic mode writes checkpoint with **no API key**.
- **Regression:** existing `semantic_lookup`/`brain_search` still work; `settings.template.json` stays valid JSON; `install.sh` tolerates missing optional components.
- **Per-merge:** run `agent/REVIEW_CHECKLIST.md` (safety, token-efficiency, correctness, migration-compat, tests). Run `/freview` on phases touching permissions/input-handling or ≥6 files.

---

## 14. Definition of Done — "v2 fully implemented"

1. All six phases merged, each behind a retained `PUNTAX_*` flag, defaults flipped to v2 behavior.
2. Routine prompt injection ≤300 tokens and relevance-gated; routine precompact makes **zero** LLM calls.
3. Event ledger + checkpoints reconstruct session state deterministically; `what_changed`/`session_checkpoint` read from them.
4. Code map answers `semantic_lookup`/`symbol_context`/`impact_check` from a fresh index with LSP/Tree-sitter/regex confidence tiers and stale detection.
5. Permission layer untouched — cf-approve remains the sole authority at `PermissionRequest`; v2 adds only read-only `permission` telemetry to the ledger and no PUNTAX code can allow/deny/alter a decision.
6. LLM distillation is threshold-only and produces typed, lower-confidence, provenance-backed memory.
7. Vitest suite green; `agent/REVIEW_CHECKLIST.md` passes; existing v1 files/tools/config still work.

---

_Source of truth for contracts: `schemas/` (event, memory, permission-rule, code-map.sql, puntax-config). Operating rules: `agent/AGENT_BRIEF.md`, `agent/IMPLEMENTATION_RULES.md`. Per-phase detail: `tasks/phase-{1..5}-*.md`._
