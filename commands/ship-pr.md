---
description: Take the current uncommitted changes through worktree → branch → commit → push → PR, then hand off to /babysit-pr for the merge dance.
---

# /ship-pr — full PR flow

Take whatever's changed in the current working tree and drive it all the way to merge.

## Usage

```
/ship-pr                # auto-detect everything, ask only when ambiguous
/ship-pr <slug-hint>    # use the given slug for branch/worktree naming
/ship-pr --no-merge     # ship, babysit, but stop short of auto-merge
```

## Why this exists

The maintainer's working PR process across foresight-app PRs (and any other project that follows the same workflow) is:

1. **Fresh worktree, fresh branch.** Never push from `main`. Never accumulate two unrelated changes on one branch.
2. **Targeted, small PRs.** One purpose per PR. Split before pushing, not after.
3. **Conventional commit prefix** (`feat:` / `fix:` / `refactor:` / `docs:` / `test:` / `chore:` / `perf:`).
4. **Stage explicit files, never `git add -A`.** Avoids `.env`, lockfiles, stray binaries.
5. **HEREDOC commit + PR body** so formatting survives shell escaping.
6. **`gh pr create` + `/babysit-pr <N>`** so the maintainer doesn't have to babysit themselves.
7. **No `--no-verify`, no force-push, no hook bypass.** Ever.
8. **Co-authored-by Claude in the commit trailer.**

This command codifies that flow so it's reproducible across projects and sessions.

## Steps

### 1. Pre-flight checks

Run these in parallel:

- `git rev-parse --is-inside-work-tree` → must be `true`
- `gh auth status` → must be authenticated
- `git status --short` → must have changes (else exit and tell user)
- `git remote -v` → confirm there's an `origin`
- `gh repo view --json nameWithOwner,defaultBranchRef -q '"\(.nameWithOwner)\t\(.defaultBranchRef.name)"'` → REPO + MAIN_BRANCH

If `gh auth` fails, tell the user to run `gh auth login` and stop.

### 2. Inventory the changes

- `git status --short` — list modified/untracked
- `git diff` (and `git diff --cached`) — see actual content
- For changes that look sensitive (file names containing `secret`, `.env`, `credential`, `*.pem`, `*.key`), **stop and warn the user** before staging. Do not auto-include them.

### 3. Plan the PR

Based on the diff, draft:

- **Type** — pick one conventional-commit prefix
- **Slug** — short kebab-case (`fix/auth-redirect`, `refactor/api-client-rename`); use the user's hint if provided
- **Branch** — `<type>/<slug>`
- **Commit title** — `<type>(<scope>): <short imperative>` under ~70 chars (use scope only if it adds signal)
- **PR title** — same as commit title
- **PR body** — Summary (1–3 bullets, "what" and "why") + Test plan (markdown checklist)

If anything is genuinely ambiguous (e.g., two unrelated themes in the diff that should be split into two PRs), surface that to the user via `AskUserQuestion` before proceeding. Otherwise proceed silently.

### 4. Decide where the branch lives

Two situations:

- **Currently on main / default branch**: create a fresh worktree.

  ```bash
  git fetch origin <MAIN_BRANCH> --quiet
  git worktree add .worktrees/<slug> -b <branch> origin/<MAIN_BRANCH>
  ```

  Then move the uncommitted changes into the worktree (see Step 5).

- **Currently on a feature branch**: commit + push from the current dir. Do NOT create a second worktree unless the user explicitly asks.

In either case, the worktree path (if any) is captured for `/babysit-pr` so post-merge cleanup removes the right directory.

### 5. Move changes into the worktree (only if Step 4 created a new worktree)

`git diff` only captures **tracked** changes — brand-new untracked files would be dropped if you just patch. Handle both:

