# PUNTAX v2 Metamorphosis Documentation Bundle

**PUNTAX** means **Permissioned Unified Navigation & Token-Aware eXecution**.

This bundle is intended to be fed to a coding agent working inside the existing `crypticpy/claude-harness` codebase. It describes a v2 re-authoring strategy that keeps the existing safety and permission posture while replacing broad AI summarization with deterministic event capture, typed memory, LSP/Tree-sitter code intelligence, and a budget-aware context router.

## How to use this bundle with a coding agent

Feed the agent these files in this order:

1. `agent/AGENT_BRIEF.md` — the implementation operating brief.
2. `docs/01-vision-and-non-goals.md` — what PUNTAX v2 is and is not.
3. `docs/03-target-architecture.md` — the target architecture.
4. The task file for the phase you want implemented from `tasks/`.
5. The relevant schemas from `schemas/`.

Avoid asking the coding agent to implement all phases at once. The safest sequence is:

```text
Phase 1: Reduce token burn using current architecture
Phase 2: Event ledger + deterministic session reducer
Phase 3: Code map index
Phase 4: Permission governor
Phase 5: Optional LLM distillation + retrospective refinements
```

## Bundle contents

```text
README.md
agent/
  AGENT_BRIEF.md
  IMPLEMENTATION_RULES.md
  REVIEW_CHECKLIST.md
adr/
  0001-deterministic-first-memory.md
  0002-permission-governor-separation.md
  0003-lsp-tree-sitter-code-map.md
  0004-context-router-primary-tool.md
docs/
  01-vision-and-non-goals.md
  02-current-harness-assessment.md
  03-target-architecture.md
  04-permission-governor.md
  05-event-ledger-and-session-reducer.md
  06-code-map-index.md
  07-memory-model.md
  08-context-router-mcp-tools.md
  09-hooks-and-agent-orchestration.md
  10-migration-plan.md
  11-testing-and-acceptance.md
  12-operational-policy.md
  13-agent-command-pack.md
schemas/
  code-map.schema.sql
  event.schema.json
  memory.schema.json
  permission-rule.schema.json
  puntax-config.example.json
tasks/
  phase-1-reduce-token-burn.md
  phase-2-event-ledger.md
  phase-3-code-map.md
  phase-4-permission-governor.md
  phase-5-llm-distillation.md
```

## Core thesis

The current harness has the correct skeleton: unified hooks, permissions, MCP tools, persistent brain files, hot-file learning, quality gates, and sub-agent discipline. PUNTAX v2 should not discard that. It should convert it into a deterministic-first context fabric:

```text
permission governor
+ event ledger
+ deterministic session reducer
+ LSP/Tree-sitter code map
+ typed project memory
+ context router MCP tool
+ optional LLM distillation
```

The primary implementation target is `puntax_context`, a budget-aware MCP context router that replaces broad always-on prompt injection.

