"use strict";
/**
 * Pattern Detector for Auto-Learning
 *
 * Detects patterns from tool usage and file access that should become lessons.
 * Identifies debugging sessions, refactoring patterns, hot paths, and conventions.
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
exports.startSession = startSession;
exports.endSession = endSession;
exports.recordAccess = recordAccess;
exports.getDetectedPatterns = getDetectedPatterns;
exports.getFileStats = getFileStats;
exports.clearPatternState = clearPatternState;
exports.getHotFilesFromPatterns = getHotFilesFromPatterns;
const path = __importStar(require("path"));
// =============================================================================
// Constants
// =============================================================================
const DEBUGGING_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const DEBUGGING_ACCESS_THRESHOLD = 3;
const HOT_PATH_SESSION_THRESHOLD = 3;
const RECENT_ACCESS_LIMIT = 20;
// =============================================================================
// Pattern Detection State
// =============================================================================
/** In-memory state for pattern detection (per-project) */
const projectState = new Map();
function getProjectState(projectPath) {
    if (!projectState.has(projectPath)) {
        projectState.set(projectPath, {
            currentSession: null,
            fileStats: new Map(),
            detectedPatterns: [],
        });
    }
    return projectState.get(projectPath);
}
// =============================================================================
// Session Management
// =============================================================================
/**
 * Start or continue a session for pattern tracking
 */
function startSession(projectPath, sessionId) {
    const state = getProjectState(projectPath);
    if (!state.currentSession || state.currentSession.sessionId !== sessionId) {
        state.currentSession = {
            sessionId,
            filesAccessed: new Set(),
            toolSequence: [],
            startTime: Date.now(),
        };
    }
}
/**
 * End the current session and analyze patterns
 */
function endSession(projectPath) {
    const state = getProjectState(projectPath);
    const session = state.currentSession;
    if (!session)
        return [];
    const patterns = [];
    // Analyze session for patterns
    patterns.push(...detectSessionPatterns(session, state.fileStats));
    // Clear session
    state.currentSession = null;
    return patterns;
}
// =============================================================================
// Access Recording
// =============================================================================
/**
 * Record a file access event for pattern detection
 */
function recordAccess(projectPath, event) {
    const state = getProjectState(projectPath);
    const patterns = [];
    // Ensure session exists
    if (!state.currentSession) {
        startSession(projectPath, event.sessionId || 'default');
    }
    const session = state.currentSession;
    // Add to session
    session.filesAccessed.add(event.filePath);
    session.toolSequence.push(event);
    // Update file stats
    if (!state.fileStats.has(event.filePath)) {
        state.fileStats.set(event.filePath, {
            totalAccesses: 0,
            sessionsAccessed: new Set(),
            recentAccesses: [],
            lastAccessed: 0,
        });
    }
    const stats = state.fileStats.get(event.filePath);
    stats.totalAccesses++;
    stats.sessionsAccessed.add(event.sessionId || 'default');
    stats.lastAccessed = event.timestamp;
    stats.recentAccesses.push(event);
    // Keep only recent accesses
    if (stats.recentAccesses.length > RECENT_ACCESS_LIMIT) {
        stats.recentAccesses = stats.recentAccesses.slice(-RECENT_ACCESS_LIMIT);
    }
    // Real-time pattern detection
    patterns.push(...detectDebuggingPattern(event.filePath, stats));
    patterns.push(...detectHotPathPattern(event.filePath, stats));
    patterns.push(...detectRefactoringPattern(session));
    return patterns;
}
// =============================================================================
// Pattern Detection Functions
// =============================================================================
/**
 * Detect debugging session pattern:
 * Same file accessed 3+ times within 10 minutes
 */
