---
description: Aggregate session lessons and surface proposed harness improvements for user review.
---

You are running the harness self-evolution analysis. This reads `lessons.jsonl` (written by the trace-diagnosis hook on PreCompact), aggregates patterns, calls the synthesizer, and presents proposals for approval.

## Step 1: Run the analysis

```bash
echo '{}' | node ~/.claude/hooks/unified/unified-hook.mjs evolve
```

If the module returns `success: false`, report the reason to the user and stop. Common reasons: not enough sessions have hit PreCompact yet, or no API key is configured.

## Step 2: Read the proposals

If the run succeeded, read:

```
~/.claude/hooks/unified/evolution/proposals.md
```

## Step 3: Present

For each proposal, show the user:
- title, target file, the exact change, confidence level
- your own one-line take: agree, disagree, or "need more data"

Present proposals one at a time. Wait for an explicit approve/reject from the user before moving to the next.

## Step 4: Apply approved changes

For each approval:
1. Read the target file.
2. Make the change exactly as described in the proposal.
3. In `proposals.md`, change the status line from `[ ] Pending review` to `[x] Applied <YYYY-MM-DD>`.

For each rejection: change the status line to `[-] Rejected <YYYY-MM-DD> — <one-line reason from the user>`.

## Step 5: History (optional)

If the user asks about trends, read `~/.claude/hooks/unified/evolution/history.jsonl` and report what changed across recent runs. Do not open it unsolicited.

## Rules

- Never apply a proposal without explicit user approval.
- If a proposal contradicts `CLAUDE.md`, surface the conflict and ask which wins before applying.
- Stop condition: every proposal has an approve/reject status logged.
