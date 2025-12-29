"use strict";
/**
 * Session State Management for Context-Layer
 *
 * Provides persistent session state tracking across compaction events.
 * This allows the context-layer to remember what files were accessed,
 * what tools were used, and what the user was working on - even after
 * context compaction forces a memory reset.
 *
 * Key insight: Session state enables continuity across compaction boundaries,
 * allowing Claude to pick up where it left off with relevant context.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBrainDir = getBrainDir;
exports.saveSessionState = saveSessionState;
exports.loadSessionState = loadSessionState;
exports.updateSessionState = updateSessionState;
exports.clearSessionState = clearSessionState;
exports.recordFileAccess = recordFileAccess;
exports.recordToolUsage = recordToolUsage;
exports.recordLesson = recordLesson;
exports.generateWorkingSummary = generateWorkingSummary;
exports.setWorkingSummary = setWorkingSummary;
exports.getSessionStatus = getSessionStatus;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const file_lock_1 = require("../learn/file-lock");
// =============================================================================
// Configuration
// =============================================================================
const SESSION_STATE_FILE = 'session-state.json';
// =============================================================================
// Core Functions
// =============================================================================
/**
 * Get the brain directory path for a project.
 * The brain directory stores all context-layer persistent data.
 *
 * @param projectPath - The root path of the project
 * @returns The path to the .claude/context-layer directory
 */
function getBrainDir(projectPath) {
    return path.join(projectPath, '.claude', 'context-layer');
}
/**
 * Get the full path to the session state file
 */
function getSessionStatePath(projectPath) {
    return path.join(getBrainDir(projectPath), SESSION_STATE_FILE);
}
/**
 * Ensure the brain directory exists
 */
function ensureBrainDir(projectPath) {
    const brainDir = getBrainDir(projectPath);
    try {
        fs.mkdirSync(brainDir, { recursive: true });
    }
    catch {
        // Directory may already exist or creation may fail - non-critical
    }
}
/**
 * Create a fresh session state object
 */
function createFreshState(projectPath, sessionId) {
    const now = Date.now();
    return {
        sessionId,
        originalProjectPath: projectPath,
        startTime: now,
        lastActivity: now,
        filesAccessed: [],
        lessonsLearned: [],
        toolsUsed: [],
    };
}
// =============================================================================
// Public API
// =============================================================================
/**
 * Save session state to disk.
 * Creates the brain directory if it doesn't exist.
 *
 * @param projectPath - The root path of the project
 * @param state - The session state to save
 */
function saveSessionState(projectPath, state) {
    ensureBrainDir(projectPath);
    const statePath = getSessionStatePath(projectPath);
    try {
        state.lastActivity = Date.now();
        fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
    }
    catch {
        // Non-critical: session state is advisory, not essential
    }
}
/**
 * Load session state from disk.
 * Returns null if no state exists, state is corrupted, or sessionId doesn't match.
 *
 * @param projectPath - The root path of the project
 * @param sessionId - The session ID to match against
 * @returns The loaded session state, or null if not found/invalid
 */
function loadSessionState(projectPath, sessionId) {
    const statePath = getSessionStatePath(projectPath);
    try {
        if (!fs.existsSync(statePath)) {
            return null;
        }
        const data = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
        // Validate the session ID matches
        if (data.sessionId !== sessionId) {
            return null;
        }
        return data;
    }
    catch {
        // Corrupted or unreadable - return null to start fresh
        return null;
    }
}
/**
 * Update session state with partial updates.
 * Merges the updates into the existing state and saves.
 * If no existing state is found, creates a new one.
 *
 * @param projectPath - The root path of the project
 * @param sessionId - The session ID
 * @param updates - Partial updates to merge into the state
 */
