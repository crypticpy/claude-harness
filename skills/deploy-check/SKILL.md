# /deploy-check — one-shot deployment validation

## Usage

```
/deploy-check                         # run all checks from ./.claude/deploy-check.env
/deploy-check --verbose               # also print response bodies (useful when triaging)
```

## Why

Repeated ad-hoc `curl` calls to health endpoints after a deploy are a known source of context churn (per evolution analysis 2026-06-27). This skill consolidates them into one scripted invocation with structured pass/fail output. Project-agnostic: each repo declares its own URLs.

## Steps

### 1. Locate config

```bash
test -f .claude/deploy-check.env || echo "missing"
```

If the file does not exist in the repo, tell the user the skill needs one and offer to scaffold it (do NOT guess URLs). A minimal config looks like:

```
# .claude/deploy-check.env
CHECK="api|https://my-api.example.com/api/v1/health|status:200;json:status=healthy"
CHECK="frontend|https://my-frontend.example.com|status:200"
```

Each `CHECK` line is `label|URL|expect`, where `expect` is one or more (semicolon-joined) of:
- `status:<N>` — HTTP status must equal N
- `json:<dot.path>=<value>` — JSON body must contain `value` at the given dot path
- `contains:<substring>` — response body must contain the substring

### 2. Run the script

```bash
bash ~/.claude/skills/deploy-check/check.sh
```

Exit codes:
- `0` — every check passed
- `1` — at least one check failed (script also prints which)
- `3` — fatal (no config, no curl)

### 3. Surface results

The script already prints a structured pass/fail table. Don't restate it line by line — just tell the user "all N checks passed" or summarize what failed.

If the user wants to re-run after a fix, they can re-invoke `/deploy-check` themselves; don't auto-poll.

## Guardrails

- **Don't edit the config silently.** If a check URL or expectation seems wrong, surface it and ask. The config is owned by the repo, not the skill.
- **No retries.** A failed health check means the deploy is unhealthy or still propagating — that's information, not an error to retry away.
- **Don't add checks to the global script.** All target-specific knowledge lives in the per-repo `.claude/deploy-check.env` file.
