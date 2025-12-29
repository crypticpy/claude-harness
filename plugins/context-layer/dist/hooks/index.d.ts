/**
 * Context Layer Hooks Module
 *
 * Provides hooks that integrate with Claude Code's hook system.
 * These hooks inject context at key points in the conversation.
 */
export { handleUserPromptSubmit, findProjectRoot, type HookInput as CLIHookInput, type HookOutput, } from './personality-hook';
export { handlePreCompact, handleSessionStart, checkCompactionRecovery, generateRecoveryContext, clearCompactionRecovery, type PreCompactInput, type PreCompactOutput, type SessionStartInput, type PreCompactionSave, } from './compaction-handler';
export { loadSessionState, saveSessionState, updateSessionState, clearSessionState, recordFileAccess as recordSessionFileAccess, recordToolUsage, recordLesson, generateWorkingSummary, type SessionState, } from './session-state';
import type { StackInfo } from '../personality';
/**
 * Context injected into prompts by the personality hook.
 */
export interface PersonalityContext {
    /** Project name */
    projectName: string;
    /** Detected technology stack */
    stack: StackInfo;
    /** Key patterns to follow */
    patterns: string[];
    /** Important conventions */
    conventions: string[];
    /** Known gotchas to avoid */
    gotchas: string[];
    /** Critical files the AI should know about */
    keyFiles: string[];
}
/**
 * Hook result returned to Claude Code.
 */
export interface HookResult {
    /** Whether the hook executed successfully */
    success: boolean;
    /** Context to inject (if any) */
    context?: string;
    /** Error message (if failed) */
    error?: string;
}
/**
 * Hook input from Claude Code.
 */
export interface HookInput {
    /** Current session ID */
    sessionId?: string;
    /** Current project directory */
    projectDir: string;
    /** The user's prompt */
    prompt: string;
    /** Timestamp */
    timestamp?: number;
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
export declare function personalityHook(input: HookInput): Promise<HookResult>;
/**
 * Context health status returned by the health check hook.
 */
export interface ContextHealthStatus {
    /** Overall health: good, degraded, or poor */
    status: 'good' | 'degraded' | 'poor';
    /** Percentage of context window estimated to be used */
    contextUsagePercent: number;
    /** Number of files currently in context */
    filesInContext: number;
    /** Recommendations for context optimization */
    recommendations: string[];
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
export declare function contextHealthHook(_input: HookInput): Promise<ContextHealthStatus>;
export declare const hooks: {
    readonly personality: typeof personalityHook;
    readonly contextHealth: typeof contextHealthHook;
};
export default hooks;
//# sourceMappingURL=index.d.ts.map