```bash
# Tracked changes (modified + staged): patch into the worktree
git -C <current-dir> diff HEAD > /tmp/ship-pr-<slug>.patch
if [[ -s /tmp/ship-pr-<slug>.patch ]]; then
  git -C .worktrees/<slug> apply /tmp/ship-pr-<slug>.patch
fi

# Untracked files: copy them in with their parent directories preserved
( cd <current-dir> && git ls-files --others --exclude-standard -z ) | \
  while IFS= read -r -d '' f; do
    mkdir -p ".worktrees/<slug>/$(dirname "$f")"
    cp -p "<current-dir>/$f" ".worktrees/<slug>/$f"
  done

git -C <current-dir> checkout -- .   # reset tracked changes in original dir (ASK FIRST)
# (Untracked files in original dir are NOT removed automatically — let the user decide.)
```

Only run the checkout reset if the user agrees — ask before destructive action. If unsure, leave the original dir alone and continue — the changes are already in the worktree.

### 6. Validate

In the worktree (or current dir if branch was already feature):

- For Python changes: `ruff check <touched files>`
- For TypeScript/JS changes: project-specific type-check (e.g. `npx tsc -b --noEmit` for project-reference setups, `npx tsc --noEmit` otherwise). Check the project's CLAUDE.md for the right invocation.
- For touched test files: run the matching test (e.g. `pytest tests/test_x.py::test_y` or `pnpm test:run <file>`).

If validation fails, **fix the problem before pushing** — never `--no-verify`.

**Review gate**: if the change modifies **≥6 files**, or touches **auth, input handling, or payments** (any file count), run `/freview` now — before the commit leaves the machine — and fix any blockers it reports. Smaller changes skip this; the edit-hook self-check is sufficient. This mirrors the repo CLAUDE.md review-gate rule: catching a blocker pre-push costs one local fix; catching it post-push costs a review cycle on the PR.

### 7. Stage, commit, push

Stage **specific files** (the ones you actually changed). Never `git add -A` or `git add .`.

```bash
git -C <worktree-or-cwd> add <file1> <file2> ...
git -C <worktree-or-cwd> commit -m "$(cat <<'EOF'
<commit title>

<optional body — short, why-not-what>

Co-Authored-By: <the exact co-author trailer your harness instructions specify for the current model — do not hardcode an older model name>
EOF
)"
git -C <worktree-or-cwd> push -u origin <branch>
```

Use HEREDOC for the commit message so newlines survive.

If a pre-commit hook fails: **fix the failure**, re-stage, create a NEW commit. Never `--amend` to paper over a failed hook (the original commit didn't actually happen — amending would modify the previous commit).

### 8. Open the PR

```bash
gh pr create --title "<title>" --body "$(cat <<'EOF'
## Summary

- <bullet 1>
- <bullet 2>

## Test plan

- [ ] <step 1>
- [ ] <step 2>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Capture the PR URL and number from the command's stdout.

### 9. Hand off to /babysit-pr

Invoke the `babysit-pr` skill with the PR number (and `--no-merge` if the user passed it). The babysit skill writes the bash poll to `/tmp/`, runs it in background, and the babysit auto-merges with `--delete-branch` once CI is green, review has been quiet for two ticks, and the comment queue is drained (`/address-pr-comments` advances the drain cursor).

### 10. Report to the user

One concise message:

- PR URL
- Branch name
- Worktree path (if created)
- Babysit task ID
- Reminder: `/address-pr-comments <N>` if bots leave feedback that needs a human decision

## Guardrails

- **Never** `git add -A`, `git add .`, or `--no-verify`.
- **Never** push to `main`/`master` directly. Always feature branch.
- **Never** force-push without explicit user instruction. Never to `main`.
- **Never** commit files matching `.env`, `*.pem`, `*.key`, `credentials*`, or files the user hasn't explicitly OK'd that contain `SUPABASE_KEY`, `OPENAI_API_KEY`, etc.
- **Never** auto-include large generated files (lock files outside what's already tracked, `dist/`, build artifacts).
- **If the diff spans two unrelated themes**, stop and propose splitting into two PRs. Smaller PRs ship faster.
- **If currently in a worktree** and the user types `/ship-pr`, ship the worktree's changes from where they sit — do not nest worktrees inside worktrees.
