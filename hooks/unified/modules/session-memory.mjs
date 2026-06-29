/**
 * Session Memory Module
 *
 * Injects narrative memory at UserPromptSubmit so the next conversation window
 * starts with the prior compaction's project context and history. The memory
 * itself is written by precompact-llm.mjs on PreCompact; this module is the
 * read-side only.
 *
 * Also exports poison-detection helpers used by precompact-llm and self-evolution.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { readPuntaxConfig } from './puntax-config.mjs';

const MEMORIES_DIR = join(process.env.HOME, '.claude', 'hooks', 'unified', 'memories');

if (!existsSync(MEMORIES_DIR)) {
    mkdirSync(MEMORIES_DIR, { recursive: true });
}

/**
 * Detect poisoned memory — stub values written when an LLM call failed early
 * in the harness's history. Used at read AND write paths to prevent regressions.
 */
export function isPoisonedMemory(data) {
    if (!data) return false;
    return data.projectContext === 'Unknown'
        && data.overallDirection === 'In progress'
        && !data.keyPoints?.length
        && !data.milestones?.length;
}

/**
 * Check if memory has real (non-poisoned) content worth preserving.
 */
export function hasRealContent(data) {
    return data?.projectContext && !isPoisonedMemory(data);
}

function formatDuration(memory) {
    const startedAt = new Date(memory.startedAt);
    const now = new Date();
    const durationMs = now - startedAt;
    const durationHours = Math.floor(durationMs / (1000 * 60 * 60));
    const durationMins = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
    return durationHours > 0 ? `${durationHours}h ${durationMins}m` : `${durationMins}m`;
}

/** Full <session-memory> block — the legacy always-on render. */
function renderFull(memory) {
    let output = '<session-memory>\n';
    output += `Compaction #${memory.compactionCount} | Session: ${formatDuration(memory)}\n\n`;

    if (memory.projectContext) {
        output += `Project: ${memory.projectContext}\n`;
    }
    if (memory.overallDirection) {
        output += `Direction: ${memory.overallDirection}\n`;
    }
    if (memory.longTermNarrative) {
        output += `\nNarrative: ${memory.longTermNarrative}\n`;
    }
    if (Array.isArray(memory.milestones) && memory.milestones.length > 0) {
        output += '\nProgression (punch list of major events):\n';
        memory.milestones.forEach((m) => {
            const tag = m && typeof m === 'object' && m.c ? `[#${m.c}] ` : '';
            const text = typeof m === 'string' ? m : (m?.t || '');
            if (text) output += `  • ${tag}${text}\n`;
        });
    } else if (memory.keyPoints?.length > 0) {
        // Legacy memories written before the punch-list change.
        output += '\nHistory:\n';
        memory.keyPoints.forEach((point, i) => {
            const text = typeof point === 'string' ? point : point.summary || point.text || JSON.stringify(point);
            output += `  ${i + 1}. ${text}\n`;
        });
    }

    output += '</session-memory>';
    return output;
}

/** Near-zero render: one line, used when the prompt is relevant but stale. */
function renderCompact(memory) {
    const bits = [];
    if (memory.projectContext) bits.push(`Project: ${memory.projectContext}`);
    if (memory.overallDirection) bits.push(`Direction: ${memory.overallDirection}`);
    if (bits.length === 0) return null;
    return `<session-memory>\n${bits.join(' | ')}\n</session-memory>`;
}

/**
 * "Fresh compaction" = the first prompt of a window after a NEW compaction.
 * Tracked by a per-session marker file holding the last-injected compaction
 * count. Returns true (and updates the marker) only when this prompt is the
 * first to see `memory.compactionCount`.
 */
function isFreshCompaction(sessionId, memory) {
    const markerPath = join(MEMORIES_DIR, `${sessionId}.lastinject`);
    let lastInjected = null;
    if (existsSync(markerPath)) {
        try { lastInjected = parseInt(readFileSync(markerPath, 'utf-8').trim(), 10); } catch (e) {}
    }
    const current = memory.compactionCount ?? 0;
    if (lastInjected !== current) {
        try { writeFileSync(markerPath, String(current)); } catch (e) {}
        return true;
    }
    return false;
}

/** Does the prompt share keywords with the memory's project/direction/milestones? */
function promptRelevant(event, memory) {
    const prompt = (event?.prompt || '').toLowerCase();
    if (!prompt) return false;
    const terms = prompt.split(/\s+/).filter((t) => t.length > 3);
    if (terms.length === 0) return false;

    const haystack = [
        memory.projectContext || '',
        memory.overallDirection || '',
        memory.longTermNarrative || '',
        ...(Array.isArray(memory.milestones)
            ? memory.milestones.map((m) => (typeof m === 'string' ? m : m?.t || ''))
            : []),
    ].join(' ').toLowerCase();

    return terms.some((t) => haystack.includes(t));
}

/**
 * UserPromptSubmit: read memory written by the prior PreCompact and render it
 * as a <session-memory> block for injection.
 *
 * With the PUNTAX context router enabled (default), broad memory is injected
 * only on a fresh compaction (resume moment) or when the prompt is relevant;
 * otherwise injection is near-zero. Set PUNTAX_CONTEXT_ROUTER=false to restore
 * the legacy always-inject behavior.
 */
export async function injectMemory(event, config) {
    try {
        const { session_id } = event;
        if (!session_id) return null;

        const memoryPath = join(MEMORIES_DIR, `${session_id}.json`);
        if (!existsSync(memoryPath)) return null;

        const memory = JSON.parse(readFileSync(memoryPath, 'utf-8'));

        if (!memory.projectContext && !memory.overallDirection && !memory.keyPoints?.length && !memory.milestones?.length) {
            return null;
        }
        if (isPoisonedMemory(memory)) {
            return null;
        }

        let routerEnabled = true;
        try {
            routerEnabled = readPuntaxConfig(config || {}, process.env).contextRouter.enabled;
        } catch (e) { /* default to gated behavior */ }

        // Rollback path: legacy always-inject.
        if (!routerEnabled) {
            return renderFull(memory);
        }

        // Resume moment: inject the full block once per new compaction.
        if (isFreshCompaction(session_id, memory)) {
            return renderFull(memory);
        }

        // Otherwise inject only when the prompt is relevant, and only compactly.
        if (promptRelevant(event, memory)) {
            return renderCompact(memory);
        }

        return null;

    } catch (err) {
        if (process.env.DEBUG) process.stderr.write('[session-memory] injectMemory error: ' + err.message + '\n');
        return null;
    }
}