function detectDebuggingPattern(filePath, stats) {
    const patterns = [];
    const now = Date.now();
    // Count accesses in the debugging window
    const recentAccesses = stats.recentAccesses.filter(a => now - a.timestamp < DEBUGGING_WINDOW_MS);
    if (recentAccesses.length >= DEBUGGING_ACCESS_THRESHOLD) {
        // Check if this is the first time we're detecting this pattern
        const fileName = path.basename(filePath);
        patterns.push({
            type: 'debugging-session',
            confidence: recentAccesses.length >= 5 ? 'high' : 'medium',
            description: `File "${fileName}" accessed ${recentAccesses.length} times in ${Math.round(DEBUGGING_WINDOW_MS / 60000)} minutes`,
            suggestedLesson: `Investigated ${fileName} - consider documenting any gotchas or non-obvious behavior`,
            files: [filePath],
            metadata: {
                accessCount: recentAccesses.length,
                windowMinutes: DEBUGGING_WINDOW_MS / 60000,
            },
        });
    }
    return patterns;
}
/**
 * Detect hot path pattern:
 * File accessed in 3+ different sessions
 */
function detectHotPathPattern(filePath, stats) {
    const patterns = [];
    if (stats.sessionsAccessed.size >= HOT_PATH_SESSION_THRESHOLD) {
        const fileName = path.basename(filePath);
        patterns.push({
            type: 'hot-path',
            confidence: stats.sessionsAccessed.size >= 5 ? 'high' : 'medium',
            description: `File "${fileName}" accessed across ${stats.sessionsAccessed.size} sessions - likely a core file`,
            suggestedLesson: `${fileName} is a frequently accessed file - consider adding to key files list with enhanced documentation`,
            files: [filePath],
            metadata: {
                sessionCount: stats.sessionsAccessed.size,
                totalAccesses: stats.totalAccesses,
            },
        });
    }
    return patterns;
}
/**
 * Detect refactoring pattern:
 * impact_check followed by multiple file accesses
 */
function detectRefactoringPattern(session) {
    const patterns = [];
    const sequence = session.toolSequence;
    // Look for impact_check followed by multiple accesses
    for (let i = 0; i < sequence.length - 2; i++) {
        if (sequence[i].toolUsed === 'impact_check') {
            const impactFile = sequence[i].filePath;
            const followingEvents = sequence.slice(i + 1, i + 10);
            const uniqueFiles = new Set(followingEvents.map(e => e.filePath));
            if (uniqueFiles.size >= 3) {
                const fileName = path.basename(impactFile);
                patterns.push({
                    type: 'refactoring-pattern',
                    confidence: uniqueFiles.size >= 5 ? 'high' : 'medium',
                    description: `Refactoring detected: impact_check on "${fileName}" followed by ${uniqueFiles.size} file accesses`,
                    suggestedLesson: `Refactored ${fileName} with ${uniqueFiles.size} related files - document the change pattern if it's a breaking change`,
                    files: [impactFile, ...Array.from(uniqueFiles)],
                    metadata: {
                        relatedFileCount: uniqueFiles.size,
                        impactFile: impactFile,
                    },
                });
                break; // Only detect once per session
            }
        }
    }
    return patterns;
}
/**
 * Analyze entire session for patterns
 */
function detectSessionPatterns(session, fileStats) {
    const patterns = [];
    // Detect naming conventions in accessed files
    patterns.push(...detectNamingConventions(session.filesAccessed));
    // Detect directory patterns
    patterns.push(...detectDirectoryPatterns(session.filesAccessed));
    // Detect error-prone files (high access count in short session)
    const sessionDuration = Date.now() - session.startTime;
    if (sessionDuration < 30 * 60 * 1000) { // Less than 30 minutes
        for (const [filePath, stats] of fileStats) {
            const sessionAccesses = stats.recentAccesses.filter(a => a.timestamp >= session.startTime);
            if (sessionAccesses.length >= 5) {
                patterns.push({
                    type: 'error-prone-file',
                    confidence: 'medium',
                    description: `File "${path.basename(filePath)}" accessed ${sessionAccesses.length} times in a short session`,
                    suggestedLesson: `${path.basename(filePath)} may have subtle issues - review for edge cases`,
                    files: [filePath],
                });
            }
        }
    }
    return patterns;
}
/**
 * Detect naming conventions from accessed files
 */
