---
name: babysit-pr
description: >
  Babysit one PR through bot review (CodeRabbit, Greptile, Sourcery, Codex)
  via a bash poll loop that auto-squash-merges with --delete-branch once CI
  is green and review has been quiet for two consecutive ticks. New bot
  comments are persisted to an events.jsonl queue so the main session can
  drain and address them via /address-pr-comments. Invoke when the user
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

The script truncates `/tmp/babysit-pr<N>.events.jsonl` on start so each babysit run begins with a clean event queue.

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

If the user asks "what's happening with PR X" while a babysit is running, do this:

1. `tail -30 /tmp/babysit-pr<N>.log` — show the recent ticks
2. Count outstanding events: `wc -l < /tmp/babysit-pr<N>.events.jsonl` minus the cursor offset (see `/address-pr-comments`)
3. Report status concisely

## Guardrails

- **No agent recursion.** The bash script is dumb infrastructure — it does not call Claude or spawn sub-agents.
- **Don't run on main/master.** This skill watches feature-branch PRs targeting main, not main itself.
- **Don't bypass hook signatures or use `--no-verify`** anywhere in the merge call. The script uses `--squash --delete-branch` only.
- **Repo must be authed to `gh`.** If `gh auth status` fails, stop and tell the user — do not retry blindly.

## Re-invoking on the same PR

If the user re-invokes `/babysit-pr <N>` while another babysit is running, the duplicate-guard (Step 3) catches it. If they want a fresh poll (e.g. they manually pushed a commit and want the deadline reset), stop the running task with `TaskStop`, then start fresh.
