/**
 * Deterministic Auto-Distillation (Phase 5 — in-process, zero-cost)
 *
 * Derives high-confidence typed memories straight from the event ledger with NO
 * LLM at all, then writes them via the shared memory store. This is the
 * "distillation that happens internally for free" path: the facts it extracts
 * are exactly the cheap, unambiguous ones an external model was previously asked
 * to produce.
 *
 * What it extracts (confidence: observed, provenance.source: event):
 *   test_command     — distinct test commands actually run this session
 *   failure_pattern  — files that errored and were never cleanly re-edited
 *
 * The open-loop logic mirrors event-reducer.mjs so a file counted as an open
 * loop in the checkpoint also yields a failure_pattern memory. Dedup is handled
 * by the content-addressed id in appendMemory, so re-running across compactions
 * never duplicates.
 */

import { resolve } from 'node:path';
import { readEvents } from './event-writer.mjs';
import { appendMemories, projectIdFor } from './memory-store.mjs';

const MAX_CMD = 200;
const MAX_MSG = 300;
const MAX_MEMORIES = 12;
const DEFAULT_TTL_DAYS = 90;

// Pipe stages that only shape OUTPUT (pagers/filters), never the test itself.
// A trailing `| tail`/`| grep` is noise for a test_command memory.
const OUTPUT_FILTERS = new Set([
  'tail', 'head', 'less', 'more', 'cat', 'grep', 'egrep', 'fgrep', 'rg', 'ag',
  'awk', 'sed', 'tee', 'wc', 'sort', 'uniq', 'tr', 'cut', 'fold', 'column', 'jq',
]);

/**
 * Canonicalize a shell command so cosmetic output-plumbing doesn't fork one logical
 * command into many near-duplicate memories. `npx vitest run 2>&1 | tail -30`,
 * `npx vitest run > out.log`, and `npx vitest run` all collapse to `npx vitest run`.
 * Drops, in order: fd-dup redirects (`2>&1`), `&>file`, plain/append redirects
 * (`2>file`, `>file`, `>>file`), leading `echo … &&`/`echo … ;` banner segments
 * (progress decoration, not part of the command), then trailing pipe stages into
 * known output filters. Leaves meaningful (non-filter) pipe stages intact.
 * Pure + deterministic.
 */
