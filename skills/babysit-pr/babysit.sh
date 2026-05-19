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
#   CODEX_WINDOW_S  1500 (25 min — typical Codex review window)
#   STATE_DIR       <MAIN>/.claude/state  (state file location)
#   EVENTS_FILE     /tmp/babysit-pr<PR>.events.jsonl  (new-comment events)
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
CODEX_WINDOW_S="${CODEX_WINDOW_S:-1500}"
STATE_DIR="${STATE_DIR:-${MAIN}/.claude/state}"
EVENTS_FILE="${EVENTS_FILE:-/tmp/babysit-pr${PR}.events.jsonl}"

STATE="${STATE_DIR}/pr-${PR}.json"
DEADLINE=$(( $(date +%s) + CODEX_WINDOW_S ))
QUIET_TICKS=0
SEEN_FILE=$(mktemp)
trap 'rm -f "$SEEN_FILE"' EXIT

mkdir -p "$STATE_DIR"
: > "$EVENTS_FILE"  # truncate so each babysit run starts clean
printf '{"pr_number": %s, "started_at": "%s", "merged": false, "auto_merge": %s}\n' \
  "$PR" "$(date -u +%FT%TZ)" "$AUTO_MERGE" > "$STATE"

log() { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }

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

  pr_state=$(gh pr view "$PR" --repo "$REPO" --json state,mergeable,statusCheckRollup 2>/dev/null || true)
  if [[ -z "$pr_state" ]]; then
    log "gh pr view returned nothing, retrying"
    sleep "$TICK"; continue
  fi

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

  # Surface and persist new bot comments across the three endpoints that bots use.
  for endpoint in "pulls/$PR/comments" "issues/$PR/comments" "pulls/$PR/reviews"; do
    prefix=""
    [[ "$endpoint" == "issues/$PR/comments" ]] && prefix="issue-"
    [[ "$endpoint" == "pulls/$PR/reviews"  ]] && prefix="review-"
    items=$(gh api "repos/$REPO/$endpoint" \
      --jq ".[] | \"${prefix}\(.id)\t\(.user.login)\t\(.body // \"\" | gsub(\"\n\"; \" \") | .[0:280])\"" \
      2>/dev/null || true)
    while IFS=$'\t' read -r cid user snippet; do
      [[ -z "$cid" ]] && continue
      if ! grep -q "^${cid}$" "$SEEN_FILE"; then
        echo "$cid" >> "$SEEN_FILE"
        log "NEW [$endpoint] $user: $snippet"
        emit_event "$endpoint" "$cid" "$user" "$snippet"
        QUIET_TICKS=0
        # Push deadline out 10 min whenever a new comment lands so a slow review
        # cycle can complete before we attempt to merge.
        DEADLINE=$(( now + 600 ))
      fi
    done <<< "$items"
  done

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
    failing=$(echo "$pr_state" | jq -r '.statusCheckRollup // [] | map(select(.conclusion == "FAILURE")) | length')
    pending=$(echo "$pr_state" | jq -r '.statusCheckRollup // [] | map(select(.conclusion == null and (.status == "PENDING" or .status == "IN_PROGRESS" or .status == "QUEUED"))) | length')
    if [[ "$failing" == "0" && "$pending" == "0" && "$mergeable" != "CONFLICTING" ]]; then
      log "Conditions met — squash-merging PR #$PR with --delete-branch"
      if gh pr merge "$PR" --repo "$REPO" --squash --delete-branch 2>&1 | tee -a "/tmp/babysit-pr${PR}.log"; then
        log "Merge command succeeded; will verify on next tick"
      else
        log "Merge command failed; will retry next tick"
      fi
    else
      log "Not ready: failing=$failing pending=$pending mergeable=$mergeable. Waiting."
    fi
  fi

  sleep "$TICK"
done
