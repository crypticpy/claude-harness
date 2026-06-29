/**
 * Event Writer (Phase 2)
 *
 * Append-only writer + corrupted-line-tolerant reader for the PUNTAX event
 * ledger (events.jsonl). Events are the canonical, deterministic substrate the
 * session reducer folds into checkpoints — no LLM involved.
 *
 * Schema: puntax-v2-docs/schemas/event.schema.json. Validation here is
 * lightweight/dependency-free (enum membership + shape coercion) rather than a
 * full JSON-schema library, by design (simplicity + no test network deps).
 *
 * Writing is gated by the caller (PUNTAX_EVENT_LEDGER / config.eventLedger);
 * this module itself is mechanism, not policy.
 */

import { appendFileSync, readFileSync, existsSync, writeFileSync } from 'fs';
import { join, dirname, extname } from 'path';
import { createHash } from 'crypto';
import { resolveContextDir, ensureDir } from './storage-paths.mjs';

const KINDS = new Set([
  'tool_call', 'read', 'edit', 'write', 'test', 'lint', 'diagnostic',
  'error', 'permission', 'decision', 'memory', 'checkpoint', 'index',
]);
const OUTCOMES = new Set([
  'ok', 'error', 'denied', 'asked', 'escalated', 'skipped', 'verified',
]);
const RISKS = new Set(['low', 'medium', 'high', 'critical']);

const PERMISSION_DENIED_RE =
  /permission denied|EACCES|EPERM|not permitted|unauthorized|requires approval|operation not permitted/i;

// Per-process monotonic counter so two same-content events get distinct ids.
let seq = 0;

/** Resolve the project-local context dir, with a HOME fallback (no projectDir). */
export function contextDir(projectDir) {
  const base = projectDir || process.env.CLAUDE_PROJECT_DIR;
  if (base) return resolveContextDir(base);
  return join(process.env.HOME || '.', '.claude', 'context-layer');
}

export function eventsFile(projectDir) {
  return join(contextDir(projectDir), 'events.jsonl');
}

export function checkpointsFile(projectDir) {
  return join(contextDir(projectDir), 'checkpoints.jsonl');
}

/** Deterministic-within-process evt_* id from core fields. */
function makeEventId(core) {
  const hash = createHash('sha1').update(JSON.stringify(core)).digest('hex');
  return `evt_${hash.slice(0, 20)}`;
}

/**
 * Normalize + append a single event. Coerces invalid kind/outcome/risk to safe
 * defaults rather than dropping the event. Returns the written event, or null
 * on failure (fail-open — never throws to the hook path).
 */
export function writeEvent(partial, opts = {}) {
  try {
    if (!partial || typeof partial !== 'object') return null;
    const projectDir = opts.projectDir;
    const sessionId = partial.sessionId || opts.sessionId || 'unknown';
    const kind = KINDS.has(partial.kind) ? partial.kind : 'tool_call';
    const outcome = OUTCOMES.has(partial.outcome) ? partial.outcome : 'ok';
    const ts = partial.ts || new Date().toISOString();
    const files = Array.isArray(partial.files)
      ? partial.files.filter((f) => typeof f === 'string')
      : [];
    const symbols = Array.isArray(partial.symbols)
      ? partial.symbols.filter((s) => typeof s === 'string')
      : [];
    const tool = typeof partial.tool === 'string' ? partial.tool : null;
    const command =
      typeof partial.command === 'string' ? partial.command.slice(0, 500) : null;
    const risk = RISKS.has(partial.risk) ? partial.risk : null;

    const core = { sessionId, ts, kind, tool, files, symbols, command, outcome, seq: seq++ };
    const event = {
      id: partial.id || makeEventId(core),
      sessionId,
      ts,
      kind,
      tool,
      projectDir: projectDir || process.env.CLAUDE_PROJECT_DIR || '',
      files,
      symbols,
      command,
      outcome,
      summary: partial.summary != null ? String(partial.summary).slice(0, 2000) : null,
      risk,
    };
    if (partial.evidence && typeof partial.evidence === 'object') {
      event.evidence = partial.evidence;
    }
    if (partial.meta && typeof partial.meta === 'object') {
      event.meta = partial.meta;
    }

    const file = eventsFile(projectDir);
    ensureDir(dirname(file));
    appendFileSync(file, JSON.stringify(event) + '\n');
    return event;
  } catch (err) {
    if (process.env.DEBUG) process.stderr.write('[event-writer] write error: ' + err.message + '\n');
    return null;
  }
}

/**
 * Read events, skipping corrupted lines. Optional filters: sessionId, sinceTs
 * (strictly-after ISO timestamp).
 */
