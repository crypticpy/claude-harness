/**
 * In-Process Distillation Nudge (Phase 5 — zero external cost)
 *
 * Native compaction can't be steered or its summary captured (unsupported by the
 * Claude Code hook API). Instead we ride the SUPPORTED additionalContext channel:
 * right after a compaction, the SessionStart hook fires with source="compact",
 * and whatever it prints is injected into the freshly-compacted, in-process
 * model — which still holds the session in cached context.
 *
 * So we let the MAIN model do the nuanced distillation for free: inject the
 * deterministic checkpoint facts plus a short instruction to persist any durable
 * lesson via the memory_write MCP tool. The cheap, unambiguous facts
 * (test_command, failure_pattern) are already written deterministically by
 * auto-distill.mjs, so the nudge explicitly tells the model not to re-add those.
 *
 * Pure builder + fail-open: returns '' when there's nothing to distill.
 */

import { collectStructuredContext } from './structured-context.mjs';

function bullets(label, items, cap) {
  if (!items || !items.length) return '';
  const lines = items.slice(0, cap).map((x) => `  - ${x}`);
  return `${label}:\n${lines.join('\n')}\n`;
}

/**
 * Build the post-compaction distillation nudge for the active project. Returns
 * '' when no deterministic substrate exists (nothing worth distilling).
 *
 * @param {string|null} projectDir
 * @param {object} opts  { collect } injectable for tests
 */
export function buildCompactionNudge(projectDir, opts = {}) {
  const collect = opts.collect || collectStructuredContext;
  const s = collect(projectDir);
  if (!s || !s.available) return '';

  const kinds = Object.entries(s.memoryByKind || {});
  const storedLine = s.counts.memories
    ? `Already stored: ${s.counts.memories} typed memor${s.counts.memories === 1 ? 'y' : 'ies'}${kinds.length ? ` (${kinds.map(([k, n]) => `${k}:${n}`).join(', ')})` : ''}.`
    : 'No typed memory stored yet for this project.';

  const factParts = [
    s.latestRisk ? `Risk: ${s.latestRisk}\n` : '',
    bullets('Open loops', s.openLoops, 5),
    bullets('Recent failures', s.failures, 5),
    s.changedFiles.length ? `Changed files: ${s.changedFiles.slice(0, 10).join(', ')}\n` : '',
    bullets('Decisions', s.decisions, 5),
  ].filter(Boolean);

  // Nothing substantive beyond bare counts → skip the nudge entirely.
  if (factParts.length === 0 && s.counts.checkpoints === 0) return '';

  return [
    '## Session distillation (post-compaction)',
    '',
    'Deterministic checkpoint for this session:',
    factParts.join('').trimEnd() || '  (no notable signals)',
    '',
    storedLine,
    'Deterministic facts (test commands run, unresolved file errors) are captured automatically — do NOT re-add those.',
    '',
    'If a DURABLE, reusable lesson emerged this session that is not already stored — a gotcha, decision, convention, api_contract, or user_preference — persist it now with the `memory_write` MCP tool (fields: kind, scope, text, severity). Prefer 0–3 high-value entries; skip routine or one-off details. If nothing durable emerged, do nothing.',
  ].join('\n');
}

export default { buildCompactionNudge };
