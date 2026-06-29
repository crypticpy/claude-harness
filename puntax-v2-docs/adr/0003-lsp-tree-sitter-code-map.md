# ADR 0003 — LSP + Tree-sitter Code Map

## Status

Proposed.

## Context

The current context-layer parser is regex-based and the active indexer is a placeholder. This limits correctness for symbol context and impact analysis.

## Decision

PUNTAX v2 uses a layered code intelligence backend:

```text
LSP for semantic operations
Tree-sitter for structural parsing
Regex fallback for emergency/basic cases
```

## Consequences

Positive:

- More accurate definitions/references/diagnostics.
- Better file/symbol spans.
- Less need for full-file reads.

Negative:

- LSP lifecycle management adds complexity.
- Tree-sitter language support must be managed.

## Implementation notes

- Build backend abstraction before hard-coding one implementation.
- Maintain stale index detection.
- Impact analysis should use indexed edges first, scan fallback second.

