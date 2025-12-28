#!/bin/bash
# Context Reporter Hook - reads ACTUAL token usage from session transcript
# Much more reliable than statusline data

# Read hook input from stdin
INPUT=$(cat)

# Extract session_id from input
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
[[ -z "$SESSION_ID" ]] && exit 0

# Get project directory
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"

# Convert project path to Claude's folder name format (replace / with -)
PROJECT_FOLDER=$(echo "$PROJECT_DIR" | sed 's|^/||; s|/|-|g; s|^|-|')

# Build transcript path
TRANSCRIPT_PATH="$HOME/.claude/projects/${PROJECT_FOLDER}/${SESSION_ID}.jsonl"

# Check if transcript exists
[[ ! -f "$TRANSCRIPT_PATH" ]] && exit 0

# Get the LAST assistant message's usage (current context state)
# cache_read = tokens loaded from cache (previous context)
# cache_create = new tokens added to context this turn
# This represents the CURRENT context window size
token_stats=$(
  grep '"type":"assistant"' "$TRANSCRIPT_PATH" 2>/dev/null | \
  tail -1 | \
  jq -r '
    [
      (.message.usage.cache_read_input_tokens // 0),
      (.message.usage.cache_creation_input_tokens // 0),
      (.message.usage.input_tokens // 0),
      (.message.usage.output_tokens // 0)
    ] | @tsv
  ' 2>/dev/null
)

# Parse: cache_read + cache_create ≈ current context size
IFS=$'\t' read -r cache_read cache_create input_tokens output_tokens <<< "$token_stats"

# Default if parsing failed
input_tokens=${input_tokens:-0}
output_tokens=${output_tokens:-0}
cache_read=${cache_read:-0}
cache_create=${cache_create:-0}

# Current context size ≈ cache_read + cache_create + output_tokens
# cache_read = previous context loaded from cache
# cache_create = new content added this turn
# output_tokens = model's response (also in context)
current_context=$((cache_read + cache_create + output_tokens))

# Skip if no meaningful data
(( current_context < 1000 )) && exit 0

# REAL context limits (compaction happens at ~154K, not 200K)
compaction_threshold=154000
context_window=200000

# Calculate ACTUAL remaining before compaction
current_k=$((current_context / 1000))
compaction_k=$((compaction_threshold / 1000))
remaining_before_compact=$((compaction_threshold - current_context))
remaining_k=$((remaining_before_compact / 1000))

# Percent of USABLE context (toward 150K, not 200K)
percent=$((current_context * 100 / compaction_threshold))
(( percent > 100 )) && percent=100

# Status based on proximity to compaction
if (( remaining_before_compact <= 5000 )); then
    indicator="🔴 COMPACTION IMMINENT"
elif (( remaining_before_compact <= 15000 )); then
    indicator="🟠"
elif (( remaining_before_compact <= 30000 )); then
    indicator="🟡"
else
    indicator="🟢"
fi

# Message for Claude (not user - they have statusline)
if (( remaining_before_compact <= 5000 )); then
    echo "[${indicator} - ${current_k}K used, ~${remaining_k}K until auto-compact! SAVE IMPORTANT CONTEXT NOW]"
elif (( remaining_before_compact <= 15000 )); then
    echo "[${indicator} ${current_k}K/${compaction_k}K - ~${remaining_k}K until compact. Consider saving key learnings.]"
else
    echo "[${indicator} ${current_k}K/${compaction_k}K (${percent}%) ~${remaining_k}K until compact]"
fi
