/**
 * Structured Context Reader (Phase 5c)
 *
 * The deterministic v2 substrate that `/evolve` and `/retrospective` consume
 * FIRST, falling back to the v1 narrative sources (lessons.jsonl, session
 * memories, rolling logs) only when this substrate is empty.
 *
 * Sources (all project-local, written by Phase 2 + Phase 5):
 *   checkpoints.jsonl  deterministic reductions of the event ledger
 *                      (so reading checkpoints == consuming the events' distillate)
 *   memories.jsonl     typed, provenance-backed memory (Phase 5a)
 *
 * Pure-ish: only reads, never writes. Fail-open — any error or missing file
 * yields { available: false } and the caller behaves exactly as v1.
 *
 * Scope: the active project (CLAUDE_PROJECT_DIR). The deterministic substrate
 * lives under <repo>/.claude/context-layer/; the v1 cross-project narrative
 * sweep in deep-retrospective.mjs still provides the broad, multi-project view.
 */

import { readFileSync, existsSync } from 'fs';
import { contextPaths } from './storage-paths.mjs';
import { readMemories } from './memory-store.mjs';

const MAX_CHECKPOINTS = 12;
const MAX_LIST = 20;

const EMPTY = {
  available: false,
  counts: { checkpoints: 0, memories: 0 },
  checkpoints: [],
  memories: [],
  openLoops: [],
  failures: [],
  changedFiles: [],
  decisions: [],
  testsRun: [],
  memoryByKind: {},
  topMemories: [],
  latestRisk: null,
};

/** Defensive checkpoints.jsonl reader. Returns checkpoints oldest→newest. */
export function readCheckpoints(projectDir, { sessionId = null, limit = MAX_CHECKPOINTS } = {}) {
  if (!projectDir) return [];
  const file = contextPaths(projectDir).checkpoints;
  if (!existsSync(file)) return [];
  let raw;
  try {
    raw = readFileSync(file, 'utf-8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const c = JSON.parse(line);
      if (c && c.type === 'checkpoint' && (!sessionId || c.session_id === sessionId)) {
        out.push(c);
      }
    } catch {
      // tolerate corrupt lines
    }
  }
  return limit ? out.slice(-limit) : out;
}

function dedupCap(values, cap = MAX_LIST) {
  const seen = new Set();
  const out = [];
  for (const v of values) {
    if (typeof v !== 'string' || !v.trim() || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= cap) break;
  }
  return out;
}

const SEVERITY_RANK = { critical: 3, high: 2, medium: 1, low: 0 };

/**
 * Collect the deterministic substrate for a project into a compact rollup the
 * /evolve and /retrospective prompts can lead with. Returns EMPTY (available:
 * false) when nothing is recorded yet.
 */
export function collectStructuredContext(projectDir) {
  if (!projectDir) return EMPTY;

  let checkpoints = [];
  let memories = [];
  try {
    checkpoints = readCheckpoints(projectDir);
  } catch {
    checkpoints = [];
  }
  try {
    const now = Date.now();
    memories = readMemories(projectDir).filter((m) => {
      if (m.status !== undefined && m.status !== 'active') return false;
      if (m.expiresAt) {
        const exp = Date.parse(m.expiresAt);
        // Malformed expiry is corrupt — exclude (fail-safe), matching prune/recall.
        if (Number.isNaN(exp) || exp <= now) return false;
      }
      return true;
    });
  } catch {
    memories = [];
  }

  if (checkpoints.length === 0 && memories.length === 0) return EMPTY;

  // Roll up checkpoint fields, newest-first so recent loops/failures lead.
  const openLoops = [];
  const failures = [];
  const changedFiles = [];
  const decisions = [];
  const testsRun = [];
  for (const c of [...checkpoints].reverse()) {
    if (Array.isArray(c.openLoops)) openLoops.push(...c.openLoops);
    if (Array.isArray(c.failures)) failures.push(...c.failures);
    if (Array.isArray(c.recentErrors)) failures.push(...c.recentErrors); // transcript-fallback shape
    if (Array.isArray(c.changedFiles)) changedFiles.push(...c.changedFiles);
    if (Array.isArray(c.decisions)) decisions.push(...c.decisions);
    if (Array.isArray(c.testsRun)) testsRun.push(...c.testsRun);
  }

  const latest = checkpoints[checkpoints.length - 1] || null;

  const memoryByKind = {};
  for (const m of memories) memoryByKind[m.kind] = (memoryByKind[m.kind] || 0) + 1;

  const topMemories = [...memories]
    .sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0))
    .slice(0, 15)
    .map((m) => ({ kind: m.kind, scope: m.scope, severity: m.severity, confidence: m.confidence, text: m.text }));

  return {
    available: true,
    counts: { checkpoints: checkpoints.length, memories: memories.length },
    checkpoints: checkpoints.slice(-6),
    memories,
    openLoops: dedupCap(openLoops),
    failures: dedupCap(failures),
    changedFiles: dedupCap(changedFiles),
    decisions: dedupCap(decisions),
    testsRun: dedupCap(testsRun),
    memoryByKind,
    topMemories,
    latestRisk: latest?.risk || null,
  };
}

/**
 * Render the structured substrate as an authoritative prompt section. Empty
 * string when nothing is available, so callers can prepend unconditionally.
 */
export function renderStructuredFacts(structured) {
  if (!structured || !structured.available) return '';
  const lines = [
    '## Deterministic Structured Facts (AUTHORITATIVE — outrank the narrative sources below)',
    '',
    `Derived deterministically from the project event ledger — ${structured.counts.checkpoints} checkpoint(s) + ${structured.counts.memories} typed memory entr(ies). These are recorded facts, not LLM narration; prefer them when they conflict with the narrative sections.`,
  ];
  if (structured.latestRisk) lines.push('', `Latest session risk: ${structured.latestRisk}`);
  if (structured.openLoops.length) {
    lines.push('', 'Open loops (unresolved):');
    for (const l of structured.openLoops.slice(0, 10)) lines.push(`- ${l}`);
  }
  if (structured.failures.length) {
    lines.push('', 'Recent failures:');
    for (const f of structured.failures.slice(0, 10)) lines.push(`- ${f}`);
  }
  if (structured.changedFiles.length) {
    lines.push('', `Recently changed files: ${structured.changedFiles.slice(0, 12).join(', ')}`);
  }
  if (structured.decisions.length) {
    lines.push('', 'Decisions recorded:');
    for (const d of structured.decisions.slice(0, 8)) lines.push(`- ${d}`);
  }
  const kinds = Object.entries(structured.memoryByKind);
  if (kinds.length) {
    lines.push('', `Typed memory by kind: ${kinds.map(([k, n]) => `${k}(${n})`).join(', ')}`);
  }
  if (structured.topMemories.length) {
    lines.push('', 'Top typed memories (by severity):');
    for (const m of structured.topMemories.slice(0, 12)) {
      lines.push(`- [${m.kind}/${m.severity}/${m.confidence}] ${m.text}`);
    }
  }
  return lines.join('\n');
}

export default { readCheckpoints, collectStructuredContext, renderStructuredFacts };
