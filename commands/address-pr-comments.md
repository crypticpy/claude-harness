---
description: Drain new bot review comments from a babysit run and address each — push a fix when we agree, post a reasoned reply via gh api when we disagree, so the intelligence lives in PR history.
---

# /address-pr-comments — process bot review feedback

While `/babysit-pr <N>` is running in the background, it appends new bot comments to `/tmp/babysit-pr<N>.events.jsonl` (one JSON line per event). This command drains that queue and handles each comment intelligently:

- **Agree with the suggestion** → make the code change in the worktree, commit, push. The babysit detects the new activity and resets its quiet counter, so the auto-merge waits for the next review cycle.
- **Disagree with reasoning** → post a reply via `gh api` so the rationale is part of the PR's permanent record. Future reviewers (human or LLM) will see why we made the call.
- **Trivial noise / out-of-scope nit** → post a brief polite reply explaining we're not changing it (e.g., "thanks — leaving as-is, this matches existing repo conventions in `X.ts`"). Same goal: keep the reasoning in history.

The point: never silently ignore bot feedback. Either fix it or document the disagreement.

## Usage

```
/address-pr-comments <pr-number>
/address-pr-comments <pr-number> --dry-run    # print decisions, don't push or post
```

If no number is passed, ask the user — don't guess.

## Steps

### 1. Locate state

- Events file: `/tmp/babysit-pr<N>.events.jsonl` — must exist (else tell the user the babysit isn't running)
- Cursor file: `/tmp/babysit-pr<N>.cursor` — stores the line offset already processed (default 0)
- Repo + branch + worktree: read from `<repo-root>/.claude/state/pr-<N>.json` (the babysit writes this on startup)

### 2. Compute new events

```bash
total=$(wc -l < /tmp/babysit-pr<N>.events.jsonl)
cursor=$(cat /tmp/babysit-pr<N>.cursor 2>/dev/null || echo 0)
```

If `total == cursor`, nothing new. Tell the user "no new comments since last drain" and exit.

Otherwise tail the new lines: `tail -n +$((cursor + 1)) /tmp/babysit-pr<N>.events.jsonl`.

### 3. For each new event

Parse the JSON line. Fields available: `ts`, `endpoint`, `id`, `user`, `body` (first 280 chars). Strip the `issue-` or `review-` prefix from `id` to get the raw comment ID for API calls.

Fetch the full comment body for context:

- For `pulls/<N>/comments` (inline review comments): `gh api repos/<REPO>/pulls/comments/<id>` — fields include `body`, `path`, `line`, `diff_hunk`, `commit_id`
- For `issues/<N>/comments` (issue/PR-level comments): `gh api repos/<REPO>/issues/comments/<id>`
- For `pulls/<N>/reviews` (review summaries): `gh api repos/<REPO>/pulls/<N>/reviews/<id>`

**Filter out non-actionable noise**: pure status updates ("@coderabbitai is reviewing"), Vercel deploy bot summaries, Greptile trial-limit messages, Sourcery "looks great" no-op approvals. Mark those as `dismissed: noise` in your processing log without posting anything.

### 4. Classify each actionable comment

Read the full comment body + the diff hunk it references. Classify into one of:

- **`agree`** — the suggested change is correct and applies to our code. Examples: real bug, security issue, type error, broken edge case.
- **`disagree-with-reasoning`** — the suggestion misreads the code, conflicts with project conventions, or proposes premature abstraction. Have a defensible "why."
- **`out-of-scope`** — valid feedback but addresses something this PR isn't trying to do. Document why we're deferring.
- **`noise`** — pure style nit / restating obvious things / wrong about the language. Brief polite dismissal.

When unsure between agree and disagree, **err on the side of the bot being right** for genuine code-quality concerns, and on the side of the maintainer's existing conventions for style. If genuinely 50/50, ask the user.

### 5. Take action

**For `agree`**:

1. `cd` to the worktree (from the state file)
2. Make the edit (`Edit` tool)
3. Stage **only** the file you touched (`git add <file>`)
4. Commit with a HEREDOC message referencing the reviewer:

   ```
   fix: <one-line description>

   Addresses <reviewer-bot> review on PR #<N>.

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   ```

5. Push: `git push` (no -u flag, upstream already set)

Don't reply when pushing a fix — the bot reviewers usually mark resolved automatically once the line changes. If they don't, post a one-liner: "Fixed in <short-sha>."

**For `disagree-with-reasoning`, `out-of-scope`, or `noise`**:

Post a reply via `gh api`. The endpoint depends on the comment type:

- **Inline review comment reply** (preferred — threads in the right place):
  ```bash
  gh api -X POST repos/<REPO>/pulls/<N>/comments/<id>/replies \
    -f body="<your reply text>"
  ```
- **Issue/PR-level comment** (just adds a new comment, doesn't thread):
  ```bash
  gh api -X POST repos/<REPO>/issues/<N>/comments \
    -f body="<your reply text>"
  ```
- **Review summary** (no direct reply API; respond at PR-level instead):
  ```bash
  gh api -X POST repos/<REPO>/issues/<N>/comments \
    -f body="<your reply, quoting which review you're responding to>"
  ```

Reply tone: terse, concrete, specific. State your reasoning in 1–3 sentences. Cite the file/line/convention you're following when applicable. No filler ("Thanks for the review!"), no LLM hedging.

Examples:

> Leaving as-is. This file uses `datetime.now(timezone.utc)` everywhere else (`backend/app/discovery_service.py:127`, `backend/app/worker.py:412`). Switching just this one site would introduce inconsistency.

> Deferring to a follow-up PR. This PR is scoped to the timezone fix; refactoring the helper into a shared module changes ~8 callers and deserves its own diff.

> Disagree — the suggestion would re-introduce the race condition we just fixed. The lock check at L92 must happen before the `await`, not after.

### 6. Update the cursor and report

```bash
echo $total > /tmp/babysit-pr<N>.cursor
```

Report to the user, in a single message:

- N events processed (out of M total)
- Per-event: `agree → pushed <sha>` / `disagree → replied to <id>` / `noise → dismissed`
- The babysit task is still running (don't stop it)
- If `--dry-run` was passed, NONE of the side effects happen — just print the classification table

### Failure handling

- `gh api` rejects (e.g. 422 Unprocessable Entity, wrong endpoint for the comment type) → log the failure for that comment, continue with the rest, advance the cursor so we don't re-attempt. Tell the user at the end which IDs failed and why.
- The worktree path from the state file no longer exists → tell the user the babysit may have already merged and cleaned up; do not invent a new path.

## Guardrails

- **Never push to a branch other than the PR's head branch.** Read it from the state file or `gh pr view`.
- **Never close the PR** based on a comment.
- **Never resolve a review thread you didn't address** — that's lying to the reviewers.
- **Never post the same reply twice** — the cursor protects against duplicate processing, but if a comment posting failed and you retry, check `gh api repos/<REPO>/pulls/<N>/comments/<id>/replies` to confirm yours isn't already there.
- **One commit per addressed comment cluster** (don't batch unrelated fixes into one commit — keeps the review history clean).
- **If you can't classify a comment confidently, surface it to the user** rather than guessing. Better to pause than to post a wrong reply that lives in PR history forever.
