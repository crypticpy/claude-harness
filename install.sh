#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────
# Claude Code Custom Harness — Installer
#
# Installs the Memento hook system, slash commands, agents,
# skills, context-layer plugin, and status line into ~/.claude.
# Optionally bootstraps system-level prereqs (brew, npm globals,
# sidecar repos) via scripts/bootstrap-mac.sh.
#
# Usage:
#   git clone <repo-url> ~/.claude
#   cd ~/.claude && ./install.sh                # install harness only
#   cd ~/.claude && ./install.sh --bootstrap    # also run fresh-Mac bootstrap
# ──────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAUDE_DIR="$HOME/.claude"
BOOTSTRAP=false
[[ "${1:-}" == "--bootstrap" ]] && BOOTSTRAP=true

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

# ── Optional: fresh-Mac bootstrap ────────────────────────────
if $BOOTSTRAP; then
    BOOTSTRAP_SCRIPT="$CLAUDE_DIR/scripts/bootstrap-mac.sh"
    if [[ -x "$BOOTSTRAP_SCRIPT" ]]; then
        info "Running fresh-Mac bootstrap…"
        bash "$BOOTSTRAP_SCRIPT"
    else
        warn "bootstrap-mac.sh not found or not executable — skipping"
    fi
fi

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

# Template uses $HOME directly (Claude Code expands env vars in hook commands)
# so a straight copy suffices. MCP servers are registered separately below.
cp "$TEMPLATE" "$SETTINGS"
ok "settings.json materialized"

# ── Materialize settings.local.json from template ────────────
LOCAL_TEMPLATE="$CLAUDE_DIR/settings.local.json.template"
LOCAL_SETTINGS="$CLAUDE_DIR/settings.local.json"
if [[ -f "$LOCAL_TEMPLATE" && ! -f "$LOCAL_SETTINGS" ]]; then
    cp "$LOCAL_TEMPLATE" "$LOCAL_SETTINGS"
    ok "settings.local.json materialized from template"
elif [[ -f "$LOCAL_SETTINGS" ]]; then
    ok "settings.local.json already present (kept as-is)"
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

# ── Register MCP servers (idempotent) ────────────────────────
MCP_DATA="$CLAUDE_DIR/mcp-servers.json"
if command -v claude >/dev/null 2>&1 && [[ -f "$MCP_DATA" ]]; then
    info "Registering MCP servers from mcp-servers.json…"

    # context-layer
    CONTEXT_LAYER_JS="$CLAUDE_DIR/plugins/context-layer/dist/mcp-server.js"
    if [[ -f "$CONTEXT_LAYER_JS" ]]; then
        claude mcp remove context-layer 2>/dev/null || true
        claude mcp add context-layer node "$CONTEXT_LAYER_JS" >/dev/null 2>&1 \
            && ok "  context-layer registered" \
            || warn "  context-layer registration failed"
    else
        warn "  context-layer dist not built — skipping registration"
    fi

    # Ref (HTTP, needs REF_API_KEY)
    if [[ -n "${REF_API_KEY:-}" ]]; then
        claude mcp remove Ref 2>/dev/null || true
        claude mcp add --transport http Ref "https://api.ref.tools/mcp?apiKey=${REF_API_KEY}" >/dev/null 2>&1 \
            && ok "  Ref registered" \
            || warn "  Ref registration failed"
    else
        warn "  REF_API_KEY not set — Ref MCP skipped"
    fi

    # chorus / polyphony (resolve dynamically)
    CHORUS_BIN="$(command -v chorus 2>/dev/null || command -v polyphony 2>/dev/null || true)"
    if [[ -n "$CHORUS_BIN" ]]; then
        # The bin is a #!/usr/bin/env node script that takes 'mcp' as arg
        claude mcp remove chorus 2>/dev/null || true
        claude mcp add chorus node "$CHORUS_BIN" mcp >/dev/null 2>&1 \
            && ok "  chorus registered ($(basename $CHORUS_BIN))" \
            || warn "  chorus registration failed"
    else
        warn "  chorus/polyphony not on PATH — skipping (run ./install.sh --bootstrap to install)"
    fi
else
    warn "claude CLI or mcp-servers.json missing — MCP registration skipped"
fi

# ── Final verification: print live MCP list ──────────────────
if command -v claude >/dev/null 2>&1; then
    info "Active MCP servers:"
    claude mcp list 2>&1 | sed 's/^/    /' | grep -v 'Checking MCP server health' || true
fi

# ── Summary ──────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  Installation complete                        ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo "  Installed:"
echo "    - Unified hook system (Memento architecture)"
echo "    - Slash commands: /plan, /evolve, /retrospective, /freview, /chorus"
echo "    - Custom agents: principal-code-reviewer, final-review-completeness, pr-babysitter"
echo "    - Skills: babysit-pr, frontend-design"
echo "    - Status line with context tracking"
echo "    - Context-layer MCP plugin"
echo "    - First-party MCP servers (context-layer, Ref, chorus) registered"
echo ""
if ! $BOOTSTRAP; then
    echo "  Fresh Mac? Run: ./install.sh --bootstrap"
    echo "  (installs tokf, cf-approve, claude-deck, chorus, writes env vars to ~/.zshrc)"
    echo ""
fi
echo "  Start a new Claude Code session to activate."
echo ""
