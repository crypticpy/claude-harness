#!/bin/bash
# cache-keepwarm — keep an idle Claude Code session's prompt cache warm by
# sending it a one-line ping through Superset shortly before the cache expires.
#
# Fired in the background by statusline-command.sh when the cache has five
# minutes or less left. One-shot: checks, maybe pings, exits.
#
# Pings only when all of these hold:
#   - the session runs in a Superset terminal (SUPERSET_TERMINAL_ID and
#     SUPERSET_WORKSPACE_ID are set; the status line inherits them)
#   - this expiry window has not been handled yet (one ping per window)
#   - the agent is not mid-turn (last transcript entry is not a pending tool call)
#   - the worker has not finished: no SUPERSET_WORKER_DONE / _BLOCKED in an
#     assistant message after the last human prompt
#   - fewer than MAX_PINGS pings in a row with no real prompt in between
#
# Usage: cache-keepwarm.sh <session_id> <transcript_path> <expires_at>

session_id="$1"
transcript="$2"
expires_at="$3"

MAX_PINGS=3
PING_TEXT="[keep-warm] mic check. Reply with just: ok"
STATE_DIR="${TMPDIR:-/tmp}/claude-keepwarm"
LOG="$STATE_DIR/keepwarm.log"

[ -n "$session_id" ] && [ -n "$expires_at" ] && [ -f "$transcript" ] || exit 0
[ -n "$SUPERSET_TERMINAL_ID" ] && [ -n "$SUPERSET_WORKSPACE_ID" ] || exit 0
mkdir -p "$STATE_DIR"

# One attempt per expiry window, atomic against concurrent status line runs
( set -C; : > "$STATE_DIR/$session_id.$expires_at" ) 2>/dev/null || exit 0
find "$STATE_DIR" -name "$session_id.*" ! -name "$session_id.$expires_at" -delete 2>/dev/null

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') ${session_id:0:8} $*" >> "$LOG"; }

recent=$(tail -c 2000000 "$transcript")

# Human prompts are user entries with plain string content (tool results use
# an array; hook and system injections carry isMeta)
prompts=$(echo "$recent" | grep -n '"type":"user","message":{"role":"user","content":"' | grep -v '"isMeta":true')
last_prompt=$(echo "$prompts" | tail -1 | cut -d: -f1)

# Mid-turn: the newest conversation entry is an assistant tool call still running
last_entry=$(echo "$recent" | grep -E '"type":"(user|assistant)"' | tail -1)
if echo "$last_entry" | grep -q '"type":"assistant"' && echo "$last_entry" | grep -q '"type":"tool_use"'; then
  log "skip: mid-turn"; exit 0
fi

# Finished worker: its contract closed, so let the cache go cold
done_line=$(echo "$recent" | grep -n '"type":"assistant"' | grep -E 'SUPERSET_WORKER_(DONE|BLOCKED)' | tail -1 | cut -d: -f1)
if [ -n "$done_line" ] && [ "$done_line" -gt "${last_prompt:-0}" ]; then
  log "skip: worker done"; exit 0
fi

# Consecutive pings since the last real prompt
streak=$(echo "$prompts" | awk '/\[keep-warm\]/ { c++; next } { c = 0 } END { print c + 0 }')
if [ "$streak" -ge "$MAX_PINGS" ]; then
  log "skip: $streak pings without a real prompt"; exit 0
fi

superset=$(command -v superset || echo "$HOME/.superset/bin/superset")
if "$superset" terminals send --local --workspace "$SUPERSET_WORKSPACE_ID" \
    --terminal "$SUPERSET_TERMINAL_ID" --text "$PING_TEXT" >/dev/null 2>&1; then
  log "pinged terminal ${SUPERSET_TERMINAL_ID:0:8} (streak $((streak + 1))/$MAX_PINGS)"
else
  log "ping failed for terminal ${SUPERSET_TERMINAL_ID:0:8}"
fi
exit 0
