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
c_dim='\e[38;2;90;90;90m'           # dark gray - empty bar

# Extract every field in one jq pass (the script re-runs on a timer in every
# open session, so per-field jq forks add up)
eval "$(echo "$input" | jq -r '
  def n: if type == "number" then floor else 0 end;
  @sh "cwd=\(.cwd // .workspace.current_dir // "")",
  @sh "model=\(.model.display_name // .model.id // "?")",
  @sh "effort=\(.effort.level // "")",
  @sh "session_name=\(.session_name // "")",
  @sh "context_size=\(.context_window.context_window_size // 200000)",
  @sh "transcript_path=\(.transcript_path // "")",
  @sh "session_id=\(.session_id // "")",
  @sh "input_tok=\(.context_window.current_usage.input_tokens | n)",
  @sh "output_tok=\(.context_window.current_usage.output_tokens | n)",
  @sh "cache_create=\(.context_window.current_usage.cache_creation_input_tokens | n)",
  @sh "cache_read=\(.context_window.current_usage.cache_read_input_tokens | n)",
  @sh "session_cost=\(.cost.total_cost_usd // 0)",
  @sh "duration_ms=\(.cost.total_duration_ms | n)",
  @sh "five_pct=\(.rate_limits.five_hour.used_percentage // "" | if type == "number" then floor else . end)",
  @sh "five_reset=\(.rate_limits.five_hour.resets_at // "" | if type == "number" then floor else . end)",
  @sh "week_pct=\(.rate_limits.seven_day.used_percentage // "" | if type == "number" then floor else . end)",
  @sh "week_reset=\(.rate_limits.seven_day.resets_at // "" | if type == "number" then floor else . end)",
  @sh "pr_number=\(.pr.number // "")",
  @sh "pr_state=\(.pr.review_state // "")",
  @sh "cache_warm=\(.prompt_cache.warm // false)",
  @sh "cache_expires=\(.prompt_cache.expires_at | n)",
  @sh "cache_requests=\(.prompt_cache.requests | n)",
  @sh "cache_recache=\(.prompt_cache.recache_tokens_if_cold | n)"
')"
[ -z "$cwd" ] && cwd=$(pwd)
now=$(date +%s)

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
# Total current context = all token types
ctx_tokens=$((input_tok + output_tok + cache_create + cache_read))
ctx_k=$((ctx_tokens / 1000))

# Calculate percentage toward COMPACTION threshold (not full context)
ctx_percent=$((ctx_tokens * 100 / compaction_threshold))
[ "$ctx_percent" -gt 100 ] && ctx_percent=100

# Remaining until compaction
remaining_until_compact=$((compaction_threshold - ctx_tokens))
remaining_k=$((remaining_until_compact / 1000))

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

# Plan usage limits (subscription only; absent for API-key sessions)
# Color: green <60%, yellow <85%, red 85%+
usage_color() {
  if [ "$1" -ge 85 ]; then printf '%s' "$c_error"
  elif [ "$1" -ge 60 ]; then printf '%s' "$c_warning"
  else printf '%s' "$c_success"; fi
}
usage_info=""
if [ -n "$five_pct" ]; then
  five_left=""
  if [ -n "$five_reset" ]; then
    secs_left=$(( five_reset - now ))
    if [ "$secs_left" -gt 0 ]; then
      five_left=" ${c_dim}↻$((secs_left / 3600))h$(( (secs_left % 3600) / 60 ))m"
    fi
  fi
  usage_info="${c_muted}5h $(usage_color "$five_pct")${five_pct}%${five_left}${c_reset}"
fi
if [ -n "$week_pct" ]; then
  week_day=""
  [ -n "$week_reset" ] && week_day=" ${c_dim}↻$(date -r "$week_reset" '+%a %-I%p' | sed 's/AM$/am/;s/PM$/pm/')"
  [ -n "$usage_info" ] && usage_info+="  "
  usage_info+="${c_muted}7d $(usage_color "$week_pct")${week_pct}%${week_day}${c_reset}"
fi

# Time elapsed
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

# Tool call count. The transcript is append-only, so cache "bytes-seen count"
# per session and only grep the bytes added since the last refresh.
tool_count=0
if [ -n "$transcript_path" ] && [ -f "$transcript_path" ]; then
  tool_cache="/tmp/claude-statusline-tools-${session_id:-default}"
  size=$(stat -f%z "$transcript_path" 2>/dev/null || echo 0)
  seen=0
  [ -f "$tool_cache" ] && read -r seen tool_count < "$tool_cache"
  if [ "${seen:-0}" -gt "$size" ]; then seen=0; tool_count=0; fi
  if [ "$size" -gt "${seen:-0}" ]; then
    added=$(tail -c +$((seen + 1)) "$transcript_path" | grep -c '"type":"tool_use"')
    tool_count=$(( ${tool_count:-0} + added ))
    echo "$size $tool_count" > "$tool_cache"
  fi
fi

# SSH session info (if applicable)
ssh_info=""
if [ -n "$SSH_CONNECTION" ] || [ -n "$SSH_CLIENT" ]; then
  ssh_info="${c_muted}$(whoami)@$(hostname -s) ${c_reset}"
