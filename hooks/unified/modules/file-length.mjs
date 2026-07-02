/**
 * Anti-monolith nudge — one line, once per file per session.
 *
 * Models have a known propensity to keep stuffing code into whichever file
 * is already open until it's thousands of lines long. This PostToolUse
 * (Write|Edit) check surfaces the moment a code file exceeds the soft
 * ceiling (config qualityGates.maxFileLines, default 700) and prompts a
 * split-into-modules design check. It deliberately fires at most once per
 * file per session — a nudge that nags gets ignored.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, extname, relative, isAbsolute, resolve } from 'path';
import { homedir } from 'os';

const DEFAULT_MAX_LINES = 700;
const LOG_DIR = join(homedir(), '.claude', 'hooks', 'unified', 'logs');

// Code files only — docs, JSON, lockfiles, and data get long legitimately.
const CODE_EXTS = new Set([
    '.py', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
    '.go', '.rs', '.rb', '.java', '.kt', '.swift', '.scala',
    '.c', '.cc', '.cpp', '.h', '.hpp', '.cs', '.php', '.sh',
]);

/**
 * PostToolUse(Write|Edit) entry. Returns the nudge string or null.
 */
export function emitLengthNudge(event, config = {}, opts = {}) {
    try {
        const rawPath = event?.tool_input?.file_path;
        const sessionId = event?.session_id;
        if (!rawPath || !sessionId) return null;
        const filePath = isAbsolute(rawPath) ? rawPath : resolve(event?.cwd || process.cwd(), rawPath);
        if (!CODE_EXTS.has(extname(filePath).toLowerCase())) return null;

        const maxLines = config?.qualityGates?.maxFileLines ?? DEFAULT_MAX_LINES;
        if (!maxLines || maxLines <= 0) return null; // 0/null disables
        if (!existsSync(filePath)) return null;

        const lines = readFileSync(filePath, 'utf-8').split('\n').length;
        if (lines <= maxLines) return null;

        // Once per file per session.
        const logDir = opts.logDir || LOG_DIR;
        const stateFile = join(logDir, `${sessionId}.length-nudges.json`);
        let state = {};
        try { state = JSON.parse(readFileSync(stateFile, 'utf-8')) || {}; } catch (_) { /* first nudge */ }
        if (state[filePath]) return null;
        state[filePath] = lines;
        try {
            mkdirSync(logDir, { recursive: true });
            writeFileSync(stateFile, JSON.stringify(state));
        } catch (_) { /* fail-open: worst case we nudge twice */ }

        const rel = event?.cwd && isAbsolute(filePath) ? relative(event.cwd, filePath) : filePath;
        return `📏 ${rel} is now ${lines} lines (soft ceiling ${maxLines}). Before growing it further, `
            + `check whether cohesive sections — a class, a command group, pure helpers — should be `
            + `extracted into their own modules. Files this long are usually a design smell, not a need. `
            + `If the length is genuinely justified (generated code, data tables), carry on; this fires `
            + `once per file per session.`;
    } catch (e) {
        if (process.env.DEBUG) console.error('[file-length]', e);
        return null;
    }
}