export function normalizeCommand(cmd) {
  let s = String(cmd == null ? '' : cmd).trim();
  if (!s) return '';
  s = s
    .replace(/\s*\d*>&\d*/g, ' ')        // 2>&1, >&2
    .replace(/\s*&>>?\s*\S+/g, ' ')      // &>file, &>>file
    .replace(/\s*\d*>>?\s*\S+/g, ' ');   // 2>file, >file, >>file, 2>/dev/null
  // Leading echo banners: `echo "=== suite ===" && npx vitest run` must dedup
  // with `npx vitest run`. Only LEADING segments joined by `&&`/`;` are safe to
  // drop — an interior/trailing echo may be control flow (`make test || echo fail`).
  for (let prev = null; prev !== s; ) {
    prev = s;
    s = s.replace(/^echo(?:\s+(?:"[^"]*"|'[^']*'|[^&;|])*)?(?:&&|;)\s*/, '');
  }
  const parts = s.split(/\s*(?<!\|)\|(?!\|)\s*/); // single pipes only, never `||`
  if (parts.length > 1) {
    const kept = [parts[0]];
    for (let i = 1; i < parts.length; i++) {
      const lead = parts[i].trim().split(/\s+/)[0] || '';
      if (OUTPUT_FILTERS.has(lead)) break; // drop this filter stage and all after
      kept.push(parts[i]);
    }
    s = kept.join(' | ');
  }
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Pure: events → typed-memory inputs. No I/O. `projectId` is precomputed by the
 * caller so this stays deterministic and unit-testable.
 *
 * These are low-confidence `observed` facts, so they get a TTL (`expiresAt`):
 * pruneMemories ages them out unless the same fact keeps being re-distilled.
 * `opts.now` is supplied by the (impure) caller — omit it to keep this pure and
 * TTL-free for unit tests. User-written memories (memory_write) get no TTL.
 *
 * @param {Array<object>} events  ledger events, oldest-first
 * @param {string} projectId
 * @param {{ now?: number, ttlDays?: number }} [opts]
 * @returns {Array<object>} MemoryInput[] ready for appendMemory
 */
export function deriveMemories(events, projectId, opts = {}) {
  const list = Array.isArray(events) ? events : [];
  const out = [];
  const ttlDays = typeof opts.ttlDays === 'number' ? opts.ttlDays : DEFAULT_TTL_DAYS;
  const expiresAt =
    typeof opts.now === 'number'
      ? new Date(opts.now + ttlDays * 24 * 60 * 60 * 1000).toISOString()
      : undefined;
  const ttl = expiresAt ? { expiresAt } : {};

  // test_command: distinct commands from test events. Normalize first so
  // `npx vitest run 2>&1 | tail` and `npx vitest run` dedup to one memory.
  const seenCmd = new Set();
  for (const e of list) {
    if (!e || e.kind !== 'test') continue;
    const cmd = normalizeCommand(e.command);
    if (!cmd || seenCmd.has(cmd)) continue;
    seenCmd.add(cmd);
    out.push({
      projectId,
      kind: 'test_command',
      scope: 'project',
      text: cmd.slice(0, MAX_CMD),
      severity: 'low',
      confidence: 'observed',
      provenance: { source: 'event' },
      ...ttl,
    });
  }

  // failure_pattern: files that errored without a later clean edit/write.
  const fileLastError = new Map();
  const fileResolved = new Set();
  for (const e of list) {
    if (!e || typeof e !== 'object') continue;
    const files = Array.isArray(e.files) ? e.files : [];
    if (e.outcome === 'error' || e.kind === 'error') {
      for (const f of files) {
        if (typeof f === 'string') fileLastError.set(f, e.summary || 'error');
      }
    } else if (e.outcome === 'ok' && (e.kind === 'edit' || e.kind === 'write')) {
      for (const f of files) if (typeof f === 'string') fileResolved.add(f);
    }
  }
  for (const [f, msg] of fileLastError) {
    if (fileResolved.has(f)) continue;
    out.push({
      projectId,
      kind: 'failure_pattern',
      scope: 'file',
      files: [f],
      text: `Unresolved error in ${f}: ${String(msg).slice(0, MAX_MSG)}`,
      severity: 'medium',
      confidence: 'observed',
      provenance: { source: 'event' },
      ...ttl,
    });
  }

  return out.slice(0, MAX_MEMORIES);
}

/**
 * Read the session's events, derive deterministic memories, and append them.
 * Fail-open: returns { written, candidates } and never throws to the hook path.
 *
 * @param {object} event  the hook event ({ session_id })
 * @param {object} opts   { projectDir, deps: { readEvents, appendMemories,
 *                          appendMemory? } }  appendMemory (single) still
 *                          overrides the batch path when injected.
 */
export function runAutoDistill(event, opts = {}) {
  try {
    const sessionId = event?.session_id;
    if (!sessionId) return { written: 0, candidates: 0 };
    const projectDir = opts.projectDir ?? process.env.CLAUDE_PROJECT_DIR ?? null;
    if (!projectDir) return { written: 0, candidates: 0 };

    const deps = opts.deps || {};
    const readEv = deps.readEvents || readEvents;
    // Batch append: one store read for the whole session, not one per candidate.
    // A custom single-appender (deps.appendMemory) is still honored for tests.
    const appendBatch = deps.appendMemories || appendMemories;

    const events = readEv(projectDir, { sessionId });
    if (!events.length) return { written: 0, candidates: 0 };

    const projectId = projectIdFor(resolve(projectDir));
    const candidates = deriveMemories(events, projectId, { now: Date.now() });

    let written;
    if (deps.appendMemory) {
      written = 0;
      for (const input of candidates) {
        if (deps.appendMemory(projectDir, input)?.written) written++;
      }
    } else {
      written = appendBatch(projectDir, candidates).written;
    }
    return { written, candidates: candidates.length };
  } catch (err) {
    if (process.env.DEBUG) process.stderr.write('[auto-distill] error: ' + err.message + '\n');
    return { written: 0, candidates: 0 };
  }
}

export default { deriveMemories, runAutoDistill };
