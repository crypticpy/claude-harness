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

import * as lockfile from "proper-lockfile";
import * as fs from "fs";
import * as path from "path";

// =============================================================================
// Types
// =============================================================================

export interface LockOptions {
  /** Max retry attempts (default: 3) */
  retries?: number;
  /** Base delay between retries in ms (default: 100) */
  retryDelay?: number;
  /** Consider lock stale after ms (default: 10000) */
  stale?: number;
}

interface LockfileOptions {
  retries: {
    retries: number;
    minTimeout: number;
    maxTimeout: number;
    factor: number;
  };
  stale: number;
  realpath: boolean;
}

// =============================================================================
// Configuration
// =============================================================================

const DEFAULT_OPTIONS: Required<LockOptions> = {
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
function buildLockfileOptions(options?: LockOptions): LockfileOptions {
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
function ensureDirectoryExists(filePath: string): string {
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
function logWarning(message: string): void {
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
export async function withFileLock<T>(
  filePath: string,
  fn: () => Promise<T> | T,
  options?: LockOptions,
): Promise<T> {
  const lockDir = ensureDirectoryExists(filePath);
  const lockOptions = buildLockfileOptions(options);

  let release: (() => Promise<void>) | null = null;
  let lockAcquired = false;

  try {
    // Attempt to acquire lock
    release = await lockfile.lock(lockDir, lockOptions);
    lockAcquired = true;
  } catch (error) {
    // Lock acquisition failed - log warning and proceed anyway
    const errorMessage = error instanceof Error ? error.message : String(error);
    logWarning(
      `Failed to acquire lock for ${filePath}: ${errorMessage}. Proceeding without lock.`,
    );
  }

  try {
    // Execute the function
    return await fn();
  } finally {
    // Release lock if we acquired it
    if (lockAcquired && release) {
      try {
        await release();
      } catch (releaseError) {
        const errorMessage =
          releaseError instanceof Error
            ? releaseError.message
            : String(releaseError);
        logWarning(`Failed to release lock for ${filePath}: ${errorMessage}`);
      }
    }
  }
}

/**
 * Block the current thread for `ms` milliseconds (no event loop required).
 */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Synchronous version of withFileLock.
 *
 * Acquires a lock, executes a function, and releases the lock.
 * If lock acquisition fails, proceeds with a warning (graceful degradation).
 *
 * proper-lockfile's sync API rejects any `retries` option, so retries are
 * implemented here as a manual loop: each attempt calls lockSync with
 * retries disabled, sleeping with exponential backoff between attempts.
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
export function withFileLockSync<T>(
  filePath: string,
  fn: () => T,
  options?: LockOptions,
): T {
  const lockDir = ensureDirectoryExists(filePath);
  const opts = { ...DEFAULT_OPTIONS, ...options };

  let release: (() => void) | null = null;
  let lockAcquired = false;

  for (let attempt = 0; attempt <= opts.retries && !lockAcquired; attempt++) {
    try {
      release = lockfile.lockSync(lockDir, {
        stale: opts.stale,
        realpath: false,
      });
      lockAcquired = true;
    } catch (error) {
      if (attempt < opts.retries) {
        sleepSync(opts.retryDelay * Math.pow(2, attempt)); // 100, 200, 400
      } else {
        // Lock acquisition failed - log warning and proceed anyway
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logWarning(
          `Failed to acquire lock for ${filePath}: ${errorMessage}. Proceeding without lock.`,
        );
      }
    }
  }

  try {
    // Execute the function
    return fn();
  } finally {
    // Release lock if we acquired it
    if (lockAcquired && release) {
      try {
        release();
      } catch (releaseError) {
        const errorMessage =
          releaseError instanceof Error
            ? releaseError.message
            : String(releaseError);
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
export async function isFileLocked(filePath: string): Promise<boolean> {
  const lockDir = path.dirname(filePath);

  if (!fs.existsSync(lockDir)) {
    return false;
  }

  try {
    return await lockfile.check(lockDir, { realpath: false });
  } catch {
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
export function isFileLockedSync(filePath: string): boolean {
  const lockDir = path.dirname(filePath);

  if (!fs.existsSync(lockDir)) {
    return false;
  }

  try {
    return lockfile.checkSync(lockDir, { realpath: false });
  } catch {
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
export async function forceUnlock(filePath: string): Promise<void> {
  const lockDir = path.dirname(filePath);

  if (!fs.existsSync(lockDir)) {
    return;
  }

  try {
    await lockfile.unlock(lockDir, { realpath: false });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logWarning(`Failed to force unlock ${filePath}: ${errorMessage}`);
  }
}

/**
 * Synchronous version of forceUnlock.
 *
 * @param filePath - Path to the file to unlock
 */
export function forceUnlockSync(filePath: string): void {
  const lockDir = path.dirname(filePath);

  if (!fs.existsSync(lockDir)) {
    return;
  }

  try {
    lockfile.unlockSync(lockDir, { realpath: false });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logWarning(`Failed to force unlock ${filePath}: ${errorMessage}`);
  }
}
