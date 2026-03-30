/**
 * Context Report Module
 * Consolidated from context-reporter hook
 * Reports token usage and warns about approaching compaction
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export async function reportContext(event, config) {
    try {
        const { session_id } = event;
        if (!session_id) return null;

        const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();

        // Convert project path to Claude's folder name format
        const projectFolder = projectDir.replace(/^\//, '').replace(/\//g, '-').replace(/^/, '-');
        const transcriptPath = join(process.env.HOME, '.claude', 'projects', projectFolder, `${session_id}.jsonl`);

        if (!existsSync(transcriptPath)) return null;

        // Get the LAST assistant message's usage
        const transcript = readFileSync(transcriptPath, 'utf-8');
        const lines = transcript.split('\n').filter(l => l.trim());

        let lastAssistant = null;
        for (let i = lines.length - 1; i >= 0; i--) {
            try {
                const entry = JSON.parse(lines[i]);
                if (entry.type === 'assistant') {
                    lastAssistant = entry;
                    break;
                }
            } catch (e) {}
        }

        if (!lastAssistant?.message?.usage) return null;

        const usage = lastAssistant.message.usage;
        const cacheRead = usage.cache_read_input_tokens || 0;
        const cacheCreate = usage.cache_creation_input_tokens || 0;
        const outputTokens = usage.output_tokens || 0;

        const inputTokens = usage.input_tokens || 0;
        const currentContext = inputTokens + cacheRead + cacheCreate + outputTokens;

        // Skip if minimal usage
        if (currentContext < 1000) return null;

        const compactionThreshold = config.context?.compactionThreshold || 200000;
        const warningThresholds = config.context?.warningThresholds || { green: 50000, yellow: 25000, orange: 10000 };

        const currentK = Math.floor(currentContext / 1000);
        const compactionK = Math.floor(compactionThreshold / 1000);
        const remainingBeforeCompact = compactionThreshold - currentContext;
        const remainingK = Math.floor(remainingBeforeCompact / 1000);
        const percent = Math.min(100, Math.floor(currentContext * 100 / compactionThreshold));

        // Status indicator
        let indicator;
        if (remainingBeforeCompact <= warningThresholds.orange) {
            indicator = '🔴 COMPACTION IMMINENT';
        } else if (remainingBeforeCompact <= warningThresholds.yellow) {
            indicator = '🟠';
        } else if (remainingBeforeCompact <= warningThresholds.green) {
            indicator = '🟡';
        } else {
            indicator = '🟢';
        }

        // Only output warning-level messages
        if (remainingBeforeCompact <= warningThresholds.orange) {
            return `[${indicator} - ${currentK}K used, ~${remainingK}K until auto-compact! SAVE IMPORTANT CONTEXT NOW]`;
        } else if (remainingBeforeCompact <= warningThresholds.yellow) {
            return `[${indicator} ${currentK}K/${compactionK}K - ~${remainingK}K until compact. Consider saving key learnings.]`;
        }

        // Normal status - brief
        return `[${indicator} ${currentK}K/${compactionK}K (${percent}%)]`;

    } catch (err) {
        return null;
    }
}