function updateSessionState(projectPath, sessionId, updates) {
    let state = loadSessionState(projectPath, sessionId);
    if (!state) {
        // Create fresh state if none exists
        state = createFreshState(projectPath, sessionId);
    }
    // Merge updates (shallow merge for top-level properties)
    const updatedState = {
        ...state,
        ...updates,
        // Preserve these critical fields
        sessionId: state.sessionId,
        originalProjectPath: state.originalProjectPath,
        startTime: state.startTime,
        lastActivity: Date.now(),
    };
    saveSessionState(projectPath, updatedState);
}
/**
 * Clear (remove) the session state file.
 * Only clears if the sessionId matches the stored state.
 *
 * @param projectPath - The root path of the project
 * @param sessionId - The session ID to verify before clearing
 */
function clearSessionState(projectPath, sessionId) {
    const statePath = getSessionStatePath(projectPath);
    try {
        // Only clear if the session ID matches
        const existingState = loadSessionState(projectPath, sessionId);
        if (existingState && existingState.sessionId === sessionId) {
            fs.unlinkSync(statePath);
        }
    }
    catch {
        // File may not exist or deletion may fail - non-critical
    }
}
/**
 * Record a file access in the session state.
 * Increments the access count if the file was already accessed,
 * otherwise adds a new entry.
 *
 * @param projectPath - The root path of the project
 * @param sessionId - The session ID
 * @param filePath - The path to the file being accessed
 */
function recordFileAccess(projectPath, sessionId, filePath) {
    // Use file locking to prevent race conditions with concurrent tool calls
    const statePath = getSessionStatePath(projectPath);
    (0, file_lock_1.withFileLockSync)(statePath, () => {
        let state = loadSessionState(projectPath, sessionId);
        if (!state) {
            state = createFreshState(projectPath, sessionId);
        }
        // Normalize path to be relative
        const relativePath = path.isAbsolute(filePath)
            ? path.relative(projectPath, filePath)
            : filePath;
        // Skip external files (outside project)
        if (relativePath.startsWith('..')) {
            return;
        }
        const now = Date.now();
        const existingIndex = state.filesAccessed.findIndex(f => f.path === relativePath);
        if (existingIndex >= 0) {
            // Update existing entry
            state.filesAccessed[existingIndex].accessCount++;
            state.filesAccessed[existingIndex].lastAccessed = now;
        }
        else {
            // Add new entry
            state.filesAccessed.push({
                path: relativePath,
                accessCount: 1,
                lastAccessed: now,
            });
        }
        saveSessionState(projectPath, state);
    });
}
/**
 * Record tool usage in the session state.
 * Increments the usage count if the tool was already used,
 * otherwise adds a new entry.
 *
 * @param projectPath - The root path of the project
 * @param sessionId - The session ID
 * @param toolName - The name of the tool being used
 */
function recordToolUsage(projectPath, sessionId, toolName) {
    // Use file locking to prevent race conditions with concurrent tool calls
    const statePath = getSessionStatePath(projectPath);
    (0, file_lock_1.withFileLockSync)(statePath, () => {
        let state = loadSessionState(projectPath, sessionId);
        if (!state) {
            state = createFreshState(projectPath, sessionId);
        }
        const existingIndex = state.toolsUsed.findIndex(t => t.tool === toolName);
        if (existingIndex >= 0) {
            // Update existing entry
            state.toolsUsed[existingIndex].count++;
        }
        else {
            // Add new entry
            state.toolsUsed.push({
                tool: toolName,
                count: 1,
            });
        }
        saveSessionState(projectPath, state);
    });
}
/**
 * Add a lesson learned to the session state.
 *
 * @param projectPath - The root path of the project
 * @param sessionId - The session ID
 * @param lesson - The lesson content
 * @param severity - Severity level: 'low', 'medium', or 'high'
 */
