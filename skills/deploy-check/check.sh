#!/usr/bin/env bash
# deploy-check — one-shot validation of a deployed environment.
#
# Reads checks from a config file (default: ./.claude/deploy-check.env in the
# current repo, or override with DEPLOY_CHECK_CONFIG=<path>). The config
# declares one CHECK per line:
#
#   CHECK="label|URL|expect"
#
# where `expect` is one of:
#   status:<N>           — HTTP status code must equal N (e.g. status:200)
#   json:<dot.path>=<v>  — jq-style dot path in the JSON body must equal v
#                          (e.g. json:status=healthy or json:mode=full)
#   contains:<substring> — response body must contain the substring
#
# Multiple expects on one line are joined with `;` and all must pass.
#
# Exit 0 if every check passes, non-zero on first failure. Prints a compact
# table at the end.
#
# Project-agnostic: no hardcoded URLs. Drop a .claude/deploy-check.env in any
# repo to opt in. Example:
#
#   CHECK="api|https://foo-api.up.railway.app/api/v1/health|status:200;json:status=healthy"
#   CHECK="worker|https://foo-worker.up.railway.app/api/v1/worker/health|status:200"
#   CHECK="frontend|https://foo.vercel.app|status:200"
#
# Usage:
#   bash ~/.claude/skills/deploy-check/check.sh                 # uses ./.claude/deploy-check.env
#   DEPLOY_CHECK_CONFIG=/path/to/cfg bash ~/.claude/skills/deploy-check/check.sh
#   bash ~/.claude/skills/deploy-check/check.sh --verbose       # show response bodies

set -u
set -o pipefail

VERBOSE=0
for arg in "$@"; do
  case "$arg" in
    -v|--verbose) VERBOSE=1 ;;
    -h|--help)
      sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
  esac
done

CONFIG="${DEPLOY_CHECK_CONFIG:-./.claude/deploy-check.env}"

if [[ ! -f "$CONFIG" ]]; then
  echo "deploy-check: no config at $CONFIG" >&2
  echo "  create it with one CHECK=\"label|URL|expect\" line per target." >&2
  echo "  see: bash ~/.claude/skills/deploy-check/check.sh --help" >&2
  exit 3
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "deploy-check: curl not found in PATH" >&2
  exit 3
fi

CHECKS=()
while IFS= read -r line; do
  [[ "$line" =~ ^[[:space:]]*# ]] && continue
  [[ "$line" =~ ^[[:space:]]*$ ]] && continue
  if [[ "$line" =~ ^CHECK=\"(.*)\"$ ]]; then
    CHECKS+=("${BASH_REMATCH[1]}")
  elif [[ "$line" =~ ^CHECK=\'(.*)\'$ ]]; then
    CHECKS+=("${BASH_REMATCH[1]}")
  fi
done < "$CONFIG"

if [[ ${#CHECKS[@]} -eq 0 ]]; then
  echo "deploy-check: config $CONFIG has no CHECK= lines" >&2
  exit 3
fi

# Helpers ---------------------------------------------------------------
extract_json_path() {
  # $1 = body, $2 = dot.path
  # Uses python (always present on the targeted machines) for robust JSON walk.
  # Body goes via env var so the heredoc can own stdin for the script itself.
  DEPLOY_CHECK_BODY="$1" python3 - "$2" <<'PY' 2>/dev/null
import json, os, sys
path = sys.argv[1].split('.')
try:
    val = json.loads(os.environ.get("DEPLOY_CHECK_BODY", ""))
    for p in path:
        if isinstance(val, list):
            val = val[int(p)]
        else:
            val = val[p]
    if isinstance(val, (dict, list)):
        print(json.dumps(val))
    elif val is None:
        print("null")
    elif isinstance(val, bool):
        print("true" if val else "false")
    else:
        print(val)
except Exception:
    sys.exit(1)
PY
}

# Run -------------------------------------------------------------------
PASS_ROWS=()
FAIL_ROWS=()
OVERALL_RC=0

for spec in "${CHECKS[@]}"; do
  IFS='|' read -r LABEL URL EXPECT <<<"$spec"
  if [[ -z "${LABEL:-}" || -z "${URL:-}" || -z "${EXPECT:-}" ]]; then
    FAIL_ROWS+=("? | (bad CHECK spec) | $spec")
    OVERALL_RC=1
    continue
  fi

  TMP_BODY="$(mktemp)"
  STATUS="$(curl -sS -o "$TMP_BODY" -w '%{http_code}' --max-time 15 "$URL" 2>/dev/null || echo "000")"
  BODY="$(cat "$TMP_BODY")"
  rm -f "$TMP_BODY"

  FAILED_REASON=""
  IFS=';' read -ra EXPECTS <<<"$EXPECT"
  for e in "${EXPECTS[@]}"; do
    case "$e" in
      status:*)
        want="${e#status:}"
        if [[ "$STATUS" != "$want" ]]; then
          FAILED_REASON="status=$STATUS (want $want)"
          break
        fi
        ;;
      json:*)
        rest="${e#json:}"
        path="${rest%%=*}"
        want="${rest#*=}"
        got="$(extract_json_path "$BODY" "$path" || echo '<no-such-path>')"
        if [[ "$got" != "$want" ]]; then
          FAILED_REASON="json:$path=$got (want $want)"
          break
        fi
        ;;
      contains:*)
        sub="${e#contains:}"
        if [[ "$BODY" != *"$sub"* ]]; then
          FAILED_REASON="body missing: $sub"
          break
        fi
        ;;
      *)
        FAILED_REASON="unknown expect: $e"
        break
        ;;
    esac
  done

  if [[ -z "$FAILED_REASON" ]]; then
    PASS_ROWS+=("$LABEL | $URL | $STATUS")
    if [[ $VERBOSE -eq 1 ]]; then
      echo "PASS  $LABEL  $URL  status=$STATUS"
      echo "      body: ${BODY:0:200}"
    fi
  else
    FAIL_ROWS+=("$LABEL | $URL | $FAILED_REASON")
    OVERALL_RC=1
    if [[ $VERBOSE -eq 1 ]]; then
      echo "FAIL  $LABEL  $URL  $FAILED_REASON"
      echo "      body: ${BODY:0:200}"
    fi
  fi
done

# Summary ---------------------------------------------------------------
echo
echo "deploy-check summary"
echo "===================="
if [[ ${#PASS_ROWS[@]} -gt 0 ]]; then
  echo "PASS (${#PASS_ROWS[@]}):"
  for r in "${PASS_ROWS[@]}"; do echo "  $r"; done
fi
if [[ ${#FAIL_ROWS[@]} -gt 0 ]]; then
  echo "FAIL (${#FAIL_ROWS[@]}):"
  for r in "${FAIL_ROWS[@]}"; do echo "  $r"; done
fi
echo

if [[ $OVERALL_RC -eq 0 ]]; then
  echo "All ${#PASS_ROWS[@]} checks passed."
else
  echo "${#FAIL_ROWS[@]} check(s) failed."
fi
exit $OVERALL_RC
