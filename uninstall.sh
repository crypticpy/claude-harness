#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────
# Claude Code Custom Harness — Uninstaller
#
# Removes custom hooks and restores Claude Code to defaults.
# Does NOT delete the repo — just resets settings.json to minimal.
# ──────────────────────────────────────────────────────────────

CLAUDE_DIR="$HOME/.claude"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo ""
echo -e "${YELLOW}This will disable the custom hook system and reset settings.${NC}"
echo "The repo files will remain in ~/.claude for re-installation."
echo ""
read -p "Continue? (y/N) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
fi

# Back up current settings
if [[ -f "$CLAUDE_DIR/settings.json" ]]; then
    BACKUP="$CLAUDE_DIR/settings.json.pre-uninstall.$(date +%Y%m%d-%H%M%S)"
    cp "$CLAUDE_DIR/settings.json" "$BACKUP"
    echo -e "${GREEN}[ok]${NC} Settings backed up to $BACKUP"
fi

# Write minimal settings
cat > "$CLAUDE_DIR/settings.json" << 'EOF'
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "hooks": {},
  "mcpServers": {},
  "enabledPlugins": {}
}
EOF

echo -e "${GREEN}[ok]${NC} Settings reset to defaults"
echo ""
echo "Custom hooks are now disabled. To re-enable:"
echo "  cd ~/.claude && ./install.sh"
echo ""
