---
description: Run self-evolution analysis - aggregate lessons across sessions and propose harness improvements
---

# Self-Evolution Protocol

You are running the harness self-evolution analysis. This closes the feedback loop: session failures become lessons, lessons become proposals, proposals become improvements.

## How It Works

1. **Collect**: Read all entries from `lessons.jsonl` (written by trace-diagnosis on PreCompact)
2. **Aggregate**: Group recurring patterns, count frequencies, compute stats
3. **Synthesize**: Call GPT-4.1 to distill patterns into actionable proposals
4. **Review**: Present proposals for user approval before any changes

## Step 1: Run Evolution Analysis

Execute the self-evolution module:

```bash
echo '{}' | node ~/.claude/hooks/unified/unified-hook.mjs evolve
```

If the module returns `success: false` due to insufficient data, explain what's needed:

- Sessions need to hit the PreCompact hook (auto-compact at ~200K tokens)
- The trace-diagnosis module analyzes the transcript and writes lessons
- More sessions = better pattern detection

## Step 2: Review Proposals

If proposals were generated, read the proposals file:

```
Read: ~/.claude/hooks/unified/evolution/proposals.md
```

Present each proposal to the user with:

- The proposal title and target file
- What change is being suggested and why
- Confidence level (high/medium/low)
- Your own assessment: do you agree with the proposal?

## Step 3: Apply Approved Changes

For each proposal the user approves:

1. Read the target file
2. Make the specific change described in the proposal
3. Update the proposal status from `[ ] Pending review` to `[x] Applied (date)`

For rejected proposals, update status to `[-] Rejected (date) - reason`

## Step 4: Evolution History

Check the evolution history to track improvement over time:

```
Read: ~/.claude/hooks/unified/evolution/history.jsonl
```

Report trends: is the harness getting more efficient? Are the same patterns recurring?

## Rules

- NEVER apply proposals without explicit user approval
- Present proposals one at a time for focused review
- If a proposal conflicts with existing CLAUDE.md rules, flag the conflict
- Track all decisions in the proposals file for future reference
- After applying changes, suggest running /freview to validate
