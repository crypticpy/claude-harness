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
/**
 * Represents a file access record within a session
 */
interface FileAccessRecord {
    /** Relative path to the file */
    path: string;
    /** Number of times this file was accessed in the session */
    accessCount: number;
    /** Timestamp of last access */
    lastAccessed: number;
}
/**
 * Represents a lesson learned during the session
 */
interface LessonRecord {
    /** When the lesson was recorded */
    timestamp: number;
    /** The lesson content */
    lesson: string;
    /** Severity: low, medium, high */
    severity: string;
}
/**
 * Represents tool usage statistics
 */
interface ToolUsageRecord {
    /** Tool name */
    tool: string;
    /** Number of times used */
    count: number;
}
/**
 * Complete session state interface
 */
export interface SessionState {
    /** Unique identifier for this session */
    sessionId: string;
    /** Original project path where session started */
    originalProjectPath: string;
    /** Session start timestamp */
    startTime: number;
    /** Last activity timestamp */
    lastActivity: number;
    /** Files accessed during this session */
    filesAccessed: FileAccessRecord[];
    /** Lessons learned during this session */
    lessonsLearned: LessonRecord[];
    /** Tools used during this session */
    toolsUsed: ToolUsageRecord[];
    /** Summary of what the user was working on */
    workingSummary?: string;
}
/**
 * Get the brain directory path for a project.
 * The brain directory stores all context-layer persistent data.
 *
 * @param projectPath - The root path of the project
 * @returns The path to the .claude/context-layer directory
 */
export declare function getBrainDir(projectPath: string): string;
/**
 * Save session state to disk.
 * Creates the brain directory if it doesn't exist.
 *
 * @param projectPath - The root path of the project
 * @param state - The session state to save
 */
export declare function saveSessionState(projectPath: string, state: SessionState): void;
/**
 * Load session state from disk.
 * Returns null if no state exists, state is corrupted, or sessionId doesn't match.
 *
 * @param projectPath - The root path of the project
 * @param sessionId - The session ID to match against
 * @returns The loaded session state, or null if not found/invalid
 */
export declare function loadSessionState(projectPath: string, sessionId: string): SessionState | null;
/**
 * Update session state with partial updates.
 * Merges the updates into the existing state and saves.
 * If no existing state is found, creates a new one.
 *
 * @param projectPath - The root path of the project
 * @param sessionId - The session ID
 * @param updates - Partial updates to merge into the state
 */
export declare function updateSessionState(projectPath: string, sessionId: string, updates: Partial<SessionState>): void;
/**
 * Clear (remove) the session state file.
 * Only clears if the sessionId matches the stored state.
 *
 * @param projectPath - The root path of the project
 * @param sessionId - The session ID to verify before clearing
 */
export declare function clearSessionState(projectPath: string, sessionId: string): void;
/**
 * Record a file access in the session state.
 * Increments the access count if the file was already accessed,
 * otherwise adds a new entry.
 *
 * @param projectPath - The root path of the project
 * @param sessionId - The session ID
 * @param filePath - The path to the file being accessed
 */
export declare function recordFileAccess(projectPath: string, sessionId: string, filePath: string): void;
/**
 * Record tool usage in the session state.
 * Increments the usage count if the tool was already used,
 * otherwise adds a new entry.
 *
 * @param projectPath - The root path of the project
 * @param sessionId - The session ID
 * @param toolName - The name of the tool being used
 */
export declare function recordToolUsage(projectPath: string, sessionId: string, toolName: string): void;
/**
 * Add a lesson learned to the session state.
 *
 * @param projectPath - The root path of the project
 * @param sessionId - The session ID
 * @param lesson - The lesson content
 * @param severity - Severity level: 'low', 'medium', or 'high'
 */
export declare function recordLesson(projectPath: string, sessionId: string, lesson: string, severity?: string): void;
/**
 * Generate a human-readable summary of what was worked on during the session.
 * Analyzes file access patterns and tool usage to infer the work context.
 *
 * @param state - The session state to summarize
 * @returns A descriptive summary of the session's work
 */
export declare function generateWorkingSummary(state: SessionState): string;
/**
 * Set the working summary for a session.
 * This can be called to explicitly set what the user is working on.
 *
 * @param projectPath - The root path of the project
 * @param sessionId - The session ID
 * @param summary - The summary of current work
 */
export declare function setWorkingSummary(projectPath: string, sessionId: string, summary: string): void;
/**
 * Get a quick status of the session state.
 * Useful for diagnostics and checking if state exists.
 *
 * @param projectPath - The root path of the project
 * @param sessionId - The session ID
 * @returns Status object with key metrics
 */
export declare function getSessionStatus(projectPath: string, sessionId: string): {
    exists: boolean;
    filesCount: number;
    toolsCount: number;
    lessonsCount: number;
    durationMinutes: number;
    hasWorkingSummary: boolean;
};
export {};
//# sourceMappingURL=session-state.d.ts.map