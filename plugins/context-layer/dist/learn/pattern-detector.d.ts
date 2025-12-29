/**
 * Pattern Detector for Auto-Learning
 *
 * Detects patterns from tool usage and file access that should become lessons.
 * Identifies debugging sessions, refactoring patterns, hot paths, and conventions.
 */
export interface AccessEvent {
    filePath: string;
    toolUsed: string;
    timestamp: number;
    sessionId?: string;
}
export interface PatternResult {
    type: PatternType;
    confidence: 'low' | 'medium' | 'high';
    description: string;
    suggestedLesson?: string;
    files?: string[];
    metadata?: Record<string, unknown>;
}
export type PatternType = 'debugging-session' | 'refactoring-pattern' | 'hot-path' | 'naming-convention' | 'directory-pattern' | 'error-prone-file';
interface FileAccessStats {
    totalAccesses: number;
    sessionsAccessed: Set<string>;
    recentAccesses: AccessEvent[];
    lastAccessed: number;
}
/**
 * Start or continue a session for pattern tracking
 */
export declare function startSession(projectPath: string, sessionId: string): void;
/**
 * End the current session and analyze patterns
 */
export declare function endSession(projectPath: string): PatternResult[];
/**
 * Record a file access event for pattern detection
 */
export declare function recordAccess(projectPath: string, event: AccessEvent): PatternResult[];
/**
 * Get all detected patterns for a project
 */
export declare function getDetectedPatterns(projectPath: string): PatternResult[];
/**
 * Get file access statistics for a project
 */
export declare function getFileStats(projectPath: string): Map<string, FileAccessStats>;
/**
 * Clear pattern detection state for a project
 */
export declare function clearPatternState(projectPath: string): void;
/**
 * Get hot files based on pattern detection
 * Returns files that have been accessed across multiple sessions
 */
export declare function getHotFilesFromPatterns(projectPath: string): Array<{
    path: string;
    sessionCount: number;
    totalAccesses: number;
    reason: string;
}>;
export {};
//# sourceMappingURL=pattern-detector.d.ts.map