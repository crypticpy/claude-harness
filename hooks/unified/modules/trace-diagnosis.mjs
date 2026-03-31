/**
 * Trace Diagnosis Module
 * Runs on PreCompact to analyze the session for failure patterns and extract lessons.
 * Inspired by Meta-Harness's counterfactual diagnosis approach.
 * Writes findings to context-layer lessons.jsonl for future sessions.
 */

import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { callLlm } from './llm-call.mjs';

const MAX_TRANSCRIPT_CHARS = 500_000;
const MIN_TOOL_CALLS = 5;
const LLM_TIMEOUT_MS = 45_000;

import { getApiKey } from './api-key.mjs';

/**
 * Parse a JSONL transcript and extract diagnostic signals.
 */
function extractDiagnosticSignals(transcript) {
    const lines = transcript.split('\n').filter(Boolean);
    const signals = {
        totalTurns: 0,
        totalToolCalls: 0,
        toolErrors: 0,
        retryPatterns: 0,
        explorationSpirals: 0,
        contextSwitches: 0,
        permissionDenials: 0,
        toolSequence: [],
        errorMessages: [],
    };

    let lastToolName = null;
    let lastToolArgs = null;
    let consecutiveSameTool = 0;
    let consecutiveBashCount = 0;
    let lastFileContext = null;

    for (const line of lines) {
        let entry;
        try {
            entry = JSON.parse(line);
        } catch (e) {
            continue;
        }

        // Count turns
        if (entry.type === 'user' || entry.type === 'assistant') {
            signals.totalTurns++;
        }

        // Track tool calls — Claude Code embeds tool_use blocks inside assistant messages
        if (entry.type === 'assistant' && Array.isArray(entry.message?.content)) {
            for (const block of entry.message.content) {
                if (block.type !== 'tool_use') continue;

                signals.totalToolCalls++;
                const toolName = block.name || 'unknown';
                const toolArgs = JSON.stringify(block.input || {}).slice(0, 200);

                signals.toolSequence.push(toolName);

                // Detect retry patterns: same tool called in sequence with similar args
                if (toolName === lastToolName && toolArgs === lastToolArgs) {
                    consecutiveSameTool++;
                    if (consecutiveSameTool >= 2) {
                        signals.retryPatterns++;
                    }
                } else {
                    consecutiveSameTool = 0;
                }

                // Detect exploration spirals: many Bash commands in a row
                if (toolName === 'Bash' || toolName === 'bash') {
                    consecutiveBashCount++;
                    if (consecutiveBashCount >= 5) {
                        signals.explorationSpirals++;
                        consecutiveBashCount = 0;
                    }
                } else {
                    consecutiveBashCount = 0;
                }

                // Detect context switches: alternating between different files
                const inputStr = JSON.stringify(block.input || {});
                const fileMatch = inputStr.match(/["']([^"']+\.\w{1,5})["']/);
                if (fileMatch) {
                    const currentFile = fileMatch[1];
                    if (lastFileContext && currentFile !== lastFileContext) {
                        signals.contextSwitches++;
                    }
                    lastFileContext = currentFile;
                }

                lastToolName = toolName;
                lastToolArgs = toolArgs;
            }
        }

        // Count tool errors — tool_result blocks are inside user-type entries
        if (entry.type === 'user' && Array.isArray(entry.message?.content)) {
            for (const block of entry.message.content) {
                if (block.type !== 'tool_result') continue;

                if (block.is_error) {
                    signals.toolErrors++;
                    const errorContent = typeof block.content === 'string'
                        ? block.content.slice(0, 200)
                        : JSON.stringify(block.content).slice(0, 200);
                    signals.errorMessages.push(errorContent);
                }

                // Detect permission denials
                const content = typeof block.content === 'string'
                    ? block.content
                    : JSON.stringify(block.content || '');
                if (/permission denied|EACCES|EPERM|not permitted|unauthorized/i.test(content)) {
                    signals.permissionDenials++;
                }
            }
        }
    }

    return signals;
}

/**
 * Determine if the signals warrant a full LLM diagnosis.
 */
function hasSignificantPatterns(signals) {
    if (signals.totalToolCalls < MIN_TOOL_CALLS) return false;
    // Worth diagnosing if there are errors, retries, spirals, or many context switches
    return (
        signals.toolErrors >= 2 ||
        signals.retryPatterns >= 1 ||
        signals.explorationSpirals >= 1 ||
        signals.contextSwitches >= 10 ||
        signals.permissionDenials >= 1
    );
}

/**
 * Call the LLM to analyze the transcript for failure patterns.
 */
