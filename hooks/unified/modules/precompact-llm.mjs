/**
 * PreCompact LLM Consolidation Module
 *
 * Replaces two separate LLM calls (session-memory.saveMemory + trace-diagnosis.diagnoseSession)
 * with a single combined call. Reads the transcript once, asks the LLM for both
 * narrative memory and efficiency diagnosis, then dispatches results to both sinks:
 *   - memory file at hooks/unified/memories/<session_id>.json  (used by session-memory.injectMemory)
 *   - lessons.jsonl in the project's context-layer dir         (used by retrospective + evolve)
 *
 * Why: halves PreCompact LLM cost, eliminates duplicated transcript parsing,
 * and keeps the prompt aware of cross-compaction memory when producing diagnosis.
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { callLlm } from './llm-call.mjs';
import { isPoisonedMemory, hasRealContent } from './session-memory.mjs';

const MEMORIES_DIR = join(process.env.HOME, '.claude', 'hooks', 'unified', 'memories');
const MAX_TRANSCRIPT_CHARS = 500_000;
const MIN_TOOL_CALLS = 5;
const LLM_TIMEOUT_MS = 60_000;
const MAX_MILESTONES = 60; // append-only punch list; oldest entries drop past this

if (!existsSync(MEMORIES_DIR)) {
    mkdirSync(MEMORIES_DIR, { recursive: true });
}

/**
 * Parse JSONL transcript and extract signal counts + a condensed message stream.
 * Combines the previously-separate logic from trace-diagnosis (signals) and
 * session-memory (content extraction) into one pass.
 */
export function parseTranscript(transcript, existingMemory) {
    const lines = transcript.split('\n').filter(Boolean);
    const signals = {
        totalTurns: 0,
        totalToolCalls: 0,
        toolErrors: 0,
        retryPatterns: 0,
        explorationSpirals: 0,
        contextSwitches: 0,
        permissionDenials: 0,
        errorMessages: [],
    };
    const messages = [];

    let lastToolName = null;
    let lastToolArgs = null;
    let consecutiveSameTool = 0;
    let consecutiveBashCount = 0;
    let lastFileContext = null;

    // If continuing from prior memory, skip past the most recent transcript-summary marker
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
        let entry;
        try { entry = JSON.parse(lines[i]); } catch (e) { continue; }

        if (entry.type === 'user' || entry.type === 'assistant') {
            signals.totalTurns++;
        }

        // Assistant: text + tool_use blocks
        if (entry.type === 'assistant' && Array.isArray(entry.message?.content)) {
            let textBuf = '';
            for (const block of entry.message.content) {
                if (block.type === 'text' && block.text) {
                    textBuf += block.text + '\n';
                }
                if (block.type === 'tool_use') {
                    signals.totalToolCalls++;
                    const toolName = block.name || 'unknown';
                    const toolArgs = JSON.stringify(block.input || {}).slice(0, 200);

                    if (toolName === lastToolName && toolArgs === lastToolArgs) {
                        consecutiveSameTool++;
                        if (consecutiveSameTool >= 2) signals.retryPatterns++;
                    } else {
                        consecutiveSameTool = 0;
                    }

                    if (toolName === 'Bash' || toolName === 'bash') {
                        consecutiveBashCount++;
                        if (consecutiveBashCount >= 5) {
                            signals.explorationSpirals++;
                            consecutiveBashCount = 0;
                        }
                    } else {
                        consecutiveBashCount = 0;
                    }

                    const inputStr = JSON.stringify(block.input || {});
                    const fileMatch = inputStr.match(/["']([^"']+\.\w{1,5})["']/);
                    if (fileMatch) {
                        const currentFile = fileMatch[1];
                        if (lastFileContext && currentFile !== lastFileContext) {
                            signals.contextSwitches++;
                        }
                        lastFileContext = currentFile;
                    }

                    messages.push('TOOL: ' + toolName + ' ' + toolArgs.slice(0, 150));
                    lastToolName = toolName;
                    lastToolArgs = toolArgs;
                }
            }
            if (textBuf) messages.push('ASSISTANT: ' + textBuf.slice(0, 1000));
        }

        // User: plain text or tool_result blocks
        if (entry.type === 'user' && entry.message?.content) {
            const content = entry.message.content;
            if (Array.isArray(content)) {
                for (const block of content) {
                    if (block.type === 'tool_result') {
                        const text = typeof block.content === 'string'
                            ? block.content
                            : JSON.stringify(block.content || '');
                        if (block.is_error) {
                            signals.toolErrors++;
                            signals.errorMessages.push(text.slice(0, 200));
                            messages.push('TOOL_ERROR: ' + text.slice(0, 200));
                        }
                        if (/permission denied|EACCES|EPERM|not permitted|unauthorized/i.test(text)) {
                            signals.permissionDenials++;
                        }
                    }
                }
            } else if (typeof content === 'string') {
                messages.push('USER: ' + content.slice(0, 500));
            }
        }
    }

    let condensed = messages.join('\n\n');
    if (condensed.length > MAX_TRANSCRIPT_CHARS) {
        condensed = condensed.slice(0, MAX_TRANSCRIPT_CHARS) + '\n...[TRUNCATED]';
    }

    return { signals, condensed };
}

