---
description: Deep cross-session analysis across ALL conversation history — extract meta-learnings spanning projects, tech stacks, and time
---

# Deep Retrospective Protocol

You are running a comprehensive cross-session analysis. Unlike `/evolve` (which reads lessons.jsonl), this reads ALL available data:

- 9,500+ prompts from global history
- 80+ session memory summaries
- 7,000+ file edit records
- 8,600+ tool operation logs
- 50+ project memory files

This is designed for periodic use (~every 50 sessions) to extract meta-learnings.

## Step 1: Run the Retrospective

Execute the analysis via the unified hook:

```bash
echo '{}' | node ~/.claude/hooks/unified/unified-hook.mjs retrospective
```

This will take 30-60 seconds as it:

1. **Extracts** patterns from each data source (local, no LLM)
2. **Aggregates** cross-session patterns
3. **Synthesizes** meta-learnings via GPT-4.1 (1M context)
4. **Generates** a versioned report

## Step 2: Review the Report

If successful, read the generated report:

```
Read: ~/.claude/hooks/unified/evolution/retrospective-YYYY-MM-DD.md
```

Present each section to the user:

1. **Efficiency Report** — overall health score and trend
2. **Meta-Learnings** — non-obvious insights spanning multiple projects
3. **Working Patterns** — strengths, inefficiencies, blind spots
4. **Harness Recommendations** — specific changes to improve the setup

## Step 3: Apply Insights

For each meta-learning or recommendation the user wants to act on:

1. **CLAUDE.md changes**: Add new behavioral rules based on observed patterns
2. **Config changes**: Adjust thresholds, add new settings
3. **Hook changes**: Modify modules based on tool usage patterns
4. **Memory updates**: Save key insights to project memory files

## Step 4: Check Raw Data

The raw aggregated data is saved alongside the report:

```
Read: ~/.claude/hooks/unified/evolution/retrospective-raw-YYYY-MM-DD.json
```

Use this to drill into specific patterns (e.g., "which project has the most file churn?").

## Rules

- This is a READ-HEAVY operation — it reads many files but only writes to the evolution/ directory
- NEVER apply recommendations without user approval
- Present the most actionable findings first
- If the LLM synthesis fails, the raw data is still saved — present the aggregated stats directly
- Compare with previous retrospectives if they exist to track trends
