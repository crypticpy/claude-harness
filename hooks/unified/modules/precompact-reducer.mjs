/**
 * Deterministic PreCompact Reducer (Phase 1 stub)
 *
 * Writes a session checkpoint at PreCompact using ONLY deterministic transcript
 * analysis — no LLM, no API key required. Reuses parseTranscript from
 * precompact-llm.mjs (signals + condensed message stream) and derives a compact
 * resume seed: working files, last actions, recent errors, and signal counts.
 *
 * This is the seed of the Phase 2 event ledger + session reducer. It runs on
 * every PreCompact regardless of PUNTAX_PRECOMPACT_MODE; the LLM consolidation
 * path (precompact-llm) is gated separately by the caller.
 */

import { readFileSync, appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { parseTranscript } from './precompact-llm.mjs';

const MIN_TOOL_CALLS = 5;
const MAX_WORKING_FILES = 8;
const MAX_ACTIONS = 6;
const MAX_ERRORS = 5;

/** Resolve the project context-layer dir, mirroring precompact-llm's lessons path. */
function resolveCheckpointsPath() {
  const projectDir = process.env.CLAUDE_PROJECT_DIR;
  if (projectDir) {
    const dir = join(projectDir, '.claude', 'context-layer');
    try {
      mkdirSync(dir, { recursive: true });
      return join(dir, 'checkpoints.jsonl');
    } catch (e) {}
  }
  const fallbackDir = join(process.env.HOME, '.claude', 'context-layer');
  mkdirSync(fallbackDir, { recursive: true });
  return join(fallbackDir, 'checkpoints.jsonl');
}

/** Pull file-like paths out of the condensed TOOL lines, most-recent-last. */
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
  // Keep the most recently mentioned files.
  return files.slice(-MAX_WORKING_FILES);
}

function extractLastActions(condensed) {
  const actions = condensed
    .split('\n')
    .filter((l) => l.startsWith('TOOL:'))
    .map((l) => l.slice('TOOL: '.length).trim());
  return actions.slice(-MAX_ACTIONS);
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

/**
 * Build and append a deterministic checkpoint. Returns the checkpoint object
 * (or null when skipped) so callers/tests can assert on it.
 */
export async function runReducer(event, _config) {
  try {
    const { session_id, transcript_path } = event || {};
    if (!session_id || !transcript_path) return null;
    if (!existsSync(transcript_path)) return null;

    const transcript = readFileSync(transcript_path, 'utf-8');
    // No prior-memory skip: the checkpoint reflects the full visible window.
    const { signals, condensed } = parseTranscript(transcript, null);

    // Too short to be worth a checkpoint.
    if (signals.totalToolCalls < MIN_TOOL_CALLS) return null;

    const checkpoint = {
      timestamp: new Date().toISOString(),
      type: 'checkpoint',
      session_id,
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

    appendFileSync(resolveCheckpointsPath(), JSON.stringify(checkpoint) + '\n');
    return checkpoint;
  } catch (err) {
    if (process.env.DEBUG) {
      process.stderr.write('[precompact-reducer] error: ' + err.message + '\n');
    }
    return null;
  }
}
