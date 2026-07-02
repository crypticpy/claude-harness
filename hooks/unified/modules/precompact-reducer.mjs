/**
 * Deterministic PreCompact Reducer
 *
 * Writes a session checkpoint at PreCompact using ONLY deterministic analysis —
 * no LLM, no API key required.
 *
 * Two sources, in priority order:
 *   1. Event ledger (Phase 2): when PUNTAX_EVENT_LEDGER is on and there are
 *      events since the last checkpoint, fold them into the docs/05 checkpoint
 *      shape via the pure event-reducer (replayable, deterministic).
 *   2. Transcript signals (Phase 1 stub): otherwise, derive a lighter checkpoint
 *      from the raw transcript (working files, last actions, recent errors).
 *
 * Runs on every PreCompact regardless of PUNTAX_PRECOMPACT_MODE; the LLM
 * consolidation path (precompact-llm) is gated separately by the caller.
 */

import { readFileSync, appendFileSync, existsSync } from 'fs';
import { dirname } from 'path';
import { parseTranscript } from './precompact-llm.mjs';
import { reduceEvents } from './event-reducer.mjs';
import {
  readEvents,
  checkpointsFile,
  pruneEvents,
  pruneCheckpoints,
  classifyBashCommand,
  countMemoryRecalls,
} from './event-writer.mjs';
import { ensureDir } from './storage-paths.mjs';
import { readPuntaxConfig } from './puntax-config.mjs';
import { pruneMemories } from './memory-store.mjs';
import { normalizeCommand } from './auto-distill.mjs';

const MIN_TOOL_CALLS = 5;
const MAX_WORKING_FILES = 8;
const MAX_ACTIONS = 6;
const MAX_ERRORS = 5;
const NEVER_RECALLED_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Never-recalled prune predicate (composed into pruneMemories' dropJunk by the
 * caller — memory-store stays recall-agnostic). Drops a row only when ALL hold:
 *   (a) older than 30 days,
 *   (b) zero memory_recall ledger events reference its id, AND
 *   (c) it was machine-distilled (auto-distill: observed/event, or LLM:
 *       llm_distilled / provenance llm).
 * User-written (provenance user/manual) or user-confirmed rows are NEVER
 * dropped here. Exported for tests.
 */
export function isNeverRecalledJunk(m, recallCounts, now = Date.now()) {
  if (!m || typeof m !== 'object') return false;
  if (m.confidence === 'user_confirmed') return false;
  const src = m.provenance?.source;
  if (src === 'user' || src === 'manual') return false;
  const machineDistilled =
    m.confidence === 'llm_distilled' ||
    src === 'llm' ||
    (m.confidence === 'observed' && src === 'event');
  if (!machineDistilled) return false;
  const created = Date.parse(m.createdAt);
  if (Number.isNaN(created) || now - created < NEVER_RECALLED_MAX_AGE_MS) return false;
  return (recallCounts?.get?.(m.id) || 0) === 0;
}

function appendCheckpoint(projectDir, checkpoint) {
  const file = checkpointsFile(projectDir);
  ensureDir(dirname(file));
  appendFileSync(file, JSON.stringify(checkpoint) + '\n');
}

/**
 * One-line, deterministic "where was I" headline synthesized from a checkpoint's
 * arrays. Surfaced by the session_checkpoint tool so a resuming agent recovers
 * the gist at a glance instead of reading every field. Returns undefined when
 * there's nothing in flight. Works for both event- and transcript-sourced
 * checkpoints (falls back across the equivalent field names).
 */
export function deriveFocus(cp) {
  if (!cp || typeof cp !== 'object') return undefined;
  const parts = [];
  const files = (cp.changedFiles?.length ? cp.changedFiles : cp.workingFiles) || [];
  if (files.length) {
    parts.push(files.length > 1 ? `${files[0]} (+${files.length - 1} more)` : files[0]);
  }
  const loops = cp.openLoops || [];
  if (loops.length) parts.push(`${loops.length} open loop${loops.length > 1 ? 's' : ''}`);
  const tests = cp.testsRun || [];
  if (tests.length) parts.push(`last test: ${tests[tests.length - 1]}`);
  const errs = (cp.failures?.length ? cp.failures : cp.recentErrors) || [];
  if (errs.length && !loops.length) {
    parts.push(`${errs.length} recent error${errs.length > 1 ? 's' : ''}`);
  }
  const next = cp.nextActions || [];
  if (next.length) parts.push(`→ next: ${next[0]}`);
  return parts.length ? parts.join(' · ') : undefined;
}

/** Last checkpoint for this session (for index continuity + incremental sinceTs). */
function lastCheckpoint(projectDir, sessionId) {
  const file = checkpointsFile(projectDir);
  if (!existsSync(file)) return null;
  let raw;
  try {
    raw = readFileSync(file, 'utf-8');
  } catch {
    return null;
  }
  let found = null;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const c = JSON.parse(line);
      if (c && c.type === 'checkpoint' && (!sessionId || c.session_id === sessionId)) {
        found = c;
      }
    } catch {
      // skip corrupt
    }
  }
  return found;
}

// =============================================================================
// Transcript-signal fallback (Phase 1)
// =============================================================================

function extractWorkingFiles(condensed) {
  const files = [];
  const seen = new Set();
  const re = /([\w./@-]+\.\w{1,5})\b/g;
  for (const line of condensed.split('\n')) {
    if (!line.startsWith('TOOL:')) continue;
    let m;
    while ((m = re.exec(line)) !== null) {
      const f = m[1];
      if (!seen.has(f)) {
        seen.add(f);
        files.push(f);
      }
    }
  }
  return files.slice(-MAX_WORKING_FILES);
}