function buildCombinedPrompt(condensed, signals, existingMemory) {
    const signalsBlock = [
        `Total turns: ${signals.totalTurns}`,
        `Total tool calls: ${signals.totalToolCalls}`,
        `Tool errors: ${signals.toolErrors}`,
        `Retry patterns: ${signals.retryPatterns}`,
        `Exploration spirals (5+ sequential bash): ${signals.explorationSpirals}`,
        `Context switches: ${signals.contextSwitches}`,
        `Permission denials: ${signals.permissionDenials}`,
    ].join('\n');

    const errorBlock = signals.errorMessages.length > 0
        ? `\nError samples:\n${signals.errorMessages.slice(0, 10).join('\n')}\n`
        : '';

    const recentMilestones = Array.isArray(existingMemory?.milestones)
        ? existingMemory.milestones.slice(-15).map(m => (typeof m === 'string' ? m : `[#${m.c}] ${m.t}`))
        : [];
    const priorBlock = existingMemory ? `
This is compaction #${(existingMemory.compactionCount || 0) + 1}. Prior memory:
${JSON.stringify({
    projectContext: existingMemory.projectContext,
    overallDirection: existingMemory.overallDirection,
    recentMilestones,
    longTermNarrative: existingMemory.longTermNarrative
}, null, 2)}
` : 'This is the first compaction of this session.';

    return `You are a Claude Code session analyst. Produce both (a) narrative memory for the next session window and (b) efficiency diagnosis.

${priorBlock}

Pre-computed signals:
${signalsBlock}
${errorBlock}
CONDENSED TRANSCRIPT:
${condensed}

Respond ONLY with valid JSON in this exact shape:
{
  "memory": {
    "projectContext": "one-line: what codebase/project",
    "overallDirection": "1-2 sentences: the current high-level goal / what the user is working toward now",
    "newMilestones": ["1-4 terse past-tense bullets of MAJOR events, decisions, or goals reached in THIS window ONLY (high-level punch list, NOT per-edit detail). Do NOT repeat anything already in recentMilestones. Use [] if nothing significant happened."],
    "longTermNarrative": "2-3 sentence story of the session's progression so far (omit on first compaction)"
  },
  "diagnosis": {
    "efficiency": <integer 1-10>,
    "patterns": ["failure patterns or wasted-turn patterns observed (empty array if none)"],
    "lessons": ["concrete lessons for future sessions (use ['Session completed without significant issues'] for clean runs)"],
    "improvements": ["actionable improvements to prompts, tools, or workflow (empty if none)"]
  }
}

If memory updates would result in placeholder text like "Unknown" or "In progress", instead carry forward the prior memory fields verbatim.`;
}

function loadExistingMemory(memoryPath) {
    if (!existsSync(memoryPath)) return null;
    try {
        const mem = JSON.parse(readFileSync(memoryPath, 'utf-8'));
        if (isPoisonedMemory(mem)) return null;
        return mem;
    } catch (e) {
        return null;
    }
}

function resolveLessonsPath() {
    const projectDir = process.env.CLAUDE_PROJECT_DIR;
    if (projectDir) {
        const primary = join(projectDir, '.claude', 'context-layer', 'lessons.jsonl');
        const primaryDir = join(projectDir, '.claude', 'context-layer');
        try {
            mkdirSync(primaryDir, { recursive: true });
            return primary;
        } catch (e) {}
    }
    const fallbackDir = join(process.env.HOME, '.claude', 'context-layer');
    mkdirSync(fallbackDir, { recursive: true });
    return join(fallbackDir, 'lessons.jsonl');
}

