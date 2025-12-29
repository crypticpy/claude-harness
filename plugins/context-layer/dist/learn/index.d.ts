/**
 * Learn Module
 *
 * Auto-learning capabilities for the context layer.
 */
export { recordFileAccess, getAccessStats, cleanupAccessLog, } from './file-tracker';
export { withFileLock, withFileLockSync, isFileLocked, isFileLockedSync, forceUnlock, forceUnlockSync, type LockOptions, } from './file-lock';
export { recordAccess, startSession, endSession, getDetectedPatterns, getFileStats, clearPatternState, getHotFilesFromPatterns, type AccessEvent, type PatternResult, type PatternType, } from './pattern-detector';
//# sourceMappingURL=index.d.ts.map