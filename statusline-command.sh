#!/usr/bin/env bash
# Claude Code Status Line - using accurate current_usage from Claude Code

# Read JSON input from Claude Code
input=$(cat)

# Color palette - distinct colors for visibility
c_reset='\e[0m'
c_fg='\e[38;2;220;220;220m'         # light gray - main foreground
c_muted='\e[38;2;140;140;140m'      # gray - muted text
c_accent='\e[38;2;97;175;239m'      # #61AFEF - bright blue
c_warning='\e[38;2;229;192;123m'    # #E5C07B - yellow/gold
c_error='\e[38;2;224;108;117m'      # #E06C75 - red
c_success='\e[38;2;80;250;123m'     # #50FA7B - bright green (Dracula)
c_symbol='\e[38;2;198;120;221m'     # #C678DD - purple
c_cost='\e[38;2;86;182;194m'        # #56B6C2 - cyan
c_dim='\e[38;2;90;90;90m'           # dark gray - empty bar

# Extract JSON values
cwd=$(echo "$input" | jq -r '.cwd // .workspace.current_dir // ""')
[ -z "$cwd" ] && cwd=$(pwd)

# Model info
model=$(echo "$input" | jq -r '.model.display_name // .model.id // "?"')

# Context window size and transcript path
context_size=$(echo "$input" | jq -r '.context_window.context_window_size // 200000')
transcript_path=$(echo "$input" | jq -r '.transcript_path // ""')

# Session id — stamped into the shared stats file so the personality hook can
# reject another session's snapshot instead of reporting it as this session's.
session_id=$(echo "$input" | jq -r '.session_id // ""')

# Compaction threshold = CLAUDE_CODE_AUTO_COMPACT_WINDOW × (effective trigger %).
# Claude Code's actual auto-compact fires near 80% of WINDOW in practice (the
# CLAUDE_AUTOCOMPACT_PCT_OVERRIDE env var is documented but unreliable on the
# main thread — see anthropics/claude-code#36381). We track the observed ~80%
# so the statusline matches reality.
auto_window="${CLAUDE_CODE_AUTO_COMPACT_WINDOW:-200000}"
auto_pct=80
compaction_threshold=$(( auto_window * auto_pct / 100 ))
compaction_k=$((compaction_threshold / 1000))

# ACCURATE context usage from current_usage (sum of all token types)
input_tok=$(echo "$input" | jq -r '.context_window.current_usage.input_tokens // 0')
output_tok=$(echo "$input" | jq -r '.context_window.current_usage.output_tokens // 0')
cache_create=$(echo "$input" | jq -r '.context_window.current_usage.cache_creation_input_tokens // 0')
cache_read=$(echo "$input" | jq -r '.context_window.current_usage.cache_read_input_tokens // 0')

# Handle null values
[ "$input_tok" = "null" ] && input_tok=0
[ "$output_tok" = "null" ] && output_tok=0
[ "$cache_create" = "null" ] && cache_create=0
[ "$cache_read" = "null" ] && cache_read=0

# Total current context = all token types
ctx_tokens=$((input_tok + output_tok + cache_create + cache_read))
ctx_k=$((ctx_tokens / 1000))

# Calculate percentage toward COMPACTION threshold (not full context)
ctx_percent=$((ctx_tokens * 100 / compaction_threshold))
[ "$ctx_percent" -gt 100 ] && ctx_percent=100

# Remaining until compaction
remaining_until_compact=$((compaction_threshold - ctx_tokens))
remaining_k=$((remaining_until_compact / 1000))

# Session cost (extracted early for JSON export)
session_cost=$(echo "$input" | jq -r '.cost.total_cost_usd // 0')
[ "$session_cost" = "null" ] && session_cost=0

# Write context stats to shared file for context-layer plugin (only with real data)
CONTEXT_FILE="/tmp/claude-context-stats.json"
if [ "$ctx_tokens" -gt 0 ] || [ ! -f "$CONTEXT_FILE" ]; then
cat > "$CONTEXT_FILE" << EOF
{
  "timestamp": $(date +%s),
  "session_id": "$session_id",
  "context_size": $context_size,
  "current_tokens": $ctx_tokens,
  "current_k": $ctx_k,
  "percent_used": $ctx_percent,
  "input_tokens": $input_tok,
  "output_tokens": $output_tok,
  "cache_read": $cache_read,
  "cache_write": $cache_create,
  "model": "$model",
  "session_cost_usd": $session_cost
}
EOF
fi

# Also update Claude Deck state if it exists (only when we have real data)
CLAUDE_DECK_STATE="$HOME/.claude-deck/state.json"
if [ -f "$CLAUDE_DECK_STATE" ] && command -v jq &> /dev/null && [ "$ctx_tokens" -gt 0 ]; then
    # Update context fields in claude-deck state
    jq --argjson ctx_size "$context_size" \
       --argjson ctx_used "$ctx_tokens" \
       --argjson ctx_pct "$ctx_percent" \
       --argjson cost "$session_cost" \
       '.contextSize = $ctx_size | .contextUsed = $ctx_used | .contextPercent = $ctx_pct | .sessionCost = $cost' \
       "$CLAUDE_DECK_STATE" > "${CLAUDE_DECK_STATE}.tmp" && mv "${CLAUDE_DECK_STATE}.tmp" "$CLAUDE_DECK_STATE"
