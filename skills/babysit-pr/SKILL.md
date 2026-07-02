---
name: babysit-pr
description: >
  Babysit one PR through bot review (CodeRabbit, Greptile, Sourcery, Codex)
  via a bash poll loop that auto-squash-merges with --delete-branch once CI
  is green, review has been quiet for two consecutive ticks, AND the comment
  queue has been drained. New bot comments are persisted to an events.jsonl
  queue so the main session can drain and address them via
  /address-pr-comments. Invoke when the user
  types /babysit-pr <N>, asks to "babysit", "watch", "monitor", "drive home"
  a PR, or as the hand-off step from /ship-pr. Does NOT open the PR — call
  /ship-pr or open it manually first.
---

# /babysit-pr — drive one PR to merge

## Usage

```
/babysit-pr <pr-number>            # watch + auto-merge when clean (default)
/babysit-pr <pr-number> --no-merge # watch + report ready, maintainer merges
```

If the user types `/babysit-pr` without a number, ask which PR — don't guess.

## Why bash, not an agent

The earlier `pr-babysitter` background agent stalled silently when the schedule chain dropped or when an internal `sleep` was interrupted. The bash version proved reliable across foresight-app PRs #147, #148, #149: it polls every 90s in a process the OS owns, logs to stdout, writes structured events for the main session to drain, and auto-merges when conditions are met. The script is at `~/.claude/skills/babysit-pr/babysit.sh` — keep it project-agnostic; configuration is via env vars.

## Steps

### 1. Parse args

- `pr_number`: first positional. Required. Must match `^\d+$`.
- `auto_merge`: true unless `--no-merge` appears in args.

If user passed only `--no-merge` without a number, stop and ask which PR.

### 2. Read PR state and detect worktree

```bash
gh pr view <N> --json state,headRefName,baseRefName
```

- If `state != "OPEN"` → tell the user and stop. Don't try to revive.
- `headRefName` → BRANCH for the bash script.
- Repo root → `git rev-parse --show-toplevel` from cwd (or `gh repo view --json defaultBranchRef` to confirm).
- Repo slug → `gh repo view --json nameWithOwner -q .nameWithOwner`.

**Detect worktree**: check `git worktree list --porcelain` for an entry whose branch matches the head ref. If found, capture its absolute path. The bash script removes the worktree after merge — leaving it dangling produces stale state.

### 3. Guard against duplicate babysitters

If `<repo-root>/.claude/state/pr-<N>.json` exists with `merged: false` AND its mtime is within the last 5 minutes, a previous babysit is likely still running. Warn the user before starting a second one. The state file's mtime updates every tick.

You can also check the active task list (`TaskList`) for a previous background bash invocation matching this PR.

### 4. Run the bash script in the background

Invoke with `run_in_background: true`. The script template lives at `~/.claude/skills/babysit-pr/babysit.sh` — do not duplicate it; just exec with env vars.

```bash
PR=<N> \
REPO=<owner/repo> \
BRANCH=<headRefName> \
MAIN=<repo-root-abs-path> \
WORKTREE=<absolute-worktree-path-or-empty> \
AUTO_MERGE=<true|false> \
bash ~/.claude/skills/babysit-pr/babysit.sh > /tmp/babysit-pr<N>.log 2>&1
```

The script truncates `/tmp/babysit-pr<N>.events.jsonl` AND removes `/tmp/babysit-pr<N>.cursor` on start, so each babysit run begins with a clean event queue and a zeroed drain cursor (a stale cursor from a prior run on the same PR would otherwise make `/address-pr-comments` report "nothing new" forever).

### 5. Confirm to the user and exit this turn

Brief message: PR number, PR URL, that the babysit is now running, task ID so they can `TaskOutput` / `TaskStop`, and a reminder that `/address-pr-comments <N>` drains new bot comments when they appear.

Do NOT poll the PR yourself, do NOT call `ScheduleWakeup`, do NOT spawn additional ticks. The OS-managed bash process owns the loop.

## When the script terminates

The harness delivers a task notification with the script's exit code:

- **Exit 0** — PR merged, worktree + branch cleaned up, state file marked `merged: true`. Surface the success to the user.
- **Exit 2** — PR closed without merge. Tell the user.
- **Exit 3** — fatal error (missing tool, bad env). Read the log and surface the error.

