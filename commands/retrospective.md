---
description: Run the deep retrospective across all history (prompts, sessions, edits, tool ops) and present the resulting report.
---

You are running the periodic cross-session retrospective. Use this ~every 50 sessions, not every session.

## Step 1: Run

```bash
echo '{}' | node ~/.claude/hooks/unified/unified-hook.mjs retrospective
```

Expect 1–4 minutes (the synthesis LLM call reads the whole cross-session aggregation) — set the Bash timeout to at least 300000 ms. The command prints a JSON result whose `reportPath` field is the file to read next.

If it returns `success: false`:

- `reportPath` pointing at `retrospective-raw-*.json` means LLM synthesis failed but the raw aggregation was saved. Report the failure message and offer to re-run once (a transient LLM failure is the common cause). Do not present the raw JSON as if it were the report.
- Otherwise report the `message` and stop.

## Step 2: Read the report

Read the markdown file at the `reportPath` from Step 1's output (`retrospective-<date>.md`). Take the path from the result — do not reconstruct the filename from today's date.

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
