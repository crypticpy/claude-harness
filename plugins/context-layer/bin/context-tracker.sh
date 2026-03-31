#!/bin/bash
# Context Tracker - Writes token usage to shared file for other hooks to read
# Runs as a statusLine hook

set -e

# Read JSON input from stdin
input=$(cat)

# Extract context window data and write to shared location
CONTEXT_FILE="/tmp/claude-context-layer-stats.json"

# Parse and write relevant stats
echo "$input" | jq '{
  session_id: .session_id,
  model: .model.display_name,
  context_window: {
    size: .context_window.context_window_size,
    current: (
      (.context_window.current_usage.input_tokens // 0) +
      (.context_window.current_usage.output_tokens // 0) +
      (.context_window.current_usage.cache_creation_input_tokens // 0) +
      (.context_window.current_usage.cache_read_input_tokens // 0)
    ),
    input_tokens: .context_window.current_usage.input_tokens,
    output_tokens: .context_window.current_usage.output_tokens,
    cache_read: .context_window.current_usage.cache_read_input_tokens,
    cache_write: .context_window.current_usage.cache_creation_input_tokens
  },
  cost: {
    total_usd: .cost.total_cost_usd,
    session_duration_ms: .cost.total_duration_ms
  },
  exceeds_200k: .exceeds_200k_tokens,
  timestamp: now
}' > "$CONTEXT_FILE" 2>/dev/null || true

# Output empty JSON for statusLine (no display needed, we're just tracking)
echo '{}'
