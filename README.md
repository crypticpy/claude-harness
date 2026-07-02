# Claude Code Custom Harness

Personal Claude Code configuration with the **Memento Architecture** — a hook system that gives Claude persistent memory, self-diagnosis, and self-improvement across compactions and sessions.

## What This Does

Claude Code's context window compacts every ~154K tokens, losing detailed memory of what happened. This harness solves that with:

- **Session Memory** — headless `claude -p` (Haiku) summarizes each compaction, building a narrative that persists across the entire session
- **Trace Diagnosis** — headless `claude -p` (Haiku) analyzes full session transcripts to extract lessons from failures
- **Rolling Log** — Every tool operation logged with timestamps, creating a searchable audit trail
- **Context Injection** — On each prompt, recent lessons and project context are injected into Claude's context
- **Self-Evolution** — `/evolve` aggregates lessons across sessions and proposes harness improvements
- **Deep Retrospective** — `/retrospective` analyzes ALL conversation history for cross-project meta-learnings
- **Long-Session Steering** — a mission charter re-injected **verbatim** after every compaction, a refactor manifest that ticks itself off as files are edited, and drift tripwires (out-of-scope edits, removed public exports, flaky tests)

## Architecture

```
~/.claude/
├── settings.template.json          # Hook routing config (templated)
├── CLAUDE.md                       # Global instructions
├── install.sh / uninstall.sh       # Setup scripts
│
├── hooks/unified/
│   ├── unified-hook.mjs            # Event router (entry point for all hooks)
│   ├── config.json                 # LLM models, formatters, thresholds
│   └── modules/
│       ├── session-memory.mjs      # Memory across compactions
│       ├── session-start.mjs       # Context injection on prompt
│       ├── trace-diagnosis.mjs     # Failure analysis via headless claude -p
│       ├── rolling-log.mjs         # Operation audit trail
│       ├── self-evolution.mjs      # Cross-session lesson synthesis
│       ├── deep-retrospective.mjs  # Full history analysis
│       ├── context-report.mjs      # Token usage warnings
│       ├── quality-gates.mjs       # End-of-session checks
│       ├── verification-check.mjs  # Three-tier verification
│       ├── format-lint.mjs         # Auto-format on edit
│       ├── edit-history.mjs        # File edit tracking
│       ├── skill-activation.mjs    # Skill suggestions
│       └── llm-call.mjs            # Shared headless `claude -p` client
│
├── commands/                        # Slash commands
│   ├── plan.md                     # /plan — parallel exploration planning
│   ├── evolve.md                   # /evolve — self-evolution analysis
│   ├── retrospective.md           # /retrospective — deep cross-session review
│   └── freview.md                  # /freview — dual-agent final review
│
├── agents/                          # Custom agents
│   ├── principal-code-reviewer.md
│   └── final-review-completeness.md
│
└── plugins/context-layer/           # MCP plugin (TypeScript)
    ├── src/                         # Semantic lookup, impact check, brain search
    └── package.json
```

## Hook Flow

```
SessionStart     → inject project context + recent lessons; pin git baseline;
                   after compaction: re-inject mission charter (verbatim) + remaining manifest items
UserPromptSubmit → inject session memory + context bar
PostToolUse      → log operation, lint edited files, tick refactor-manifest items,
                   warn on out-of-charter-scope edits
PreCompact       → deterministic checkpoint + auto-distill (LLM distillation threshold-gated)
Stop             → quality gates, verification check, export-surface diff, flaky-test flags
```

## Slash Commands

| Command          | Purpose                                              | Frequency          |
| ---------------- | ---------------------------------------------------- | ------------------ |
| `/plan`          | Create implementation plan with parallel exploration | Per task           |
| `/freview`       | Dual-agent review (completeness + code quality)      | Per deliverable    |
| `/evolve`        | Aggregate lessons, propose harness improvements      | Every ~10 sessions |
| `/retrospective` | Deep analysis across ALL conversation history        | Every ~50 sessions |

## Setup

### Fresh Mac — end to end

One-shot bootstrap that installs everything: harness, tokf, cf-approve, claude-deck, chorus/polyphony, MCP registrations, and shell env vars.

