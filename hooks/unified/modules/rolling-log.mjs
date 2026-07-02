/**
 * Rolling Log Module
 * 
 * Logs all tool operations with timestamps, enriches with summaries.
 * Maintains conversation history for the "Memento advisor" recall system.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, readdirSync, unlinkSync, statSync } from 'fs';
import { join, extname } from 'path';
import { callLlm } from './llm-call.mjs';
import { readPuntaxConfig } from './puntax-config.mjs';
import { mirrorToolEvent } from './event-writer.mjs';

const LOG_DIR = join(process.env.HOME, '.claude', 'hooks', 'unified', 'logs');
// Legacy one-shot JSON DB. No longer written: it is the frozen one-time
// migration BASE that readFileEditsDb() folds the sidecar onto. Left in place.
const FILE_EDITS_DB = join(LOG_DIR, 'file-edits.json');
// Append-only edit-event sidecar (one JSONL line per edit). Replaces the old
// full read-parse-mutate-rewrite of FILE_EDITS_DB on every edit; the
// {files: {...}} map is reconstructed on READ by readFileEditsDb().
const FILE_EDITS_LOG = join(LOG_DIR, 'file-edits.jsonl');
// Append-only sidecar for LLM-generated edit summaries, merged on read by
// getFileEditHistory.
const EDIT_SUMMARIES_LOG = join(LOG_DIR, 'edit-summaries.jsonl');

// Ensure log directory exists
if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * Log a tool operation to the rolling log
 */
export async function logOperation(event, config, apiKey) {
    try {
        const { session_id, tool_name, tool_input, tool_output } = event;
        
        if (!session_id) return;

        const sessionLogPath = join(LOG_DIR, `${session_id}.jsonl`);
        
        const logEntry = {
            timestamp: new Date().toISOString(),
            tool_name,
            tool_input,
            output_summary: summarizeOutput(tool_output),
            metadata: extractMetadata(tool_name, tool_input)
        };

        // Append to session log
        appendFileSync(sessionLogPath, JSON.stringify(logEntry) + '\n');

        // Mirror into the PUNTAX event ledger when enabled (additive; the
        // rolling log keeps running in parallel). Also records passive
        // `permission` events on observed denials. Never blocks on failure.
        try {
            if (readPuntaxConfig(config || {}, process.env).eventLedger.enabled) {
                mirrorToolEvent(event, { projectDir: process.env.CLAUDE_PROJECT_DIR });
            }
        } catch (e) {
            // Stays non-fatal, but surface under DEBUG: silently swallowing this
            // hid event-mirroring outages (corrupt config, permission denied).
            if (process.env.DEBUG) process.stderr.write('[rolling-log] event mirror failed: ' + e.message + '\n');
        }

        // Track file edits specifically
        if (tool_name === 'Edit' || tool_name === 'Write') {
            await trackFileEdit(event, config, apiKey);
        }

        // Prune stale entries — at most once per hour to avoid I/O on every edit
        const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
        const pruneMarker = join(LOG_DIR, '.last-prune');
        let shouldPrune = true;
        try {
            if (existsSync(pruneMarker)) {
                const lastPrune = statSync(pruneMarker).mtimeMs;
                shouldPrune = (Date.now() - lastPrune) > PRUNE_INTERVAL_MS;
            }
        } catch (_) {}
        if (shouldPrune) {
            pruneOldEntries(config);
            try { writeFileSync(pruneMarker, new Date().toISOString()); } catch (_) {}
        }

    } catch (err) {
        if (process.env.DEBUG) {
            console.error('[RollingLog] Error:', err);
        }
    }
}

/**
 * Track file edits for edit-history warnings.
 * O(1) append to the JSONL sidecar — the map view is rebuilt on read.
 */
async function trackFileEdit(event, config, apiKey) {
    const { tool_input, session_id } = event;
    const filePath = tool_input?.file_path;

    if (!filePath) return;

    const timestamp = new Date().toISOString();
    appendFileSync(
        FILE_EDITS_LOG,
        JSON.stringify({ filePath, sessionId: session_id || 'unknown', timestamp }) + '\n'
    );

    // Background enrichment: summarize the edit if configured (the headless
    // claude CLI needs no API key, so the flag alone gates it).
    if (config.rolling_log?.backgroundEnrichment) {
        // Don't await - let it run in background
        // Pass the timestamp so the summary can be matched back to this edit on read
        enrichEditSummary(filePath, timestamp, tool_input, apiKey, config).catch(() => {});
    }
}