Also tail the last ~30 lines of `/tmp/babysit-pr<N>.log` so the user sees the final ticks.

## Comment-addressing (between start and merge)

When the script logs `NEW [<endpoint>] <user>: <snippet>`, it also writes a JSON event to `/tmp/babysit-pr<N>.events.jsonl`. The main session does NOT auto-react — `/address-pr-comments <N>` is the entry point for processing those events.

**Draining is load-bearing**: the merge gate requires the event queue to be fully drained (cursor == queue length), not merely quiet — quiet ticks measure bot *silence*, not whether feedback was *handled*. Every comment event, including pure noise, blocks the merge until a drain pass advances the cursor. When the log says `merge blocked by N undrained comment event(s)`, run `/address-pr-comments <N>`.

If the user asks "what's happening with PR X" while a babysit is running, do this:

1. `tail -30 /tmp/babysit-pr<N>.log` — show the recent ticks
2. Count outstanding events: `wc -l < /tmp/babysit-pr<N>.events.jsonl` minus the cursor offset (see `/address-pr-comments`)
3. Report status concisely

**Get PR status from the log, never from a fresh `gh` call.** While a babysit is
running it already polls merge state, CI, and bot comments every tick into the
log — that data is free to read. Firing your own `gh pr view` / `gh pr checks`
on a babysat PR duplicates work AND adds to the burst that trips GitHub's
secondary rate limit (see below). The log is the source of truth; `gh` is not.

## GitHub API hygiene (avoid rate limits)

The pain we hit is **secondary** rate limits, not the primary 5,000/hr budget.
A diagnostic mid-session showed `core` at 8/5000 and `graphql` at 42/5000 — the
hourly budget was barely touched. GitHub's *secondary* limit instead punishes
**bursts and concurrency**: many `gh` calls fired back-to-back or in parallel in
a few seconds. It returns 403 "you have exceeded a secondary rate limit / retry
your request" even when the hourly budget is full.

So the rule is **spread calls out, don't pile them up**:

- **One source of truth per PR.** If a babysit is watching it, read the log; do
  not also `gh pr view` it. Don't run two status-checking mechanisms on one PR.
- **Don't batch `gh` calls.** Avoid issuing several `gh` calls in one shell block
  or as parallel tool calls — that's the exact burst pattern the secondary limit
  flags. Serialize them; let a beat pass between them.
- **Trust `gh pr merge --auto`.** After arming auto-merge, don't fire a
  confirmatory `gh pr view` — the merge command's own output already confirms.
- **One babysit at a time** (matches the repo's "one PR in flight" rule). N
  concurrent babysits = N× the per-tick burst against a shared limit.
- **`gh api rate_limit` is free** (exempt from the limit), so it's safe to check
  when diagnosing — but don't poll it in a loop.

The script itself now cooperates: it polls **one** comment endpoint per tick in
round-robin (not all three at once), uses `--paginate` on that call (a chatty PR
pushes older comments past the 30-item first page — without it they're never
seen), backs off `RL_BACKOFF` seconds on any rate-limit error via the `gh_safe`
wrapper, and sleeps a random ≤30s at startup (`START_JITTER_MAX`) so concurrent
babysits don't tick in phase — N in-phase loops fire 2N calls in the same
instant, the exact burst shape the secondary limit punishes. Keep those when
editing it.

## Guardrails

- **No agent recursion.** The bash script is dumb infrastructure — it does not call Claude or spawn sub-agents.
- **Don't run on main/master.** This skill watches feature-branch PRs targeting main, not main itself.
- **Don't bypass hook signatures or use `--no-verify`** anywhere in the merge call. The script uses `--squash --delete-branch` only.
- **Repo must be authed to `gh`.** If `gh auth status` fails, stop and tell the user — do not retry blindly.
- **Read the log for status; don't re-poll with `gh`.** See "GitHub API hygiene" above — duplicate polling is the main cause of the secondary-rate-limit 403s.

## Re-invoking on the same PR

If the user re-invokes `/babysit-pr <N>` while another babysit is running, the duplicate-guard (Step 3) catches it. If they want a fresh poll (e.g. they manually pushed a commit and want the deadline reset), stop the running task with `TaskStop`, then start fresh.
