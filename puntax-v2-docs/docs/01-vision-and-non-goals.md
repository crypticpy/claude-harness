# 01 — Vision and Non-Goals

## Vision

PUNTAX v2 converts the current Claude/QuadCode/Codex harness into a **permissioned, token-aware context fabric**.

The goal is not to build another broad “AI memory summarizer.” The goal is to make context construction explicit, cheap, auditable, and safe.

```text
Current v1 shape:
  hooks + LLM summaries + rolling logs + context-layer tools + permission hook

PUNTAX v2 shape:
  hooks + permission governor + event ledger + deterministic reducer
  + code map + typed memory + context router + optional LLM distillation
```

## Core design principles

### 1. Deterministic first

Routine memory capture should not require an LLM. Tool events, edits, tests, permission decisions, file accesses, and errors are structured facts. Capture them directly.

### 2. LLMs are distillers, not the memory substrate

LLMs are valuable for retrospectives, failure analysis, and long-horizon synthesis. They are too expensive and too noisy to be the default mechanism for every compaction.

### 3. Permission remains separate

The permission layer prevents bad actions. It must not be entangled with memory ranking, context injection, or model self-reflection.

### 4. Context is routed, not dumped

A coding agent should receive the smallest relevant context for the current task. The default should be near-zero injection, with targeted retrieval through `puntax_context` and existing MCP tools.

### 5. Source of truth remains external to memory

Memory can guide the agent, but source files, tests, diagnostics, git history, and explicit user instructions outrank memory.

## Non-goals

PUNTAX v2 does not aim to:

- Replace Claude Code, Codex, or QuadCode.
- Replace LSPs, compilers, tests, or typecheckers.
- Build a full graph database platform in phase 1.
- Summarize every conversation turn.
- Inject all “brain” files into every prompt.
- Autonomously rewrite permission policy from LLM output.
- Spawn more agents by default.
- Build a giant always-on RAG system.

## Naming

**PUNTAX**: Permissioned Unified Navigation & Token-Aware eXecution.

The name emphasizes four responsibilities:

```text
Permissioned  -> action safety and auditability
Unified       -> one harness across Claude Code, Codex, QuadCode where possible
Navigation    -> code/context routing before reading/editing
Token-Aware   -> budgeted injection and deterministic memory
Execution     -> workflow orchestration with verification
```

