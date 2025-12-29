"use strict";
/**
 * Compaction Handler
 *
 * Handles PreCompact and SessionStart events to preserve state across
 * Claude Code's context compaction process.
 *
 * When context approaches the limit (~154K tokens), Claude auto-compacts.
 * This handler saves session state before compaction and restores it after.
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
exports.handlePreCompact = handlePreCompact;
exports.checkCompactionRecovery = checkCompactionRecovery;
exports.generateRecoveryContext = generateRecoveryContext;
exports.clearCompactionRecovery = clearCompactionRecovery;
exports.handleSessionStart = handleSessionStart;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const session_state_1 = require("./session-state");
const personality_hook_1 = require("./personality-hook");
const learn_1 = require("../learn");
// =============================================================================
// Constants
// =============================================================================
const PRE_COMPACTION_FILE = 'pre-compaction-save.json';
const COMPACTION_SAVE_TTL_MS = 5 * 60 * 1000; // 5 minutes
// =============================================================================
// Helper Functions
// =============================================================================
function getPreCompactionPath(projectPath) {
    return path.join(projectPath, '.claude', 'context-layer', PRE_COMPACTION_FILE);
}
function ensureContextLayerDir(projectPath) {
    const dir = path.join(projectPath, '.claude', 'context-layer');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}
// =============================================================================
// PreCompact Handler
// =============================================================================
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
function handlePreCompact(input, projectPath) {
    const resolvedPath = projectPath || (0, personality_hook_1.findProjectRoot)(process.cwd());
    try {
        ensureContextLayerDir(resolvedPath);
        // Load current session state
        const sessionState = (0, session_state_1.loadSessionState)(resolvedPath, input.session_id);
        // Get detected patterns
        const patterns = (0, learn_1.getDetectedPatterns)(resolvedPath);
        const hotFiles = (0, learn_1.getHotFilesFromPatterns)(resolvedPath);
        // Build recovery context (transform records to strings)
        const workingFiles = sessionState?.filesAccessed
            .slice(-10)
            .map(f => f.path) || [];
        const recentTools = sessionState?.toolsUsed
            .slice(-10)
            .map(t => t.tool) || [];
        const sessionLessons = sessionState?.lessonsLearned
            .map(l => l.lesson) || [];
        // Generate working summary
        const workingSummary = sessionState
            ? (0, session_state_1.generateWorkingSummary)(sessionState)
            : 'No session state available';
        // Build pattern descriptions
        const patternDescriptions = patterns
            .slice(-5)
            .map(p => p.description);
        // Create recovery context string
        const recoveryLines = [];
        if (workingFiles.length > 0) {
            recoveryLines.push(`Working files: ${workingFiles.join(', ')}`);
        }
        if (recentTools.length > 0) {
            // Tools are already unique, just count them
            const toolCounts = {};
            for (const tool of recentTools) {
                toolCounts[tool] = (toolCounts[tool] || 0) + 1;
            }
            const toolSummary = Object.entries(toolCounts)
                .map(([tool, count]) => `${tool}(${count})`)
                .join(', ');
            recoveryLines.push(`Recent activity: ${toolSummary}`);
        }
        if (sessionLessons.length > 0) {
            recoveryLines.push(`Lessons: ${sessionLessons.slice(-3).join('; ')}`);
        }
        if (hotFiles.length > 0) {
            const hotFilePaths = hotFiles.slice(0, 5).map(h => path.basename(h.path));
            recoveryLines.push(`Hot files: ${hotFilePaths.join(', ')}`);
        }
        // Create the pre-compaction save
        const save = {
            savedAt: new Date().toISOString(),
            sessionId: input.session_id,
            workingFiles,
            recentTools,
            workingSummary,
            sessionLessons,
            detectedPatterns: patternDescriptions,
            recoveryContext: recoveryLines.join('\n'),
        };
        // Write to file
        const savePath = getPreCompactionPath(resolvedPath);
        fs.writeFileSync(savePath, JSON.stringify(save, null, 2));
        // Output reminder to transcript (this goes to the compacted context)
        const reminderLines = [
            '',
            '<pre-compaction-state>',
            `Session: ${input.session_id}`,
            workingSummary,
        ];
        if (workingFiles.length > 0) {
            reminderLines.push(`Key files: ${workingFiles.slice(-5).join(', ')}`);
        }
        reminderLines.push('</pre-compaction-state>');
        return {
            continue: true,
            result: reminderLines.join('\n'),
        };
    }
    catch (err) {
        // Don't block compaction on errors
        console.error('PreCompact handler error:', err);
        return {
            continue: true,
            result: `<pre-compaction-state>State save failed: ${err instanceof Error ? err.message : String(err)}</pre-compaction-state>`,
        };
    }
}
// =============================================================================
// SessionStart Compact Recovery
// =============================================================================
/**
 * Check if we're recovering from a recent compaction.
 * Returns recovery context if available and recent enough.
 */
