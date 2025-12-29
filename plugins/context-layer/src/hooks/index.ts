/**
 * Context Layer Hooks Module
 *
 * Provides hooks that integrate with Claude Code's hook system.
 * These hooks inject context at key points in the conversation.
 */

// =============================================================================
// Primary Exports (New CLI-compatible Implementation)
// =============================================================================

export {
  handleUserPromptSubmit,
  findProjectRoot,
  type HookInput as CLIHookInput,
  type HookOutput,
} from './personality-hook';

export {
  handlePreCompact,
  handleSessionStart,
  checkCompactionRecovery,
  generateRecoveryContext,
  clearCompactionRecovery,
  type PreCompactInput,
  type PreCompactOutput,
  type SessionStartInput,
  type PreCompactionSave,
} from './compaction-handler';

export {
  loadSessionState,
  saveSessionState,
  updateSessionState,
  clearSessionState,
  recordFileAccess as recordSessionFileAccess,
  recordToolUsage,
  recordLesson,
  generateWorkingSummary,
  type SessionState,
} from './session-state';

// =============================================================================
// Legacy Implementation (Backward Compatibility)
// =============================================================================

import type { ProjectPersonality, StackInfo } from '../personality';
import { createStorage, DEFAULT_DB_PATH } from '../storage';
import type { ContextStorage } from '../storage/interface';

// =============================================================================
// Hook Types
// =============================================================================

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

// =============================================================================
// Personality Hook
// =============================================================================

/**
 * Format personality context for injection into prompts.
 */
function formatPersonalityContext(personality: ProjectPersonality): string {
  const sections: string[] = [];

  // Header
  sections.push(`## Project Context: ${personality.name}`);
  sections.push('');

  // Stack info
  const { stack } = personality;
  const stackParts: string[] = [];
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
function generateProjectId(projectDir: string): string {
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
async function loadPersonality(
  storage: ContextStorage,
  projectDir: string
): Promise<ProjectPersonality | null> {
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
        const personality = JSON.parse(profile.personality) as ProjectPersonality;
        return personality;
      } catch {
        // Invalid JSON in personality field
        return null;
      }
    }

    return null;
  } catch {
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
export async function personalityHook(input: HookInput): Promise<HookResult> {
  try {
    const { projectDir } = input;

    if (!projectDir) {
      return { success: false, error: 'No project directory provided' };
    }

    // Get storage
    const storage = createStorage(DEFAULT_DB_PATH);

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
    } finally {
      await storage.close();
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error in personality hook',
    };
  }
}

// =============================================================================
// Context Health Hook
// =============================================================================

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
export async function contextHealthHook(_input: HookInput): Promise<ContextHealthStatus> {
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

export const hooks = {
  personality: personalityHook,
  contextHealth: contextHealthHook,
} as const;

export default hooks;
