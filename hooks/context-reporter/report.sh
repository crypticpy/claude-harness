#!/bin/bash
# Context Reporter Hook - runs every message, must be FAST
# Reads token stats from statusline and injects a one-liner

STATS_FILE="/tmp/claude-context-stats.json"
COMPACTION_THRESHOLD=154000  # Auto-compaction at ~154K, not 200K

# Fast exit if no stats file
[[ ! -f "$STATS_FILE" ]] && exit 0

# Read stats with single jq call (fast)
read -r current_k current_tokens <<< $(jq -r '[.current_k, .current_tokens] | @tsv' "$STATS_FILE" 2>/dev/null)

# Validate we got numbers
[[ -z "$current_k" || "$current_k" == "null" || "$current_k" == "0" ]] && exit 0

# Calculate remaining until COMPACTION (not total context)
compaction_k=$((COMPACTION_THRESHOLD / 1000))
remaining_until_compact=$((COMPACTION_THRESHOLD - current_tokens))
remaining_k=$((remaining_until_compact / 1000))

# Percent toward compaction threshold
percent_to_compact=$((current_tokens * 100 / COMPACTION_THRESHOLD))
(( percent_to_compact > 100 )) && percent_to_compact=100

# Color coding based on remaining until compaction
if (( remaining_until_compact <= 10000 )); then
    status="🔴"
    warning=" ⚠️ COMPACTION IMMINENT"
elif (( remaining_until_compact <= 30000 )); then
    status="🟠"
    warning=" - consider saving context"
elif (( remaining_until_compact <= 50000 )); then
    status="🟡"
    warning=""
else
    status="🟢"
    warning=""
fi

# Output the context line - this gets injected
echo "${status} Context: ${current_k}K/${compaction_k}K (${percent_to_compact}%) | ~${remaining_k}K until compaction${warning}"
