/**
 * Format & Lint Module
 *
 * formatFile — legacy auto-format on Write/Edit. DISABLED by default
 *   (config.formatting.enabled = false): mutating a file on every edit caused
 *   surprise whole-file reformats and per-edit overhead. Kept behind the flag.
 *
 * lintFile — read-only lint of the edited file (config.linting). Runs the
 *   project's linter in CHECK mode (never --fix), bounds the output, and returns
 *   a nudge so the agent fixes issues — including pre-existing ones — while it
 *   still has the file open. Never mutates the file. Stays silent in projects
 *   without a configured linter (gated on the linter's own config file being
 *   present), so e.g. TypeScript type errors keep coming from the editor's
 *   native diagnostics rather than being duplicated here.
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { extname, join, relative } from 'path';

export async function formatFile(event, config) {
    try {
        if (!config.formatting?.enabled) return;

        const filePath = event.tool_input?.file_path;
        if (!filePath) return;

        const ext = extname(filePath);
        const formatter = config.formatting.extensions[ext];

        if (formatter) {
            try {
                execSync(`${formatter} "${filePath}" 2>/dev/null`, { timeout: 5000 });
            } catch (e) {
                // Silent failure - formatting is best-effort
            }
        }
    } catch (err) {
        // Silent
    }
}

// A diagnostic line from a single-line linter format (eslint --format unix,
// ruff's default, etc.):  path/to/file.ts:12:5: 'x' is unused  [no-unused-vars]
const DIAGNOSTIC_LINE = /:\d+:\d+:/;

/**
 * Shape a linter's raw check output into a bounded, fix-oriented nudge. Pure (no
 * I/O) so it is unit-testable. Returns null when there are no issue lines.
 *
 * @param {string} rawOutput
 * @param {{ file?: string, linter?: string, maxIssues?: number }} [opts]
 * @returns {string|null}
 */
export function buildLintReport(rawOutput, { file, linter, maxIssues = 20 } = {}) {
    const issues = String(rawOutput || '')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => DIAGNOSTIC_LINE.test(l));
    if (issues.length === 0) return null;

    const cap = Math.max(1, maxIssues);
    const shown = issues.slice(0, cap);
    const extra = issues.length - shown.length;

    const lines = [
        `🔎 Lint (${linter || 'lint'}, read-only — not auto-fixed): ${issues.length} issue(s) in ${file}.`,
        'Fix what you reasonably can, including pre-existing ones, before you finish with this file.',
        ...shown.map((l) => `  ${l}`),
    ];
    if (extra > 0) lines.push(`  …+${extra} more (run the linter to see the rest)`);
    return lines.join('\n');
}

/**
 * Lint the edited file read-only; return a nudge string or null. Runs the
 * configured linter for the file's extension in CHECK mode, only when that
 * linter's config (`requires`) is present in the project. Never mutates.
 */
export function lintFile(event, config, opts = {}) {
    try {
        if (!config.linting?.enabled) return null;

        const filePath = event.tool_input?.file_path;
        if (!filePath) return null;

        const cwd = opts.projectDir || process.env.CLAUDE_PROJECT_DIR || process.cwd();
        if (!cwd || !existsSync(cwd)) return null;

        const ext = extname(filePath);
        const spec = (config.linting.linters || []).find(
            (l) => Array.isArray(l.exts) && l.exts.includes(ext),
        );
        if (!spec || !spec.cmd) return null;

        // Applicability gate: only run when the linter's own config exists, so a
        // project without that linter produces no noise.
        if (
            Array.isArray(spec.requires) &&
            spec.requires.length > 0 &&
            !spec.requires.some((r) => existsSync(join(cwd, r)))
        ) {
            return null;
        }

        let out = '';
        try {
            out = execSync(`${spec.cmd} "${filePath}"`, {
                cwd,
                encoding: 'utf-8',
                timeout: config.linting.timeoutMs || 10000,
                shell: '/bin/bash',
                stdio: ['ignore', 'pipe', 'pipe'],
            });
        } catch (e) {
            // Linters exit non-zero when they find issues — the normal, expected
            // path. Diagnostics land on stdout (and sometimes stderr).
            out = `${e.stdout || ''}\n${e.stderr || ''}`;
        }

        return buildLintReport(out, {
            file: relative(cwd, filePath),
            linter: spec.name || 'lint',
            maxIssues: config.linting.maxIssues,
        });
    } catch {
        return null;
    }
}
