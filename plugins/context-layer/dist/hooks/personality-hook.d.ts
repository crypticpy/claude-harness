/**
 * Project Personality Hook
 *
 * Runs on UserPromptSubmit to inject project context into Claude's context.
 * Extracts stack, patterns, conventions, and gotchas from project configuration files.
 */
export interface HookInput {
    session_id: string;
    prompt: string;
}
export interface HookOutput {
    continue: boolean;
    result?: string;
}
export declare function handleUserPromptSubmit(input: HookInput): Promise<HookOutput>;
/**
 * Find the project root by walking up the directory tree
 * Handles nested repos and monorepo sub-packages
 * Exported for use by other modules (e.g., active indexer, session state)
 */
export declare function findProjectRoot(startPath: string): string;
//# sourceMappingURL=personality-hook.d.ts.map