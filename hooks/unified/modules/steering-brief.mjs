/**
 * Steering Brief — evolving mid-session orientation, keyed to compaction count.
 *
 * Every Nth compaction of a session (default 5), synthesize a short markdown
 * brief from the session's event ledger, checkpoints, charter/manifest, and
 * the PREVIOUS brief — then OVERWRITE the previous brief. Replacement is the
 * point: resolved items fall out, open threads and carry-forward file
 * pointers survive. The brief is injected at SessionStart (source=compact
 * always when fresh/same-session; source=resume only when fresh) so long
 * runs re-orient after context loss.
 *
 * Synthesis runs on SONNET via headless `claude -p` (user directive: this is
 * steering content pushed into context — no haiku). It runs in a DETACHED
 * worker process (this same file, --worker) so the PreCompact hook never
 * blocks on the LLM; the next SessionStart picks up whatever brief exists.
 */

import { readFileSync, writeFileSync, renameSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { spawn } from 'node:child_process';

import { resolveContextDir, ensureDir } from './storage-paths.mjs';
import { readCheckpoints, collectStructuredContext, renderStructuredFacts } from './structured-context.mjs';
import { readCharter, readManifest } from './steering-store.mjs';
import { readEvents } from './event-writer.mjs';
import { callLlm } from './llm-call.mjs';

const MODULE_PATH = fileURLToPath(import.meta.url);
const DEFAULTS = {
    enabled: true,
    everyNCompactions: 5,
    model: 'sonnet',
    maxTokens: 2500,
    timeoutMs: 180_000,
};

function briefConfig(config) {
    return { ...DEFAULTS, ...(config?.puntax?.steeringBrief || {}) };
}

export function briefFile(projectDir) {
    return join(resolveContextDir(projectDir), 'steering-brief.json');
}

export function readBrief(projectDir) {
    try {
        const data = JSON.parse(readFileSync(briefFile(projectDir), 'utf-8'));
        return data && typeof data.brief === 'string' ? data : null;
    } catch (_) {
        return null;
    }
}

function writeBrief(projectDir, data) {
    const file = briefFile(projectDir);
    ensureDir(dirname(file));
    const tmp = `${file}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, file);
    return file;
}

/** Pure gate: generate on every Nth compaction of the session. */
export function shouldGenerate(count, everyN) {
    return Number.isFinite(count) && Number.isFinite(everyN)
        && everyN > 0 && count > 0 && count % everyN === 0;
}

/**
 * Compress the session's event ledger into a bounded plain-text digest for
 * the synthesis prompt: counts by kind/outcome, recent errors, top files.
 */
export function digestEvents(events) {
    const rows = Array.isArray(events) ? events : [];
    if (rows.length === 0) return '(no ledger events for this session)';

    const byKind = {};
    const fileCounts = {};
    const errors = [];
    for (const e of rows) {
        const kind = e?.kind || 'other';
        byKind[kind] = (byKind[kind] || 0) + 1;
        for (const f of Array.isArray(e?.files) ? e.files : []) {
            fileCounts[f] = (fileCounts[f] || 0) + 1;
        }
        if (e?.outcome === 'error') {
            errors.push(String(e.command || e.summary || e.kind || 'unknown').slice(0, 100));
        }
    }
    const kinds = Object.entries(byKind).map(([k, n]) => `${k}:${n}`).join(', ');
    const topFiles = Object.entries(fileCounts)
        .sort((a, b) => b[1] - a[1]).slice(0, 10)
        .map(([f, n]) => `${f} (${n})`).join(', ');
    const recentErrors = errors.slice(-8).map((c) => `  - ${c}`).join('\n');

    return [
        `Events by kind: ${kinds}`,
        topFiles ? `Most-touched files: ${topFiles}` : null,
        errors.length ? `Errors (${errors.length} total, last ${Math.min(8, errors.length)}):\n${recentErrors}` : 'No errored operations.',
    ].filter(Boolean).join('\n');
}

export function buildBriefPrompt({ count, everyN, charter, manifest, prevBrief, facts, eventsDigest }) {
    const pending = (manifest?.items || []).filter((i) => i.status === 'pending').slice(0, 15);
    const manifestText = pending.length
        ? pending.map((i) => `- [ ] ${i.file}${i.symbol ? ` — ${i.symbol}` : ''}${i.note ? ` (${i.note})` : ''}`).join('\n')
        : '(no pending manifest items)';

    const charterText = charter?.mission
        ? [
            `Mission: ${charter.mission}`,
            charter.scope?.length ? `Scope: ${charter.scope.join(', ')}` : null,
            charter.constraints?.length ? `Constraints:\n${charter.constraints.map((c) => `- ${c}`).join('\n')}` : null,
        ].filter(Boolean).join('\n')
        : '(no mission charter set)';

    return `You are writing the STEERING BRIEF for a long-running coding session that just compacted for the ${count}th time. The brief is injected into the model's context after each compaction so the session re-orients without re-deriving everything. You write a fresh brief every ${everyN} compactions.

CRITICAL — this brief REPLACES the previous one. Copy forward only what is still true and unresolved. If the previous brief lists an item that the activity below shows resolved or abandoned, DROP it. An accumulating brief is a failed brief.

## Mission charter (source of truth for intent)
${charterText}

## Remaining refactor-manifest items
${manifestText}

## Previous brief (being replaced — prune it against the activity below)
${prevBrief || '(none — this is the first brief of the session)'}

## Deterministic session facts (from checkpoints/memories)
${facts || '(none)'}

## Session activity digest (event ledger)
${eventsDigest}

Write the new brief now. Hard rules:
- Markdown, at most 30 lines total. Terse, concrete, no filler.
- Sections (omit any that would be empty):
  **Mission status** — 1-3 lines: on/off course vs the charter, and the single most important next thing.
  **Done since last brief** — max 5 bullets, only items that were open before.
  **Open threads** — each bullet: the thread + its concrete next action.
  **Active gotchas** — recurring failures/constraints still in force. Drop anything fixed.
  **Carry forward** — pointers of the form \`path\` — why it matters later. Only files whose contents will be needed again.
- Never invent facts not supported by the inputs. When unsure, omit.
- Output ONLY the brief markdown. No preamble, no code fence around the whole thing.`;
}

/**
 * PreCompact entry: cheap count check, then hand off to a detached worker so
 * the hook returns immediately. Returns {scheduled, count} for tests/logging.
 */
export function maybeScheduleBrief(event, config = {}, opts = {}) {
    try {
        const cfg = briefConfig(config);
        if (!cfg.enabled) return { scheduled: false, reason: 'disabled' };
        const sessionId = event?.session_id;
        if (!sessionId) return { scheduled: false, reason: 'no-session' };
        const projectDir = opts.projectDir || process.env.CLAUDE_PROJECT_DIR || event?.cwd || process.cwd();

        // The reducer has already appended this compaction's checkpoint, so the
        // row count IS the compaction number for this session. limit:0 =
        // unlimited — the default cap would freeze the count on long sessions.
        const count = readCheckpoints(projectDir, { sessionId, limit: 0 }).length;
        if (!shouldGenerate(count, cfg.everyNCompactions)) {
            return { scheduled: false, reason: 'off-cycle', count };
        }

        const spawnFn = opts.spawn || spawn;
        const child = spawnFn(
            process.execPath,
            [MODULE_PATH, '--worker', projectDir, sessionId, String(count)],
            { detached: true, stdio: 'ignore', env: process.env },
        );
        child?.unref?.();
        return { scheduled: true, count };
    } catch (e) {
        if (process.env.DEBUG) console.error('[steering-brief]', e);
        return { scheduled: false, reason: 'error' };
    }
}

/**
 * Worker body: gather inputs, synthesize on sonnet, overwrite the brief file.
 * Deps injectable for tests.
 */
export async function generateBrief(projectDir, sessionId, count, opts = {}) {
    const deps = opts.deps || {};
    const llm = deps.callLlm || callLlm;
    const cfg = briefConfig(opts.config ?? readHookConfig());

    const charter = readCharter(projectDir);
    const manifest = readManifest(projectDir);
    const prev = readBrief(projectDir);
    const facts = renderStructuredFacts(collectStructuredContext(projectDir));
    const eventsDigest = digestEvents(readEvents(projectDir, { sessionId }));

    const prompt = buildBriefPrompt({
        count,
        everyN: cfg.everyNCompactions,
        charter,
        manifest,
        prevBrief: prev?.brief || null,
        facts,
        eventsDigest,
    });

    const text = await llm(
        null,
        { engine: 'claude-cli', model: cfg.model, maxTokens: cfg.maxTokens },
        prompt,
        { timeoutMs: cfg.timeoutMs, format: 'text' },
    );
    if (!text || typeof text !== 'string') return { written: false, reason: 'llm-null' };

    const path = writeBrief(projectDir, {
        version: 1,
        sessionId,
        compactions: count,
        generatedAt: new Date().toISOString(),
        model: cfg.model,
        brief: text.trim(),
    });
    return { written: true, path };
}

/**
 * SessionStart entry: inject the brief on compact (same session, or fresh)
 * and on resume (fresh only). Returns the injection text or null.
 */
export function buildBriefInjection(projectDir, event, opts = {}) {
    try {
        const source = event?.source;
        if (source !== 'compact' && source !== 'resume') return null;
        const b = readBrief(projectDir);
        if (!b) return null;

        const now = opts.now ?? Date.now();
        const ageHours = (now - Date.parse(b.generatedAt || 0)) / 3_600_000;
        const fresh = Number.isFinite(ageHours) && ageHours >= 0 && ageHours < 48;
        const sameSession = Boolean(b.sessionId && event?.session_id && b.sessionId === event.session_id);
        if (!(source === 'compact' ? (sameSession || fresh) : fresh)) return null;

        return `## Steering brief (auto-generated at compaction #${b.compactions}; refreshed every few compactions)\n`
            + `Orientation only — verify specifics against the code before acting on them.\n\n`
            + b.brief;
    } catch (e) {
        if (process.env.DEBUG) console.error('[steering-brief]', e);
        return null;
    }
}

function readHookConfig() {
    try {
        return JSON.parse(readFileSync(join(dirname(MODULE_PATH), '..', 'config.json'), 'utf-8'));
    } catch (_) {
        return {};
    }
}

// ─── Detached worker entry ───────────────────────────────────────────
// `node steering-brief.mjs --worker <projectDir> <sessionId> <count>`
const invokedAs = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (invokedAs === import.meta.url && process.argv[2] === '--worker') {
    const [projectDir, sessionId, countStr] = process.argv.slice(3);
    generateBrief(projectDir, sessionId, Number(countStr) || 0)
        .then((r) => {
            if (process.env.DEBUG) console.error('[steering-brief worker]', JSON.stringify(r));
            process.exit(0);
        })
        .catch((e) => {
            if (process.env.DEBUG) console.error('[steering-brief worker]', e);
            process.exit(0); // fail-open: a missing brief is never an error
        });
}
