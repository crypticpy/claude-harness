#!/bin/bash
# Context Layer Personality Hook
# Injects project personality context on session start

# Read the hook input from stdin
INPUT=$(cat)

# Extract the session_id and project directory from the input
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
PROMPT=$(echo "$INPUT" | jq -r '.prompt // empty')

# Get the project directory (CLAUDE_PROJECT_DIR or current working directory)
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"

# Run the personality hook
# Pin Node v24: better-sqlite3 is built for it, and GUI-launched sessions may
# otherwise resolve Homebrew's newer node from PATH.
NODE="$HOME/.local/bin/node"
[ -x "$NODE" ] || NODE=node
"$NODE" "$HOME/.claude/plugins/context-layer/dist/hooks/personality.js" <<EOF
$INPUT
EOF
