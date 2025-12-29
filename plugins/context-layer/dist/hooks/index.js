"use strict";
/**
 * Context Layer Hooks Module
 *
 * Provides hooks that integrate with Claude Code's hook system.
 * These hooks inject context at key points in the conversation.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.hooks = exports.generateWorkingSummary = exports.recordLesson = exports.recordToolUsage = exports.recordSessionFileAccess = exports.clearSessionState = exports.updateSessionState = exports.saveSessionState = exports.loadSessionState = exports.clearCompactionRecovery = exports.generateRecoveryContext = exports.checkCompactionRecovery = exports.handleSessionStart = exports.handlePreCompact = exports.findProjectRoot = exports.handleUserPromptSubmit = void 0;
exports.personalityHook = personalityHook;
exports.contextHealthHook = contextHealthHook;
// =============================================================================
// Primary Exports (New CLI-compatible Implementation)
// =============================================================================
var personality_hook_1 = require("./personality-hook");
Object.defineProperty(exports, "handleUserPromptSubmit", { enumerable: true, get: function () { return personality_hook_1.handleUserPromptSubmit; } });
Object.defineProperty(exports, "findProjectRoot", { enumerable: true, get: function () { return personality_hook_1.findProjectRoot; } });
var compaction_handler_1 = require("./compaction-handler");
Object.defineProperty(exports, "handlePreCompact", { enumerable: true, get: function () { return compaction_handler_1.handlePreCompact; } });
Object.defineProperty(exports, "handleSessionStart", { enumerable: true, get: function () { return compaction_handler_1.handleSessionStart; } });
Object.defineProperty(exports, "checkCompactionRecovery", { enumerable: true, get: function () { return compaction_handler_1.checkCompactionRecovery; } });
Object.defineProperty(exports, "generateRecoveryContext", { enumerable: true, get: function () { return compaction_handler_1.generateRecoveryContext; } });
Object.defineProperty(exports, "clearCompactionRecovery", { enumerable: true, get: function () { return compaction_handler_1.clearCompactionRecovery; } });
var session_state_1 = require("./session-state");
Object.defineProperty(exports, "loadSessionState", { enumerable: true, get: function () { return session_state_1.loadSessionState; } });
Object.defineProperty(exports, "saveSessionState", { enumerable: true, get: function () { return session_state_1.saveSessionState; } });
Object.defineProperty(exports, "updateSessionState", { enumerable: true, get: function () { return session_state_1.updateSessionState; } });
Object.defineProperty(exports, "clearSessionState", { enumerable: true, get: function () { return session_state_1.clearSessionState; } });
Object.defineProperty(exports, "recordSessionFileAccess", { enumerable: true, get: function () { return session_state_1.recordFileAccess; } });
Object.defineProperty(exports, "recordToolUsage", { enumerable: true, get: function () { return session_state_1.recordToolUsage; } });
Object.defineProperty(exports, "recordLesson", { enumerable: true, get: function () { return session_state_1.recordLesson; } });
Object.defineProperty(exports, "generateWorkingSummary", { enumerable: true, get: function () { return session_state_1.generateWorkingSummary; } });
const storage_1 = require("../storage");
// =============================================================================
// Personality Hook
// =============================================================================
/**
 * Format personality context for injection into prompts.
 */
