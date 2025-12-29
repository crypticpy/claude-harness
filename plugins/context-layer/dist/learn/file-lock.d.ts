/**
 * File Locking Utility for Brain Files
 *
 * Provides cross-process file locking to prevent concurrent write corruption
 * when multiple Claude Code instances access the same project brain.
 *
 * Uses proper-lockfile for cross-process locks with:
 * - Directory-based locking (handles atomic file operations)
 * - Exponential backoff for retries
 * - Stale lock detection and recovery
 * - Graceful degradation on lock failures
 */
export interface LockOptions {
    /** Max retry attempts (default: 3) */
    retries?: number;
    /** Base delay between retries in ms (default: 100) */
    retryDelay?: number;
    /** Consider lock stale after ms (default: 10000) */
    stale?: number;
}
/**
 * Acquire a lock, execute a function, and release the lock.
 *
 * If lock acquisition fails after all retries, the function is still executed
 * with a warning logged (graceful degradation).
 *
 * @param filePath - Path to the file to lock (locks its parent directory)
 * @param fn - Function to execute while holding the lock
 * @param options - Lock options
 * @returns The result of the function
 *
 * @example
 * ```typescript
 * const data = await withFileLock('/path/to/brain/file.json', async () => {
 *   const content = fs.readFileSync('/path/to/brain/file.json', 'utf-8');
 *   const parsed = JSON.parse(content);
 *   parsed.updated = Date.now();
 *   fs.writeFileSync('/path/to/brain/file.json', JSON.stringify(parsed));
 *   return parsed;
 * });
 * ```
 */
export declare function withFileLock<T>(filePath: string, fn: () => Promise<T> | T, options?: LockOptions): Promise<T>;
/**
 * Synchronous version of withFileLock.
 *
 * Acquires a lock, executes a function, and releases the lock.
 * If lock acquisition fails, proceeds with a warning (graceful degradation).
 *
 * @param filePath - Path to the file to lock (locks its parent directory)
 * @param fn - Function to execute while holding the lock
 * @param options - Lock options
 * @returns The result of the function
 *
 * @example
 * ```typescript
 * const data = withFileLockSync('/path/to/brain/file.json', () => {
 *   const content = fs.readFileSync('/path/to/brain/file.json', 'utf-8');
 *   return JSON.parse(content);
 * });
 * ```
 */
export declare function withFileLockSync<T>(filePath: string, fn: () => T, options?: LockOptions): T;
/**
 * Check if a file (or its parent directory) is currently locked.
 *
 * @param filePath - Path to the file to check
 * @returns True if locked, false otherwise
 *
 * @example
 * ```typescript
 * if (await isFileLocked('/path/to/brain/file.json')) {
 *   console.log('Another process is accessing this file');
 * }
 * ```
 */
export declare function isFileLocked(filePath: string): Promise<boolean>;
/**
 * Synchronous version of isFileLocked.
 *
 * @param filePath - Path to the file to check
 * @returns True if locked, false otherwise
 */
export declare function isFileLockedSync(filePath: string): boolean;
/**
 * Force unlock a file's parent directory.
 *
 * Use this for recovery from stale locks left by crashed processes.
 * Should be used sparingly and only when certain no other process holds the lock.
 *
 * @param filePath - Path to the file to unlock
 *
 * @example
 * ```typescript
 * // Recovery from stale lock
 * if (await isFileLocked('/path/to/brain/file.json')) {
 *   await forceUnlock('/path/to/brain/file.json');
 * }
 * ```
 */
export declare function forceUnlock(filePath: string): Promise<void>;
/**
 * Synchronous version of forceUnlock.
 *
 * @param filePath - Path to the file to unlock
 */
export declare function forceUnlockSync(filePath: string): void;
//# sourceMappingURL=file-lock.d.ts.map