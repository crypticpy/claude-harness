/**
 * Command redirect — PreToolUse(Bash).
 *
 * Denies Bash commands that have a safer rewrite, or that are irreversible,
 * outside the project, or system-level. It gives a reason the model can act
 * on, so it rewrites the command and carries on by itself instead of raising
 * a human approval prompt. Families (rules live in command-rules.mjs):
 *
 *   [secrets]    printing credential files or `gh auth token`
 *   [gh-budget]  gh shapes that burn the shared GitHub rate limit
 *   [guarded]    destructive / global / outward-facing / infra commands, with
 *                a safer alternative and a "User action:" escape hatch
 *
 * The matching `permissions.deny` rules in settings stay as the backstop if
 * this hook ever fails (it fails open: every error returns null).
 *
 * Runs on every Bash call. The command is lexed into simple-command segments
 * (command-lexer.mjs); each segment runs the rules keyed by its argv[0] plus
 * the few cheap any-command rules (redirect targets, mkfs*).
 */

import { parseCommand } from './command-lexer.mjs';
import { RULES_BY_CMD, ANY_CMD_RULES } from './command-rules.mjs';

const RETRY = 'Rewrite the command and retry; do not ask the user to approve the original.';
const GUARDED_CLOSER = (cmd) => "Don't work around this with another tool (python shutil/os.remove, node fs.rm, "
    + 'find -delete, a script file, etc.). If the task truly needs it, add '
    + `'User action: run \`${cmd}\` because <why>' to your final report/handoff and continue with the rest of the task.`;
const MAX_CMD_ECHO = 120;

/** Rule hits in table order: [{ rule, seg }], at most one per rule. */
function findHits(cmd) {
    if (typeof cmd !== 'string') return [];
    const segs = parseCommand(cmd);
    const byRule = new Map();
    for (const seg of segs) {
        const args = seg.argv.slice(1);
        for (const rules of [RULES_BY_CMD.get(seg.argv[0]), ANY_CMD_RULES]) {
            if (!rules) continue;
            for (const rule of rules) {
                if (!byRule.has(rule) && rule.test(args, seg, segs)) byRule.set(rule, seg);
            }
        }
    }
    return [...byRule].map(([rule, seg]) => ({ rule, seg })).sort((a, b) => a.rule.order - b.rule.order);
}

/**
 * Pure classifier. Returns the violated rule ids (unique, table order).
 */
export function classifyCommand(cmd) {
    return [...new Set(findHits(cmd).map((h) => h.rule.id))];
}

/** One-line echo of the top-level command a (possibly nested) segment belongs to. */
function echoCmd(seg) {
    let root = seg;
    while (root.parent) root = root.parent;
    const oneLine = root.raw.replace(/\s+/g, ' ').trim();
    return oneLine.length > MAX_CMD_ECHO ? oneLine.slice(0, MAX_CMD_ECHO - 1) + '…' : oneLine;
}

/** "[family] reasons… closer" per family, closers shared by adjacent families. */
function buildReason(hits) {
    const parts = [];
    const seen = new Set();
    let family = null;
    let closer = null;
    for (const { rule, seg } of hits) {
        if (rule.family !== family) {
            const next = rule.family === 'guarded' ? GUARDED_CLOSER(echoCmd(seg)) : RETRY;
            if (closer && closer !== next) parts.push(closer);
            family = rule.family;
            closer = next;
            parts.push(`[${family}]`);
        }
        if (!seen.has(rule.reason)) {
            seen.add(rule.reason);
            parts.push(rule.reason);
        }
    }
    parts.push(closer);
    return parts.join(' ');
}

/**
 * PreToolUse(Bash) entry. Returns the deny payload object, or null to allow.
 */
export function checkCommand(event) {
    try {
        if (event?.tool_name !== 'Bash') return null;
        const hits = findHits(event?.tool_input?.command);
        if (!hits.length) return null;
        return {
            hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'deny',
                permissionDecisionReason: buildReason(hits),
            },
        };
    } catch (_) {
        return null;
    }
}
