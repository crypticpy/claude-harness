/**
 * Self-Evolution Module
 *
 * Reads accumulated lessons.jsonl entries and session memories,
 * identifies recurring patterns across sessions, and proposes
 * concrete harness improvements (CLAUDE.md, hooks, config).
 *
 * Closes the Meta-Harness-inspired feedback loop: the harness
 * improves itself over time based on observed failure patterns.
 *
 * Triggered on-demand via /evolve command or programmatically.
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync, mkdirSync, statSync } from 'fs';
import { join } from 'path';
import { callLlm } from './llm-call.mjs';
import { getApiKey } from './api-key.mjs';

const EVOLUTION_DIR = join(process.env.HOME, '.claude', 'hooks', 'unified', 'evolution');
const PROPOSALS_FILE = join(EVOLUTION_DIR, 'proposals.md');
const HISTORY_FILE = join(EVOLUTION_DIR, 'history.jsonl');

/**
 * Collect all lessons from both project-local and global lessons.jsonl files.
 */
function collectLessons() {
    const paths = new Set();

    // Global lessons
    const globalPath = join(process.env.HOME, '.claude', 'context-layer', 'lessons.jsonl');
    if (existsSync(globalPath)) paths.add(globalPath);

    // Project-specific lessons (scan known project dirs)
    const projectDir = process.env.CLAUDE_PROJECT_DIR;
    if (projectDir) {
        const projectPath = join(projectDir, '.claude', 'context-layer', 'lessons.jsonl');
        if (existsSync(projectPath)) paths.add(projectPath);
    }

    const allEntries = [];
    for (const p of paths) {
        try {
            const content = readFileSync(p, 'utf-8').trim();
            if (!content) continue;
            for (const line of content.split('\n')) {
                try {
                    const entry = JSON.parse(line.trim());
                    entry._source = p;
                    allEntries.push(entry);
                } catch (_) { /* skip malformed */ }
            }
        } catch (_) { /* skip inaccessible */ }
    }

    return allEntries;
}

/**
 * Collect session memory summaries for cross-session context.
 */
function collectSessionMemories(limit = 20) {
    const memoriesDir = join(process.env.HOME, '.claude', 'hooks', 'unified', 'memories');
    if (!existsSync(memoriesDir)) return [];

    try {
        const files = readdirSync(memoriesDir)
            .filter(f => f.endsWith('.json'))
            .map(f => ({ name: f, mtime: statSync(join(memoriesDir, f)).mtimeMs }))
            .sort((a, b) => a.mtime - b.mtime)
            .slice(-limit)
            .map(f => f.name);

        const memories = [];
        for (const file of files) {
            try {
                const data = JSON.parse(readFileSync(join(memoriesDir, file), 'utf-8'));
                if (data.summary || data.context) {
                    memories.push({
                        session: file.replace('.json', ''),
                        summary: data.summary || data.context,
                        timestamp: data.timestamp || null,
                    });
                }
            } catch (_) { /* skip malformed */ }
        }
        return memories;
    } catch (_) {
        return [];
    }
}

/**
 * Aggregate lesson entries into pattern frequencies.
 * Groups similar lessons and counts occurrences.
 */
function aggregatePatterns(entries) {
    const diagnosisEntries = entries.filter(e => e.type === 'trace-diagnosis');
    const otherEntries = entries.filter(e => e.type !== 'trace-diagnosis');

    // Collect all lessons, patterns, and improvements from diagnosis entries
    const allLessons = [];
    const allPatterns = [];
    const allImprovements = [];
    const efficiencyScores = [];
    const stats = {
        totalSessions: diagnosisEntries.length,
        totalToolErrors: 0,
        totalRetryPatterns: 0,
        totalExplorationSpirals: 0,
        totalContextSwitches: 0,
        totalPermissionDenials: 0,
    };

    for (const entry of diagnosisEntries) {
        if (Array.isArray(entry.lessons)) allLessons.push(...entry.lessons);
        if (Array.isArray(entry.patterns)) allPatterns.push(...entry.patterns);
        if (Array.isArray(entry.improvements)) allImprovements.push(...entry.improvements);
        if (entry.efficiency != null) efficiencyScores.push(entry.efficiency);
        if (entry.stats) {
            stats.totalToolErrors += entry.stats.toolErrors || 0;
            stats.totalRetryPatterns += entry.stats.retryPatterns || 0;
            stats.totalExplorationSpirals += entry.stats.explorationSpirals || 0;
            stats.totalContextSwitches += entry.stats.contextSwitches || 0;
            stats.totalPermissionDenials += entry.stats.permissionDenials || 0;
        }
    }

    // Add standalone lessons
    for (const entry of otherEntries) {
        if (entry.lesson) allLessons.push(entry.lesson);
        if (entry.summary) allLessons.push(entry.summary);
    }

    const avgEfficiency = efficiencyScores.length > 0
        ? Math.round((efficiencyScores.reduce((a, b) => a + b, 0) / efficiencyScores.length) * 10) / 10
        : null;

    return {
        lessons: allLessons,
        patterns: allPatterns,
        improvements: allImprovements,
        stats,
        avgEfficiency,
        sessionCount: entries.length,
        diagnosisCount: diagnosisEntries.length,
    };
}

