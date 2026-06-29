# 06 — Code Map Index

## Goal

Convert the current context-layer from file summaries and scan-based lookup into a real local code map:

```text
files -> symbols -> edges -> reads/chunks -> diagnostics
```

## Current state

- `semantic_lookup` reads files, parses with regex, and stores file-level summaries.
- `symbol_context` searches parse results, not a true LSP.
- `impact_check` scans project files and import maps.
- `active-indexer.ts` currently only verifies readability and stores index state.

## Target layers

### Tier 1 — LSP

Use LSP for:

```text
definition
references
diagnostics
hover/type info
rename/code actions where supported
workspace/document symbols
```

### Tier 2 — Tree-sitter

Use Tree-sitter for:

```text
file outlines
symbol spans
imports
syntactic call sites
containment
language-agnostic chunking
```

### Tier 3 — Regex fallback

Keep regex parser only for emergency/basic fallback and tests.

## Code map schema

See `schemas/code-map.schema.sql`.

Core tables:

```text
projects
files
symbols
edges
reads
chunks
diagnostics
index_runs
```

## Edge types

```text
contains
imports
exports
calls
references
extends
implements
tests
configures
reads_table
writes_table
```

## Confidence tiers

```text
lsp        LSP-derived, high confidence
extracted  syntax-extracted from Tree-sitter
resolved   post-pass resolved
inferred   heuristic or naming-based
ambiguous  multiple possible targets
```

## Indexing flow

```text
refresh_index(projectDir, changedFiles?)
  -> detect changed files by hash
  -> parse changed files with Tree-sitter/fallback
  -> update files/symbols/import edges
  -> run post-pass resolution
  -> optionally query LSP for references/diagnostics
  -> write index_runs entry
```

## Impact check evolution

Current `impact_check` can remain as fallback. Target behavior:

```text
impact_check(file/symbol)
  1. ensure index freshness
  2. query indexed edges
  3. add tests and diagnostics
  4. if missing/stale, run fallback scan
  5. label fallback confidence
```

## Symbol context evolution

Current `symbol_context` should become:

```text
symbol_context(symbolName, filePath?)
  -> LSP find symbol / document symbol if available
  -> code-map symbol table fallback
  -> Tree-sitter span extraction fallback
  -> regex fallback last
```

## Staleness policy

Every file row has:

```text
hash
mtime
indexed_at
```

If a file changed since indexing:

```text
semantic_lookup returns stale=true
impact_check warns stale=true
puntax_context avoids stale claims unless no alternative
```

## Acceptance criteria

- Active indexer writes real file and symbol rows.
- `semantic_lookup` can answer from index without re-reading when fresh.
- Post-edit hook updates changed file index.
- Impact check uses indexed edges when available.
- Stale index is detected and labeled.

