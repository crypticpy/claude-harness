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
const FILE_EDITS_DB = join(LOG_DIR, 'file-edits.json');
// Append-only sidecar for LLM-generated edit summaries. Avoids racing with
// trackFileEdit (which mutates FILE_EDITS_DB synchronously on every edit).
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
        } catch (_) {}

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
 * Track file edits for edit-history warnings
 */
async function trackFileEdit(event, config, apiKey) {
    const { tool_input, session_id } = event;
    const filePath = tool_input?.file_path;
    
    if (!filePath) return;

    // Load file edits DB
    let db = { files: {} };
    if (existsSync(FILE_EDITS_DB)) {
        try {
            db = JSON.parse(readFileSync(FILE_EDITS_DB, 'utf-8'));
        } catch (e) {
            db = { files: {} };
        }
    }

    // Initialize file entry
    if (!db.files[filePath]) {
        db.files[filePath] = {
            editCount: 0,
            sessions: {},
            firstEdit: new Date().toISOString()
        };
    }

    // Track this edit
    db.files[filePath].editCount++;
    db.files[filePath].lastEdit = new Date().toISOString();
    
    if (!db.files[filePath].sessions[session_id]) {
        db.files[filePath].sessions[session_id] = {
            edits: [],
            count: 0
        };
    }

    const edit = {
        timestamp: new Date().toISOString(),
        summary: null // Will be enriched in background
    };

    db.files[filePath].sessions[session_id].edits.push(edit);
    db.files[filePath].sessions[session_id].count++;

    // Save DB
    writeFileSync(FILE_EDITS_DB, JSON.stringify(db, null, 2));

    // Background enrichment: summarize the edit if configured
    if (config.rolling_log?.backgroundEnrichment && apiKey) {
        // Don't await - let it run in background
        // Pass the timestamp (not the object) so enrichEditSummary can find the correct entry after re-reading DB
        enrichEditSummary(filePath, edit.timestamp, tool_input, apiKey, config).catch(() => {});
    }
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
    if (!existsSync(FILE_EDITS_DB)) return null;

    try {
        const db = JSON.parse(readFileSync(FILE_EDITS_DB, 'utf-8'));
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
        const maxEntries = config.rolling_log?.maxEntries ?? 10000;
        const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

        // --- Prune file-edits DB ---
        if (existsSync(FILE_EDITS_DB)) {
            let db;
            try {
                db = JSON.parse(readFileSync(FILE_EDITS_DB, 'utf-8'));
            } catch {
                db = null;
            }

            if (db?.files) {
                let changed = false;

                for (const [filePath, fileData] of Object.entries(db.files)) {
                    // Remove file entries whose lastEdit is older than maxAgeDays
                    if (fileData.lastEdit && new Date(fileData.lastEdit).getTime() < cutoff) {
                        delete db.files[filePath];
                        changed = true;
                        continue;
                    }

                    // Within each file, prune sessions with only old edits
                    if (fileData.sessions) {
                        for (const [sessionId, sessionData] of Object.entries(fileData.sessions)) {
                            if (sessionData.edits) {
                                sessionData.edits = sessionData.edits.filter(
                                    e => !e.timestamp || new Date(e.timestamp).getTime() >= cutoff
                                );
                                sessionData.count = sessionData.edits.length;
                            }
                            if (!sessionData.edits || sessionData.edits.length === 0) {
                                delete fileData.sessions[sessionId];
                                changed = true;
                            }
                        }
                        // If no sessions remain, remove the file entry
                        if (Object.keys(fileData.sessions).length === 0) {
                            delete db.files[filePath];
                            changed = true;
                            continue;
                        }
                    }

                    // Recompute editCount from remaining edits
                    const totalEdits = Object.values(fileData.sessions || {})
                        .reduce((sum, s) => sum + (s.count || 0), 0);
                    if (totalEdits !== fileData.editCount) {
                        fileData.editCount = totalEdits;
                        changed = true;
                    }
                }

                // Enforce maxEntries: if total file entries exceed limit, drop oldest
                const fileKeys = Object.keys(db.files);
                if (fileKeys.length > maxEntries) {
                    const sorted = fileKeys.sort((a, b) => {
                        const aTime = new Date(db.files[a].lastEdit || 0).getTime();
                        const bTime = new Date(db.files[b].lastEdit || 0).getTime();
                        return aTime - bTime;
                    });
                    const toRemove = sorted.slice(0, fileKeys.length - maxEntries);
                    for (const key of toRemove) {
                        delete db.files[key];
                    }
                    changed = true;
                }

                if (changed) {
                    writeFileSync(FILE_EDITS_DB, JSON.stringify(db, null, 2));
                }
            }
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
        try {
            const logFiles = readdirSync(LOG_DIR).filter(f => f.endsWith('.jsonl'));
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
