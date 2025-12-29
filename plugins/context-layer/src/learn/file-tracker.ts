/**
 * File Access Tracker for Auto-Learn Mode
 *
 * Tracks file access patterns and auto-promotes frequently accessed files
 * to the hot-files.json list for better context injection.
 *
 * Key insight: Store pre-cached INTELLIGENCE about files, not raw content.
 * This gives Claude the knowledge without consuming full-file tokens.
 */

import * as fs from 'fs';
import * as path from 'path';
import { semanticLookup, checkImpact } from '../tools';
import { withFileLockSync } from './file-lock';

// =============================================================================
// Types
// =============================================================================

interface FileAccess {
  count: number;
  lastAccessed: number;  // timestamp
  firstAccessed: number; // timestamp
  sources: string[];     // which tools accessed it
}

interface AccessLog {
  version: 1;
  lastUpdated: number;
  files: Record<string, FileAccess>;
}

interface HotFile {
  path: string;
  accessCount: number;
  lastAccessed: string | null;
  reason: string;
  autoLearned?: boolean;
  // Pre-cached intelligence (populated on promotion)
  intelligence?: {
    summary: string;        // What the file does
    exports: string[];      // Public API
    imports: string[];      // Dependencies
    complexity: string;     // low/medium/high
    lineCount: number;
    dependents?: number;    // How many files import this
    cachedAt: number;       // When intelligence was captured
  };
}

interface HotFilesData {
  lastUpdated: string;
  hotFiles: HotFile[];
}

// =============================================================================
// Configuration
// =============================================================================

const ACCESS_LOG_FILE = 'file-access-log.json';
const HOT_FILES_FILE = 'hot-files.json';
const AUTO_PROMOTE_THRESHOLD = 5;  // Access count to auto-promote
const DECAY_DAYS = 7;              // Days until old accesses decay
const DECAY_FACTOR = 0.5;          // Multiplier for decayed accesses
const MAX_AUTO_HOT_FILES = 15;     // Max auto-learned hot files

// =============================================================================
// Core Functions
// =============================================================================

/**
 * Get the brain directory for a project
 */
function getBrainDir(projectPath: string): string {
  return path.join(projectPath, '.claude', 'context-layer');
}

/**
 * Load the access log, creating if needed
 * Uses file locking to prevent concurrent read/write corruption
 */
function loadAccessLog(projectPath: string): AccessLog {
  const logPath = path.join(getBrainDir(projectPath), ACCESS_LOG_FILE);

  return withFileLockSync(logPath, () => {
    try {
      if (fs.existsSync(logPath)) {
        const data = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
        return data as AccessLog;
      }
    } catch {
      // Corrupted file, start fresh
    }

    return {
      version: 1,
      lastUpdated: Date.now(),
      files: {},
    };
  }, { retries: 3 });
}

/**
 * Save the access log
 * Uses file locking to prevent concurrent write corruption
 */
function saveAccessLog(projectPath: string, log: AccessLog): void {
  const brainDir = getBrainDir(projectPath);
  const logPath = path.join(brainDir, ACCESS_LOG_FILE);

  withFileLockSync(logPath, () => {
    try {
      fs.mkdirSync(brainDir, { recursive: true });
      log.lastUpdated = Date.now();
      fs.writeFileSync(logPath, JSON.stringify(log, null, 2));
    } catch {
      // Non-critical, ignore
    }
  }, { retries: 3 });
}

/**
 * Load hot files
 * Uses file locking to prevent concurrent read/write corruption
 */
function loadHotFiles(projectPath: string): HotFilesData {
  const hotPath = path.join(getBrainDir(projectPath), HOT_FILES_FILE);

  return withFileLockSync(hotPath, () => {
    try {
      if (fs.existsSync(hotPath)) {
        return JSON.parse(fs.readFileSync(hotPath, 'utf-8'));
      }
    } catch {
      // Corrupted, start fresh
    }

    return {
      lastUpdated: new Date().toISOString(),
      hotFiles: [],
    };
  }, { retries: 3 });
}

/**
 * Save hot files
 * Uses file locking to prevent concurrent write corruption
 */
function saveHotFiles(projectPath: string, data: HotFilesData): void {
  const hotPath = path.join(getBrainDir(projectPath), HOT_FILES_FILE);

  withFileLockSync(hotPath, () => {
    try {
      data.lastUpdated = new Date().toISOString();
      fs.writeFileSync(hotPath, JSON.stringify(data, null, 2));
    } catch {
      // Non-critical
    }
  }, { retries: 3 });
}

/**
 * Calculate effective access count with time decay
 */