function checkCompactionRecovery(projectPath) {
    const savePath = getPreCompactionPath(projectPath);
    if (!fs.existsSync(savePath)) {
        return null;
    }
    try {
        const content = fs.readFileSync(savePath, 'utf-8');
        const save = JSON.parse(content);
        // Check if save is recent enough
        const saveAge = Date.now() - new Date(save.savedAt).getTime();
        if (saveAge > COMPACTION_SAVE_TTL_MS) {
            // Too old, clean it up
            fs.unlinkSync(savePath);
            return null;
        }
        return save;
    }
    catch {
        return null;
    }
}
/**
 * Generate recovery context to inject after compaction.
 */
function generateRecoveryContext(save) {
    const lines = [
        '<session-recovery>',
        'Context was recently compacted. Resuming from saved state:',
        '',
    ];
    if (save.workingSummary) {
        lines.push(`**What you were working on:**`);
        lines.push(save.workingSummary);
        lines.push('');
    }
    if (save.workingFiles.length > 0) {
        lines.push(`**Key files:** ${save.workingFiles.slice(-5).join(', ')}`);
    }
    if (save.sessionLessons.length > 0) {
        lines.push('');
        lines.push('**Recent learnings:**');
        for (const lesson of save.sessionLessons.slice(-3)) {
            lines.push(`- ${lesson}`);
        }
    }
    if (save.detectedPatterns.length > 0) {
        lines.push('');
        lines.push('**Detected patterns:**');
        for (const pattern of save.detectedPatterns.slice(-3)) {
            lines.push(`- ${pattern}`);
        }
    }
    lines.push('</session-recovery>');
    return lines.join('\n');
}
/**
 * Clear the pre-compaction save after recovery.
 */
function clearCompactionRecovery(projectPath) {
    const savePath = getPreCompactionPath(projectPath);
    if (fs.existsSync(savePath)) {
        fs.unlinkSync(savePath);
    }
}
// =============================================================================
// Main Handler Export
// =============================================================================
/**
 * Handle SessionStart event, checking for compaction recovery.
 */
function handleSessionStart(input, projectPath) {
    const resolvedPath = projectPath || (0, personality_hook_1.findProjectRoot)(process.cwd());
    // Check for recent compaction save
    const save = checkCompactionRecovery(resolvedPath);
    if (!save) {
        return { needsRecovery: false };
    }
    // Only recover if session IDs match or it's very recent
    const saveAge = Date.now() - new Date(save.savedAt).getTime();
    const isVeryRecent = saveAge < 60 * 1000; // Less than 1 minute
    const sameSession = save.sessionId === input.session_id;
    if (isVeryRecent || sameSession) {
        const recoveryContext = generateRecoveryContext(save);
        // Clear the save after generating recovery context
        clearCompactionRecovery(resolvedPath);
        return {
            needsRecovery: true,
            recoveryContext,
        };
    }
    // Old or different session, clear it
    clearCompactionRecovery(resolvedPath);
    return { needsRecovery: false };
}
//# sourceMappingURL=compaction-handler.js.map