/**
 * Command redirect — PreToolUse(Bash).
 *
 * Denies Bash command shapes that have a clear safer rewrite, with a reason
 * the model can act on, so it rewrites the command and retries by itself
 * instead of popping a human approval prompt:
 *
 *   [gh-budget]  gh shapes that burn the shared GitHub rate limit: loops /
 *                fan-out over gh, --paginate/--slurp, --limit/per_page/first:
 *                over 100, search endpoints, unbounded expensive list endpoints.
 *   [secrets]    printing credential files (cat/less/more/head/tail/bat) or
 *                `gh auth token` into the transcript.
 *
 * These replaced the matching `permissions.ask` rules in settings.template.json
 * (genuinely destructive commands keep the human prompt there).
 *
 * Runs on every Bash call: commands with neither `gh` nor a credential file
 * name exit after two cheap regex tests.
 */

import { homedir } from 'os';

const MAX_PAGE = 100;

const RETRY = 'Rewrite the command and retry; do not ask the user to approve the original.';

const REASONS = {
    loop: "Don't loop over gh (for/while/until loops, seq/xargs/parallel fan-out). Batch into one GraphQL query using aliases (a: repository(owner:\"o\",name:\"r\"){...} b: repository(...){...}) or one gh api call with a server-side filter.",
    paginate: 'No --paginate/--slurp. Tighten the filter server-side (--state/--label/--author/--search, or query params) or ask the user before walking pages.',
    limit: 'Keep --limit/-L, per_page and first:/last: at or below 100 and filter server-side instead of pulling more rows.',
    search: 'search/* (REST search endpoints and GraphQL search()) is an expensive endpoint; use a filtered list endpoint (e.g. gh pr list/gh issue list with --state/--label/--author/--search) unless the task is specifically about search. If the task is genuinely a search, use the `gh search` subcommand with a narrow query and --limit ≤100.',
    expensive: '/events, /stargazers, /forks, /contributors, /traffic/ and commit lists are the most expensive endpoints. Use a narrower endpoint or filter instead (a single-object endpoint such as repos/o/r/commits/<sha>, or commits?since=...&until=...&path=...&per_page=50). Use them only when the task is specifically about that data, and then as one call with an explicit per_page≤100 and no pagination.',
    secrets: "Don't print credential files or tokens into the transcript. Check auth with `gh auth status`/`npm whoami`/`kubectl config current-context`, or list structure without values (e.g. `jq 'keys' ~/.claude.json`, `grep -c` for a key). gh and other CLIs authenticate on their own; you never need the raw token.",
};

const FAMILY = {
    loop: 'gh-budget', paginate: 'gh-budget', limit: 'gh-budget',
    search: 'gh-budget', expensive: 'gh-budget', secrets: 'secrets',
};

// A command position: start, after a separator / subshell / quote (covers
// `sh -c 'gh ...'`), or after a loop/branch keyword (so a polling
// `while gh run view ...; do` counts). `echo gh` or `grep -r gh` are not.
const CMD_POS = String.raw`(?:^|[;&|({\x60\n'"]|\$\(|\b(?:do|then|else|if|elif|while|until|time|command|exec)\s)\s*`;

// ---- gh-budget ----------------------------------------------------------

