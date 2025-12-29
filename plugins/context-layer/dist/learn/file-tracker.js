"use strict";
/**
 * File Access Tracker for Auto-Learn Mode
 *
 * Tracks file access patterns and auto-promotes frequently accessed files
 * to the hot-files.json list for better context injection.
 *
 * Key insight: Store pre-cached INTELLIGENCE about files, not raw content.
 * This gives Claude the knowledge without consuming full-file tokens.
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
exports.recordFileAccess = recordFileAccess;
exports.getAccessStats = getAccessStats;
exports.cleanupAccessLog = cleanupAccessLog;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const tools_1 = require("../tools");
const file_lock_1 = require("./file-lock");
// =============================================================================
// Configuration
// =============================================================================
const ACCESS_LOG_FILE = 'file-access-log.json';
const HOT_FILES_FILE = 'hot-files.json';
const AUTO_PROMOTE_THRESHOLD = 5; // Access count to auto-promote
const DECAY_DAYS = 7; // Days until old accesses decay
const DECAY_FACTOR = 0.5; // Multiplier for decayed accesses
const MAX_AUTO_HOT_FILES = 15; // Max auto-learned hot files
// =============================================================================
// Core Functions
// =============================================================================
/**
 * Get the brain directory for a project
 */
function getBrainDir(projectPath) {
    return path.join(projectPath, '.claude', 'context-layer');
}
/**
 * Load the access log, creating if needed
 * Uses file locking to prevent concurrent read/write corruption
 */
function loadAccessLog(projectPath) {
    const logPath = path.join(getBrainDir(projectPath), ACCESS_LOG_FILE);
    return (0, file_lock_1.withFileLockSync)(logPath, () => {
        try {
            if (fs.existsSync(logPath)) {
                const data = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
                return data;
            }
        }
        catch {
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
function saveAccessLog(projectPath, log) {
    const brainDir = getBrainDir(projectPath);
    const logPath = path.join(brainDir, ACCESS_LOG_FILE);
    (0, file_lock_1.withFileLockSync)(logPath, () => {
        try {
            fs.mkdirSync(brainDir, { recursive: true });
            log.lastUpdated = Date.now();
            fs.writeFileSync(logPath, JSON.stringify(log, null, 2));
        }
        catch {
            // Non-critical, ignore
        }
    }, { retries: 3 });
}
/**
 * Load hot files
 * Uses file locking to prevent concurrent read/write corruption
 */
function loadHotFiles(projectPath) {
    const hotPath = path.join(getBrainDir(projectPath), HOT_FILES_FILE);
    return (0, file_lock_1.withFileLockSync)(hotPath, () => {
        try {
            if (fs.existsSync(hotPath)) {
                return JSON.parse(fs.readFileSync(hotPath, 'utf-8'));
            }
        }
        catch {
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
function saveHotFiles(projectPath, data) {
    const hotPath = path.join(getBrainDir(projectPath), HOT_FILES_FILE);
    (0, file_lock_1.withFileLockSync)(hotPath, () => {
        try {
            data.lastUpdated = new Date().toISOString();
            fs.writeFileSync(hotPath, JSON.stringify(data, null, 2));
        }
        catch {
            // Non-critical
        }
    }, { retries: 3 });
}
/**
 * Calculate effective access count with time decay
 */
function getEffectiveCount(access) {
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
function recordFileAccess(projectPath, filePath, source) {
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
async function gatherFileIntelligence(projectPath, filePath) {
    try {
        // Get semantic summary
        const lookupResult = await (0, tools_1.semanticLookup)({
            filePath,
            projectPath,
        });
        // Get impact/dependents info
        let dependents = 0;
        try {
            const impactResult = await (0, tools_1.checkImpact)({
                filePath,
                projectPath,
            });
            if (impactResult.success && impactResult.data) {
                dependents = impactResult.data.dependents?.length || 0;
            }
        }
        catch {
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
    }
    catch {
        // If we can't gather intelligence, still promote but without it
        return undefined;
    }
}
/**
 * Potentially promote a file to hot files list
 */
async function maybePromoteToHotFiles(projectPath, filePath, access) {
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
function getAccessStats(projectPath) {
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
function cleanupAccessLog(projectPath) {
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
//# sourceMappingURL=file-tracker.js.map