function recordLesson(projectPath, sessionId, lesson, severity = 'medium') {
    // Use file locking to prevent race conditions with concurrent tool calls
    const statePath = getSessionStatePath(projectPath);
    (0, file_lock_1.withFileLockSync)(statePath, () => {
        let state = loadSessionState(projectPath, sessionId);
        if (!state) {
            state = createFreshState(projectPath, sessionId);
        }
        state.lessonsLearned.push({
            timestamp: Date.now(),
            lesson,
            severity,
        });
        saveSessionState(projectPath, state);
    });
}
/**
 * Generate a human-readable summary of what was worked on during the session.
 * Analyzes file access patterns and tool usage to infer the work context.
 *
 * @param state - The session state to summarize
 * @returns A descriptive summary of the session's work
 */
function generateWorkingSummary(state) {
    const parts = [];
    // Session duration
    const durationMs = state.lastActivity - state.startTime;
    const durationMins = Math.round(durationMs / 60000);
    if (durationMins > 0) {
        parts.push(`Session duration: ${durationMins} minute${durationMins !== 1 ? 's' : ''}`);
    }
    // Most accessed files
    if (state.filesAccessed.length > 0) {
        const sortedFiles = [...state.filesAccessed]
            .sort((a, b) => b.accessCount - a.accessCount)
            .slice(0, 5);
        const fileList = sortedFiles
            .map(f => `${f.path} (${f.accessCount}x)`)
            .join(', ');
        parts.push(`Key files: ${fileList}`);
        // Infer file types/domains
        const extensions = new Set(state.filesAccessed
            .map(f => path.extname(f.path).toLowerCase())
            .filter(ext => ext.length > 0));
        if (extensions.size > 0) {
            const extList = Array.from(extensions).join(', ');
            parts.push(`File types: ${extList}`);
        }
        // Infer directories worked in
        const directories = new Set(state.filesAccessed
            .map(f => path.dirname(f.path))
            .filter(d => d !== '.' && d.length > 0));
        if (directories.size > 0 && directories.size <= 5) {
            const dirList = Array.from(directories).slice(0, 3).join(', ');
            parts.push(`Directories: ${dirList}`);
        }
    }
    // Tool usage summary
    if (state.toolsUsed.length > 0) {
        const sortedTools = [...state.toolsUsed]
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);
        const toolList = sortedTools
            .map(t => `${t.tool} (${t.count}x)`)
            .join(', ');
        parts.push(`Tools used: ${toolList}`);
    }
    // Lessons learned count
    if (state.lessonsLearned.length > 0) {
        const highSeverity = state.lessonsLearned.filter(l => l.severity === 'high').length;
        if (highSeverity > 0) {
            parts.push(`Important lessons: ${highSeverity}`);
        }
        parts.push(`Total lessons: ${state.lessonsLearned.length}`);
    }
    // Combine into summary
    if (parts.length === 0) {
        return 'Session started but no significant activity recorded yet.';
    }
    return parts.join('\n');
}
/**
 * Set the working summary for a session.
 * This can be called to explicitly set what the user is working on.
 *
 * @param projectPath - The root path of the project
 * @param sessionId - The session ID
 * @param summary - The summary of current work
 */
function setWorkingSummary(projectPath, sessionId, summary) {
    updateSessionState(projectPath, sessionId, { workingSummary: summary });
}
/**
 * Get a quick status of the session state.
 * Useful for diagnostics and checking if state exists.
 *
 * @param projectPath - The root path of the project
 * @param sessionId - The session ID
 * @returns Status object with key metrics
 */
function getSessionStatus(projectPath, sessionId) {
    const state = loadSessionState(projectPath, sessionId);
    if (!state) {
        return {
            exists: false,
            filesCount: 0,
            toolsCount: 0,
            lessonsCount: 0,
            durationMinutes: 0,
            hasWorkingSummary: false,
        };
    }
    const durationMs = state.lastActivity - state.startTime;
    return {
        exists: true,
        filesCount: state.filesAccessed.length,
        toolsCount: state.toolsUsed.length,
        lessonsCount: state.lessonsLearned.length,
        durationMinutes: Math.round(durationMs / 60000),
        hasWorkingSummary: !!state.workingSummary,
    };
}
//# sourceMappingURL=session-state.js.map