```bash
# Apple Command Line Tools + Homebrew + base CLI
xcode-select --install
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install node gh
gh auth login                        # needed to clone private claude-deck repo

# Required env vars (these get persisted to ~/.zshrc by --bootstrap)
export OPENROUTER_API_KEY=sk-or-...
export REF_API_KEY=ref-...

# Clone harness and bootstrap everything
git clone https://github.com/crypticpy/claude-harness.git ~/.claude
cd ~/.claude
./install.sh --bootstrap
```

`--bootstrap` runs `scripts/bootstrap-mac.sh` first, which:

- `brew install mpecan/tokf/tokf` (token-output filter)
- `npm i -g @abdo-el-mobayad/claude-code-fast-permission-hook` (provides `cf-approve`)
- Clones `crypticpy/claude-deck` to `~/Projects/claude-deck` and runs its `./scripts/install.sh`
- Clones `crypticpy/chorus` to `~/Projects/chorus`, runs `npm install`, then `npm link` (provides both `chorus` and `polyphony` on PATH)
- Appends `OPENROUTER_API_KEY` and `REF_API_KEY` to `~/.zshrc` if set in the current shell and not already present

Then `install.sh` itself:

- Materializes `settings.json` from `settings.template.json`
- Materializes `settings.local.json` from `settings.local.json.template` if absent
- Builds the `context-layer` MCP plugin
- Registers the three first-party MCP servers (`context-layer`, `Ref`, `chorus`) idempotently via `claude mcp add`
- Smoke-tests every hook module
- Prints the live `claude mcp list` output

After bootstrap, sign in to the claude.ai-hosted MCP servers from inside Claude Code (`/mcp`) if you use them: Vercel, Hugging Face, Google Drive, Google Calendar, Gmail.

### Upgrading an existing machine

```bash
cd ~/.claude && git pull && ./install.sh
```

No `--bootstrap` needed once tokf, cf-approve, and the sidecar repos are already present.

### Environment variables

| Variable             | Required            | Purpose                                                                 |
| -------------------- | ------------------- | ----------------------------------------------------------------------- |
| `OPENROUTER_API_KEY` | For chorus sidecar  | chorus/polyphony LLM access (the harness's own hooks no longer need it) |
| `REF_API_KEY`        | Optional            | Ref MCP server access                                                   |

### External integrations

Referenced by hook commands; installed by `scripts/bootstrap-mac.sh` and detected (but not installed) by `install.sh`:

- **Claude Deck** (private repo `crypticpy/claude-deck`, installs to `~/.claude-deck/`) — visual dashboard hooks
- **tokf** (Homebrew `mpecan/tokf/tokf`, data dir `~/Library/Application Support/tokf/`) — token-output filter
- **cf-approve** (npm `@abdo-el-mobayad/claude-code-fast-permission-hook`) — fast permission decisions
- **chorus / polyphony** (public repo `crypticpy/chorus`, package `@crypticpy/polyphony`) — MCP server for chat orchestration
- **Formatters** (`black`, `gofmt`, `rustfmt`, `prettier`) — auto-format on edit (no auto-install)

## LLM Configuration

The hook system calls Claude headlessly (`claude -p --model haiku`) for memory and diagnosis, using the user's existing Claude auth — no API keys:

| Role        | Use                                          | Why                                     |
| ----------- | -------------------------------------------- | --------------------------------------- |
| `recall`    | recall_history, retrospective, evolution     | On-demand transcript analysis           |
| `summarize` | Session memory summaries, distillation       | Fast and cheap for compaction summaries |

Recursion is prevented by a spawn guard: `llm-call.mjs` sets `CLAUDE_HOOK_LLM_SPAWNED=1` on the child, and `unified-hook.mjs` exits immediately in any hook fired from such a child — so a headless call never re-enters the hook system.

Configured in `hooks/unified/config.json`.

## Key Design Decisions

- **Poison Prevention** — Failed LLM calls return `null` instead of stub values, preventing "Unknown/In progress" from propagating through compactions forever
- **Defense in Depth** — `isPoisonedMemory()` checks at read, write, inject, and evolution layers
- **No Feedback Loops** — hook LLM calls go through headless `claude -p` with a spawn-guard env var, so a hook-spawned Claude never triggers hooks of its own
- **Graceful Degradation** — Every hook catches errors silently; a broken hook never blocks Claude's operation
- **Template Settings** — `settings.json` is generated from `settings.template.json` by install.sh, keeping secrets and paths out of the repo