const GH_CMD = new RegExp(CMD_POS + String.raw`gh\s+[a-z]`);
// Loop keywords at a command position, and `done`, for depth-counted spans.
const LOOP_TOKENS = new RegExp(CMD_POS + String.raw`(for|while|until)\b|\b(done)\b`, 'g');
const FANOUT = /\b(?:xargs|parallel)\b[^;&|]*?\bgh\s+[a-z]/;
const GH_TO_PARALLEL = /\bgh\s[^|;&]*\|\s*parallel\b/;
const SEQ_TO_GH = new RegExp(CMD_POS + String.raw`seq\b[^;&|]*\|[^;&]*?\bgh\s+[a-z]`);
const PAGINATE = /(?:^|\s)--(?:paginate|slurp)\b/;
const LIMIT_NUMS = [
    /(?:^|\s)(?:--limit(?:=|\s+)|-L\s*)['"]?(\d+)/g,
    /\bper_page=(\d+)/g,
    /\b(?:first|last)\s*:\s*(\d+)/g,
];
const REST_SEARCH = /\bgh\s+api\b[^;&|]*?(?:[\s'"]\/?|api\.github\.com\/|\/api\/v3\/)search\//;
const GRAPHQL_SEARCH = /\bgh\s+api\s+graphql\b[\s\S]*?\bsearch\s*\(/;
// One `gh api ...` invocation, up to `;`, `&&` or a newline (single `&` kept:
// it is a URL query separator; pipes kept: they are usually inside --jq).
const GH_API_CALL = /\bgh\s+api\b(?:[^;&\n]|&(?!&))*/g;
const EXPENSIVE_ENDPOINT = /(?:^|[\s'"/])(?:events|stargazers|forks|contributors)(?=[/?\s'"]|$)|\/traffic\/|\/commits(?=[?\s'"]|$)/;
const WRITE_METHOD = /(?:^|\s)(?:-X\s*|--method[=\s]+)['"]?(?:POST|PUT|PATCH|DELETE)\b/i;
const BOUNDED_PAGE = /\bper_page=\d+/;
const GRAPHQL_CALL = /\bgh\s+api\s+graphql\b/;

/** Each outermost for/while/until ... done span, with nesting respected. */
function loopSpans(cmd) {
    const spans = [];
    let depth = 0;
    let start = 0;
    for (const m of cmd.matchAll(LOOP_TOKENS)) {
        if (m[1]) {
            if (depth++ === 0) start = m.index;
        } else if (depth > 0 && --depth === 0) {
            spans.push(cmd.slice(start, m.index + m[0].length));
        }
    }
    if (depth > 0) spans.push(cmd.slice(start));
    return spans;
}

function hasLoopOverGh(cmd) {
    if (loopSpans(cmd).some((span) => GH_CMD.test(span))) return true;
    return FANOUT.test(cmd) || GH_TO_PARALLEL.test(cmd) || SEQ_TO_GH.test(cmd);
}

function overLimit(cmd) {
    return LIMIT_NUMS.some((re) =>
        [...cmd.matchAll(re)].some((m) => Number(m[1]) > MAX_PAGE));
}

// Unbounded read of an expensive list endpoint. An explicit per_page (>100 is
// caught by the limit rule) marks a deliberate bounded call and passes.
function hitsExpensiveEndpoint(cmd) {
    return [...cmd.matchAll(GH_API_CALL)].some(([call]) =>
        !GRAPHQL_CALL.test(call) && EXPENSIVE_ENDPOINT.test(call)
        && !WRITE_METHOD.test(call) && !BOUNDED_PAGE.test(call));
}

// ---- secrets ------------------------------------------------------------

const CRED_FILES = String.raw`(?:\.claude\.json|\.claude-code-fast-permission-hook/config\.json|\.config/gh/hosts\.yml|\.npmrc|\.pypirc|\.docker/config\.json|\.kube/config|\.claude/\.credentials\.json)`;
const CRED_HINT = new RegExp(CRED_FILES);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const HOME_FORMS = [String.raw`~`, String.raw`\$HOME`, String.raw`\$\{HOME\}`, escapeRe(homedir())].join('|');
const READ_CRED = new RegExp(
    CMD_POS + String.raw`(?:cat|less|more|head|tail|bat)\b[^;&|\n]*?[\s'"<](?:${HOME_FORMS})/${CRED_FILES}`);
const GH_AUTH_TOKEN = new RegExp(CMD_POS + String.raw`gh\s+auth\s+token\b`);

// ---- entry points -------------------------------------------------------

/**
 * Pure classifier. Returns the list of violated categories (possibly empty).
 */
export function classifyCommand(cmd) {
    if (typeof cmd !== 'string') return [];
    const mentionsGh = /\bgh\b/.test(cmd);
    if (!mentionsGh && !CRED_HINT.test(cmd)) return [];

    const hits = [];
    if (READ_CRED.test(cmd) || (mentionsGh && GH_AUTH_TOKEN.test(cmd))) hits.push('secrets');
    if (!mentionsGh || (!GH_CMD.test(cmd) && !FANOUT.test(cmd))) return hits;
    if (hasLoopOverGh(cmd)) hits.push('loop');
    if (PAGINATE.test(cmd)) hits.push('paginate');
    if (overLimit(cmd)) hits.push('limit');
    if (REST_SEARCH.test(cmd) || GRAPHQL_SEARCH.test(cmd)) hits.push('search');
    if (hitsExpensiveEndpoint(cmd)) hits.push('expensive');
    return hits;
}

/**
 * PreToolUse(Bash) entry. Returns the deny payload object, or null to allow.
 */
export function checkCommand(event) {
    try {
        if (event?.tool_name !== 'Bash') return null;
        const hits = classifyCommand(event?.tool_input?.command);
        if (!hits.length) return null;
        const parts = [];
        let family = null;
        for (const h of hits) {
            if (FAMILY[h] !== family) {
                family = FAMILY[h];
                parts.push(`[${family}]`);
            }
            parts.push(REASONS[h]);
        }
        parts.push(RETRY);
        return {
            hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'deny',
                permissionDecisionReason: parts.join(' '),
            },
        };
    } catch (_) {
        return null;
    }
}
