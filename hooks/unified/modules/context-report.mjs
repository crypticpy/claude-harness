/**
 * Context Report Module
 *
 * Fires a SINGLE warning per session when context usage reaches 90% of the
 * auto-compact trigger. Silent otherwise — no per-prompt status spam.
 *
 * Threshold is derived at runtime from env vars Claude Code respects:
 *   compactAt = CLAUDE_CODE_AUTO_COMPACT_WINDOW * CLAUDE_AUTOCOMPACT_PCT_OVERRIDE / 100
 *
 * The per-session marker lives at:
 *   ~/.claude/hooks/unified/memories/.warned-90pct-<session_id>
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

function computeCompactThreshold() {
    const window = parseInt(process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW || '200000', 10);
    const pct = parseInt(process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE || '95', 10);
    return Math.floor(window * pct / 100);
}

function markerPath(sessionId) {
    return join(process.env.HOME || '', '.claude', 'hooks', 'unified', 'memories', `.warned-90pct-${sessionId}`);
}

function alreadyWarned(sessionId) {
    return existsSync(markerPath(sessionId));
}

function recordWarned(sessionId) {
    const p = markerPath(sessionId);
    try {
        mkdirSync(dirname(p), { recursive: true });
        // 'wx' fails if file exists — atomic against concurrent hook runs
        writeFileSync(p, String(Date.now()), { flag: 'wx' });
        return true;
    } catch (_) {
        return false;
    }
}

export async function reportContext(event, _config) {
    try {
        const { session_id } = event;
        if (!session_id) return null;
        if (alreadyWarned(session_id)) return null;

        const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
        const projectFolder = projectDir.replace(/^\//, '').replace(/\//g, '-').replace(/^/, '-');
        const transcriptPath = join(process.env.HOME, '.claude', 'projects', projectFolder, `${session_id}.jsonl`);

        if (!existsSync(transcriptPath)) return null;

        // Pull token usage from the last assistant message in the transcript
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
            } catch (_) {}
        }

        if (!lastAssistant?.message?.usage) return null;

        const usage = lastAssistant.message.usage;
        const currentContext =
            (usage.input_tokens || 0) +
            (usage.cache_read_input_tokens || 0) +
            (usage.cache_creation_input_tokens || 0) +
            (usage.output_tokens || 0);

        const compactAt = computeCompactThreshold();
        const warnAt = Math.floor(compactAt * 0.9);

        if (currentContext < warnAt) return null;

        // We're at or past 90%. Record the marker, then emit ONE warning.
        // If marker write fails (race), suppress the message — another hook run got there first.
        if (!recordWarned(session_id)) return null;

        const currentK = Math.floor(currentContext / 1000);
        const compactK = Math.floor(compactAt / 1000);
        const percent = Math.min(100, Math.floor(currentContext * 100 / compactAt));

        return `[⚠️ Context at ${percent}% (${currentK}K/${compactK}K) — consider wrapping up the current task; auto-compact will fire at ${compactK}K.]`;
    } catch (_) {
        return null;
    }
}