/**
 * Reconstruct the `{ files: { <path>: { editCount, sessions, firstEdit,
 * lastEdit } } }` view by folding the append-only sidecar onto the legacy
 * file-edits.json base (one-time migration: the old file is read but never
 * rewritten). Same shape the old DB held, so all readers keep working:
 * getFileEditHistory here, edit-history.mjs, deep-retrospective.mjs.
 */
export function readFileEditsDb() {
    let db = { files: {} };
    if (existsSync(FILE_EDITS_DB)) {
        try {
            const legacy = JSON.parse(readFileSync(FILE_EDITS_DB, 'utf-8'));
            if (legacy && typeof legacy === 'object' && legacy.files && typeof legacy.files === 'object') {
                db = structuredClone(legacy);
            }
        } catch (_) { /* corrupt legacy base — start empty */ }
    }
    if (!db.files || typeof db.files !== 'object') db.files = {};

    if (!existsSync(FILE_EDITS_LOG)) return db;
    let raw;
    try {
        raw = readFileSync(FILE_EDITS_LOG, 'utf-8');
    } catch (_) {
        return db;
    }
    for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        let r;
        try { r = JSON.parse(line); } catch (_) { continue; }
        if (!r || typeof r.filePath !== 'string' || !r.filePath) continue;

        let entry = db.files[r.filePath];
        if (!entry) {
            entry = db.files[r.filePath] = { editCount: 0, sessions: {}, firstEdit: r.timestamp };
        }
        entry.editCount = (entry.editCount || 0) + 1;
        entry.lastEdit = r.timestamp;
        if (!entry.firstEdit) entry.firstEdit = r.timestamp;
        if (!entry.sessions || typeof entry.sessions !== 'object') entry.sessions = {};

        const sid = r.sessionId || 'unknown';
        let sess = entry.sessions[sid];
        if (!sess) sess = entry.sessions[sid] = { edits: [], count: 0 };
        sess.edits.push({ timestamp: r.timestamp, summary: null });
        sess.count = (sess.count || 0) + 1;
    }
    return db;
}

/**
 * Background enrichment: call mini LLM to summarize what changed.
 * Writes summaries to an append-only sidecar log to avoid racing with
 * trackFileEdit, which mutates FILE_EDITS_DB synchronously on every edit.
 * Summaries are merged back in on read by getFileEditHistory.
 */
async function enrichEditSummary(filePath, editTimestamp, toolInput, apiKey, config) {
    try {
        const llmConfig = config.llm?.summarize;
        if (!llmConfig) return;

        const prompt = `Summarize this code edit in 1 sentence (max 80 chars):

File: ${filePath}
Changes: ${JSON.stringify(toolInput.diffs || toolInput, null, 2).slice(0, 1000)}

Summary:`;

        const summary = await callLlm(apiKey, llmConfig, prompt, {
            timeoutMs: 15_000,
            title: 'Claude Code Rolling Log',
            format: 'text',
        });

        if (!summary) return;

        const record = JSON.stringify({
            filePath,
            editTimestamp,
            summary,
            generatedAt: new Date().toISOString(),
        }) + '\n';
        appendFileSync(EDIT_SUMMARIES_LOG, record);
    } catch (err) {
        // Silent failure
    }
}

/**
 * Load a map of {filePath::editTimestamp -> summary} from the append-only log.
 * Later entries win, so re-runs of enrichment produce the latest summary.
 */
function loadSummariesMap() {
    const map = new Map();
    if (!existsSync(EDIT_SUMMARIES_LOG)) return map;
    try {
        const content = readFileSync(EDIT_SUMMARIES_LOG, 'utf-8');
        for (const line of content.split('\n')) {
            if (!line.trim()) continue;
            try {
                const r = JSON.parse(line);
                if (r.filePath && r.editTimestamp && r.summary) {
                    map.set(`${r.filePath}::${r.editTimestamp}`, r.summary);
                }
            } catch (_) {}
        }
    } catch (_) {}
    return map;
}

/**
 * Summarize tool output (truncate large outputs)
 */
function summarizeOutput(output) {
    if (!output) return null;
    
    const str = typeof output === 'string' ? output : JSON.stringify(output);
    
    if (str.length > 500) {
        return str.slice(0, 500) + '... [truncated]';
    }
    
    return str;
}

/**
 * Extract metadata from tool calls
 */
