/**
 * Export-surface tripwire (Phase 2b)
 *
 * At session start we pin the git HEAD as the session baseline; at Stop we
 * diff the exports of this session's edited files against that baseline and
 * warn when PUBLIC EXPORTS DISAPPEARED. Removing/renaming an export is the
 * classic silent breaking change a long session commits to without noticing —
 * additions are normal and stay quiet.
 *
 * Git supplies the "before" state (no snapshot files to corrupt); the baseline
 * marker only pins the sha so mid-session commits don't hide removals. JS/TS
 * export syntax only for now — matches this harness. Fail-open everywhere:
 * non-git projects and git errors produce silence, never noise.
 */

import { execFileSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { readEvents } from './event-writer.mjs';
import { contextPaths, ensureDir } from './storage-paths.mjs';

const JS_TS_EXT = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const MAX_REPORTED_FILES = 5;

function baselinePath(projectDir) {
  return join(contextPaths(projectDir).dir, 'session-baseline.json');
}

function git(projectDir, args) {
  return execFileSync('git', args, {
    cwd: projectDir,
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 10000,
  })
    .toString()
    .trim();
}

/**
 * Pin the session's git baseline at SessionStart. Compaction keeps the same
 * session (and baseline); a new session id re-pins to the current HEAD.
 */
export function recordBaseline(event, opts = {}) {
  try {
    const projectDir = opts.projectDir || process.env.CLAUDE_PROJECT_DIR || event?.cwd || null;
    const sessionId = event?.session_id;
    if (!projectDir || !sessionId || event?.source === 'compact') return null;

    const file = baselinePath(projectDir);
    if (existsSync(file)) {
      try {
        const existing = JSON.parse(readFileSync(file, 'utf-8'));
        if (existing?.sessionId === sessionId) return existing; // resume — keep the original pin
      } catch {
        // corrupt marker — overwrite below
      }
    }

    const head = git(projectDir, ['rev-parse', 'HEAD']);
    const baseline = { sessionId, head, ts: new Date().toISOString() };
    ensureDir(contextPaths(projectDir).dir);
    writeFileSync(file, JSON.stringify(baseline) + '\n');
    return baseline;
  } catch {
    return null; // non-git project or git unavailable
  }
}

/** Export names mentioned on a single source line (JS/TS surface syntax). */
export function exportNamesIn(line) {
  const names = [];
  const decl = line.match(
    /export\s+(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(?:function\*?|class|const|let|var|interface|type|enum)\s+([A-Za-z0-9_$]+)/,
  );
  if (decl) names.push(decl[1]);
  const braces = line.match(/export\s*(?:type\s*)?\{([^}]*)\}/);
  if (braces) {
    for (const part of braces[1].split(',')) {
      const token = part.trim();
      if (!token) continue;
      const asMatch = token.match(/^\S+\s+as\s+(\S+)$/); // exported alias wins
      names.push(asMatch ? asMatch[1] : token.split(/\s+/)[0]);
    }
  }
  if (/export\s+default\b/.test(line)) names.push('default');
  return names.filter((n) => n && n !== 'type');
}

/**
 * Diff the public exports of this session's edited files against the session
 * baseline. Returns a warning string listing files whose exports were removed
 * or renamed, or null when the surface only grew (or nothing to check).
 */
export function diffExportSurface(event, opts = {}) {
  try {
    const projectDir = opts.projectDir || process.env.CLAUDE_PROJECT_DIR || event?.cwd || null;
    const sessionId = event?.session_id;
    if (!projectDir || !sessionId) return null;

    let baselineSha = 'HEAD';
    try {
      const marker = JSON.parse(readFileSync(baselinePath(projectDir), 'utf-8'));
      if (marker?.sessionId === sessionId && marker.head) baselineSha = marker.head;
    } catch {
      // no marker — HEAD is still a useful baseline
    }

    const edited = new Set();
    for (const e of readEvents(projectDir, { sessionId })) {
      if (e.kind !== 'edit' && e.kind !== 'write') continue;
      for (const f of e.files || []) {
        if (JS_TS_EXT.test(f)) edited.add(f);
      }
    }
    if (!edited.size) return null;

    const diff = git(projectDir, [
      'diff',
      '-U0',
      baselineSha,
      '--',
      ...edited,
    ]);
    if (!diff) return null;

    // Fold +/- export lines per file; a name present on both sides just moved.
    const perFile = new Map(); // file → {removed:Set, added:Set}
    let current = null;
    for (const line of diff.split('\n')) {
      const header = line.match(/^\+\+\+ b\/(.+)$/) || line.match(/^--- a\/(.+)$/);
      if (header) {
        current = header[1];
        if (!perFile.has(current)) perFile.set(current, { removed: new Set(), added: new Set() });
        continue;
      }
      if (!current || !/^[-+]/.test(line) || /^[-+]{3}/.test(line)) continue;
      const bucket = line[0] === '-' ? 'removed' : 'added';
      for (const name of exportNamesIn(line.slice(1))) {
        perFile.get(current)[bucket].add(name);
      }
    }

    const warnings = [];
    for (const [file, { removed, added }] of perFile) {
      const gone = [...removed].filter((n) => !added.has(n));
      if (!gone.length) continue;
      warnings.push(
        `[api] ⚠ public exports removed since session start in ${file}: ${gone.join(', ')}. ` +
          'If unintentional, restore them; if intentional, impact_check the file for stranded consumers.',
      );
      if (warnings.length >= MAX_REPORTED_FILES) break;
    }

    return warnings.length ? warnings.join('\n') : null;
  } catch {
    return null; // non-git, git error, unreadable events — stay silent
  }
}

export default { recordBaseline, diffExportSurface, exportNamesIn };
