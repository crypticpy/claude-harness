# AGENTS.md — working on this harness

This file applies only when editing the Claude Code harness at `~/.claude/`. For broader background, see `README.md`.

## What this repo is

A personal Claude Code harness ("Memento"). It's a collection of hook scripts, slash commands, custom agents, and an MCP plugin, all coordinated through `settings.json`. The harness wraps Claude Code — Claude Code itself is upstream.

## Where things live

- `settings.json` — generated, runtime hook routing. Don't commit secrets.
- `settings.template.json` — source of truth for hook wiring. Edits to runtime routing must land here too.
- `hooks/unified/unified-hook.mjs` — single entry point; routes 6 hook events (`prompt`, `precompact`, `post-edit`, `post-tool`, `stop`, `session-start`) to `modules/*.mjs`.
- `hooks/unified/config.json` — LLM model selection, formatter list, feature toggles.
- `hooks/unified/modules/` — one file per concern. New behavior usually means a new module + a line in `unified-hook.mjs`.
- `commands/*.md` — slash commands (markdown frontmatter format).
- `agents/*.md` — custom subagent definitions.
- `plugins/context-layer/` — TypeScript MCP plugin. Build with `npm run build` from that directory; `dist/` is gitignored.

## Build / test

- **No test suite.** Verify changes by editing a file (triggers `post-edit`), submitting a prompt (triggers `prompt`), or inspecting the rolling log at `hooks/unified/memories/operations.jsonl`.
- **Context-layer plugin**: after editing any `plugins/context-layer/src/**/*.ts`, run `cd plugins/context-layer && npm run build`. The compiled `dist/hooks/personality-hook.js` is what Claude Code actually invokes.
- **Install / uninstall**: `./install.sh` regenerates `settings.json` from the template (substituting `$HOME` and `$REF_API_KEY`). Don't hand-edit `settings.json` for anything you want to persist — edit the template.

## Invariants — don't break these

1. **Fail silently.** Every hook module wraps its body in `try/catch` and returns `null` on error. A broken hook must never block Claude's loop. If you add a new module, follow the pattern in `context-report.mjs` or `session-memory.mjs`.
2. **Poison prevention.** Session memory and lessons must never write `"Unknown"`, `"In progress"`, `"TBD"`, or any LLM-failure placeholder. Use `isPoisonedMemory()` from `hooks/unified/modules/poison-check.mjs` at read AND write paths. Commit `7afa309` repaired this; don't regress it.
3. **No self-calls.** Hooks must not invoke Claude. Memory/diagnosis go through `llm-call.mjs` → OpenRouter → GPT-4.1 / GPT-4o-mini. Routing Claude through its own hooks creates feedback loops.
4. **Compact threshold lives in env.** `CLAUDE_CODE_AUTO_COMPACT_WINDOW` × `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` / 100. Both `context-report.mjs` and `plugins/context-layer/src/hooks/personality-hook.ts` read these. Never hardcode a token threshold.
5. **One-shot side effects use per-session markers.** See `context-report.mjs` — `writeFileSync(..., { flag: 'wx' })` makes the marker write atomic against concurrent hook runs.

## Files / dirs that are NOT source

- `.credentials.json` — gitignored, contains the OpenRouter key. Never read, never commit.
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

- The PostToolUse hook reformats edited files. If you Edit a `.ts` / `.py` / `.go` file and a follow-up Edit fails on whitespace, re-Read first — the formatter may have rewritten the region.
- `CLAUDE.md` at this repo's root is the **global** Claude Code instructions file. It loads in every project on this machine — don't put harness-specific content there.
- `claude-deck` and `tokf` hooks are referenced in `settings.template.json` but live outside this repo. They are optional; their absence is non-fatal because each invocation is its own shell command and failure is swallowed.
