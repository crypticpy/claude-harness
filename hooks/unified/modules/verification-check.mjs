/**
 * Verification Check Module
 * Runs on Stop to inject a self-verification prompt after significant code changes.
 * Inspired by Meta-Harness's double-confirmation completion pattern.
 */

import { readFileSync, statSync, openSync, readSync, closeSync } from 'fs';

const EDIT_THRESHOLD = 3;
const TAIL_BYTES = 50 * 1024; // Only read last 50KB of transcript
const TOOL_NAMES = new Set(['Write', 'Edit']);

/**
 * Read the tail of the transcript file efficiently.
 * Transcripts can be very large; we only need the last portion
 * to find the most recent assistant turn.
 */
function readTranscriptTail(transcriptPath) {
    const stat = statSync(transcriptPath);
    const fileSize = stat.size;

    if (fileSize <= TAIL_BYTES) {
        return readFileSync(transcriptPath, 'utf-8');
    }

    // Read only the last TAIL_BYTES
    const buf = Buffer.alloc(TAIL_BYTES);
    const fd = openSync(transcriptPath, 'r');
    try {
        readSync(fd, buf, 0, TAIL_BYTES, fileSize - TAIL_BYTES);
    } finally {
        closeSync(fd);
    }

    const text = buf.toString('utf-8');
    // Drop the first (likely partial) line
    const firstNewline = text.indexOf('\n');
    return firstNewline >= 0 ? text.slice(firstNewline + 1) : text;
}

/**
 * Parse JSONL lines from the transcript tail and extract
 * the last contiguous run of assistant entries.
 */
function extractLastAssistantTurn(transcriptText) {
    const lines = transcriptText.split('\n').filter(l => l.trim());
    const entries = [];

    // Parse all lines (best-effort, skip malformed)
    for (const line of lines) {
        try {
            entries.push(JSON.parse(line));
        } catch {
            // Skip malformed lines (e.g., partial first line from tail read)
        }
    }

    if (entries.length === 0) return [];

    // Walk backward from the end to collect the last assistant turn
    const assistantEntries = [];
    for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];
        if (entry.type === 'assistant') {
            assistantEntries.unshift(entry);
        } else if (assistantEntries.length > 0) {
            // Hit a non-assistant entry after collecting some — we have the full turn
            break;
        }
        // If we haven't found any assistant entries yet, keep scanning backward
    }

    return assistantEntries;
}

/**
 * Count Write/Edit tool_use blocks across the assistant entries.
 */
function countFileEdits(assistantEntries) {
    let editCount = 0;

    for (const entry of assistantEntries) {
        const content = entry?.message?.content;
        if (!Array.isArray(content)) continue;

        for (const block of content) {
            if (block.type === 'tool_use' && TOOL_NAMES.has(block.name)) {
                editCount++;
            }
        }
    }

    return editCount;
}

/**
 * Build the verification checklist output string.
 */
function buildChecklist(editCount) {
    return `<verification-check>
[SELF-CHECK] Significant code changes detected (${editCount} files modified this turn).

Before proceeding, verify:
- [ ] Implementation matches the requested changes — no scope creep
- [ ] No TODO/FIXME/placeholder items left behind
- [ ] Error handling is complete (no empty catch blocks, no swallowed errors)
- [ ] No hardcoded values that should be configurable
- [ ] Changes are consistent with existing code patterns

If working on a plan: confirm this phase's objectives are met before moving to the next phase.
</verification-check>`;
}

/**
 * Main entry point. Returns a checklist string if significant edits
 * were detected, or null if below threshold / on error.
 */
export async function runVerification(event, _config) {
    try {
        const transcriptPath = event?.transcript_path;
        if (!transcriptPath) return null;

        const transcriptText = readTranscriptTail(transcriptPath);
        if (!transcriptText) return null;

        const assistantEntries = extractLastAssistantTurn(transcriptText);
        if (assistantEntries.length === 0) return null;

        const editCount = countFileEdits(assistantEntries);

        if (editCount >= EDIT_THRESHOLD) {
            return buildChecklist(editCount);
        }

        return null;
    } catch {
        // Silent failure — never block the Stop event
        return null;
    }
}