function extractMetadata(toolName, toolInput) {
    const meta = {
        tool: toolName
    };

    // Extract file paths
    if (toolInput?.file_path) {
        meta.file = toolInput.file_path;
        meta.ext = extname(toolInput.file_path);
    } else if (toolInput?.paths) {
        meta.files = toolInput.paths;
    }

    // Extract search queries
    if (toolInput?.query) {
        meta.query = toolInput.query;
    }

    // Extract command
    if (toolInput?.command) {
        meta.command = toolInput.command.slice(0, 200);
    }

    return meta;
}

/**
 * Get file edit history for a specific file in this session
 */
export function getFileEditHistory(filePath, sessionId) {
    try {
        const db = readFileEditsDb();
        const fileData = db.files[filePath];

        if (!fileData) return null;

        const sessionEdits = fileData.sessions[sessionId];
        const rawEdits = sessionEdits?.edits || [];

        // Merge summaries from the append-only sidecar.
        const summaries = loadSummariesMap();
        const edits = rawEdits.map(e => {
            if (e.summary) return e;
            const found = summaries.get(`${filePath}::${e.timestamp}`);
            return found ? { ...e, summary: found } : e;
        });

        return {
            totalEdits: fileData.editCount,
            sessionEdits: sessionEdits?.count || 0,
            edits,
            firstEdit: fileData.firstEdit,
            lastEdit: fileData.lastEdit
        };
    } catch (e) {
        return null;
    }
}

/**
 * Prune old entries from the file-edits DB and remove stale session log files.
 * Enforces rolling_log.maxAgeDays and rolling_log.maxEntries from config.
 */
function pruneOldEntries(config) {
    try {
        const maxAgeDays = config.rolling_log?.maxAgeDays ?? 30;
        const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

        // --- Compact the append-only file-edits sidecar ---
        // The legacy file-edits.json (if present) is a frozen migration base
        // and is never rewritten; only sidecar lines age out here. (The old
        // per-file maxEntries cap no longer applies — retention is age-based.)
        try {
            if (existsSync(FILE_EDITS_LOG)) {
                const lines = readFileSync(FILE_EDITS_LOG, 'utf-8').split('\n');
                const kept = [];
                let dropped = 0;
                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const r = JSON.parse(line);
                        const ts = r.timestamp ? new Date(r.timestamp).getTime() : 0;
                        if (ts >= cutoff) kept.push(line);
                        else dropped++;
                    } catch {
                        dropped++;
                    }
                }
                if (dropped > 0) {
                    writeFileSync(FILE_EDITS_LOG, kept.length ? kept.join('\n') + '\n' : '');
                }
            }
        } catch {
            // Skip if we can't compact the sidecar
        }

        // --- Prune the edit-summaries sidecar ---
        // Drop lines whose editTimestamp is older than the cutoff.
        try {
            if (existsSync(EDIT_SUMMARIES_LOG)) {
                const lines = readFileSync(EDIT_SUMMARIES_LOG, 'utf-8').split('\n');
                const kept = [];
                let dropped = 0;
                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const r = JSON.parse(line);
                        const ts = r.editTimestamp ? new Date(r.editTimestamp).getTime() : 0;
                        if (ts >= cutoff) kept.push(line);
                        else dropped++;
                    } catch {
                        dropped++;
                    }
                }
                if (dropped > 0) {
                    writeFileSync(EDIT_SUMMARIES_LOG, kept.length ? kept.join('\n') + '\n' : '');
                }
            }
        } catch {
            // Skip if we can't prune the sidecar
        }

        // --- Prune old session log files ---
        // The two sidecars share LOG_DIR and the .jsonl suffix but age out
        // per-line above — never unlink them wholesale on stale mtime.
        try {
            const sidecars = new Set(['file-edits.jsonl', 'edit-summaries.jsonl']);
            // .length-nudges.json = per-session anti-monolith state (file-length.mjs);
            // ages out whole-file like session logs.
            const logFiles = readdirSync(LOG_DIR).filter(f =>
                (f.endsWith('.jsonl') || f.endsWith('.length-nudges.json')) && !sidecars.has(f));
            for (const file of logFiles) {
                const fullPath = join(LOG_DIR, file);
                try {
                    const stat = statSync(fullPath);
                    if (stat.mtimeMs < cutoff) {
                        unlinkSync(fullPath);
                    }
                } catch {
                    // Skip files we can't stat
                }
            }
        } catch {
            // Skip if we can't read the log directory
        }
    } catch (err) {
        if (process.env.DEBUG) {
            console.error('[RollingLog] Prune error:', err);
        }
    }
}
