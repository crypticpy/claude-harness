## Coding rules

Priority when trade-offs arise: correctness > maintainability > performance > brevity.

1. **Match effort to task size.** For a task that fits in ≤3 file edits with an obvious fix, execute directly — do not write a plan, do not spawn agents, do not load skills. For larger or ambiguous tasks, use `/plan`.
2. **Before modifying a function or module, check downstream consumers** with the `impact_check` MCP tool. Its answer is a deterministic import-graph + scan result and is always marked `complete:false` — treat it as a fast first pass, not an exhaustive one. For a risky rename or signature change, confirm with the built-in LSP tool (`findReferences`) before editing. Proceed without any check only when the change is an additive new file.
3. **Input handling.** For code that accepts user input, network input, or CMS/API-fed content: validate at the boundary, parameterize SQL, check auth/authz before sensitive operations. Do not add defensive guards inside pure functions.
4. **Match existing code.** Before using an import path, naming style, or framework pattern, grep the codebase for ≥2 existing examples. If the codebase disagrees with a convention you'd otherwise apply, follow the codebase.
5. **Self-correct silently.** Fix typos, missing imports, and obvious syntax errors you notice; do not stop to announce each one.
6. **Destructive operations.** Before `rm -rf`, `DROP`, `force push`, or any irreversible action: name the operation and what it will affect in one sentence, then proceed only if the user explicitly asked for it.

## MCP tooling

Two MCP servers are configured:

- **`Ref`** (remote HTTP) — the standard documentation lookup path. Use for any question about a public library, framework, SDK, or API.
- **`context-layer`** (local) — code intelligence and a persistent memory layer for this codebase/account.

### `Ref` — documentation lookup

Ref is the only tool you should use for external documentation. Do not fall back to `WebSearch`, `WebFetch`, or memory for library/API questions.

Tools:

- `ref_search_documentation` — search Ref's indexed docs. Pass a full-sentence query that includes the language/framework/library name (e.g. "Next.js 15 app router route handler JSON body parsing", not "route handler").
- `ref_read_url` — fetch a specific URL returned by `ref_search_documentation` (or any web URL) and return it as markdown. Use only with URLs from Ref results or URLs the user gave you.

When to call Ref:

- Before citing a library's API surface, method signature, config option, or version-specific behavior that is not already visible in the current file.
- When the user asks "how do I do X with library Y."
- When you are about to write an import, constructor call, or decorator and are not certain it exists in the installed version.

When not to call Ref:

- For questions answered by reading the user's own source code — use `context-layer` tools for that.
- For general programming concepts not tied to a specific library.
- For library questions where a `semantic_lookup` on a local file would answer them (e.g. the codebase wraps the library and you just need to know the wrapper's shape).

### `context-layer` tools (use before reading files by hand)

- `semantic_lookup` — summary of a file (or batch of files) without reading full contents. Use when you only need to know what a file is for.
- `impact_check` — list downstream consumers of a file or symbol. Run before editing a function signature, renaming, or deleting.
- `symbol_context` — get the definition and immediate context for a symbol. Use instead of full-file reads when you only need one function.
- `syntax_check` — tree-sitter parse gate for a file; catches syntax errors without running a compiler.
- `code_map_outline` — token-cheap directory/file outline from the code map.
- `what_changed` — recent edits to a file across sessions.
- `brain_search` — search the memory layer (lessons, conventions, hot-files, file-insights) for prior knowledge about this codebase or prior mistakes.
- `mistake_log` — record a mistake when you catch one, so it's searchable later.
- `session_summary` — record a short session summary at natural stopping points.
- `mission_charter` — set/get/clear the session's steering charter (mission, scope prefixes, constraints). The harness re-injects it verbatim after every compaction and warns on out-of-scope edits.
- `refactor_manifest` — append-only work-list for long refactors. Items tick off automatically when their file is edited; remaining items re-inject after every compaction.

When a confirmed plan spans ≥6 files or is likely to outlive a compaction, set a `mission_charter` (and a `refactor_manifest` when the work is an enumerable file list) before starting, and clear both when the work is done.

Order of preference: `Ref` for external docs, `context-layer` for this codebase, raw file reads only when neither applies.

## Memory layer

Persistent state lives in `~/.claude/context-layer/`:

- `lessons.jsonl` — per-session lessons written by the trace-diagnosis hook on PreCompact.
- `conventions.json` — observed naming/style patterns.
- `hot-files.json` — files touched often.
- `file-insights.json` — per-file summaries.
- `user-prefs.json` — workflow/style preferences.

Read via `brain_search` when starting work on an unfamiliar area. Do not edit these files directly unless explicitly told to.

## Sub-agents

Default is single-agent execution. Spawn a sub-agent only when one of these is true:

- The task has ≥3 independent workstreams that touch disjoint files (e.g., backend schema + frontend UI + tests) — dispatch one agent per workstream in parallel.
- Exploration requires reading >10 files to build context — dispatch one `Explore` agent with a bounded question.
- You are running `/freview` — that command spawns review agents by design.

When you do spawn a sub-agent:

- Give it one objective, the specific files/paths it owns (exclusively), and the exact output shape you expect back.
- Never assign overlapping files to two parallel agents. If files would overlap, sequence the work instead.
- Do not spawn a sub-agent for a task that would fit in a single tool call.

Do not describe the system as "a team of specialists" or use phrasing like "the planning agent." Sub-agents are a tool you reach for under the conditions above, not a standing staff.

## Review gates

- `/freview` runs the `final-review-completeness` and `principal-code-reviewer` agents in parallel against current session work. Run it before reporting done when the change modifies ≥6 files, or when the change touches auth, input handling, or payments. Otherwise skip it.
- For smaller changes, the edit-hook self-check output is sufficient.

## Git

- Use conventional commit prefixes: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`.
- Run `git status` before committing.
- Never push without user confirmation. Never force push.
- Commit smartly as needed to keep all work well organized: commit each logical unit of work when it's complete and tested, one concern per commit, rather than letting large bodies of work pile up uncommitted or waiting to be asked.

## Behavioral guidelines

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
