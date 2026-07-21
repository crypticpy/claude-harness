#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# patch-cf-approve.sh — apply local patches to the globally
# installed cf-approve npm package.
#
# Patches (vs upstream 0.2.2), sources in ~/.claude/patches/cf-approve/dist:
#   - llm-client.js / permission-handler.js: LLM API failures are marked
#     isError, never cached, and passthrough to the native permission
#     dialog instead of denying (a transient 401 used to become a
#     week-long cached deny).
#   - cache.js: cache key drops cwd and Bash description/timeout, and
#     collapses whitespace in the command — the same command no longer
#     re-queries the LLM per worktree or per description wording.
#   - fast-decisions.js: customAllowPatterns also match Bash command
#     text for simple commands (no chaining/pipes/redirection), so
#     command families like `git status` can be instant-allowed.
#
# Idempotent; safe to re-run. Called from scripts/bootstrap-mac.sh
# after npm install, and manually after any cf-approve upgrade.
# ──────────────────────────────────────────────────────────────
set -euo pipefail

EXPECTED_VERSION="0.2.2"
PATCH_DIR="$HOME/.claude/patches/cf-approve/dist"

# Resolve the package dir from the binary actually on PATH (npm's global
# prefix and the install location can disagree, e.g. Homebrew vs ~/.local).
CF_BIN="$(command -v cf-approve || true)"
if [[ -z "$CF_BIN" ]]; then
    echo "[error] cf-approve not on PATH — run npm install -g first" >&2
    exit 1
fi
PKG_DIR="$(cd "$(dirname "$(readlink -f "$CF_BIN")")/.." && pwd)"

if [[ ! -f "$PKG_DIR/package.json" ]]; then
    echo "[error] could not resolve cf-approve package dir (got $PKG_DIR)" >&2
    exit 1
fi

version="$(node -p "require('$PKG_DIR/package.json').version")"
if [[ "$version" != "$EXPECTED_VERSION" ]]; then
    echo "[error] cf-approve is v$version but patches target v$EXPECTED_VERSION." >&2
    echo "        Re-diff the patched files against the new upstream before applying." >&2
    exit 1
fi

cp "$PATCH_DIR"/*.js "$PKG_DIR/dist/"
echo "[ok] cf-approve v$version patched ($(ls "$PATCH_DIR"/*.js | wc -l | tr -d ' ') files)"
