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

import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

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
        && (!data.keyPoints || data.keyPoints.length === 0);
}

/**
 * Check if memory has real (non-poisoned) content worth preserving.
 */
export function hasRealContent(data) {
    return data?.projectContext && !isPoisonedMemory(data);
}

/**
 * UserPromptSubmit: read memory written by the prior PreCompact and render it
 * as a <session-memory> block for injection.
 */
export async function injectMemory(event) {
    try {
        const { session_id } = event;
        if (!session_id) return null;

        const memoryPath = join(MEMORIES_DIR, `${session_id}.json`);
        if (!existsSync(memoryPath)) return null;

        const memory = JSON.parse(readFileSync(memoryPath, 'utf-8'));

        if (!memory.projectContext && !memory.overallDirection && !memory.keyPoints?.length) {
            return null;
        }
        if (isPoisonedMemory(memory)) {
            return null;
        }

        const startedAt = new Date(memory.startedAt);
        const now = new Date();
        const durationMs = now - startedAt;
        const durationHours = Math.floor(durationMs / (1000 * 60 * 60));
        const durationMins = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
        const durationStr = durationHours > 0 ? `${durationHours}h ${durationMins}m` : `${durationMins}m`;

        let output = '<session-memory>\n';
        output += `Compaction #${memory.compactionCount} | Session: ${durationStr}\n\n`;

        if (memory.projectContext) {
            output += `Project: ${memory.projectContext}\n`;
        }
        if (memory.overallDirection) {
            output += `Direction: ${memory.overallDirection}\n`;
        }
        if (memory.longTermNarrative) {
            output += `\nNarrative: ${memory.longTermNarrative}\n`;
        }
        if (memory.keyPoints?.length > 0) {
            output += '\nHistory:\n';
            memory.keyPoints.forEach((point, i) => {
                const text = typeof point === 'string' ? point : point.summary || point.text || JSON.stringify(point);
                output += `  ${i + 1}. ${text}\n`;
            });
        }

        output += '</session-memory>';
        return output;

    } catch (err) {
        if (process.env.DEBUG) process.stderr.write('[session-memory] injectMemory error: ' + err.message + '\n');
        return null;
    }
}