fi

# Visual progress bar (10 chars wide)
bar_width=10
filled=$((ctx_percent * bar_width / 100))
empty=$((bar_width - filled))

# Choose color based on remaining until compaction
# Red: <10K remaining, Orange: <25K, Yellow: <50K, Green: 50K+
if [ "$remaining_until_compact" -le 10000 ]; then
  bar_color="$c_error"
elif [ "$remaining_until_compact" -le 25000 ]; then
  bar_color="$c_warning"
elif [ "$remaining_until_compact" -le 50000 ]; then
  bar_color="$c_warning"
else
  bar_color="$c_success"
fi

# Build visual bar - shows progress toward compaction threshold
bar_filled=""
bar_empty=""
for ((i=0; i<filled; i++)); do bar_filled+="█"; done
for ((i=0; i<empty; i++)); do bar_empty+="░"; done
context_bar="${bar_color}${bar_filled}${c_dim}${bar_empty}${c_reset} ${ctx_k}k/${compaction_k}k (${ctx_percent}%)"

# Session cost display (session_cost already extracted above)
cost_display=$(printf '$%.2f' "$session_cost")

# Time elapsed
duration_ms=$(echo "$input" | jq -r '.cost.total_duration_ms // 0')
[ "$duration_ms" = "null" ] && duration_ms=0

if [ "$duration_ms" -gt 0 ]; then
  duration_sec=$((duration_ms / 1000))
  if [ "$duration_sec" -ge 3600 ]; then
    hours=$((duration_sec / 3600))
    mins=$(( (duration_sec % 3600) / 60 ))
    time_info="${hours}h${mins}m"
  elif [ "$duration_sec" -ge 60 ]; then
    mins=$((duration_sec / 60))
    secs=$((duration_sec % 60))
    time_info="${mins}m${secs}s"
  else
    time_info="${duration_sec}s"
  fi
else
  time_info="0s"
fi

# Tool call count (grep JSONL for tool_use entries)
tool_count=0
if [ -n "$transcript_path" ] && [ -f "$transcript_path" ]; then
  tool_count=$(grep -c '"type":"tool_use"' "$transcript_path" 2>/dev/null || echo "0")
fi

# SSH session info (if applicable)
ssh_info=""
if [ -n "$SSH_CONNECTION" ] || [ -n "$SSH_CLIENT" ]; then
  ssh_info="${c_muted}$(whoami)@$(hostname -s) ${c_reset}"
fi

# Path display with max depth 3
path_display="$cwd"
if [ "$cwd" = "$HOME" ]; then
  path_display="${c_muted}~${c_reset}"
else
  path_display="${path_display/#$HOME/~}"
  depth=$(echo "$path_display" | grep -o "/" | wc -l | tr -d ' ')
  if [ "$depth" -gt 3 ]; then
    path_display="~/.../"$(echo "$path_display" | rev | cut -d'/' -f1-2 | rev)
  fi
  path_display="${c_fg}${path_display}${c_reset}"
fi

# Git information
git_info=""
if [ -d "$cwd/.git" ] || git -C "$cwd" rev-parse --git-dir > /dev/null 2>&1; then
  cd "$cwd" 2>/dev/null || true
  branch=$(git -c core.fileMode=false branch --show-current 2>/dev/null || git -c core.fileMode=false rev-parse --short HEAD 2>/dev/null)

  if [ -n "$branch" ]; then
    git_color="$c_accent"
    dirty=""
    if ! git -c core.fileMode=false diff --quiet 2>/dev/null || ! git -c core.fileMode=false diff --cached --quiet 2>/dev/null; then
      dirty="*"
      git_color="$c_warning"
    fi

    ahead_behind=""
    upstream=$(git -c core.fileMode=false rev-parse --abbrev-ref @{upstream} 2>/dev/null)
    if [ -n "$upstream" ]; then
      ahead=$(git -c core.fileMode=false rev-list --count @{upstream}..HEAD 2>/dev/null || echo "0")
      behind=$(git -c core.fileMode=false rev-list --count HEAD..@{upstream} 2>/dev/null || echo "0")
      [ "$behind" -gt 0 ] && ahead_behind="${ahead_behind}-${behind}"
      [ "$ahead" -gt 0 ] && ahead_behind="${ahead_behind}+${ahead}"
    fi

    git_info="${git_color}${branch}${dirty}${ahead_behind}${c_reset}"
  fi
fi

# Build status line with clear spacing
# Format: path | git | context | model | cost | time | tools
printf "%b%b  %b  %b  %b  %b  %b  %b" \
  "$ssh_info" \
  "$path_display" \
  "$git_info" \
  "$context_bar" \
  "${c_symbol}${model}${c_reset}" \
  "${c_cost}${cost_display}${c_reset}" \
  "${c_muted}${time_info}${c_reset}" \
  "${c_muted}tools:${c_accent}${tool_count}${c_reset}"
