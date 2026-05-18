/**
 * Impact Hint Module
 *
 * After an Edit/Write on a likely-public-API file, do a cheap heuristic count
 * of import sites and emit a one-line reminder to run `impact_check` if the
 * change touched exports.
 *
 * Push, not pull: surfaces consumer count without me having to remember to ask.
 *
 * Heuristics:
 *   - Skip test files, config files, .md files, anything in node_modules / .next / dist
 *   - Trigger only on lib, types, hooks, and app/api/route.ts paths — locations
 *     where exports are most often consumed by other modules.
 *   - Always emit when in scope; let the model decide whether the change
 *     actually touched exports vs. internal-only.
 *
 * Output format (printed to stdout, surfaces as system reminder):
 *   Impact hint: lib/foo.ts is imported by N file(s). Run impact_check if you
 *   changed any exports.
 *
 * Failure mode: silent — if anything throws, return null. Hooks should never
 * block edits.
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { basename, extname, relative, isAbsolute } from 'path';

const HIGH_IMPACT_PATTERNS = [
    /^lib\/[^/]+\.(ts|tsx|js|mjs|jsx)$/,
    /^lib\/(?!__tests__\/)[^/]+\/(?!__tests__\/)[^/]+\.(ts|tsx|js|mjs|jsx)$/,
    /^types\/[^/]+\.(ts|tsx)$/,
    /^hooks\/(?!__tests__\/)[^/]+\.(ts|tsx)$/,
    /^app\/api\/[^/]+\/route\.(ts|js)$/,
    /^app\/api\/[^/]+\/[^/]+\/route\.(ts|js)$/,
];

const SKIP_PATTERNS = [
    /__tests__/,
    /\.test\./,
    /\.spec\./,
    /\.d\.ts$/,
    /\.config\./,
    /node_modules/,
    /\.next/,
    /dist\//,
    /coverage\//,
];

function isInScope(relPath) {
    if (SKIP_PATTERNS.some(p => p.test(relPath))) return false;
    return HIGH_IMPACT_PATTERNS.some(p => p.test(relPath));
}

function countImporters(cwd, relPath) {
    // Build the import-path stem the way it'd appear in source:
    //   lib/foo.ts -> lib/foo  (also @/lib/foo via alias)
    // We grep for both the relative-style suffix and the @/ alias form.
    const ext = extname(relPath);
    const stem = relPath.slice(0, -ext.length);
    const fileBasename = basename(relPath, ext);

    // Patterns to grep for. We match two import forms:
    //   - @/lib/foo  (project alias style)
    //   - /foo['"]   (relative imports ending in the basename, with quote close)
    const aliasForm = `@/${stem}`;
    const looseForm = `/${fileBasename}['"]`;

    try {
        // Use single-quoted shell args so backticks-in-regex (rare here, but be safe)
        // never trigger shell command substitution. Backticks inside single quotes
        // are literal.
        const sq = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
        // rg's `typescript` type covers .ts/.tsx/.cts/.mts; `js` covers .js/.jsx/.mjs.
        const cmd = `rg -l --type typescript --type js ` +
            `-e ${sq(aliasForm)} ` +
            `-e ${sq(looseForm)} ` +
            `app components lib hooks types middleware.ts 2>/dev/null | ` +
            `grep -v ${sq(relPath)} | ` +
            `head -20`;
        const out = execSync(cmd, { cwd, encoding: 'utf-8', timeout: 3000, shell: '/bin/bash' });
        const files = out.trim().split('\n').filter(Boolean);
        return files;
    } catch (_) {
        return [];
    }
}

export async function emitHint(event, _config) {
    try {
        const toolName = event.tool_name;
        if (toolName !== 'Edit' && toolName !== 'Write') return null;

        const filePath = event.tool_input?.file_path;
        if (!filePath) return null;

        const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
        if (!cwd || !existsSync(cwd)) return null;

        // Normalize to repo-relative path
        const relPath = isAbsolute(filePath) ? relative(cwd, filePath) : filePath;
        if (relPath.startsWith('..')) return null; // outside repo

        if (!isInScope(relPath)) return null;

        const importers = countImporters(cwd, relPath);
        if (importers.length === 0) return null;

        const sample = importers.slice(0, 3).join(', ');
        const more = importers.length > 3 ? ` (+${importers.length - 3} more)` : '';
        return `Impact hint: ${relPath} is imported by ${importers.length} file${importers.length === 1 ? '' : 's'}: ${sample}${more}. If you changed any exports, run \`mcp__context-layer__impact_check\` before continuing.`;
    } catch (err) {
        if (process.env.DEBUG) console.error('[impact-hint]', err);
        return null;
    }
}
