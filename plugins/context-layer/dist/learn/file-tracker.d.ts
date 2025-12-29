/**
 * File Access Tracker for Auto-Learn Mode
 *
 * Tracks file access patterns and auto-promotes frequently accessed files
 * to the hot-files.json list for better context injection.
 *
 * Key insight: Store pre-cached INTELLIGENCE about files, not raw content.
 * This gives Claude the knowledge without consuming full-file tokens.
 */
/**
 * Record a file access from an MCP tool
 *
 * @param projectPath - Project root path
 * @param filePath - Path to the file being accessed (relative to project)
 * @param source - Which tool accessed it (semantic_lookup, impact_check, etc.)
 */
export declare function recordFileAccess(projectPath: string, filePath: string, source: string): void;
/**
 * Get the current access stats for all files
 */
export declare function getAccessStats(projectPath: string): {
    totalFiles: number;
    hotCandidates: Array<{
        path: string;
        count: number;
        effectiveCount: number;
    }>;
    recentlyAccessed: Array<{
        path: string;
        when: string;
    }>;
};
/**
 * Clean up old access records (run periodically)
 */
export declare function cleanupAccessLog(projectPath: string): number;
//# sourceMappingURL=file-tracker.d.ts.map