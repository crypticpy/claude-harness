---
name: babysit-pr
description: >
  Watch a single PR through bot review (CodeRabbit, Greptile, Sourcery,
  ChatGPT Codex), address each comment by pushing a fix or replying, then
  auto-squash-merge when CI is green and review has been quiet for two
  consecutive ticks. Use when the user types /babysit-pr <N>, asks you to
  "babysit", "watch", "monitor", or "drive home" a PR. Does NOT create
  PRs — open the PR first (or have the caller open it) and then invoke
  this with the PR number.
---

# /babysit-pr — drive one PR to merge

## Usage

```
/babysit-pr <pr-number>            # watch + auto-merge when clean
/babysit-pr <pr-number> --no-merge # watch + report ready, maintainer merges
```

The PR must already exist. If the user types `/babysit-pr` without a number, ask which PR — don't guess.

## How it works

You spawn the `pr-babysitter` agent ONCE in the background with `run_in_background: true`. The agent runs its own internal loop — poll, address comments, maybe push fixes, sleep, repeat — until it reaches a terminal state (merged or error) and exits.

The caller (main session) is free to do other work after the spawn. The agent notifies on completion via the standard task-notification channel.

**No `ScheduleWakeup` hops.** The agent paces itself with internal `Bash` sleeps; the main session does not wake to fire each tick. This is intentional: the previous schedule-based pattern silently stalled when the wakeup chain dropped.

State lives in `.claude/state/pr-<N>.json` (create the parent dir if missing). The agent reads it at startup, writes it after every tick, and uses it to survive restarts if the user re-invokes the skill on the same PR.

## Steps

### 1. Parse args

- `pr_number`: first positional. Required. Must match `^\d+$`.
- `auto_merge`: true unless `--no-merge` appears in the args.

If the user passed only `--no-merge` without a number, stop and ask which PR.

### 2. Sanity check the PR exists and is open

```bash
gh pr view <N> --json state,baseRefName,headRefName,createdAt
```

If `state != "OPEN"`, tell the user and stop. Don't try to re-open or revive. Keep `createdAt` from this call — Step 3 uses it for the initial watermark.

### 3. Initialize the state file

If `.claude/state/pr-<N>.json` doesn't exist, write a fresh one (use the `createdAt` from Step 2 for `last_seen_iso`):

```json
{
  "pr_number": <N>,
  "auto_merge": true,
  "quiet_ticks": 0,
  "last_seen_iso": "<createdAt from gh pr view, RFC3339>",
  "replied_to": [],
  "merged": false,
  "last_tick_at": "<current ISO timestamp>"
}
```

If the file exists, leave its body alone — the agent will pick up where it left off. Update `last_tick_at` to the current time before invoking the agent (Step 4) so the duplicate-babysitter guard below can detect a stuck loop.

### 4. Spawn the background agent

Invoke the `pr-babysitter` agent with `run_in_background: true`. Pass it (via the prompt):

- PR number.
- `auto_merge` flag.
- Absolute path to the state file.
- The current branch's repo root (so `gh` commands resolve correctly).
- An explicit instruction to **run its internal loop until merged or error** — do NOT do one tick and return.

The agent runs in the background, polls + addresses comments + maybe merges, and exits when it reaches a terminal state. You will receive a task notification when it completes.

### 5. Confirm to the user and exit this turn

Tell the user briefly: PR number, that the background agent is now running, and that they can keep working. Surface the agent's task ID so they can `TaskOutput` or `TaskStop` it if needed.

That's it. Do NOT call `ScheduleWakeup`. Do NOT poll the PR yourself. Do NOT spawn additional ticks.

## When the agent finishes

When the background agent completes, the harness delivers a task notification with its final report. Surface that report to the user as plain text. If the agent reported `merged`, the babysit work is done — branch deleted, state file marked `merged: true`. If it reported `error`, surface the error and let the user decide next steps.

If the user wants to follow up on the same PR (e.g. they pushed a manual commit and want a fresh review pass), they re-invoke `/babysit-pr <N>` — the state file is reused.

## Guardrails this skill enforces

- **One babysitter per PR.** If `.claude/state/pr-<N>.json` exists, `merged: false`, and `last_tick_at` is within the last 30 minutes, another agent is likely still running. Warn the user before spawning a duplicate. `TaskList` can confirm whether an existing `pr-babysitter` task is still live.
- **Don't invoke on main/master directly.** This skill is for feature-branch PRs targeting `main`, not for watching `main` itself.
- **No agent recursion.** The `pr-babysitter` agent must not spawn another `pr-babysitter`.

## Notes for the caller agent (you, the main session)

- Do NOT do the babysit work yourself — the background agent owns it. Keep your own context clean for other tasks.
- Do NOT poll the PR or read comments outside the agent. The agent is the only thing that touches GitHub during babysit.
- If the user interrupts mid-loop with a different request, just handle it. The background agent keeps running independently and will notify you when it terminates.
- If you need to cancel the babysit early (e.g. the user changes their mind), use `TaskStop` with the agent's task ID.
