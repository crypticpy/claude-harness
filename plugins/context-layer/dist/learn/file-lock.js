"use strict";
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
exports.withFileLock = withFileLock;
exports.withFileLockSync = withFileLockSync;
exports.isFileLocked = isFileLocked;
exports.isFileLockedSync = isFileLockedSync;
exports.forceUnlock = forceUnlock;
exports.forceUnlockSync = forceUnlockSync;
const lockfile = __importStar(require("proper-lockfile"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// =============================================================================
// Configuration
// =============================================================================
const DEFAULT_OPTIONS = {
    retries: 3,
    retryDelay: 100,
    stale: 10000,
};
// =============================================================================
// Internal Helpers
// =============================================================================
/**
 * Build proper-lockfile options from our simplified options
 */
function buildLockfileOptions(options) {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    return {
        retries: {
            retries: opts.retries,
            minTimeout: opts.retryDelay,
            maxTimeout: opts.retryDelay * Math.pow(2, opts.retries), // Exponential: 100, 200, 400
            factor: 2, // Exponential backoff factor
        },
        stale: opts.stale,
        realpath: false, // Don't resolve symlinks
    };
}
/**
 * Ensure the directory exists before attempting to lock
 */
function ensureDirectoryExists(filePath) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    // We lock the directory, not the file itself
    // This handles atomic file operations better
    return dir;
}
/**
 * Log a warning message (non-blocking)
 */
function logWarning(message) {
    // Use stderr to avoid polluting tool output
    console.error(`[context-layer/file-lock] WARNING: ${message}`);
}
// =============================================================================
// Public API
// =============================================================================
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
async function withFileLock(filePath, fn, options) {
    const lockDir = ensureDirectoryExists(filePath);
    const lockOptions = buildLockfileOptions(options);
    let release = null;
    let lockAcquired = false;
    try {
        // Attempt to acquire lock
        release = await lockfile.lock(lockDir, lockOptions);
        lockAcquired = true;
    }
    catch (error) {
        // Lock acquisition failed - log warning and proceed anyway
        const errorMessage = error instanceof Error ? error.message : String(error);
        logWarning(`Failed to acquire lock for ${filePath}: ${errorMessage}. Proceeding without lock.`);
    }
    try {
        // Execute the function
        return await fn();
    }
    finally {
        // Release lock if we acquired it
        if (lockAcquired && release) {
            try {
                await release();
            }
            catch (releaseError) {
                const errorMessage = releaseError instanceof Error ? releaseError.message : String(releaseError);
                logWarning(`Failed to release lock for ${filePath}: ${errorMessage}`);
            }
        }
    }
}
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
function withFileLockSync(filePath, fn, options) {
    const lockDir = ensureDirectoryExists(filePath);
    const lockOptions = buildLockfileOptions(options);
    let release = null;
    let lockAcquired = false;
    try {
        // Attempt to acquire lock synchronously
        release = lockfile.lockSync(lockDir, lockOptions);
        lockAcquired = true;
    }
    catch (error) {
        // Lock acquisition failed - log warning and proceed anyway
        const errorMessage = error instanceof Error ? error.message : String(error);
        logWarning(`Failed to acquire lock for ${filePath}: ${errorMessage}. Proceeding without lock.`);
    }
    try {
        // Execute the function
        return fn();
    }
    finally {
        // Release lock if we acquired it
        if (lockAcquired && release) {
            try {
                release();
            }
            catch (releaseError) {
                const errorMessage = releaseError instanceof Error ? releaseError.message : String(releaseError);
                logWarning(`Failed to release lock for ${filePath}: ${errorMessage}`);
            }
        }
    }
}
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
async function isFileLocked(filePath) {
    const lockDir = path.dirname(filePath);
    if (!fs.existsSync(lockDir)) {
        return false;
    }
    try {
        return await lockfile.check(lockDir, { realpath: false });
    }
    catch {
        // If check fails, assume not locked
        return false;
    }
}
/**
 * Synchronous version of isFileLocked.
 *
 * @param filePath - Path to the file to check
 * @returns True if locked, false otherwise
 */
function isFileLockedSync(filePath) {
    const lockDir = path.dirname(filePath);
    if (!fs.existsSync(lockDir)) {
        return false;
    }
    try {
        return lockfile.checkSync(lockDir, { realpath: false });
    }
    catch {
        // If check fails, assume not locked
        return false;
    }
}
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
async function forceUnlock(filePath) {
    const lockDir = path.dirname(filePath);
    if (!fs.existsSync(lockDir)) {
        return;
    }
    try {
        await lockfile.unlock(lockDir, { realpath: false });
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logWarning(`Failed to force unlock ${filePath}: ${errorMessage}`);
    }
}
/**
 * Synchronous version of forceUnlock.
 *
 * @param filePath - Path to the file to unlock
 */
function forceUnlockSync(filePath) {
    const lockDir = path.dirname(filePath);
    if (!fs.existsSync(lockDir)) {
        return;
    }
    try {
        lockfile.unlockSync(lockDir, { realpath: false });
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logWarning(`Failed to force unlock ${filePath}: ${errorMessage}`);
    }
}
//# sourceMappingURL=file-lock.js.map