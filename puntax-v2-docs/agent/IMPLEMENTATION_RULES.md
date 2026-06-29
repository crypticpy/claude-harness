# Implementation Rules for Coding Agents

## General rules

- Do not implement speculative extensibility.
- Preserve compatibility with existing hook names and MCP tool names unless a task explicitly says otherwise.
- Prefer additive modules during migration; remove old paths only after tests prove parity.
- Use feature flags in config for behavior changes.
- Make failure non-blocking unless the component is explicitly a permission gate.

## Memory rules

- Memory entries must be typed.
- Memory entries must carry provenance.
- Memory injection must be budgeted.
- High-severity memory can be surfaced automatically only when relevant to the current task or file.
- Raw transcript text must not be stored as durable memory.
- LLM summaries must be labeled `distilled`, not `observed`.

## Permission rules

- Existing `cf-approve` behavior must remain supported.
- A new permission governor may sit in front of or behind `cf-approve`, but must not bypass it for unknown/risky actions.
- Candidate permission rules are not active rules.
- Destructive operations must never be auto-accrued.
- Permission decisions must be logged to the event ledger.

## Indexing rules

- Use source hashes to detect freshness.
- Prefer LSP for definition/reference/diagnostics when available.
- Prefer Tree-sitter for file outline, imports, symbols, and spans.
- Regex parser is fallback only.
- Stale index data must be marked stale in outputs.

## MCP response rules

- MCP tools return small structured payloads.
- Include source/provenance identifiers when available.
- Prefer `summary + nextTools + sources` over verbose prose.
- Do not return full file contents unless the tool is explicitly a chunk/source tool.

## Hook rules

- `UserPromptSubmit` should not inject broad narrative memory on every prompt.
- `PreCompact` should run a deterministic reducer by default.
- LLM distillation is threshold-driven or explicit.
- `PostToolUse` should record events and update indexes/hot-file counters.
- `Stop` should run gates and deterministic checkpointing.