/**
 * Call the LLM to synthesize patterns into actionable proposals.
 */
async function synthesizeProposals(aggregated, memories, config) {
    const apiKey = getApiKey();
    if (!apiKey) {
        throw new Error('No API key available for evolution synthesis');
    }

    const llmConfig = config.llm?.recall;
    if (!llmConfig) {
        throw new Error('No recall LLM configured');
    }

    // Read current CLAUDE.md for context
    let claudeMd = '';
    const claudeMdPath = join(process.env.HOME, '.claude', 'CLAUDE.md');
    if (existsSync(claudeMdPath)) {
        claudeMd = readFileSync(claudeMdPath, 'utf-8');
    }

    // Read current config.json
    let currentConfig = '';
    const configPath = join(process.env.HOME, '.claude', 'hooks', 'unified', 'config.json');
    if (existsSync(configPath)) {
        currentConfig = readFileSync(configPath, 'utf-8');
    }

    const prompt = `You are a Claude Code harness optimizer. Analyze accumulated session data and propose specific improvements.

## Accumulated Data (${aggregated.sessionCount} sessions, ${aggregated.diagnosisCount} diagnosed)

### Aggregate Stats
- Average efficiency: ${aggregated.avgEfficiency || 'N/A'}/10
- Total tool errors: ${aggregated.stats.totalToolErrors}
- Total retry patterns: ${aggregated.stats.totalRetryPatterns}
- Total exploration spirals: ${aggregated.stats.totalExplorationSpirals}
- Total context switches: ${aggregated.stats.totalContextSwitches}
- Total permission denials: ${aggregated.stats.totalPermissionDenials}

### Recurring Lessons (${aggregated.lessons.length} total)
${aggregated.lessons.slice(0, 30).map((l, i) => `${i + 1}. ${l}`).join('\n')}

### Observed Patterns (${aggregated.patterns.length} total)
${aggregated.patterns.slice(0, 20).map((p, i) => `${i + 1}. ${p}`).join('\n')}

### Suggested Improvements from Past Sessions
${aggregated.improvements.slice(0, 20).map((imp, i) => `${i + 1}. ${imp}`).join('\n')}

### Recent Session Summaries
${memories.slice(0, 10).map(m => `- [${m.session}]: ${typeof m.summary === 'string' ? m.summary.slice(0, 200) : JSON.stringify(m.summary).slice(0, 200)}`).join('\n')}

## Current Harness State

### CLAUDE.md (truncated)
${claudeMd.slice(0, 3000)}

### Hook Config
${currentConfig.slice(0, 2000)}

## Task

Based on the recurring patterns above, propose 3-7 specific, actionable changes to improve the harness. Each proposal should:
1. Target a specific file (CLAUDE.md, config.json, a hook module, or a command)
2. Describe the exact change
3. Explain why (which recurring pattern it addresses)
4. Rate confidence (high/medium/low) based on how many sessions support it

IMPORTANT: Only propose changes backed by MULTIPLE sessions or STRONG signals. Don't propose speculative improvements.

Respond with valid JSON:
{
  "summary": "1-2 sentence overall assessment",
  "proposals": [
    {
      "id": "prop-1",
      "title": "Short title",
      "target": "file path or component name",
      "change": "Specific description of what to change",
      "rationale": "Why — which pattern(s) this addresses",
      "confidence": "high|medium|low",
      "category": "config|behavior|hook|command|memory"
    }
  ],
  "health": {
    "score": 1-10,
    "trend": "improving|stable|declining",
    "topIssue": "The single most impactful issue to fix"
  }
}`;

    return await callLlm(apiKey, llmConfig, prompt, {
        timeoutMs: 45_000,
        title: 'Claude Code Self-Evolution',
        temperature: 0.4,
    });
}

/**
 * Format proposals as a readable markdown document.
 */
