#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────
# Claude Code Custom Harness — Installer
#
# Installs the Memento hook system, slash commands, agents,
# skills, context-layer plugin, and status line into ~/.claude.
#
# Usage:
#   git clone <repo-url> ~/.claude
#   cd ~/.claude && ./install.sh
#
# Or on a machine where ~/.claude already exists:
#   ./install.sh  (run from the repo root)
# ──────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAUDE_DIR="$HOME/.claude"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[info]${NC}  $1"; }
ok()    { echo -e "${GREEN}[ok]${NC}    $1"; }
warn()  { echo -e "${YELLOW}[warn]${NC}  $1"; }
error() { echo -e "${RED}[error]${NC} $1"; }

# ── Verify location ──────────────────────────────────────────
if [[ "$SCRIPT_DIR" != "$CLAUDE_DIR" ]]; then
    error "This repo must be cloned to ~/.claude"
    echo "  Expected: $CLAUDE_DIR"
    echo "  Got:      $SCRIPT_DIR"
    echo ""
    echo "To fix:"
    echo "  mv $SCRIPT_DIR $CLAUDE_DIR"
    echo "  cd $CLAUDE_DIR && ./install.sh"
    exit 1
fi

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  Claude Code Custom Harness — Installer      ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── Check prerequisites ──────────────────────────────────────
info "Checking prerequisites..."

MISSING=()
command -v node >/dev/null 2>&1 || MISSING+=("node (v20+)")
command -v npm  >/dev/null 2>&1 || MISSING+=("npm")
command -v git  >/dev/null 2>&1 || MISSING+=("git")

if [[ ${#MISSING[@]} -gt 0 ]]; then
    error "Missing required tools: ${MISSING[*]}"
    exit 1
fi

NODE_MAJOR=$(node -e 'console.log(process.versions.node.split(".")[0])')
if [[ "$NODE_MAJOR" -lt 20 ]]; then
    error "Node.js v20+ required (found v$(node -v))"
    exit 1
fi

ok "Prerequisites met (node v$(node -v | tr -d 'v'), npm v$(npm -v))"

# ── Generate settings.json from template ─────────────────────
info "Generating settings.json from template..."

TEMPLATE="$CLAUDE_DIR/settings.template.json"
SETTINGS="$CLAUDE_DIR/settings.json"

if [[ ! -f "$TEMPLATE" ]]; then
    error "settings.template.json not found"
    exit 1
fi

if [[ -f "$SETTINGS" ]]; then
    warn "settings.json already exists — backing up"
    cp "$SETTINGS" "$SETTINGS.pre-install.$(date +%Y%m%d-%H%M%S)"
fi

# Replace __HOME__ placeholder with actual home directory
sed "s|__HOME__|$HOME|g" "$TEMPLATE" > "$SETTINGS"
ok "Paths configured for $HOME"

# Handle Ref API key
if grep -q '__REF_API_KEY__' "$SETTINGS" 2>/dev/null; then
    if [[ -n "${REF_API_KEY:-}" ]]; then
        sed -i.bak "s|__REF_API_KEY__|$REF_API_KEY|g" "$SETTINGS"
        rm -f "$SETTINGS.bak"
        ok "Ref API key set from \$REF_API_KEY"
    else
        warn "Ref MCP server has a placeholder API key"
        echo "       Set it later:"
        echo "       export REF_API_KEY=your-key-here && ~/.claude/install.sh"
        echo "       Or: sed -i '' 's|__REF_API_KEY__|your-key|' ~/.claude/settings.json"
    fi
fi

# ── Create runtime directories ───────────────────────────────
info "Creating runtime directories..."

RUNTIME_DIRS=(
    "hooks/unified/logs"
    "hooks/unified/memories"
    "hooks/unified/evolution"
    "context-layer"
    "sessions"
    "plans"
    "tasks"
)

for dir in "${RUNTIME_DIRS[@]}"; do
    mkdir -p "$CLAUDE_DIR/$dir"
done
ok "Runtime directories ready"

# ── Build context-layer plugin ───────────────────────────────
PLUGIN_DIR="$CLAUDE_DIR/plugins/context-layer"
if [[ -f "$PLUGIN_DIR/package.json" ]]; then
    info "Building context-layer plugin..."
    cd "$PLUGIN_DIR"

    if [[ -f "package-lock.json" ]]; then
        npm ci --silent 2>/dev/null || npm install --silent
    else
        npm install --silent
    fi

    npm run build --silent 2>/dev/null && ok "context-layer plugin built" || warn "context-layer build failed (non-critical)"

    cd "$CLAUDE_DIR"
else
    warn "context-layer plugin not found — skipping"
fi

# ── Check optional integrations ──────────────────────────────
info "Checking optional integrations..."

# Claude Deck
if [[ -d "$HOME/.claude-deck" ]]; then
    ok "Claude Deck detected"
else
    warn "Claude Deck not installed (hooks will be skipped at runtime)"
fi

# tokf
if [[ -f "$HOME/Library/Application Support/tokf/hooks/pre-tool-use.sh" ]]; then
    ok "tokf token tracker detected"
else
    warn "tokf not installed (Bash token hook will be skipped)"
fi

# Formatters
info "Checking formatters..."
for fmt in black gofmt rustfmt prettier; do
    if command -v "$fmt" >/dev/null 2>&1; then
        ok "  $fmt found"
    else
        warn "  $fmt not on PATH — formatting for its file types will be skipped"
    fi
done

# OpenRouter API key (used by hooks for LLM calls)
if [[ -n "${OPENROUTER_API_KEY:-}" ]]; then
    ok "OPENROUTER_API_KEY set"
elif [[ -f "$HOME/.claude-code-fast-permission-hook/config.json" ]]; then
    ok "API key available via config file"
else
    warn "No OPENROUTER_API_KEY — session memory, trace diagnosis, and evolution will run without LLM"
    echo "       Set OPENROUTER_API_KEY in your shell profile for full functionality"
fi

# ── Verify hook system loads ─────────────────────────────────
info "Verifying hook system..."

HOOK_OK=true
for mod in session-memory session-start trace-diagnosis rolling-log self-evolution deep-retrospective; do
    if node -e "import('$CLAUDE_DIR/hooks/unified/modules/${mod}.mjs').then(() => process.exit(0)).catch(() => process.exit(1))" 2>/dev/null; then
        ok "  $mod"
    else
        error "  $mod failed to load"
        HOOK_OK=false
    fi
done

if $HOOK_OK; then
    ok "All hook modules verified"
else
    error "Some modules failed — check Node.js version and dependencies"
fi

# ── Summary ──────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  Installation complete                        ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo "  Installed:"
echo "    - Unified hook system (Memento architecture)"
echo "    - Slash commands: /plan, /evolve, /retrospective, /freview"
echo "    - Custom agents: principal-code-reviewer, final-review-completeness"
echo "    - Status line with context tracking"
echo "    - Context-layer MCP plugin"
echo ""
echo "  Start a new Claude Code session to activate."
echo ""