function extractLastActions(condensed) {
  return condensed
    .split('\n')
    .filter((l) => l.startsWith('TOOL:'))
    .map((l) => l.slice('TOOL: '.length).trim())
    .slice(-MAX_ACTIONS);
}

function extractRecentErrors(condensed, signals) {
  if (signals.errorMessages && signals.errorMessages.length) {
    return signals.errorMessages.slice(-MAX_ERRORS);
  }
  return condensed
    .split('\n')
    .filter((l) => l.startsWith('TOOL_ERROR:'))
    .map((l) => l.slice('TOOL_ERROR: '.length).trim())
    .slice(-MAX_ERRORS);
}

function transcriptCheckpoint(event) {
  const { session_id, transcript_path } = event;
  if (!transcript_path || !existsSync(transcript_path)) return null;

  const transcript = readFileSync(transcript_path, 'utf-8');
  const { signals, condensed } = parseTranscript(transcript, null);
  if (signals.totalToolCalls < MIN_TOOL_CALLS) return null;

  return {
    timestamp: new Date().toISOString(),
    type: 'checkpoint',
    session_id,
    source: 'transcript',
    signals: {
      totalTurns: signals.totalTurns,
      totalToolCalls: signals.totalToolCalls,
      toolErrors: signals.toolErrors,
      retryPatterns: signals.retryPatterns,
      explorationSpirals: signals.explorationSpirals,
      contextSwitches: signals.contextSwitches,
      permissionDenials: signals.permissionDenials,
    },
    workingFiles: extractWorkingFiles(condensed),
    lastActions: extractLastActions(condensed),
    recentErrors: extractRecentErrors(condensed, signals),
  };
}

// =============================================================================
// Entry point
// =============================================================================

/**
 * Build and append a deterministic checkpoint. Returns the checkpoint object
 * (or null when skipped) so callers/tests can assert on it.
 */
export async function runReducer(event, config) {
  try {
    const { session_id } = event || {};
    if (!session_id) return null;
    const projectDir = process.env.CLAUDE_PROJECT_DIR || null;
    const puntax = readPuntaxConfig(config || {}, process.env);

    // 1. Event-ledger reduction (preferred when enabled and events exist).
    if (puntax.eventLedger.enabled) {
      const prev = lastCheckpoint(projectDir, session_id);
      const events = readEvents(projectDir, {
        sessionId: session_id,
        sinceTs: prev?.timestamp || null,
      });

      // Retention GC runs on EVERY checkpoint while the ledger is enabled — not
      // only when there are new events to reduce. Otherwise an event-less
      // compaction skips prune and old rows linger until the next event-bearing
      // one. memories.jsonl is otherwise append-only with no GC at all.
      const retentionDays = puntax.eventLedger.retentionDays;
      pruneEvents(projectDir, retentionDays);
      pruneCheckpoints(projectDir, retentionDays);
      // Quality filter, two composed predicates (memory-store stays agnostic):
      //  1. Junk test_command rows — auto-distilled rows ONLY (provenance
      //     source 'event'); user-written rows via memory_write are never
      //     dropped here, matching predicate 2's philosophy. Two flavors:
      //     (a) mis-tagged: an older event classifier tagged compound shell
      //         lines (e.g. `cd x && git status`) as test_command. The current
      //         classifier re-checks each row's text; anything that no longer
      //         reads as a test was never a real test command. Legit single or
      //         compound test commands (`npx vitest run`, `cd pkg && npm test`)
      //         still classify as 'test' and survive.
      //     (b) legacy un-normalized: rows written before normalizeCommand
      //         (`npx vitest run 2>&1 | tail -30`, `echo "=== suite ===" && …`).
      //         auto-distill only writes canonical text now, so a non-canonical
      //         row is by definition stale — its canonical twin is (re)written
      //         the next time the command actually runs.
      //  2. Never-recalled machine-distilled rows: >30 days old, zero
      //     memory_recall ledger events, auto-/llm-distilled provenance.
      //     User-written/confirmed rows are never dropped.
      const recallCounts = countMemoryRecalls(projectDir);
      const pruned = pruneMemories(projectDir, {
        dropJunk: (m) =>
          (m.kind === 'test_command' &&
            m.provenance?.source === 'event' &&
            (classifyBashCommand(m.text || '') !== 'test' ||
              normalizeCommand(m.text || '') !== (m.text || ''))) ||
          isNeverRecalledJunk(m, recallCounts),
      });
      if (process.env.DEBUG && pruned.dropped > 0) {
        process.stderr.write(
          '[memory-store] pruned ' + pruned.dropped + ' rows ' +
            JSON.stringify(pruned.byReason) + '\n',
        );
      }

      if (events.length > 0) {
        const checkpoint = {
          timestamp: new Date().toISOString(),
          type: 'checkpoint',
          session_id,
          source: 'events',
          ...reduceEvents(events, prev),
        };
        const focus = deriveFocus(checkpoint);
        if (focus) checkpoint.focus = focus;
        appendCheckpoint(projectDir, checkpoint);
        return checkpoint;
      }
      // No events since last checkpoint → fall through to transcript stub.
    }

    // 2. Transcript-signal fallback.
    const checkpoint = transcriptCheckpoint(event);
    if (checkpoint) {
      const focus = deriveFocus(checkpoint);
      if (focus) checkpoint.focus = focus;
      appendCheckpoint(projectDir, checkpoint);
      return checkpoint;
    }
    return null;
  } catch (err) {
    if (process.env.DEBUG) {
      process.stderr.write('[precompact-reducer] error: ' + err.message + '\n');
    }
    return null;
  }
}
