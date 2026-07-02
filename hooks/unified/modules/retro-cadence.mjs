/**
 * Retrospective cadence — compaction-counted, not session-counted.
 *
 * "Every ~50 sessions" never fires for a user whose sessions run for days.
 * Compactions are the honest unit of work volume, so: a tiny global counter
 * bumps on every PreCompact (all projects share it — the retrospective is
 * cross-project), and SessionStart suggests /retrospective once enough
 * compactions have accumulated since the last one. A successful
 * retrospective resets the counter (deep-retrospective.mjs calls
 * resetRetroCounter). Suggestions carry a 24h cooldown so a user who
 * declines isn't nagged at every startup.
 */

import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

const COUNT_FILE = join(homedir(), '.claude', 'hooks', 'unified', 'evolution', 'compaction-count.json');
const DEFAULT_THRESHOLD = 25;
const SUGGEST_COOLDOWN_MS = 24 * 3_600_000;

function countFile(opts) {
    return opts?.countFile || COUNT_FILE;
}

export function readCount(opts = {}) {
    try {
        const data = JSON.parse(readFileSync(countFile(opts), 'utf-8'));
        return {
            total: Number(data.total) || 0,
            sinceLastRetro: Number(data.sinceLastRetro) || 0,
            lastRetroAt: data.lastRetroAt || null,
            lastSuggestedAt: data.lastSuggestedAt || null,
        };
    } catch (_) {
        return { total: 0, sinceLastRetro: 0, lastRetroAt: null, lastSuggestedAt: null };
    }
}

function writeCount(data, opts = {}) {
    const file = countFile(opts);
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify({ ...data, updatedAt: new Date().toISOString() }, null, 2));
    renameSync(tmp, file);
}

/** PreCompact: one compaction happened anywhere → bump both counters. */
export function bumpCompactionCount(opts = {}) {
    try {
        const c = readCount(opts);
        const next = { ...c, total: c.total + 1, sinceLastRetro: c.sinceLastRetro + 1 };
        writeCount(next, opts);
        return next;
    } catch (e) {
        if (process.env.DEBUG) console.error('[retro-cadence]', e);
        return null;
    }
}

/** Called by deep-retrospective on a successful run. */
export function resetRetroCounter(opts = {}) {
    try {
        const c = readCount(opts);
        writeCount({ ...c, sinceLastRetro: 0, lastRetroAt: new Date().toISOString() }, opts);
        return true;
    } catch (e) {
        if (process.env.DEBUG) console.error('[retro-cadence]', e);
        return false;
    }
}

/**
 * SessionStart (startup/clear): one-line suggestion when the accumulated
 * compaction count crosses the threshold. Null when below threshold or
 * within the suggestion cooldown.
 */
export function buildRetroSuggestion(config = {}, opts = {}) {
    try {
        const threshold = config?.evolution?.suggestRetroAfterCompactions ?? DEFAULT_THRESHOLD;
        if (!threshold || threshold <= 0) return null;
        const c = readCount(opts);
        if (c.sinceLastRetro < threshold) return null;

        const now = opts.now ?? Date.now();
        const last = c.lastSuggestedAt ? Date.parse(c.lastSuggestedAt) : 0;
        if (Number.isFinite(last) && now - last < SUGGEST_COOLDOWN_MS) return null;

        writeCount({ ...c, lastSuggestedAt: new Date(now).toISOString() }, opts);
        return `📈 ${c.sinceLastRetro} compactions have accumulated since the last deep retrospective `
            + `(threshold ${threshold}). When convenient, run /retrospective to synthesize cross-session `
            + `patterns — a successful run resets this counter.`;
    } catch (e) {
        if (process.env.DEBUG) console.error('[retro-cadence]', e);
        return null;
    }
}
