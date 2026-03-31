/**
 * Session Memory Module
 * Consolidated from SessionMemory hooks
 * Saves and injects session memory across compactions
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { callLlm } from './llm-call.mjs';

const MEMORIES_DIR = join(process.env.HOME, '.claude', 'hooks', 'unified', 'memories');

/**
 * Detect poisoned memory — stub values written when LLM calls fail.
 * Single source of truth: used in session-memory and self-evolution.
 */
export function isPoisonedMemory(data) {
    if (!data) return false;
    return data.projectContext === 'Unknown'
        && data.overallDirection === 'In progress'
        && (!data.keyPoints || data.keyPoints.length === 0);
}

/**
 * Check if memory has real (non-poisoned) content worth preserving.
 */
export function hasRealContent(data) {
    return data?.projectContext && !isPoisonedMemory(data);
}

// Ensure memories directory exists
if (!existsSync(MEMORIES_DIR)) {
    mkdirSync(MEMORIES_DIR, { recursive: true });
}

/**
 * Inject session memory on UserPromptSubmit (if memory exists from compaction)
 */
export async function injectMemory(event, config) {
    try {
        const { session_id } = event;
        if (!session_id) return null;

        const memoryPath = join(MEMORIES_DIR, `${session_id}.json`);
        if (!existsSync(memoryPath)) return null;

        const memory = JSON.parse(readFileSync(memoryPath, 'utf-8'));

        // Skip if no meaningful content or if memory is poisoned (stub values)
        if (!memory.projectContext && !memory.overallDirection && !memory.keyPoints?.length) {
            return null;
        }
        if (isPoisonedMemory(memory)) {
            return null;
        }

        // Calculate duration
        const startedAt = new Date(memory.startedAt);
        const now = new Date();
        const durationMs = now - startedAt;
        const durationHours = Math.floor(durationMs / (1000 * 60 * 60));
        const durationMins = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
        const durationStr = durationHours > 0 ? `${durationHours}h ${durationMins}m` : `${durationMins}m`;

        // Build output
        let output = '<session-memory>\n';
        output += `Compaction #${memory.compactionCount} | Session: ${durationStr}\n\n`;

        if (memory.projectContext) {
            output += `Project: ${memory.projectContext}\n`;
        }

        if (memory.overallDirection) {
            output += `Direction: ${memory.overallDirection}\n`;
        }

        if (memory.longTermNarrative) {
            output += `\nNarrative: ${memory.longTermNarrative}\n`;
        }

        if (memory.keyPoints?.length > 0) {
            output += '\nHistory:\n';
            memory.keyPoints.forEach((point, i) => {
                const text = typeof point === 'string' ? point : point.summary || point.text || JSON.stringify(point);
                output += `  ${i + 1}. ${text}\n`;
            });
        }

        output += '</session-memory>';

        return output;

    } catch (err) {
        if (process.env.DEBUG) process.stderr.write('[session-memory] injectMemory error: ' + err.message + '\n');
        return null;
    }
}

/**
 * Save session memory on PreCompact
 */
export async function saveMemory(event, config, apiKey) {
    try {
        const { session_id, transcript_path } = event;
        if (!session_id || !transcript_path) return;

        const memoryPath = join(MEMORIES_DIR, `${session_id}.json`);
        const isFirstCompaction = !existsSync(memoryPath);

        // Load existing memory
        let existingMemory = null;
        if (!isFirstCompaction) {
            try {
                existingMemory = JSON.parse(readFileSync(memoryPath, 'utf-8'));
                // Detect poisoned memory — force fresh summarization
                if (isPoisonedMemory(existingMemory)) {
                    existingMemory = null;
                }
            } catch (e) {
                existingMemory = null;
            }
        }

        // Read transcript
        const transcript = readFileSync(transcript_path, 'utf-8');
        const extractedContent = extractTranscriptContent(transcript, existingMemory);

        if (!apiKey) {
            // Save basic memory without LLM enhancement
            saveBasicMemory(memoryPath, session_id, existingMemory);
            return;
        }

        // Call LLM for memory extraction
        const llmMemory = await callLLM(apiKey, extractedContent, existingMemory, config);

        // If LLM returned null (failed with no existing content to preserve), skip write
        if (!llmMemory) return;

        // Merge and save
        const compactionCount = (existingMemory?.compactionCount || 0) + 1;
        const memory = {
            sessionId: session_id,
            startedAt: existingMemory?.startedAt || new Date().toISOString(),
            lastCompactionAt: new Date().toISOString(),
            compactionCount,
            ...llmMemory
        };

        writeFileSync(memoryPath, JSON.stringify(memory, null, 2));

    } catch (err) {
        // Don't block compaction, but log for debugging
        if (process.env.DEBUG) process.stderr.write('[session-memory] saveMemory error: ' + err.message + '\n');
    }
}

