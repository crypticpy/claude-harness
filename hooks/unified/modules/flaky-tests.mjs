/**
 * Flaky-test ledger (Phase 2b)
 *
 * Aggregates kind:'test' events from the project event ledger ACROSS sessions
 * and flags commands whose outcomes flip back and forth. A test that fails,
 * passes, then fails again without being fixed is a flake — the model should
 * re-run or quarantine it instead of chasing a phantom regression (or worse,
 * trusting a lucky pass).
 *
 * Distinguishing a flake from a legitimate fix: a fix is ONE transition
 * (fail…fail → pass…pass); a flake needs ≥2 outcome flips. Pure readers +
 * fail-open.
 */

import { readEvents } from './event-writer.mjs';
import { normalizeCommand } from './auto-distill.mjs';

const MIN_RUNS = 4;
const MIN_FLIPS = 2;
const MAX_CANDIDATES = 5;

/**
 * Fold the ledger's test events into per-command run histories and return
 * flaky candidates, most-flippy first.
 *
 * @param {string|null} projectDir
 * @returns {Array<{command, runs, passes, fails, flips, lastOutcome}>}
 */
export function analyzeFlakyTests(projectDir, opts = {}) {
  if (!projectDir) return [];
  const minRuns = opts.minRuns ?? MIN_RUNS;
  const minFlips = opts.minFlips ?? MIN_FLIPS;
  let events;
  try {
    events = readEvents(projectDir, {});
  } catch {
    return [];
  }

  const groups = new Map(); // normalized command → outcomes[] (ledger order = chronological)
  for (const e of events) {
    if (e.kind !== 'test' || typeof e.command !== 'string') continue;
    const cmd = normalizeCommand(e.command);
    if (!cmd) continue;
    if (!groups.has(cmd)) groups.set(cmd, []);
    groups.get(cmd).push(e.outcome === 'error' ? 'fail' : 'pass');
  }

  const candidates = [];
  for (const [command, outcomes] of groups) {
    if (outcomes.length < minRuns) continue;
    const passes = outcomes.filter((o) => o === 'pass').length;
    const fails = outcomes.length - passes;
    if (passes === 0 || fails === 0) continue;
    let flips = 0;
    for (let i = 1; i < outcomes.length; i++) {
      if (outcomes[i] !== outcomes[i - 1]) flips++;
    }
    if (flips < minFlips) continue;
    candidates.push({
      command,
      runs: outcomes.length,
      passes,
      fails,
      flips,
      lastOutcome: outcomes[outcomes.length - 1],
    });
  }

  return candidates.sort((a, b) => b.flips - a.flips).slice(0, opts.maxCandidates ?? MAX_CANDIDATES);
}

/**
 * Stop-time report: flaky candidates whose command was actually run THIS
 * session (relevance gate — don't nag about tests the session never touched).
 * Returns null when there's nothing relevant to say.
 */
export function buildFlakyReport(projectDir, sessionId, opts = {}) {
  try {
    const candidates = (opts.analyze || analyzeFlakyTests)(projectDir, opts);
    if (!candidates.length) return null;

    let ranThisSession = null;
    if (sessionId) {
      const sessionEvents = readEvents(projectDir, { sessionId });
      ranThisSession = new Set(
        sessionEvents
          .filter((e) => e.kind === 'test' && typeof e.command === 'string')
          .map((e) => normalizeCommand(e.command)),
      );
    }

    const relevant = ranThisSession
      ? candidates.filter((c) => ranThisSession.has(c.command))
      : candidates;
    if (!relevant.length) return null;

    const lines = relevant.map(
      (c) =>
        `[flaky] \`${c.command}\` flipped outcomes ${c.flips}× across ${c.runs} recorded runs ` +
        `(${c.passes} pass / ${c.fails} fail, last: ${c.lastOutcome}). ` +
        'Treat single runs as unreliable — re-run before concluding, and consider quarantining the flaky case.',
    );
    return lines.join('\n');
  } catch {
    return null;
  }
}

export default { analyzeFlakyTests, buildFlakyReport };
