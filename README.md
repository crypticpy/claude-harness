# Claude Code Custom Harness

Personal Claude Code configuration with the **Memento Architecture** — a hook system that gives Claude persistent memory, self-diagnosis, and self-improvement across compactions and sessions.

## What This Does

Claude Code's context window compacts every ~154K tokens, losing detailed memory of what happened. This harness solves that with:

- **Session Memory** — GPT-4o-mini summarizes each compaction, building a narrative that persists across the entire session
- **Trace Diagnosis** — GPT-4.1 (1M context) analyzes full session transcripts to extract lessons from failures
- **Rolling Log** — Every tool operation logged with timestamps, creating a searchable audit trail
- **Context Injection** — On each prompt, recent lessons and project context are injected into Claude's context
- **Self-Evolution** — `/evolve` aggregates lessons across sessions and proposes harness improvements
- **Deep Retrospective** — `/retrospective` analyzes ALL conversation history for cross-project meta-learnings

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
│       ├── trace-diagnosis.mjs     # Failure analysis via GPT-4.1
│       ├── rolling-log.mjs         # Operation audit trail
│       ├── self-evolution.mjs      # Cross-session lesson synthesis
│       ├── deep-retrospective.mjs  # Full history analysis
│       ├── context-report.mjs      # Token usage warnings
│       ├── quality-gates.mjs       # End-of-session checks
│       ├── verification-check.mjs  # Three-tier verification
│       ├── format-lint.mjs         # Auto-format on edit
│       ├── edit-history.mjs        # File edit tracking
│       ├── skill-activation.mjs    # Skill suggestions
│       ├── api-key.mjs             # Key resolution chain
│       └── llm-call.mjs            # Shared OpenRouter client
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
SessionStart     → inject project context + recent lessons
UserPromptSubmit → inject session memory + context bar
PostToolUse      → log operation, format edited files
PreCompact       → save session memory via LLM, run trace diagnosis
Stop             → quality gates, verification check
```

## Slash Commands

| Command          | Purpose                                              | Frequency          |
| ---------------- | ---------------------------------------------------- | ------------------ |
| `/plan`          | Create implementation plan with parallel exploration | Per task           |
| `/freview`       | Dual-agent review (completeness + code quality)      | Per deliverable    |
| `/evolve`        | Aggregate lessons, propose harness improvements      | Every ~10 sessions |
| `/retrospective` | Deep analysis across ALL conversation history        | Every ~50 sessions |

## Setup

### New Machine Install

```bash
git clone git@github.com:crypticpy/claude-harness.git ~/.claude
cd ~/.claude
./install.sh
```

### Environment Variables

| Variable             | Required         | Purpose                                    |
| -------------------- | ---------------- | ------------------------------------------ |
| `OPENROUTER_API_KEY` | For LLM features | Session memory, trace diagnosis, evolution |
| `REF_API_KEY`        | Optional         | Ref MCP server access                      |

### Optional Integrations

The harness detects and integrates with these if installed:

- **Claude Deck** (`~/.claude-deck/`) — Visual dashboard hooks
- **tokf** (`~/Library/Application Support/tokf/`) — Token usage tracking
- **Formatters** — `black`, `gofmt`, `rustfmt`, `prettier` (used by auto-format on edit)

## LLM Configuration

The hook system uses external LLMs (via OpenRouter) for memory and diagnosis — Claude doesn't call itself:

| Model       | Use                            | Why                                     |
| ----------- | ------------------------------ | --------------------------------------- |
| GPT-4.1     | Trace diagnosis, retrospective | 1M context for full transcript analysis |
| GPT-4o-mini | Session memory summaries       | Fast and cheap for compaction summaries |

Configured in `hooks/unified/config.json`.

## Key Design Decisions

- **Poison Prevention** — Failed LLM calls return `null` instead of stub values, preventing "Unknown/In progress" from propagating through compactions forever
- **Defense in Depth** — `isPoisonedMemory()` checks at read, write, inject, and evolution layers
- **No Self-Calls** — Claude never calls itself; GPT handles memory/diagnosis to avoid feedback loops
- **Graceful Degradation** — Every hook catches errors silently; a broken hook never blocks Claude's operation
- **Template Settings** — `settings.json` is generated from `settings.template.json` by install.sh, keeping secrets and paths out of the repo