fi

# Path + git. Inside a repo, show the repo name (resolved through
# --git-common-dir so Superset worktrees under ~/.superset/worktrees/ read as
# their main repo), the worktree name when it is a linked worktree, and any
# subdirectory. Outside a repo, fall back to the ~-relative path.
path_display=""
git_info=""
git_paths=$(git -C "$cwd" rev-parse --show-toplevel --path-format=absolute --git-common-dir 2>/dev/null)
if [ -n "$git_paths" ]; then
  toplevel=$(echo "$git_paths" | sed -n 1p)
  common_dir=$(echo "$git_paths" | sed -n 2p)
  main_root=$(dirname "$common_dir")
  repo_name=$(basename "$main_root")
  path_display="${c_fg}${repo_name}"
  [ "$toplevel" != "$main_root" ] && path_display+="${c_muted}@$(basename "$toplevel")"
  subdir="${cwd#"$toplevel"}"
  [ -n "$subdir" ] && [ "$subdir" != "$cwd" ] && path_display+="${c_muted}${subdir}"
  path_display+="${c_reset}"

  # One porcelain call gives branch, upstream ahead/behind, and dirty state
  # (tracked files only, matching the old diff --quiet checks)
  status=$(git -C "$cwd" -c core.fileMode=false status --porcelain=v2 --branch -uno 2>/dev/null)
  branch=$(echo "$status" | sed -n 's/^# branch.head //p')
  [ "$branch" = "(detached)" ] && branch=$(echo "$status" | sed -n 's/^# branch.oid \(.\{7\}\).*/\1/p')

  if [ -n "$branch" ]; then
    git_color="$c_accent"
    dirty=""
    if echo "$status" | grep -q '^[12u] '; then
      dirty="*"
      git_color="$c_warning"
    fi

    ahead_behind=""
    ab=$(echo "$status" | sed -n 's/^# branch.ab //p')
    if [ -n "$ab" ]; then
      ahead=$(echo "$ab" | awk '{print substr($1,2)}')
      behind=$(echo "$ab" | awk '{print substr($2,2)}')
      [ "$behind" -gt 0 ] && ahead_behind="${ahead_behind}-${behind}"
      [ "$ahead" -gt 0 ] && ahead_behind="${ahead_behind}+${ahead}"
    fi

    git_info="  ${git_color}${branch}${dirty}${ahead_behind}${c_reset}"
  fi
elif [ "$cwd" = "$HOME" ]; then
  path_display="${c_muted}~${c_reset}"
else
  path_display="${cwd/#$HOME/~}"
  depth=$(echo "$path_display" | grep -o "/" | wc -l | tr -d ' ')
  if [ "$depth" -gt 3 ]; then
    path_display="~/.../"$(echo "$path_display" | rev | cut -d'/' -f1-2 | rev)
  fi
  path_display="${c_fg}${path_display}${c_reset}"
fi

# 1. Open PR for this branch and its review state
pr_info=""
if [ -n "$pr_number" ]; then
  case "$pr_state" in
    approved)          pr_mark="${c_success}✓" ;;
    changes_requested) pr_mark="${c_error}✗" ;;
    draft)             pr_mark="${c_muted}draft" ;;
    *)                 pr_mark="${c_warning}⏳" ;;
  esac
  pr_info="  ${c_muted}PR#${pr_number} ${pr_mark}${c_reset}"
fi

# 3. Model (shortened) with effort level; session name, truncated
model_display="${model/ (1M context)/ 1M}"
[ -n "$effort" ] && model_display+=" ${c_muted}${effort}"
session_display=""
if [ -n "$session_name" ]; then
  [ "${#session_name}" -gt 28 ] && session_name="${session_name:0:27}…"
  session_display="  ${c_muted}“${session_name}”${c_reset}"
fi

# 5. Prompt cache: warn in the last 10 minutes before the cache expires, and
# once it has gone cold say how many tokens the next message will re-cache.
cache_info=""
if [ "$cache_requests" -gt 0 ]; then
  cache_left=$(( cache_expires - now ))
  if [ "$cache_warm" = "true" ] && [ "$cache_left" -gt 0 ]; then
    if [ "$cache_left" -le 600 ]; then
      cache_color="$c_warning"
      [ "$cache_left" -le 120 ] && cache_color="$c_error"
      cache_info="  ${cache_color}cache $(( (cache_left + 59) / 60 ))m${c_reset}"
    fi
  else
    cache_info="  ${c_error}cache cold${c_muted} ~$(( cache_recache / 1000 ))k${c_reset}"
  fi
fi

# Build status line with clear spacing
# Format: path | git | PR | context | model effort | usage | cache | time | tools | session
[ -n "$usage_info" ] && usage_info+="  "
printf "%b%b%b%b  %b  %b  %b%b%b  %b%b" \
  "$ssh_info" \
  "$path_display" \
  "$git_info" \
  "$pr_info" \
  "$context_bar" \
  "${c_symbol}${model_display}${c_reset}" \
  "$usage_info" \
  "${c_muted}${time_info}${c_reset}" \
  "$cache_info" \
  "${c_muted}tools:${c_accent}${tool_count}${c_reset}" \
  "$session_display"
