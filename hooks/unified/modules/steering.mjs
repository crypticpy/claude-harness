/**
 * Long-session steering (Phase 2)
 *
 * Three mechanisms that keep a very long session or refactor on course:
 *
 *   1. Charter re-injection — after every compaction, the mission charter
 *      (mission/scope/constraints, set via the mission_charter MCP tool) is
 *      re-injected VERBATIM. Never summarized: verbatim re-injection is the
 *      whole point — a goal that survives only as a summary drifts.
 *   2. Manifest re-injection — the remaining refactor work-list items are
 *      listed after every compaction so a long migration can't lose its tail.
 *   3. Drift tripwire — on post-edit, an edit that lands outside the charter's
 *      declared scope prefixes gets an immediate warning, and pending manifest
 *      items for the edited file are ticked off automatically.
 *
 * Pure builders + fail-open: every entry point returns null/'' on any error.
 */

import {
  readCharter,
  readManifest,
  manifestTickByFile,
  isInScope,
  normalizeRelPath,
} from './steering-store.mjs';

const MAX_LISTED_ITEMS = 15;

/**
 * Build the post-compaction steering injection: charter verbatim + remaining
 * manifest items. Returns '' when neither exists (fail-open).
 *
 * @param {string|null} projectDir
 */
export function buildSteeringInjection(projectDir) {
  if (!projectDir) return '';
  try {
    const charter = readCharter(projectDir);
    const manifest = readManifest(projectDir);
    if (!charter && manifest.total === 0) return '';

    const parts = [];
    if (charter) {
      parts.push('## Mission charter (re-injected verbatim after compaction)');
      parts.push('');
      parts.push(charter.mission);
      if (charter.scope.length) {
        parts.push('');
        parts.push(`Scope (stay within these path prefixes): ${charter.scope.join(', ')}`);
      }
      if (charter.constraints.length) {
        parts.push('');
        parts.push('Constraints (verbatim):');
        for (const c of charter.constraints) parts.push(`- ${c}`);
      }
    }

    if (manifest.total > 0) {
      const pending = manifest.items.filter((i) => i.status === 'pending');
      parts.push('');
      parts.push(
        `## Refactor manifest — ${manifest.remaining} of ${manifest.total} work item(s) remaining` +
          (manifest.remaining === 0 ? ' (all done — clear it via refactor_manifest if finished)' : ''),
      );
      for (const item of pending.slice(0, MAX_LISTED_ITEMS)) {
        const label = [item.file, item.symbol && `— ${item.symbol}`, item.note && `(${item.note})`]
          .filter(Boolean)
          .join(' ');
        parts.push(`- [ ] ${label}`);
      }
      if (pending.length > MAX_LISTED_ITEMS) {
        parts.push(`- …and ${pending.length - MAX_LISTED_ITEMS} more (refactor_manifest status for the full list)`);
      }
    }

    return parts.join('\n').trim();
  } catch {
    return '';
  }
}

/**
 * Post-edit steering: tick pending manifest items for the edited file and warn
 * when the edit falls outside the charter scope. Returns a short string for
 * stdout (PostToolUse additional context) or null when there's nothing to say.
 *
 * @param {object} event  Claude Code PostToolUse event (Write|Edit)
 * @param {object} opts   { projectDir } — defaults to CLAUDE_PROJECT_DIR/cwd
 */
export function postEditSteering(event, opts = {}) {
  try {
    const projectDir = opts.projectDir || process.env.CLAUDE_PROJECT_DIR || event?.cwd || null;
    const filePath = event?.tool_input?.file_path;
    if (!projectDir || !filePath) return null;

    const rel = normalizeRelPath(projectDir, filePath);
    // Edits outside the repo (e.g. scratch files) are not steering signals.
    if (rel.startsWith('..')) return null;

    const lines = [];

    const ticked = manifestTickByFile(projectDir, filePath);
    if (ticked.length) {
      const state = readManifest(projectDir);
      lines.push(
        `[manifest] ✓ ${rel} — ${state.remaining} of ${state.total} work item(s) remaining`,
      );
    }

    const charter = readCharter(projectDir);
    if (charter && charter.scope.length && !isInScope(charter.scope, rel)) {
      lines.push(
        `[charter] ⚠ ${rel} is outside the declared scope (${charter.scope.join(', ')}). ` +
          'If this edit is intentional scope growth, update the charter via mission_charter; otherwise reconsider.',
      );
    }

    return lines.length ? lines.join('\n') : null;
  } catch {
    return null;
  }
}

export default { buildSteeringInjection, postEditSteering };
