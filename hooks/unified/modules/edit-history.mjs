/**
 * Edit History Module
 * 
 * Detects when files are being edited multiple times and provides
 * context about previous edits to help Claude understand the history.
 */

import { readFileEditsDb } from './rolling-log.mjs';

/**
 * Check if prompt mentions a file that has edit history
 * Returns warning/context if file has been edited before
 */
export async function checkEditHistory(event, config) {
    try {
        const { session_id, prompt } = event;

        if (!session_id || !prompt) return null;

        const db = readFileEditsDb();
        if (Object.keys(db.files).length === 0) return null;
        const threshold = config.rolling_log?.summarizeAfterEdits || 2;

        // Extract file paths from prompt (basic heuristic)
        const mentionedFiles = extractFilePaths(prompt);
        
        const warnings = [];

        for (const filePath of mentionedFiles) {
            const fileData = db.files[filePath];
            if (!fileData) continue;

            const sessionEdits = fileData.sessions[session_id];
            const editCount = sessionEdits?.count || 0;

            // Only warn if edited multiple times
            if (editCount >= threshold) {
                const editSummaries = sessionEdits.edits
                    .map(e => e.summary)
                    .filter(s => s)
                    .slice(-5); // Last 5 summaries

                let warning = `📝 FILE HISTORY: \`${filePath}\` has been edited ${editCount}× this session`;
                
                if (editSummaries.length > 0) {
                    warning += `\nRecent changes:\n${editSummaries.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}`;
                }

                warnings.push(warning);
            }
        }

        // Also check for high-churn files being discussed
        const highChurnWarning = checkHighChurnFiles(db, session_id, mentionedFiles);
        if (highChurnWarning) warnings.push(highChurnWarning);

        return warnings.length > 0 ? warnings.join('\n\n') : null;

    } catch (err) {
        if (process.env.DEBUG) {
            console.error('[EditHistory] Error:', err);
        }
        return null;
    }
}

/**
 * Extract file paths mentioned in prompt
 * Looks for common patterns like `path/file.ext`, path/to/file.ts, etc.
 */
function extractFilePaths(prompt) {
    const paths = new Set();
    
    // Backtick-wrapped paths
    const backtickMatches = prompt.match(/`([^`]+\.[a-zA-Z]{1,4})`/g) || [];
    backtickMatches.forEach(m => paths.add(m.replace(/`/g, '')));

    // Common file path patterns
    const pathPattern = /(?:^|\s|["'`])([a-zA-Z0-9_\-./]+\.[a-zA-Z]{1,4})(?:\s|$|["'`])/g;
    let match;
    while ((match = pathPattern.exec(prompt)) !== null) {
        const p = match[1];
        // Filter out URLs and obvious non-paths
        if (!p.includes('://') && !p.startsWith('.') && p.includes('/')) {
            paths.add(p);
        }
    }

    return Array.from(paths);
}

/**
 * Check for files that have been edited many times across sessions
 * These might indicate problematic code that keeps needing fixes
 */
function checkHighChurnFiles(db, sessionId, mentionedFiles) {
    const highChurn = [];
    
    for (const filePath of mentionedFiles) {
        const fileData = db.files[filePath];
        if (!fileData) continue;

        // If file has been edited in multiple sessions, it might be problematic
        const sessionCount = Object.keys(fileData.sessions).length;
        const totalEdits = fileData.editCount;

        if (totalEdits >= 10 && sessionCount >= 3) {
            highChurn.push(`${filePath} (${totalEdits} edits across ${sessionCount} sessions)`);
        }
    }

    if (highChurn.length > 0) {
        return `⚠️ HIGH CHURN FILES (may need architectural attention):\n${highChurn.map(f => `  • ${f}`).join('\n')}`;
    }

    return null;
}

/**
 * Get detailed history for a specific file (used by MCP tools)
 */
export function getDetailedFileHistory(filePath, options = {}) {
    try {
        const db = readFileEditsDb();
        const fileData = db.files[filePath];

        if (!fileData) return null;

        const result = {
            filePath,
            totalEdits: fileData.editCount,
            firstEdit: fileData.firstEdit,
            lastEdit: fileData.lastEdit,
            sessionCount: Object.keys(fileData.sessions).length,
            sessions: {}
        };

        // Optionally include session details
        if (options.includeSessions) {
            for (const [sid, data] of Object.entries(fileData.sessions)) {
                result.sessions[sid] = {
                    editCount: data.count,
                    edits: data.edits.map(e => ({
                        timestamp: e.timestamp,
                        summary: e.summary || '(no summary)'
                    }))
                };
            }
        }

        return result;

    } catch (e) {
        return null;
    }
}
