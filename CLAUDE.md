## Coding rules

Priority when trade-offs arise: correctness > maintainability > performance > brevity.

1. **Match effort to task size.** For a task that fits in ≤3 file edits with an obvious fix, execute directly — do not write a plan, do not spawn agents, do not load skills. For larger or ambiguous tasks, use `/plan`.
2. **Before modifying a function or module, check downstream consumers** with the `impact_check` MCP tool. Its answer is a deterministic import-graph + scan result and is always marked `complete:false` — treat it as a fast first pass, not an exhaustive one. For a risky rename or signature change, confirm with the built-in LSP tool (`findReferences`) before editing. Proceed without any check only when the change is an additive new file.
3. **Input handling.** For code that accepts user input, network input, or CMS/API-fed content: validate at the boundary, parameterize SQL, check auth/authz before sensitive operations. Do not add defensive guards inside pure functions.
4. **Match existing code.** Before using an import path, naming style, or framework pattern, grep the codebase for ≥2 existing examples. If the codebase disagrees with a convention you'd otherwise apply, follow the codebase.
5. **Self-correct silently.** Fix typos, missing imports, and obvious syntax errors you notice; do not stop to announce each one.
6. **Destructive operations.** Before `rm -rf`, `DROP`, `force push`, or any irreversible action: name the operation and what it will affect in one sentence, then proceed only if the user explicitly asked for it.
7. **Prefer modules over monoliths.** When a code file approaches ~500 lines, treat that as a design prompt: extract cohesive sections (a class, a command group, pure helpers) into their own modules instead of growing it. Never stuff a new feature into an already-long file just because it's open — the edit hook fires a one-time nudge at 700 lines, but don't wait for it.

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
- Carry the context the agent cannot derive on its own: the intent of the change, constraints already decided, and where to look first. Agents start blind — a bare "review the changes" or "explore X" prompt forces them to re-derive scope and miss intent.
- Tell it its final message is the deliverable returned to you — raw findings/data in the requested shape, not a human-facing narration.
- Never assign overlapping files to two parallel agents. If files would overlap, sequence the work instead.
- Do not spawn a sub-agent for a task that would fit in a single tool call.

### Orchestrator mode (model-tiered delegation)

When the session model is a top-tier model — **Fable 5** or any **Opus** (check the "You are powered by" line in your environment) — treat yourself as the orchestrator and push delegated work down a model tier via the Agent tool's `model` parameter. The spawn conditions above still decide *whether* to spawn; this decides *which model* the sub-agent runs on:

- `model: "sonnet"` — Explore sweeps, doc lookups, log/test-output triage, and mechanical multi-file edits that follow an explicit spec you wrote. Same choice on Fable and Opus sessions; do not drop below sonnet for code work (haiku only for trivial non-code chores, and only if you'd have used it anyway).
- Judgment-heavy subtasks (the `/freview` review agents, Plan agents, tricky debugging that doesn't need the orchestrator's full conversation context): `model: "opus"` on a Fable session; omit `model` (inherit) on an Opus session.
- Omit `model` on a Fable session only when the subtask *is* the hard part of the session.

In orchestrator mode the exploration threshold also drops: dispatch a `model: "sonnet"` Explore agent when answering would need reading >5 unfamiliar files (instead of >10). Reserve the orchestrator's own context and output for synthesis, decisions, and the final integration edits — that is where the top tier earns its cost.

On a Sonnet (or smaller) session model, ignore this subsection and spawn sub-agents with the default (inherited) model.

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

### 5. Finish the Worklist

**A confirmed plan is authorization to complete every item on it.**

- Do not stop at item 4 of 6 to re-confirm. Pause mid-worklist only when something material changed: a step invalidated the plan's assumptions, a destructive action surfaced, or scope genuinely shifted.
- When a sensible default exists, state the choice you made and proceed — don't ask.
- Track multi-item work with the task list or `refactor_manifest`, and set a `mission_charter` when the work may outlive a compaction, so context loss never strands remaining items.
- When two designs cost the same, choose the one you'd want to inherit. Elegance is the tiebreaker, not a luxury.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