function writeMemory(memoryPath, sessionId, memoryFields, existingMemory) {
    if (isPoisonedMemory(memoryFields)) {
        if (hasRealContent(existingMemory)) {
            const preserved = {
                ...existingMemory,
                sessionId,
                lastCompactionAt: new Date().toISOString(),
                compactionCount: (existingMemory.compactionCount || 0) + 1,
            };
            writeFileSync(memoryPath, JSON.stringify(preserved, null, 2));
        }
        return;
    }

    const compactionCount = (existingMemory?.compactionCount || 0) + 1;

    // Append-only punch list: keep prior milestones verbatim, add this window's.
    // (Existing milestones are {c, t} objects, so the string filter ignores them
    //  on the preserve path — only fresh `newMilestones` strings get appended.)
    const priorMilestones = Array.isArray(existingMemory?.milestones) ? existingMemory.milestones : [];
    const freshMilestones = (memoryFields.newMilestones || [])
        .filter(m => typeof m === 'string' && m.trim())
        .map(t => ({ c: compactionCount, t: t.trim() }));
    const milestones = [...priorMilestones, ...freshMilestones].slice(-MAX_MILESTONES);

    const memory = {
        sessionId,
        startedAt: existingMemory?.startedAt || new Date().toISOString(),
        lastCompactionAt: new Date().toISOString(),
        compactionCount,
        projectContext: memoryFields.projectContext,
        overallDirection: memoryFields.overallDirection,
        milestones,
        longTermNarrative: memoryFields.longTermNarrative,
    };
    writeFileSync(memoryPath, JSON.stringify(memory, null, 2));
}

function writeLesson(sessionId, diagnosisFields, signals) {
    const lessonsPath = resolveLessonsPath();
    const entry = {
        timestamp: new Date().toISOString(),
        type: 'trace-diagnosis',
        session_id: sessionId,
        efficiency: diagnosisFields.efficiency ?? null,
        patterns: diagnosisFields.patterns || [],
        lessons: diagnosisFields.lessons || [],
        improvements: diagnosisFields.improvements || [],
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
 * Main PreCompact entry point. Single LLM call, two sinks.
 */
export async function runPreCompact(event, config, apiKey) {
    try {
        const { session_id, transcript_path } = event;
        if (!session_id || !transcript_path) return;
        if (!existsSync(transcript_path)) return;

        const transcript = readFileSync(transcript_path, 'utf-8');
        const memoryPath = join(MEMORIES_DIR, `${session_id}.json`);
        const existingMemory = loadExistingMemory(memoryPath);

        const { signals, condensed } = parseTranscript(transcript, existingMemory);

        // Sessions too short to learn from: skip everything
        if (signals.totalToolCalls < MIN_TOOL_CALLS) return;

        // No API key: preserve existing memory, write signal-only lesson, no LLM call
        if (!apiKey) {
            if (hasRealContent(existingMemory)) {
                writeMemory(memoryPath, session_id, existingMemory, existingMemory);
            }
            writeLesson(session_id, {
                efficiency: null,
                patterns: signals.errorMessages.slice(0, 5),
                lessons: ['No API key available for full diagnosis'],
                improvements: [],
            }, signals);
            return;
        }

        // Per-compaction summary (rolling history punch list) runs on the cheaper
        // summarize model; recall is reserved for on-demand recall_history queries.
        const llmConfig = config.llm?.summarize || config.llm?.recall;
        if (!llmConfig) {
            if (hasRealContent(existingMemory)) {
                writeMemory(memoryPath, session_id, existingMemory, existingMemory);
            }
            return;
        }

        const prompt = buildCombinedPrompt(condensed, signals, existingMemory);

        let result = null;
        try {
            result = await callLlm(apiKey, llmConfig, prompt, {
                timeoutMs: LLM_TIMEOUT_MS,
                title: 'Claude Code PreCompact Consolidation',
            });
        } catch (err) {
            if (process.env.DEBUG) process.stderr.write('[precompact-llm] LLM failed: ' + err.message + '\n');
        }

        if (!result || typeof result !== 'object') {
            // LLM failure: preserve existing memory if real, write basic lesson
            if (hasRealContent(existingMemory)) {
                writeMemory(memoryPath, session_id, existingMemory, existingMemory);
            }
            writeLesson(session_id, {
                efficiency: null,
                patterns: [],
                lessons: ['LLM diagnosis unavailable for this compaction'],
                improvements: [],
            }, signals);
            return;
        }

        const memoryFields = result.memory || {};
        const diagnosisFields = result.diagnosis || {};

        writeMemory(memoryPath, session_id, memoryFields, existingMemory);
        writeLesson(session_id, diagnosisFields, signals);

    } catch (err) {
        if (process.env.DEBUG) process.stderr.write('[precompact-llm] error: ' + err.message + '\n');
    }
}
