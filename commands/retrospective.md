---
description: Run the deep retrospective across all history (prompts, sessions, edits, tool ops) and present the resulting report.
---

You are running the periodic cross-session retrospective. Use this ~every 50 sessions, not every session.

## Step 1: Run

```bash
echo '{}' | node ~/.claude/hooks/unified/unified-hook.mjs retrospective
```

Expect 30–60 seconds. If the module returns `success: false`, report the reason and stop.

## Step 2: Read the report

```
~/.claude/hooks/unified/evolution/retrospective-YYYY-MM-DD.md
```

## Step 3: Present

Walk the user through, in order:
1. Efficiency score and trend.
2. Meta-learnings — present the top 3. Skip the rest unless the user asks.
3. Working patterns: strengths, inefficiencies, blind spots.
4. Harness recommendations — present only the high-priority ones first.

Stop after each section and ask if the user wants to drill in. Do not dump the full report.

## Step 4: Raw data (only on request)

If the user wants to drill into a specific pattern, read:

```
~/.claude/hooks/unified/evolution/retrospective-raw-YYYY-MM-DD.json
```

Do not read this file unsolicited.

## Rules

- This is a read-mostly command. It writes only to `~/.claude/hooks/unified/evolution/`.
- Do not apply recommendations from the report without explicit user approval — use `/evolve` flow for that.
- Stop condition: user has decided what (if anything) to act on.
