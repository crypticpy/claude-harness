# AGENTS.md — working on this harness

This file applies only when editing the Claude Code harness at `~/.claude/`. For broader background, see `README.md`.

## What this repo is

A personal Claude Code harness ("Memento"). It's a collection of hook scripts, slash commands, custom agents, and an MCP plugin, all coordinated through `settings.json`. The harness wraps Claude Code — Claude Code itself is upstream.

## Where things live

- `settings.json` — generated, runtime hook routing. Don't commit secrets.
- `settings.template.json` — source of truth for hook wiring. Edits to runtime routing must land here too.
- `hooks/unified/unified-hook.mjs` — single entry point; routes 8 hook events (`prompt`, `precompact`, `post-edit`, `post-tool`, `stop`, `session-start`, `retrospective`, `evolve`) to `modules/*.mjs`.
- `hooks/unified/config.json` — LLM model selection, formatter list, feature toggles.
- `hooks/unified/modules/` — one file per concern. New behavior usually means a new module + a line in `unified-hook.mjs`.
- `commands/*.md` — slash commands (markdown frontmatter format).
- `agents/*.md` — custom subagent definitions.
- `plugins/context-layer/` — TypeScript MCP plugin. Build with `npm run build` from that directory; `dist/` is gitignored.

## Build / test

- **Vitest suite**: `cd plugins/context-layer && npx vitest run` covers both the plugin (`tests/*.test.ts`) and the hook modules (the suite imports `hooks/unified/modules/*.mjs` directly — cross-runtime parity tests keep the `.ts`/`.mjs` twins in lockstep). For live hook behavior, edit a file (triggers `post-edit`), submit a prompt (triggers `prompt`), or inspect the rolling log at `hooks/unified/memories/operations.jsonl`.
- **Context-layer plugin**: after editing any `plugins/context-layer/src/**/*.ts`, run `cd plugins/context-layer && npm run build`. The compiled `dist/hooks/personality-hook.js` is what Claude Code actually invokes.
- **Install / uninstall**: `./install.sh` regenerates `settings.json` from the template (substituting `$HOME` and `$REF_API_KEY`). Don't hand-edit `settings.json` for anything you want to persist — edit the template.

## Invariants — don't break these

1. **Fail silently.** Every hook module wraps its body in `try/catch` and returns `null` on error. A broken hook must never block Claude's loop. If you add a new module, follow the pattern in `context-report.mjs` or `session-memory.mjs`.
2. **Poison prevention.** Session memory and lessons must never write `"Unknown"`, `"In progress"`, `"TBD"`, or any LLM-failure placeholder. Use `isPoisonedMemory()` from `hooks/unified/modules/poison-check.mjs` at read AND write paths. Commit `7afa309` repaired this; don't regress it.
3. **No hook feedback loops.** Hook LLM calls go through `llm-call.mjs` → headless `claude -p --model <model> --output-format text` (the user's Claude auth; no API keys). Two roles in `config.json` `llm`: `summarize` = `haiku` for the per-compaction session summary and threshold-gated distillation; `recall` = `haiku` for on-demand `recall_history` / deep-retrospective / self-evolution. The recursion guard is load-bearing: `llm-call.mjs` sets `CLAUDE_HOOK_LLM_SPAWNED=1` on the child, and the very top of `unified-hook.mjs` `main()` exits 0 when that var is set — never remove either side, or a hook-spawned Claude will fire hooks that spawn Claude. `maxTokens` is advisory only (forwarded via `CLAUDE_CODE_MAX_OUTPUT_TOKENS`); prompts are capped at 700K chars. Per-edit LLM summarization is disabled (`rolling_log.backgroundEnrichment: false`) — the rolling log records edits locally with no LLM call.
4. **Compact threshold = `CLAUDE_CODE_AUTO_COMPACT_WINDOW` × 0.80.** Claude Code fires auto-compact near 80% of the configured window in practice; `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` is documented but ignored on the main thread (anthropics/claude-code#36381), so we don't read it. The 0.80 factor lives in `context-report.mjs`, `statusline-command.sh`, and `plugins/context-layer/src/hooks/personality-hook.ts` — keep them in sync. Never hardcode a token threshold.
5. **One-shot side effects use per-session markers.** See `context-report.mjs` — `writeFileSync(..., { flag: 'wx' })` makes the marker write atomic against concurrent hook runs.

## Files / dirs that are NOT source

- `.credentials.json` — gitignored, legacy OpenRouter key from the pre-`claude -p` era. No harness code reads it anymore; never commit it.
- `hooks/unified/memories/` — runtime state (lessons, summaries, markers). Don't hand-edit.
- `*.bak` files — leftovers from in-flight edits. Inspect before deleting in case they hold the user's work.
- `plugins/context-layer/dist/` — build artifact, gitignored.

## When editing a module

- Read the module's existing shape before adding to it; modules vary in their export signature (some `export async function`, some default exports).
- If your change affects what a hook _outputs_ to Claude (stdout), test it by running the hook manually with a fake event:
  ```bash
  echo '{"session_id":"test","cwd":"/tmp"}' | node hooks/unified/unified-hook.mjs prompt
  ```
- Always update `settings.template.json` if you're changing hook routing, not just `settings.json`.

## Slash commands and agents

Markdown files with YAML frontmatter. The harness doesn't validate them at install time — a malformed frontmatter block will fail silently at invocation. When adding one, copy the shape from an existing file (`commands/plan.md`, `agents/principal-code-reviewer.md`).

## Common gotchas

- Auto-format on edit is **disabled** (`formatting.enabled: false` in `config.json`) — the PostToolUse hook runs read-only lint instead. Run formatters manually (`npx prettier --write` for the plugin, which has a prettier config).
- `CLAUDE.md` at this repo's root is the **global** Claude Code instructions file. It loads in every project on this machine — don't put harness-specific content there.
- `claude-deck` and `tokf` hooks are referenced in `settings.template.json` but live outside this repo. They are optional; their absence is non-fatal because each invocation is its own shell command and failure is swallowed.