function formatProposalsMarkdown(result, aggregated) {
    const now = new Date().toISOString().split('T')[0];
    let md = `# Harness Evolution Proposals
> Generated: ${now} | Sessions analyzed: ${aggregated.sessionCount} | Diagnosed: ${aggregated.diagnosisCount}

## Health Assessment
- **Score**: ${result.health?.score || '?'}/10
- **Trend**: ${result.health?.trend || 'unknown'}
- **Top Issue**: ${result.health?.topIssue || 'None identified'}
- **Avg Session Efficiency**: ${aggregated.avgEfficiency || 'N/A'}/10

## Summary
${result.summary || 'No summary available.'}

---

## Proposals

`;

    if (result.proposals && result.proposals.length > 0) {
        for (const p of result.proposals) {
            md += `### ${p.id}: ${p.title}
- **Target**: \`${p.target}\`
- **Confidence**: ${p.confidence}
- **Category**: ${p.category}

**Change**: ${p.change}

**Rationale**: ${p.rationale}

**Status**: [ ] Pending review

---

`;
        }
    } else {
        md += '_No proposals generated. The harness may already be well-optimized, or more session data is needed._\n';
    }

    md += `## Raw Stats
| Metric | Value |
|--------|-------|
| Sessions | ${aggregated.sessionCount} |
| Diagnosed | ${aggregated.diagnosisCount} |
| Tool Errors | ${aggregated.stats.totalToolErrors} |
| Retry Patterns | ${aggregated.stats.totalRetryPatterns} |
| Exploration Spirals | ${aggregated.stats.totalExplorationSpirals} |
| Context Switches | ${aggregated.stats.totalContextSwitches} |
| Permission Denials | ${aggregated.stats.totalPermissionDenials} |
`;

    return md;
}

/**
 * Main entry point: run the self-evolution analysis.
 * Returns a summary string suitable for display to the user.
 */
export async function evolve(config) {
    // Ensure evolution directory exists
    if (!existsSync(EVOLUTION_DIR)) {
        mkdirSync(EVOLUTION_DIR, { recursive: true });
    }

    // Step 1: Collect data
    const lessons = collectLessons();
    const memories = collectSessionMemories();

    if (lessons.length === 0 && memories.length === 0) {
        return {
            success: false,
            message: 'No lesson data found. The self-evolution loop needs session data from trace-diagnosis (PreCompact hook). Run a few sessions with significant tool usage first.',
            proposalsPath: null,
        };
    }

    // Gate: require minimum sessions before spending API credits
    const minSessions = config.evolution?.minSessionsForAnalysis || 3;
    if (lessons.length < minSessions) {
        return {
            success: false,
            message: `Only ${lessons.length} lesson entries found (minimum: ${minSessions}). Run more sessions to accumulate data before evolution analysis.`,
            proposalsPath: null,
        };
    }

    // Step 2: Aggregate patterns
    const aggregated = aggregatePatterns(lessons);

    // Step 3: Synthesize proposals via LLM
    let result;
    try {
        result = await synthesizeProposals(aggregated, memories, config);
    } catch (err) {
        return {
            success: false,
            message: `Evolution synthesis failed: ${err.message}`,
            proposalsPath: null,
            aggregated,
        };
    }

    if (!result) {
        return {
            success: false,
            message: 'LLM returned no proposals. This may indicate insufficient data or an API issue.',
            proposalsPath: null,
            aggregated,
        };
    }

    // Step 4: Write proposals (versioned by date, preserves previous runs)
    const dateStr = new Date().toISOString().split('T')[0];
    const versionedPath = join(EVOLUTION_DIR, `proposals-${dateStr}.md`);
    const markdown = formatProposalsMarkdown(result, aggregated);
    writeFileSync(versionedPath, markdown);
    // Also write to canonical path for easy access
    writeFileSync(PROPOSALS_FILE, markdown);

    // Step 5: Record history (atomic append, no read-modify-write)
    const historyEntry = {
        timestamp: new Date().toISOString(),
        sessionsAnalyzed: aggregated.sessionCount,
        diagnosedSessions: aggregated.diagnosisCount,
        avgEfficiency: aggregated.avgEfficiency,
        proposalCount: result.proposals?.length || 0,
        healthScore: result.health?.score || null,
        trend: result.health?.trend || null,
    };
    appendFileSync(HISTORY_FILE, JSON.stringify(historyEntry) + '\n');

    return {
        success: true,
        message: `Evolution analysis complete. ${result.proposals?.length || 0} proposals generated.`,
        proposalsPath: PROPOSALS_FILE,
        health: result.health,
        summary: result.summary,
        proposalCount: result.proposals?.length || 0,
        aggregated,
    };
}