function detectNamingConventions(files) {
    const patterns = [];
    const dirPatterns = new Map();
    // Group files by directory
    for (const file of files) {
        const dir = path.dirname(file);
        if (!dirPatterns.has(dir)) {
            dirPatterns.set(dir, []);
        }
        dirPatterns.get(dir).push(path.basename(file));
    }
    // Analyze each directory for naming patterns
    for (const [dir, fileNames] of dirPatterns) {
        if (fileNames.length < 3)
            continue;
        // Check for consistent naming patterns
        const kebabCase = fileNames.filter(f => /^[a-z]+(-[a-z]+)*\.[a-z]+$/.test(f));
        const camelCase = fileNames.filter(f => /^[a-z]+([A-Z][a-z]+)*\.[a-z]+$/.test(f));
        const pascalCase = fileNames.filter(f => /^[A-Z][a-z]+([A-Z][a-z]+)*\.[a-z]+$/.test(f));
        const total = fileNames.length;
        if (kebabCase.length / total > 0.7) {
            patterns.push({
                type: 'naming-convention',
                confidence: 'medium',
                description: `Files in ${dir}/ use kebab-case naming`,
                suggestedLesson: `Convention: Files in ${dir}/ should use kebab-case (e.g., my-component.ts)`,
            });
        }
        else if (camelCase.length / total > 0.7) {
            patterns.push({
                type: 'naming-convention',
                confidence: 'medium',
                description: `Files in ${dir}/ use camelCase naming`,
                suggestedLesson: `Convention: Files in ${dir}/ should use camelCase (e.g., myComponent.ts)`,
            });
        }
        else if (pascalCase.length / total > 0.7) {
            patterns.push({
                type: 'naming-convention',
                confidence: 'medium',
                description: `Files in ${dir}/ use PascalCase naming`,
                suggestedLesson: `Convention: Files in ${dir}/ should use PascalCase (e.g., MyComponent.ts)`,
            });
        }
    }
    return patterns;
}
/**
 * Detect directory structure patterns
 */
function detectDirectoryPatterns(files) {
    const patterns = [];
    const dirCounts = new Map();
    // Count files per top-level directory
    for (const file of files) {
        const parts = file.split(path.sep);
        if (parts.length > 1) {
            const topDir = parts[0];
            dirCounts.set(topDir, (dirCounts.get(topDir) || 0) + 1);
        }
    }
    // Identify heavily accessed directories
    for (const [dir, count] of dirCounts) {
        if (count >= 5) {
            patterns.push({
                type: 'directory-pattern',
                confidence: 'low',
                description: `Directory "${dir}" had ${count} files accessed this session`,
                metadata: { directory: dir, fileCount: count },
            });
        }
    }
    return patterns;
}
// =============================================================================
// Pattern Query Functions
// =============================================================================
/**
 * Get all detected patterns for a project
 */
function getDetectedPatterns(projectPath) {
    const state = projectState.get(projectPath);
    return state?.detectedPatterns ?? [];
}
/**
 * Get file access statistics for a project
 */
function getFileStats(projectPath) {
    const state = projectState.get(projectPath);
    return state?.fileStats ?? new Map();
}
/**
 * Clear pattern detection state for a project
 */
function clearPatternState(projectPath) {
    projectState.delete(projectPath);
}
/**
 * Get hot files based on pattern detection
 * Returns files that have been accessed across multiple sessions
 */
function getHotFilesFromPatterns(projectPath) {
    const state = projectState.get(projectPath);
    if (!state)
        return [];
    const hotFiles = [];
    for (const [filePath, stats] of state.fileStats) {
        if (stats.sessionsAccessed.size >= HOT_PATH_SESSION_THRESHOLD) {
            hotFiles.push({
                path: filePath,
                sessionCount: stats.sessionsAccessed.size,
                totalAccesses: stats.totalAccesses,
                reason: `Accessed in ${stats.sessionsAccessed.size} sessions`,
            });
        }
    }
    // Sort by session count descending
    return hotFiles.sort((a, b) => b.sessionCount - a.sessionCount);
}
//# sourceMappingURL=pattern-detector.js.map