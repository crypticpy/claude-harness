---
description: Run the completeness and code-review agents in parallel against the current session's changes, then aggregate findings.
---

You are running a final review of the current session's work.

## Step 1: Identify scope

Scope comes from git — you already know what this session changed; git tells you exactly what state it's in:

```bash
git status --short          # uncommitted work (staged + unstaged + untracked)
git diff --stat HEAD        # per-file churn for the uncommitted work
git log --oneline -10       # commits this session may have already made
```

- **Uncommitted changes exist** → scope is the uncommitted diff (`git diff HEAD`), plus any files this session committed earlier.
- **Tree is clean** → scope is the commits made this session: `git diff --stat <base>..HEAD` where `<base>` is the last commit before this session's work began. You know which commits are yours from the conversation; if genuinely ambiguous, ask the user rather than guessing a base.

Assemble: the explicit file list, the per-file `--stat` churn counts, and a 1–2 sentence statement of what the session's change set out to do (you know this from the conversation — the agents don't).

If the file list is empty, stop and report "No changes to review."

## Step 2: Spawn both agents in parallel

Issue a single message with two Task tool calls so they run concurrently.

Both prompts must carry the context you assembled in Step 1 — the agents start blind; a bare "review the changes" prompt makes them re-derive scope and miss intent.

### Task 1 — `final-review-completeness`

```
Intent: <1–2 sentences — what this change set out to do>.
Scope: exactly these files (with churn): <file — +A/-D> per line.
Whether committed or uncommitted, and the diff command that reproduces the change set.
Produce the completeness report per your agent spec. Do not edit files.
```

### Task 2 — `principal-code-reviewer`

```
Intent: <1–2 sentences — what this change set out to do>.
Scope: the diff for exactly these files (with churn): <file — +A/-D> per line, and the diff command that reproduces it.
Verification priorities: name the highest-risk files first — auth/input-handling/payment code, public API surface changes, cross-runtime twins (.ts/.mjs pairs), anything with heavy churn — and tell the agent to verify those before the rest.
Read CLAUDE.md for project conventions.
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
