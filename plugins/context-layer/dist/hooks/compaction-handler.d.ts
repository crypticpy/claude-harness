/**
 * Compaction Handler
 *
 * Handles PreCompact and SessionStart events to preserve state across
 * Claude Code's context compaction process.
 *
 * When context approaches the limit (~154K tokens), Claude auto-compacts.
 * This handler saves session state before compaction and restores it after.
 */
export interface PreCompactInput {
    session_id: string;
    transcript_summary?: string;
}
export interface PreCompactOutput {
    continue: boolean;
    result?: string;
}
export interface SessionStartInput {
    session_id: string;
    source?: 'new' | 'resume' | 'compact';
}
export interface PreCompactionSave {
    /** When the save was created */
    savedAt: string;
    /** Session ID */
    sessionId: string;
    /** Files being worked on */
    workingFiles: string[];
    /** Recent tools used */
    recentTools: string[];
    /** Summary of current work */
    workingSummary: string;
    /** Lessons learned this session */
    sessionLessons: string[];
    /** Detected patterns */
    detectedPatterns: string[];
    /** High-priority context to restore */
    recoveryContext: string;
}
/**
 * Handle the PreCompact event.
 *
 * This is called when Claude Code is about to compact the context.
 * We save all relevant state so it can be restored after compaction.
 *
 * Note: According to research, PreCompact output goes to transcript only,
 * NOT injected into post-compaction context. So we rely on file-based
 * state saving and SessionStart recovery.
 */
export declare function handlePreCompact(input: PreCompactInput, projectPath?: string): PreCompactOutput;
/**
 * Check if we're recovering from a recent compaction.
 * Returns recovery context if available and recent enough.
 */
export declare function checkCompactionRecovery(projectPath: string): PreCompactionSave | null;
/**
 * Generate recovery context to inject after compaction.
 */
export declare function generateRecoveryContext(save: PreCompactionSave): string;
/**
 * Clear the pre-compaction save after recovery.
 */
export declare function clearCompactionRecovery(projectPath: string): void;
/**
 * Handle SessionStart event, checking for compaction recovery.
 */
export declare function handleSessionStart(input: SessionStartInput, projectPath?: string): {
    needsRecovery: boolean;
    recoveryContext?: string;
};
//# sourceMappingURL=compaction-handler.d.ts.map