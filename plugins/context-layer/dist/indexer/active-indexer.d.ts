/**
 * Active Indexer with Lazy Initialization
 *
 * Provides background indexing for projects with intelligent caching and
 * lazy initialization. Only re-indexes when project content has changed
 * or sufficient time has passed.
 */
export interface IndexState {
    /** Timestamp of last indexing (ISO string) */
    lastIndexed: string;
    /** Number of files indexed */
    filesIndexed: number;
    /** Hash of project structure for change detection */
    projectHash: string;
    /** Version of indexer (for invalidation on upgrades) */
    indexerVersion: string;
    /** Key files that were prioritized */
    keyFilesIndexed: string[];
    /** Whether indexing is currently in progress */
    inProgress: boolean;
}
export interface IndexOptions {
    /** Force re-index even if cache is valid */
    force?: boolean;
    /** Maximum age before re-index (default: 24 hours) */
    maxAgeHours?: number;
    /** Maximum file size to index in bytes (default: 500KB) */
    maxFileSizeBytes?: number;
    /** Run indexing in background (non-blocking) */
    background?: boolean;
    /** Callback for progress updates */
    onProgress?: (indexed: number, total: number) => void;
}
export interface IndexResult {
    /** Whether indexing was triggered */
    triggered: boolean;
    /** Reason for decision */
    reason: string;
    /** Number of files indexed (if triggered) */
    filesIndexed?: number;
    /** Time taken in ms (if triggered) */
    durationMs?: number;
    /** Any errors encountered */
    errors?: string[];
}
/**
 * Load the current index state for a project
 */
export declare function loadIndexState(projectPath: string): IndexState | null;
/**
 * Save index state for a project
 */
export declare function saveIndexState(projectPath: string, state: IndexState): void;
/**
 * Trigger active indexing for a project.
 *
 * This checks if indexing is needed based on:
 * 1. Whether an index exists
 * 2. How old the existing index is
 * 3. Whether the project structure has changed
 *
 * @param projectPath - Path to the project root
 * @param options - Indexing options
 * @returns Result of the indexing operation
 */
export declare function triggerActiveIndex(projectPath: string, options?: IndexOptions): Promise<IndexResult>;
/**
 * Check if indexing is needed without triggering it
 */
export declare function shouldIndex(projectPath: string, options?: IndexOptions): {
    needed: boolean;
    reason: string;
};
/**
 * Get the current index status for a project
 */
export declare function getIndexStatus(projectPath: string): {
    indexed: boolean;
    state: IndexState | null;
    age: number | null;
};
/**
 * Clear the index state for a project (forces re-indexing on next trigger)
 */
export declare function clearIndexState(projectPath: string): void;
//# sourceMappingURL=active-indexer.d.ts.map