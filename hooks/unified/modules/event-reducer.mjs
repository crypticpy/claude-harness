/**
 * Event Reducer (Phase 2, pure)
 *
 * Folds a list of ledger events into a deterministic checkpoint (docs/05 shape).
 * Pure: no I/O, no Date.now(), no randomness — the same events + prev checkpoint
 * always reduce to the same fields, so event replay is reproducible and testable.
 *
 * The caller (precompact-reducer.mjs) stamps `timestamp`/`type`/`session_id`
 * around this and appends to checkpoints.jsonl.
 */

const MAX_LIST = 20;
const MAX_FAILURES = 10;

/**
 * @param {Array<object>} events  ledger events, oldest-first
 * @param {object|null} prevCheckpoint  the session's previous checkpoint (for index continuity)
 * @returns {object} deterministic checkpoint fields
 */
export function reduceEvents(events, prevCheckpoint = null) {
  const list = Array.isArray(events) ? events : [];

  const workingFiles = [];
  const workingSeen = new Set();
  const changedFiles = [];
  const changedSeen = new Set();
  const symbolsTouched = [];
  const symbolSeen = new Set();
  const testsRun = [];
  const failures = [];
  const decisions = [];
  const permissionDenials = [];

  // Track error/resolution per file to derive open loops.
  const fileLastError = new Map();
  const fileResolved = new Set();

  for (const e of list) {
    if (!e || typeof e !== 'object') continue;
    const files = Array.isArray(e.files) ? e.files : [];
    const symbols = Array.isArray(e.symbols) ? e.symbols : [];

    for (const f of files) {
      if (typeof f === 'string' && !workingSeen.has(f)) {
        workingSeen.add(f);
        workingFiles.push(f);
      }
    }
    if (e.kind === 'edit' || e.kind === 'write') {
      for (const f of files) {
        if (typeof f === 'string' && !changedSeen.has(f)) {
          changedSeen.add(f);
          changedFiles.push(f);
        }
      }
    }
    for (const s of symbols) {
      if (typeof s === 'string' && !symbolSeen.has(s)) {
        symbolSeen.add(s);
        symbolsTouched.push(s);
      }
    }
    if (e.kind === 'test') {
      testsRun.push(e.summary || e.command || 'test run');
    }
    if (e.kind === 'permission' && e.outcome === 'denied') {
      permissionDenials.push(e.summary || `denied: ${e.tool || 'tool'}`);
    }
    if (e.outcome === 'error' || e.kind === 'error') {
      failures.push(e.summary || e.command || 'error');
      for (const f of files) if (typeof f === 'string') fileLastError.set(f, e.summary || 'error');
    } else if (e.outcome === 'ok' && (e.kind === 'edit' || e.kind === 'write')) {
      for (const f of files) if (typeof f === 'string') fileResolved.add(f);
    }
    if (e.kind === 'decision') {
      decisions.push(e.summary || 'decision');
    }
  }

  // Open loops: files that errored and were not subsequently re-edited cleanly.
  const openLoops = [];
  for (const [f, msg] of fileLastError) {
    if (!fileResolved.has(f)) openLoops.push(`Unresolved error in ${f}: ${msg}`);
  }

  const trimmedFailures = failures.slice(-MAX_FAILURES);
  const hasHighRisk = list.some((e) => e && (e.risk === 'high' || e.risk === 'critical'));

  let risk = 'low';
  if (hasHighRisk || trimmedFailures.length >= 3) risk = 'high';
  else if (changedFiles.length >= 6 || trimmedFailures.length >= 1 || permissionDenials.length >= 2) {
    risk = 'medium';
  }

  const checkpointIndex =
    (typeof prevCheckpoint?.checkpointIndex === 'number' ? prevCheckpoint.checkpointIndex : -1) + 1;

  return {
    checkpointIndex,
    workingFiles: workingFiles.slice(-MAX_LIST),
    changedFiles: changedFiles.slice(-MAX_LIST),
    symbolsTouched: symbolsTouched.slice(-MAX_LIST),
    testsRun: testsRun.slice(-MAX_FAILURES),
    failures: trimmedFailures,
    decisions: decisions.slice(-MAX_FAILURES),
    openLoops: openLoops.slice(-MAX_FAILURES),
    nextActions: openLoops.slice(-5).map((l) => `Resolve: ${l}`),
    permissionDenials: permissionDenials.slice(-MAX_FAILURES),
    risk,
    eventCount: list.length,
  };
}