function extractTranscriptContent(transcript, existingMemory) {
    const lines = transcript.split('\n').filter(Boolean);
    const messages = [];

    let startFromLine = 0;
    if (existingMemory) {
        for (let i = lines.length - 1; i >= 0; i--) {
            try {
                const entry = JSON.parse(lines[i]);
                if (entry.type === 'summary') {
                    startFromLine = i + 1;
                    break;
                }
            } catch (e) {}
        }
    }

    for (let i = startFromLine; i < lines.length; i++) {
        try {
            const entry = JSON.parse(lines[i]);

            if (entry.type === 'user' && entry.message?.content) {
                const content = typeof entry.message.content === 'string'
                    ? entry.message.content
                    : JSON.stringify(entry.message.content);
                messages.push(`USER: ${content.slice(0, 500)}`);
            }

            if (entry.type === 'assistant' && entry.message?.content) {
                const content = entry.message.content;
                let text = '';
                if (Array.isArray(content)) {
                    text = content
                        .filter(b => b.type === 'text')
                        .map(b => b.text)
                        .join('\n')
                        .slice(0, 1000);
                    // Extract tool_use blocks (nested inside assistant messages)
                    for (const block of content) {
                        if (block.type === 'tool_use') {
                            const args = JSON.stringify(block.input || {}).slice(0, 150);
                            messages.push('TOOL: ' + (block.name || 'unknown') + ' ' + args);
                        }
                    }
                } else if (typeof content === 'string') {
                    text = content.slice(0, 1000);
                }
                if (text) {
                    messages.push('ASSISTANT: ' + text);
                }
            }

            // Extract tool errors from user entries (tool_result blocks)
            if (entry.type === 'user' && Array.isArray(entry.message?.content)) {
                for (const block of entry.message.content) {
                    if (block.type === 'tool_result' && block.is_error) {
                        const errText = typeof block.content === 'string'
                            ? block.content.slice(0, 200)
                            : JSON.stringify(block.content).slice(0, 200);
                        messages.push('TOOL_ERROR: ' + errText);
                    }
                }
            }

        } catch (e) {}
    }

    let result = messages.join('\n\n');
    if (result.length > 200000) {
        result = result.slice(0, 200000);
    }

    return result;
}

async function callLLM(apiKey, content, existingMemory, config) {
    const llmConfig = config.llm?.summarize;
    if (!llmConfig) {
        // No LLM configured — preserve existing real memory if available,
        // otherwise return null to prevent writing a poisoned stub
        if (hasRealContent(existingMemory)) {
            return {
                projectContext: existingMemory.projectContext,
                overallDirection: existingMemory.overallDirection,
                keyPoints: existingMemory.keyPoints || []
            };
        }
        return null;
    }

    const isFirst = !existingMemory;
    const prompt = isFirst
        ? `You are a session historian. Analyze this Claude Code conversation and create a sparse memory summary.

Extract:
1. Project Context: What codebase/project? (1 line)
2. Overall Direction: What is the goal? (1-2 sentences)
3. Key Points: 3-5 major decisions/discoveries (bullet points, brief)

Format as JSON:
{
  "projectContext": "Working on X in Y codebase",
  "overallDirection": "User is building/fixing...",
  "keyPoints": ["Discovered X", "Decided Y", "Completed Z"]
}

TRANSCRIPT:
${content}`
        : `You are a session historian. This is compaction #${existingMemory.compactionCount + 1}.

Previous memory:
${JSON.stringify({
    projectContext: existingMemory.projectContext,
    overallDirection: existingMemory.overallDirection,
    keyPoints: existingMemory.keyPoints,
    longTermNarrative: existingMemory.longTermNarrative
}, null, 2)}

New transcript:
${content}

Update the memory:
1. Keep projectContext unless changed
2. Update overallDirection if focus shifted
3. Add 1-3 new key points (keep total under 10)
4. Write brief longTermNarrative (2-3 sentences)

Format as JSON.`;

    try {
        const result = await callLlm(apiKey, llmConfig, prompt, {
            title: 'Claude Code Session Memory',
        });
        if (result) return result;
        throw new Error('No JSON in response');
    } catch (err) {
        if (process.env.DEBUG) process.stderr.write('[session-memory] LLM failed: ' + err.message + '\n');
        // If existing memory has real content, preserve it; otherwise return null
        // to prevent saveMemory from writing a poisoned stub
        if (hasRealContent(existingMemory)) {
            return {
                projectContext: existingMemory.projectContext,
                overallDirection: existingMemory.overallDirection,
                keyPoints: existingMemory.keyPoints || []
            };
        }
        return null;
    }
}

function saveBasicMemory(memoryPath, sessionId, existingMemory) {
    // If no existing memory or existing is poisoned, do NOT create a stub file.
    // Writing nothing is better than poisoning — a future compaction with an API key
    // will create a real memory from fresh LLM summarization.
    if (!existingMemory) return;

    // Existing memory has real content — preserve it with updated compaction count
    const memory = {
        ...existingMemory,
        sessionId,
        lastCompactionAt: new Date().toISOString(),
        compactionCount: (existingMemory.compactionCount || 0) + 1,
    };
    writeFileSync(memoryPath, JSON.stringify(memory, null, 2));
}
