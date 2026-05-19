#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────
# Claude Code Custom Harness — Fresh-Mac Bootstrap
#
# Installs system-level prerequisites and sidecar projects that
# live outside ~/.claude but are referenced by the hook system:
#   - Homebrew + tokf
#   - npm-global cf-approve
#   - claude-deck repo (private)  → ~/Projects/claude-deck
#   - chorus / polyphony repo     → ~/Projects/chorus + `npm link`
#   - Persists OPENROUTER_API_KEY / REF_API_KEY to ~/.zshrc
#
# Intended to be called from install.sh on a fresh Mac, but is
# safe to run standalone and is idempotent.
#
# Usage:
#   bash $HOME/.claude/scripts/bootstrap-mac.sh           # run all stages
#   bash $HOME/.claude/scripts/bootstrap-mac.sh --check   # only print state
# ──────────────────────────────────────────────────────────────

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}[info]${NC}  $1"; }
ok()    { echo -e "${GREEN}[ok]${NC}    $1"; }
warn()  { echo -e "${YELLOW}[warn]${NC}  $1"; }
error() { echo -e "${RED}[error]${NC} $1"; }

CHECK_ONLY=false
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=true

PROJECTS_DIR="$HOME/Projects"
CLAUDE_DECK_REPO="git@github.com:crypticpy/claude-deck.git"
CHORUS_REPO="https://github.com/crypticpy/chorus.git"
TOKF_FORMULA="mpecan/tokf/tokf"
CF_APPROVE_PKG="@abdo-el-mobayad/claude-code-fast-permission-hook"

# ── Stage 0: prereqs ─────────────────────────────────────────
info "Checking prerequisites…"
command -v xcode-select >/dev/null 2>&1 || { error "Apple Command Line Tools missing — run: xcode-select --install"; exit 1; }
command -v brew >/dev/null 2>&1 || { error "Homebrew missing — install from https://brew.sh"; exit 1; }
command -v node >/dev/null 2>&1 || { error "Node missing — brew install node (need v20+)"; exit 1; }
command -v npm  >/dev/null 2>&1 || { error "npm missing"; exit 1; }
command -v git  >/dev/null 2>&1 || { error "git missing"; exit 1; }
command -v gh   >/dev/null 2>&1 || { warn  "gh CLI missing — brew install gh (needed to clone private claude-deck)"; }
ok "Prereqs present"

if $CHECK_ONLY; then
    info "Check-only mode — exiting before any changes."
    exit 0
fi

mkdir -p "$PROJECTS_DIR"

# ── Stage 1: tokf via Homebrew ───────────────────────────────
info "Installing tokf (token-output filter)…"
if brew list tokf >/dev/null 2>&1; then
    ok "tokf already installed"
else
    brew install "$TOKF_FORMULA" && ok "tokf installed" || warn "tokf install failed (non-fatal — hook will be skipped)"
fi

# ── Stage 2: cf-approve (npm global) ─────────────────────────
info "Installing cf-approve (fast-permission hook)…"
if command -v cf-approve >/dev/null 2>&1; then
    ok "cf-approve already on PATH"
else
    npm install -g "$CF_APPROVE_PKG" && ok "cf-approve installed" || warn "cf-approve install failed (non-fatal — PermissionRequest hook will be skipped)"
fi

# ── Stage 3: claude-deck sidecar repo ────────────────────────
info "Bootstrapping claude-deck…"
DECK_DIR="$PROJECTS_DIR/claude-deck"
if [[ -d "$DECK_DIR/.git" ]]; then
    ok "claude-deck repo already at $DECK_DIR"
elif command -v gh >/dev/null 2>&1; then
    if gh repo clone crypticpy/claude-deck "$DECK_DIR" 2>&1; then
        ok "claude-deck cloned"
    else
        warn "claude-deck clone failed — check gh auth (gh auth status)"
    fi
else
    warn "Skipping claude-deck (no gh CLI to clone private repo)"
fi

if [[ -d "$DECK_DIR" && ! -d "$HOME/.claude-deck" ]]; then
    info "Running claude-deck installer…"
    (cd "$DECK_DIR" && npm install --silent && bash ./scripts/install.sh) \
        && ok "claude-deck installed" \
        || warn "claude-deck installer failed (non-fatal)"
elif [[ -d "$HOME/.claude-deck" ]]; then
    ok "claude-deck already installed (~/.claude-deck exists)"
fi

# ── Stage 4: chorus / polyphony sidecar repo ─────────────────
info "Bootstrapping chorus/polyphony…"
CHORUS_DIR="$PROJECTS_DIR/chorus"
if [[ -d "$CHORUS_DIR/.git" ]]; then
    ok "chorus repo already at $CHORUS_DIR"
else
    if git clone "$CHORUS_REPO" "$CHORUS_DIR" 2>&1; then
        ok "chorus cloned"
    else
        warn "chorus clone failed (non-fatal — chorus MCP server will be skipped)"
    fi
fi

if [[ -d "$CHORUS_DIR" ]] && ! command -v chorus >/dev/null 2>&1 && ! command -v polyphony >/dev/null 2>&1; then
    info "Linking chorus/polyphony globally…"
    (cd "$CHORUS_DIR" && npm install --silent && npm link) \
        && ok "chorus/polyphony linked" \
        || warn "npm link failed (non-fatal)"
elif command -v polyphony >/dev/null 2>&1 || command -v chorus >/dev/null 2>&1; then
    ok "chorus/polyphony already linked on PATH"
fi

# ── Stage 5: persist env vars to ~/.zshrc ────────────────────
info "Persisting required env vars to ~/.zshrc…"
ZRC="$HOME/.zshrc"
touch "$ZRC"

persist_env() {
    local var="$1"; local val="${!var:-}"
    if [[ -z "$val" ]]; then
        warn "  $var not set in current shell — skipped (set it manually later)"
        return
    fi
    if grep -qE "^export ${var}=" "$ZRC"; then
        ok "  $var already in ~/.zshrc"
    else
        printf '\n# Added by claude-harness bootstrap %s\nexport %s=%q\n' "$(date +%F)" "$var" "$val" >> "$ZRC"
        ok "  $var appended to ~/.zshrc"
    fi
}

persist_env OPENROUTER_API_KEY
persist_env REF_API_KEY

# ── Stage 6: summary ─────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  Bootstrap complete                          ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo "Next steps:"
echo "  1. Open a new shell (or 'source ~/.zshrc') so env vars load."
echo "  2. cd ~/.claude && ./install.sh   # (already done if invoked from there)"
echo "  3. Sign in to claude.ai-hosted MCP servers in Claude Code:"
echo "     /mcp  → Vercel, Hugging Face, Google Drive, Google Calendar, Gmail"
echo ""