function formatPersonalityContext(personality) {
    const sections = [];
    // Header
    sections.push(`## Project Context: ${personality.name}`);
    sections.push('');
    // Stack info
    const { stack } = personality;
    const stackParts = [];
    if (stack.languages.length > 0) {
        stackParts.push(`Languages: ${stack.languages.join(', ')}`);
    }
    if (stack.frameworks.length > 0) {
        stackParts.push(`Frameworks: ${stack.frameworks.join(', ')}`);
    }
    if (stack.buildTools.length > 0) {
        stackParts.push(`Build: ${stack.buildTools.join(', ')}`);
    }
    if (stackParts.length > 0) {
        sections.push('### Stack');
        sections.push(stackParts.join(' | '));
        sections.push('');
    }
    // Patterns (top 5)
    if (personality.patterns.length > 0) {
        sections.push('### Key Patterns');
        personality.patterns.slice(0, 5).forEach((p) => {
            sections.push(`- **${p.name}**: ${p.description}`);
        });
        sections.push('');
    }
    // Conventions (top 5)
    if (personality.conventions.length > 0) {
        sections.push('### Conventions');
        personality.conventions.slice(0, 5).forEach((c) => {
            sections.push(`- [${c.category}] ${c.rule}`);
        });
        sections.push('');
    }
    // Gotchas (all - these are important)
    if (personality.gotchas.length > 0) {
        sections.push('### Watch Out For');
        personality.gotchas.forEach((g) => {
            sections.push(`- ${g.issue} -> ${g.prevention}`);
        });
        sections.push('');
    }
    // Key files (critical only)
    const criticalFiles = personality.keyFiles.filter((f) => f.importance === 'critical');
    if (criticalFiles.length > 0) {
        sections.push('### Critical Files');
        criticalFiles.forEach((f) => {
            sections.push(`- \`${f.path}\`: ${f.purpose}`);
        });
        sections.push('');
    }
    return sections.join('\n');
}
/**
 * Generate a project ID from a directory path.
 */
function generateProjectId(projectDir) {
    // Simple hash of the project path
    let hash = 0;
    for (let i = 0; i < projectDir.length; i++) {
        const char = projectDir.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
}
/**
 * Load personality from storage or return null if not found.
 */
async function loadPersonality(storage, projectDir) {
    try {
        // Generate project ID from path
        const projectId = generateProjectId(projectDir);
        // Try to get the project profile
        const profile = await storage.getProjectProfile(projectId);
        if (!profile) {
            return null;
        }
        // Parse the personality from the stored JSON
        // The profile.personality field contains the serialized personality
        if (profile.personality) {
            try {
                const personality = JSON.parse(profile.personality);
                return personality;
            }
            catch {
                // Invalid JSON in personality field
                return null;
            }
        }
        return null;
    }
    catch {
        return null;
    }
}
/**
 * Personality hook that injects project context into prompts.
 *
 * This hook is called by Claude Code before each user prompt is processed.
 * It looks up the project's personality profile and injects relevant
 * context to help the AI understand project patterns and conventions.
 *
 * @param input - Hook input from Claude Code
 * @returns Hook result with optional context to inject
 *
 * @example
 * ```typescript
 * const result = await personalityHook({
 *   projectDir: '/path/to/project',
 *   prompt: 'Add a new API endpoint',
 * });
 *
 * if (result.success && result.context) {
 *   // Inject context into the prompt
 * }
 * ```
 */
async function personalityHook(input) {
    try {
        const { projectDir } = input;
        if (!projectDir) {
            return { success: false, error: 'No project directory provided' };
        }
        // Get storage
        const storage = (0, storage_1.createStorage)(storage_1.DEFAULT_DB_PATH);
        try {
            // Load personality
            const personality = await loadPersonality(storage, projectDir);
            if (!personality) {
                // No personality found - this is not an error, just no context to inject
                return { success: true };
            }
            // Format context for injection
            const context = formatPersonalityContext(personality);
            return {
                success: true,
                context,
            };
        }
        finally {
            await storage.close();
        }
    }
    catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error in personality hook',
        };
    }
}
/**
 * Context health hook that monitors context window usage.
 *
 * This hook can be called periodically to check context health
 * and provide recommendations for optimization.
 *
 * @param _input - Hook input with session context (currently unused)
 * @returns Health status and recommendations
 */
async function contextHealthHook(_input) {
    // This is a placeholder implementation
    // Real implementation would track actual context usage
    return {
        status: 'good',
        contextUsagePercent: 0,
        filesInContext: 0,
        recommendations: [],
    };
}
// =============================================================================
// Exports
// =============================================================================
exports.hooks = {
    personality: personalityHook,
    contextHealth: contextHealthHook,
};
exports.default = exports.hooks;
//# sourceMappingURL=index.js.map