async function callLLMForDiagnosis(apiKey, transcript, signals, config) {
    const llmConfig = config.llm?.recall;
    if (!llmConfig) {
        throw new Error('No recall LLM configured');
    }

    // Truncate transcript for LLM
    const truncated = transcript.length > MAX_TRANSCRIPT_CHARS
        ? transcript.slice(0, MAX_TRANSCRIPT_CHARS) + '\n...[TRUNCATED]'
        : transcript;

    const signalsSummary = [
        `Total turns: ${signals.totalTurns}`,
        `Total tool calls: ${signals.totalToolCalls}`,
        `Tool errors: ${signals.toolErrors}`,
        `Retry patterns detected: ${signals.retryPatterns}`,
        `Exploration spirals (5+ sequential bash): ${signals.explorationSpirals}`,
        `Context switches: ${signals.contextSwitches}`,
        `Permission denials: ${signals.permissionDenials}`,
    ].join('\n');

    const prompt = `You are a session efficiency analyst. Analyze this Claude Code session transcript for failure patterns, wasted turns, and recurring issues.

Pre-computed signals:
${signalsSummary}

${signals.errorMessages.length > 0 ? `\nError samples:\n${signals.errorMessages.slice(0, 10).join('\n')}\n` : ''}

TRANSCRIPT:
${truncated}

Answer these questions:
1. What failure patterns, wasted turns, or recurring issues do you see in this session?
2. What concrete improvements to prompts, tools, or workflow would prevent these?
3. Rate session efficiency 1-10 and explain why.

Respond ONLY with valid JSON in this exact format:
{
  "efficiency": <number 1-10>,
  "patterns": ["pattern 1", "pattern 2"],
  "lessons": ["lesson 1", "lesson 2"],
  "improvements": ["improvement 1", "improvement 2"]
}`;

    const result = await callLlm(apiKey, llmConfig, prompt, {
        timeoutMs: LLM_TIMEOUT_MS,
        title: 'Claude Code Trace Diagnosis',
    });

    if (result) return result;
    throw new Error('No JSON found in LLM response');
}

/**
 * Resolve the lessons.jsonl output path.
 * Primary: $CLAUDE_PROJECT_DIR/.claude/context-layer/lessons.jsonl
 * Fallback: $HOME/.claude/context-layer/lessons.jsonl
 */
function resolveLessonsPath() {
    const projectDir = process.env.CLAUDE_PROJECT_DIR;
    if (projectDir) {
        const primary = join(projectDir, '.claude', 'context-layer', 'lessons.jsonl');
        const primaryDir = join(projectDir, '.claude', 'context-layer');
        try {
            mkdirSync(primaryDir, { recursive: true });
            return primary;
        } catch (e) {
            // Fall through to fallback
        }
    }

    const fallbackDir = join(process.env.HOME, '.claude', 'context-layer');
    mkdirSync(fallbackDir, { recursive: true });
    return join(fallbackDir, 'lessons.jsonl');
}

/**
 * Write diagnosis findings to lessons.jsonl.
 */
function writeLessons(sessionId, diagnosis, signals) {
    const lessonsPath = resolveLessonsPath();

    const entry = {
        timestamp: new Date().toISOString(),
        type: 'trace-diagnosis',
        session_id: sessionId,
        efficiency: diagnosis.efficiency,
        patterns: diagnosis.patterns || [],
        lessons: diagnosis.lessons || [],
        improvements: diagnosis.improvements || [],
        stats: {
            totalTurns: signals.totalTurns,
            totalToolCalls: signals.totalToolCalls,
            toolErrors: signals.toolErrors,
            retryPatterns: signals.retryPatterns,
            explorationSpirals: signals.explorationSpirals,
            contextSwitches: signals.contextSwitches,
            permissionDenials: signals.permissionDenials,
        }
    };

    appendFileSync(lessonsPath, JSON.stringify(entry) + '\n');
}

/**
 * Main entry point: diagnose the session transcript for failure patterns.
 * Exported for use by unified-hook.mjs.
 */
export async function diagnoseSession(event, config, apiKey) {
    const { session_id, transcript_path } = event;
    if (!session_id || !transcript_path) return;

    // Read transcript
    if (!existsSync(transcript_path)) return;
    const transcript = readFileSync(transcript_path, 'utf-8');

    // Extract diagnostic signals
    const signals = extractDiagnosticSignals(transcript);

    // Skip if session is too short
    if (signals.totalToolCalls < MIN_TOOL_CALLS) return;

    // Check if there are significant patterns worth diagnosing
    if (!hasSignificantPatterns(signals)) {
        // Still write a basic entry for clean sessions
        writeLessons(session_id, {
            efficiency: 8,
            patterns: [],
            lessons: ['Session completed without significant issues'],
            improvements: []
        }, signals);
        return;
    }

    // Resolve API key if not provided
    const resolvedApiKey = apiKey || getApiKey();
    if (!resolvedApiKey) {
        // No API key available, write basic signal-only entry
        writeLessons(session_id, {
            efficiency: null,
            patterns: signals.errorMessages.slice(0, 5),
            lessons: ['No API key available for full diagnosis'],
            improvements: []
        }, signals);
        return;
    }

    // Call LLM for full diagnosis
    const diagnosis = await callLLMForDiagnosis(resolvedApiKey, transcript, signals, config);

    // Write findings
    writeLessons(session_id, diagnosis, signals);
}