function getEffectiveCount(access: FileAccess): number {
  const now = Date.now();
  const daysSinceLastAccess = (now - access.lastAccessed) / (1000 * 60 * 60 * 24);

  if (daysSinceLastAccess > DECAY_DAYS) {
    // Apply decay for old accesses
    return Math.floor(access.count * DECAY_FACTOR);
  }

  return access.count;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Record a file access from an MCP tool
 *
 * @param projectPath - Project root path
 * @param filePath - Path to the file being accessed (relative to project)
 * @param source - Which tool accessed it (semantic_lookup, impact_check, etc.)
 */
export function recordFileAccess(
  projectPath: string,
  filePath: string,
  source: string
): void {
  // Normalize the file path to be relative
  const relativePath = path.isAbsolute(filePath)
    ? path.relative(projectPath, filePath)
    : filePath;

  // Skip external files (those outside project)
  if (relativePath.startsWith('..')) {
    return;
  }

  const log = loadAccessLog(projectPath);
  const now = Date.now();

  if (!log.files[relativePath]) {
    log.files[relativePath] = {
      count: 0,
      lastAccessed: now,
      firstAccessed: now,
      sources: [],
    };
  }

  const access = log.files[relativePath];
  access.count++;
  access.lastAccessed = now;

  if (!access.sources.includes(source)) {
    access.sources.push(source);
  }

  saveAccessLog(projectPath, log);

  // Check if we should auto-promote this file (fire and forget - don't block)
  const effectiveCount = getEffectiveCount(access);
  if (effectiveCount >= AUTO_PROMOTE_THRESHOLD) {
    maybePromoteToHotFiles(projectPath, relativePath, access).catch(() => {
      // Non-critical, ignore promotion failures
    });
  }
}

/**
 * Gather intelligence about a file using MCP tools
 */
async function gatherFileIntelligence(
  projectPath: string,
  filePath: string
): Promise<HotFile['intelligence'] | undefined> {
  try {
    // Get semantic summary
    const lookupResult = await semanticLookup({
      filePath,
      projectPath,
    });

    // Get impact/dependents info
    let dependents = 0;
    try {
      const impactResult = await checkImpact({
        filePath,
        projectPath,
      });
      if (impactResult.success && impactResult.data) {
        dependents = impactResult.data.dependents?.length || 0;
      }
    } catch {
      // Impact check may fail for some files, that's ok
    }

    return {
      summary: lookupResult.summary,
      exports: lookupResult.exports.slice(0, 10), // Keep top 10
      imports: lookupResult.imports.slice(0, 10),
      complexity: lookupResult.complexity,
      lineCount: lookupResult.lineCount,
      dependents,
      cachedAt: Date.now(),
    };
  } catch {
    // If we can't gather intelligence, still promote but without it
    return undefined;
  }
}

/**
 * Potentially promote a file to hot files list
 */
async function maybePromoteToHotFiles(
  projectPath: string,
  filePath: string,
  access: FileAccess
): Promise<void> {
  const hotData = loadHotFiles(projectPath);

  // Check if already in hot files
  const existing = hotData.hotFiles.find(h => h.path === filePath);
  if (existing) {
    // Update access count
    existing.accessCount = access.count;
    existing.lastAccessed = new Date(access.lastAccessed).toISOString();

    // Refresh intelligence if stale (>24h old)
    if (!existing.intelligence || Date.now() - existing.intelligence.cachedAt > 24 * 60 * 60 * 1000) {
      existing.intelligence = await gatherFileIntelligence(projectPath, filePath);
    }

    saveHotFiles(projectPath, hotData);
    return;
  }

  // Count auto-learned files
  const autoLearnedCount = hotData.hotFiles.filter(h => h.autoLearned).length;
  if (autoLearnedCount >= MAX_AUTO_HOT_FILES) {
    // Remove oldest auto-learned file to make room
    const oldest = hotData.hotFiles
      .filter(h => h.autoLearned)
      .sort((a, b) => (a.accessCount || 0) - (b.accessCount || 0))[0];

    if (oldest) {
      hotData.hotFiles = hotData.hotFiles.filter(h => h.path !== oldest.path);
    }
  }

  // Gather intelligence BEFORE adding to hot files
  const intelligence = await gatherFileIntelligence(projectPath, filePath);

  // Add new hot file with pre-cached intelligence
  hotData.hotFiles.push({
    path: filePath,
    accessCount: access.count,
    lastAccessed: new Date(access.lastAccessed).toISOString(),
    reason: `Auto-learned: accessed ${access.count}x via ${access.sources.join(', ')}`,
    autoLearned: true,
    intelligence,
  });

  saveHotFiles(projectPath, hotData);
}

/**
 * Get the current access stats for all files
 */
export function getAccessStats(projectPath: string): {
  totalFiles: number;
  hotCandidates: Array<{ path: string; count: number; effectiveCount: number }>;
  recentlyAccessed: Array<{ path: string; when: string }>;
} {
  const log = loadAccessLog(projectPath);
  const now = Date.now();

  const files = Object.entries(log.files);

  // Files that are candidates for promotion
  const hotCandidates = files
    .map(([filePath, access]) => ({
      path: filePath,
      count: access.count,
      effectiveCount: getEffectiveCount(access),
    }))
    .filter(f => f.effectiveCount >= 3) // Near threshold
    .sort((a, b) => b.effectiveCount - a.effectiveCount)
    .slice(0, 10);

  // Recently accessed files (last 24 hours)
  const recentlyAccessed = files
    .filter(([_, access]) => now - access.lastAccessed < 24 * 60 * 60 * 1000)
    .map(([filePath, access]) => ({
      path: filePath,
      when: new Date(access.lastAccessed).toISOString(),
    }))
    .sort((a, b) => b.when.localeCompare(a.when))
    .slice(0, 10);

  return {
    totalFiles: files.length,
    hotCandidates,
    recentlyAccessed,
  };
}

/**
 * Clean up old access records (run periodically)
 */
export function cleanupAccessLog(projectPath: string): number {
  const log = loadAccessLog(projectPath);
  const now = Date.now();
  const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days

  let removed = 0;
  for (const [filePath, access] of Object.entries(log.files)) {
    // Remove if not accessed in 30 days AND low count
    if (now - access.lastAccessed > maxAge && access.count < AUTO_PROMOTE_THRESHOLD) {
      delete log.files[filePath];
      removed++;
    }
  }

  if (removed > 0) {
    saveAccessLog(projectPath, log);
  }

  return removed;
}
