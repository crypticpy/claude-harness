#!/usr/bin/env bash
# babysit.sh — poll one PR through bot review and auto-merge when clean.
#
# Required env vars (set by the caller before exec):
#   PR              PR number (integer)
#   REPO            owner/repo
#   BRANCH          head branch name
#   MAIN            absolute path to the repo's main worktree (for cleanup)
#
# Optional env vars (sensible defaults applied):
#   WORKTREE        absolute path to a `.worktrees/<slug>` (or "" if none)
#   AUTO_MERGE      "true" (default) or "false"
#   TICK_SECONDS    90 (poll interval)
#   CODEX_WINDOW_S  180 (initial bot-feedback window before merge eligibility)
#   STATE_DIR       <MAIN>/.claude/state  (state file location)
#   EVENTS_FILE     /tmp/babysit-pr<PR>.events.jsonl  (new-comment events)
#   CURSOR_FILE     /tmp/babysit-pr<PR>.cursor  (drain offset, reset on start)
#   RL_BACKOFF      120 (seconds to back off on a GitHub rate-limit error)
#
# Outputs:
#   <STATE_DIR>/pr-<PR>.json    persistent run state (merged flag, timestamps)
#   $EVENTS_FILE                one JSON line per new bot comment/review
#   stdout                      human-readable tick log
#
# Exit codes:
#   0  PR merged (or already merged at startup)
#   2  PR closed without merge
#   3  fatal error (missing tools, bad inputs, gh failures past retry budget)

set -uo pipefail

: "${PR:?PR env var required}"
: "${REPO:?REPO env var required}"
: "${BRANCH:?BRANCH env var required}"
: "${MAIN:?MAIN env var required}"

WORKTREE="${WORKTREE:-}"
AUTO_MERGE="${AUTO_MERGE:-true}"
TICK="${TICK_SECONDS:-90}"
# Initial bot-feedback window before auto-merge becomes eligible. Bumped down
# from 25 → 5 → 3 min per user directive (2026-06-27): bots that haven't
# dropped a comment in 3 min are not going to. Combined with the 2 quiet
# ticks (180s) gate, minimum end-to-end is ~6 min.
CODEX_WINDOW_S="${CODEX_WINDOW_S:-180}"
STATE_DIR="${STATE_DIR:-${MAIN}/.claude/state}"
EVENTS_FILE="${EVENTS_FILE:-/tmp/babysit-pr${PR}.events.jsonl}"
CURSOR_FILE="${CURSOR_FILE:-/tmp/babysit-pr${PR}.cursor}"
# Max consecutive `gh pr view` failures before we treat the babysit as hung and
# exit 3. 10 ticks @ 90s = 15 min of total gh outage tolerance.
GH_FAILURE_MAX="${GH_FAILURE_MAX:-10}"
# Backoff (seconds) when GitHub returns a primary/secondary rate-limit error.
# Secondary limits punish bursts, so the right response is to wait, not retry.
RL_BACKOFF="${RL_BACKOFF:-120}"

STATE="${STATE_DIR}/pr-${PR}.json"
DEADLINE=$(( $(date +%s) + CODEX_WINDOW_S ))
QUIET_TICKS=0
GH_FAILURES=0
TICK_COUNT=0
SEEN_FILE=$(mktemp)
GH_ERR=$(mktemp)
trap 'rm -f "$SEEN_FILE" "$GH_ERR"' EXIT

mkdir -p "$STATE_DIR"
: > "$EVENTS_FILE"  # truncate so each babysit run starts clean
# Reset the drain cursor too — a stale cursor from a previous run on the same
# PR would exceed the truncated queue's line count and make /address-pr-comments
# report "no new comments" forever.
rm -f "$CURSOR_FILE"
# State file is read by /address-pr-comments, so include the fields it needs
# (repo, branch, worktree, main) — not just the bookkeeping ones.
printf '{"pr_number": %s, "started_at": "%s", "merged": false, "auto_merge": %s, "repo": "%s", "branch": "%s", "main": "%s", "worktree": "%s"}\n' \
  "$PR" "$(date -u +%FT%TZ)" "$AUTO_MERGE" "$REPO" "$BRANCH" "$MAIN" "$WORKTREE" > "$STATE"

log() { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }

# Run a gh command, capturing stderr. If it fails with a primary or *secondary*
# rate-limit error (the latter triggered by bursts/concurrency, not hourly
# volume), sleep RL_BACKOFF and retry once. Echoes gh stdout; empty on failure.
# Centralizing here means every polling call backs off instead of hammering.
gh_safe() {
  local out
  out="$(gh "$@" 2>"$GH_ERR")"
  if [[ -z "$out" ]] && grep -qiE 'rate limit|secondary rate|retry your request|abuse detection' "$GH_ERR"; then
    log "gh rate-limited (${1:-?} ${2:-}) — sleeping ${RL_BACKOFF}s before one retry"
    sleep "$RL_BACKOFF"
    out="$(gh "$@" 2>/dev/null)"
  fi
  printf '%s' "$out"
}

# JSON-escape a value for safe inclusion in an event line (quotes, backslashes, control chars).
json_escape() {
  python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null \
    || printf '"%s"' "$(printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"
}

emit_event() {
  local endpoint="$1" cid="$2" user="$3" body="$4"
  local body_json
  body_json=$(printf '%s' "$body" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')
  printf '{"ts":"%s","endpoint":"%s","id":"%s","user":"%s","body":%s}\n' \
    "$(date -u +%FT%TZ)" "$endpoint" "$cid" "$user" "$body_json" >> "$EVENTS_FILE"
}

for cmd in gh jq python3; do
  command -v "$cmd" >/dev/null 2>&1 || { log "FATAL: missing $cmd"; exit 3; }
done

log "Starting babysit: PR=#$PR REPO=$REPO BRANCH=$BRANCH WORKTREE=${WORKTREE:-<none>} AUTO_MERGE=$AUTO_MERGE"

while :; do
  now=$(date +%s)
  TICK_COUNT=$(( TICK_COUNT + 1 ))

  pr_state=$(gh_safe pr view "$PR" --repo "$REPO" --json state,mergeable,statusCheckRollup)
  if [[ -z "$pr_state" ]]; then
    GH_FAILURES=$(( GH_FAILURES + 1 ))
    if [[ "$GH_FAILURES" -ge "$GH_FAILURE_MAX" ]]; then
      log "FATAL: $GH_FAILURES consecutive 'gh pr view' failures — giving up. Check 'gh auth status' and re-invoke."
      exit 3
    fi
    log "gh pr view returned nothing (failure $GH_FAILURES/$GH_FAILURE_MAX), retrying"
    sleep "$TICK"; continue
  fi
  GH_FAILURES=0

  state=$(echo "$pr_state" | jq -r '.state')
  case "$state" in
    MERGED)
      log "PR #$PR is MERGED. Cleaning up."
      if [[ -n "$WORKTREE" && -d "$WORKTREE" ]]; then
        git -C "$MAIN" worktree remove --force "$WORKTREE" 2>&1 | tail -3 || true
      fi
      git -C "$MAIN" branch -D "$BRANCH" 2>&1 | tail -3 || true
      printf '{"pr_number": %s, "merged": true, "merged_at": "%s"}\n' \
        "$PR" "$(date -u +%FT%TZ)" > "$STATE"
      log "Done."
      exit 0
      ;;
    CLOSED)
      log "PR #$PR is CLOSED (not merged). Stopping."
      printf '{"pr_number": %s, "closed": true, "closed_at": "%s"}\n' \
        "$PR" "$(date -u +%FT%TZ)" > "$STATE"
      exit 2
      ;;
  esac

  # Surface new bot comments. Bots post across three endpoints; rather than hit
  # all three every tick (a 3-call burst that trips GitHub's *secondary* rate
  # limit), poll ONE per tick in round-robin. Each is still checked every ~3
  # ticks (~4.5 min @ 90s) — well inside bot latency — but we never fire the
  # burst. Merge/CI detection is unaffected (that's the gh pr view above, every
  # tick). The endpoint order puts reviews last; CodeRabbit/Sourcery land there.
  endpoints=("pulls/$PR/comments" "issues/$PR/comments" "pulls/$PR/reviews")
  endpoint="${endpoints[$(( TICK_COUNT % 3 ))]}"
  prefix=""
  [[ "$endpoint" == "issues/$PR/comments" ]] && prefix="issue-"
  [[ "$endpoint" == "pulls/$PR/reviews"  ]] && prefix="review-"
  # --paginate: default page size is 30; a chatty PR pushes older bot comments
  # onto page 2+ and without pagination they are never seen (or drained).
  items=$(gh_safe api --paginate "repos/$REPO/$endpoint" \
    --jq ".[] | \"${prefix}\(.id)\t\(.user.login)\t\(.body // \"\" | gsub(\"\n\"; \" \") | .[0:280])\"")
  while IFS=$'\t' read -r cid user snippet; do
    [[ -z "$cid" ]] && continue
    if ! grep -q "^${cid}$" "$SEEN_FILE"; then
      echo "$cid" >> "$SEEN_FILE"
      log "NEW [$endpoint] $user: $snippet"
      emit_event "$endpoint" "$cid" "$user" "$snippet"
      QUIET_TICKS=0
      # Push deadline out 2 min whenever a new comment lands so a slow review
      # cycle can complete before we attempt to merge. (Tightened from 10 →
      # 5 → 2 min per user directive 2026-06-27 — bot rounds rarely benefit
      # from longer.)
      DEADLINE=$(( now + 120 ))
    fi
  done <<< "$items"

  ci_summary=$(echo "$pr_state" | jq -r '
    .statusCheckRollup // []
    | map(.conclusion // .status)
    | "\(length) total, failing=\(map(select(. == "FAILURE")) | length), pending=\(map(select(. == "PENDING" or . == "IN_PROGRESS" or . == "QUEUED")) | length), success=\(map(select(. == "SUCCESS")) | length)"
  ')
  mergeable=$(echo "$pr_state" | jq -r '.mergeable')

  past_deadline=$(( now >= DEADLINE ))
  if [[ "$past_deadline" -eq 1 ]]; then
    QUIET_TICKS=$(( QUIET_TICKS + 1 ))
  fi

  log "tick: ci=[$ci_summary] mergeable=$mergeable quiet=$QUIET_TICKS past_deadline=$past_deadline"

  if [[ "$AUTO_MERGE" == "true" && "$past_deadline" -eq 1 && "$QUIET_TICKS" -ge 2 ]]; then
    # Anything that hasn't completed yet (no conclusion AND not skipped/neutral) is "pending".
    pending=$(echo "$pr_state" | jq -r '.statusCheckRollup // [] | map(select(.conclusion == null and (.status == "PENDING" or .status == "IN_PROGRESS" or .status == "QUEUED"))) | length')
    # Anything that completed with a non-OK terminal state blocks the merge.
    # OK conclusions are SUCCESS, SKIPPED, NEUTRAL. Everything else (FAILURE,
    # CANCELLED, TIMED_OUT, ACTION_REQUIRED, STARTUP_FAILURE, STALE, ...) is
    # treated as failing. The old gate only counted FAILURE which let
    # CANCELLED / TIMED_OUT checks slip through.
    non_ok=$(echo "$pr_state" | jq -r '
      .statusCheckRollup // []
      | map(.conclusion // empty)
      | map(select(. != "SUCCESS" and . != "SKIPPED" and . != "NEUTRAL"))
      | length
    ')
    # Require an affirmative MERGEABLE — the old `!= CONFLICTING` gate let
    # UNKNOWN (GitHub still computing mergeability) through to a doomed merge
    # attempt. UNKNOWN resolves within a tick or two; just wait.
    if [[ "$non_ok" == "0" && "$pending" == "0" && "$mergeable" == "MERGEABLE" ]]; then
      log "Conditions met — squash-merging PR #$PR with --delete-branch"
      if gh pr merge "$PR" --repo "$REPO" --squash --delete-branch 2>&1 | tee -a "/tmp/babysit-pr${PR}.log"; then
        log "Merge command succeeded; will verify on next tick"
      else
        log "Merge command failed; will retry next tick"
      fi
    else
      log "Not ready: non_ok=$non_ok pending=$pending mergeable=$mergeable. Waiting."
    fi
  fi

  sleep "$TICK"
done
