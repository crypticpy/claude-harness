---
description: Run the completeness and code-review agents in parallel against the current session's changes, then aggregate findings.
---

You are running a final review of the current session's work.

## Step 1: Identify scope

Load the session context:

```
Read: .claude/tasks/session-current.md
```

If that file does not exist, fall back to git:

```bash
git diff --name-only HEAD
git log --oneline -5
```

List the files changed. If the list is empty, stop and report "No changes to review."

## Step 2: Spawn both agents in parallel

Issue a single message with two Task tool calls so they run concurrently.

### Task 1 — `final-review-completeness`

```
Scope: the files changed in this session (list them explicitly in the prompt).
Read .claude/tasks/session-current.md for context if it exists.
Produce the completeness report per your agent spec. Do not edit files.
```

### Task 2 — `principal-code-reviewer`

```
Scope: the diff for the files changed in this session (list them explicitly in the prompt).
Read .claude/tasks/session-current.md and CLAUDE.md for project context.
Produce the review report per your agent spec. Do not edit files.
```

Both agents must be spawned in the same message. Do not run them sequentially.

## Step 3: Aggregate

After both return, produce this summary to the user:

```
## Final review

**Files reviewed**: <N>

### Blockers (must fix before commit)
- <file:line> — <issue> — (source: completeness | code-review)
...

### Non-blockers
- <file:line> — <issue> — (source: ...)
...

### Recommendation
<Commit | Fix blockers first>
```

Deduplicate issues that both agents flagged — keep one entry and note both sources.

## Rules

- Always spawn both agents. Always in parallel (one message, two Task calls).
- Do not spawn additional reviewers beyond these two, regardless of how many files changed.
- Do not add review dimensions the agents' specs do not cover.
- Do not modify files during review. `/freview` is report-only.
- Stop condition: aggregated summary is presented. The user decides whether to fix or commit.
