# 08 — Context Router and MCP Tools

## Primary tool: `puntax_context`

`puntax_context` is the main v2 tool. It replaces broad always-on injection.

### Purpose

Return the smallest relevant context block for the current task, mode, and token budget.

### Input

```ts
interface PuntaxContextInput {
  task: string;
  projectDir?: string;
  sessionId?: string;
  mode?: "prompt" | "pre_edit" | "resume" | "debug" | "review" | "architecture";
  files?: string[];
  symbols?: string[];
  budgetTokens?: number;
}
```

### Output

```ts
interface PuntaxContextOutput {
  context: string;
  sources: Array<{
    kind: "memory" | "event" | "file" | "symbol" | "permission" | "checkpoint";
    id?: string;
    path?: string;
    line?: number;
    confidence?: string;
  }>;
  nextTools: string[];
  confidence: "high" | "medium" | "low";
  omitted?: {
    reason: string;
    count?: number;
  };
}
```

## Router modes

### `prompt`

Budget: 0–300 tokens.

Use for normal user prompts. Include only:

```text
active checkpoint if resuming
high-severity relevant memory
context budget status
one or two next tool suggestions
```

### `pre_edit`

Budget: 600–1200 tokens.

Use before edit/write. Include:

```text
target file/symbol summary
known high-risk memories for file/symbol
impact_check summary if available
recent edits to same file
target tests if known
```

### `resume`

Budget: 1000–1500 tokens.

Use after compaction or explicit resume. Include:

```text
last checkpoint
working files
open loops
recent failures
actions already attempted
```

### `debug`

Budget: 1000–2000 tokens.

Include:

```text
recent errors
tests run
failure patterns
relevant hot files
known gotchas
```

### `review`

Budget: 1500–3000 tokens.

Include:

```text
changed files
impact radius
tests and diagnostics
high-risk files
review checklist hints
```

### `architecture`

Budget: 1500–3000 tokens.

Include:

```text
key modules
entry points
hot files
project conventions
code-map communities if implemented
```

## Existing tools to keep

```text
semantic_lookup
  File cards. Deterministic summary of purpose, imports, exports, symbols, complexity.

symbol_context
  Symbol definition/span/signature/doc. Should become LSP-backed.

impact_check
  Downstream consumers, callers, tests, risk. Should use code-map edges first.

chunk_ref
  Reuse cached chunks.

brain_search
  Search durable project memory.

what_changed
  Recent event/edit history for file.
```

## New optional tools

```text
memory_write
  Write typed memory with provenance.

index_status
  Report code-map freshness.

refresh_index
  Incremental code-map update.

permission_explain
  Explain permission decision.

session_checkpoint
  Return deterministic session checkpoint.
```

## MCP response style

Responses should be compact. Prefer:

```text
summary
sources
nextTools
warnings
```

over large prose blocks.

## Tool ranking logic

The router should rank context by:

```text
explicit file/symbol match
prompt keyword match
severity
recency
confidence
hot-file score
event relevance
budget cost
```

Pseudo-ranking:

```text
score = fileMatch*5
      + symbolMatch*5
      + severityWeight
      + confidenceWeight
      + recencyWeight
      + hotFileWeight
      - tokenCostPenalty
```