export function readEvents(projectDir, { sessionId, sinceTs } = {}) {
  const file = eventsFile(projectDir);
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
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue; // tolerate corruption
    }
    if (!e || typeof e !== 'object' || !KINDS.has(e.kind)) continue;
    if (sessionId && e.sessionId !== sessionId) continue;
    if (sinceTs && !(typeof e.ts === 'string' && e.ts > sinceTs)) continue;
    out.push(e);
  }
  return out;
}

// =============================================================================
// Tool-event mirroring (called from rolling-log on PostToolUse)
// =============================================================================

function classifyKind(toolName, command) {
  switch (toolName) {
    case 'Edit':
    case 'MultiEdit':
      return 'edit';
    case 'Write':
    case 'NotebookEdit':
      return 'write';
    case 'Read':
    case 'NotebookRead':
      return 'read';
    case 'Bash':
    case 'bash': {
      const c = (command || '').toLowerCase();
      if (/\b(vitest|jest|pytest|go test|cargo test|npm test|yarn test|rspec|mocha)\b/.test(c)) return 'test';
      if (/\b(eslint|tsc|prettier|ruff|mypy|flake8|typecheck|lint|clippy|gofmt)\b/.test(c)) return 'lint';
      return 'tool_call';
    }
    default:
      return 'tool_call';
  }
}

function extractFiles(toolInput) {
  if (!toolInput) return [];
  if (typeof toolInput.file_path === 'string') return [toolInput.file_path];
  if (Array.isArray(toolInput.paths)) return toolInput.paths.filter((p) => typeof p === 'string');
  if (typeof toolInput.path === 'string') return [toolInput.path];
  return [];
}

function outputText(toolOutput) {
  if (!toolOutput) return '';
  if (typeof toolOutput === 'string') return toolOutput;
  try {
    return JSON.stringify(toolOutput);
  } catch {
    return '';
  }
}

/**
 * Map a PostToolUse hook event into the ledger. Writes the tool event, and —
 * when the output shows a permission denial — an additional passive `permission`
 * event mirroring cf-approve's decision (read-only telemetry; never alters it).
 * Returns the written tool event (or null).
 */
export function mirrorToolEvent(hookEvent, opts = {}) {
  try {
    const { session_id, tool_name, tool_input, tool_output, tool_response } = hookEvent || {};
    if (!tool_name) return null;
    const projectDir = opts.projectDir || process.env.CLAUDE_PROJECT_DIR;

    const command = typeof tool_input?.command === 'string' ? tool_input.command : null;
    const kind = classifyKind(tool_name, command);
    const files = extractFiles(tool_input);
    const symbols =
      typeof tool_input?.symbolName === 'string' ? [tool_input.symbolName] : [];
    const out = outputText(tool_output);
    const isError =
      tool_response?.is_error === true ||
      /\berror\b|exception|traceback|failed/i.test(out.slice(0, 500));

    const denied = PERMISSION_DENIED_RE.test(out);

    const summaryBits = [tool_name];
    if (files.length) summaryBits.push(files[0] + (extname(files[0]) || ''));
    else if (command) summaryBits.push(command.slice(0, 80));

    // Keep the semantic kind (edit/write/read/test/lint/tool_call) and signal
    // failure via outcome — the reducer treats outcome==='error' as a failure,
    // so a failing test still both counts as a test run and as a failure.
    const toolEvent = writeEvent(
      {
        sessionId: session_id,
        kind,
        tool: tool_name,
        files,
        symbols,
        command,
        outcome: isError ? 'error' : 'ok',
        summary: summaryBits.join(' '),
      },
      { projectDir },
    );

    // Passive permission audit (Phase 4 folded in): mirror denials only.
    if (denied) {
      writeEvent(
        {
          sessionId: session_id,
          kind: 'permission',
          tool: tool_name,
          files,
          command,
          outcome: 'denied',
          summary: `permission denied for ${tool_name}`,
        },
        { projectDir },
      );
    }

    return toolEvent;
  } catch (err) {
    if (process.env.DEBUG) process.stderr.write('[event-writer] mirror error: ' + err.message + '\n');
    return null;
  }
}

// =============================================================================
// Retention
// =============================================================================

/** Drop events older than retentionDays. Called infrequently (at checkpoint). */
export function pruneEvents(projectDir, retentionDays = 90) {
  try {
    const file = eventsFile(projectDir);
    if (!existsSync(file)) return;
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const lines = readFileSync(file, 'utf-8').split('\n');
    const kept = [];
    let dropped = 0;
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        const ts = e.ts ? new Date(e.ts).getTime() : 0;
        if (ts >= cutoff) kept.push(line);
        else dropped++;
      } catch {
        dropped++; // drop corrupt lines while we're here
      }
    }
    if (dropped > 0) {
      writeFileSync(file, kept.length ? kept.join('\n') + '\n' : '');
    }
  } catch (err) {
    if (process.env.DEBUG) process.stderr.write('[event-writer] prune error: ' + err.message + '\n');
  }
}
