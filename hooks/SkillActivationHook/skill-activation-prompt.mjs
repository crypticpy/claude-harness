#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

async function main() {
    try {
        // Read input from stdin
        const input = readFileSync(0, 'utf-8');
        const data = JSON.parse(input);
        const prompt = data.prompt.toLowerCase();
        const sessionId = data.session_id;

        // Load skill rules
        // Prefer project-local rules (if this project uses ClaudeFast), otherwise fall back to global rules.
        // Claude Code sets CLAUDE_PROJECT_DIR for hooks.
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);

        const projectDir = process.env.CLAUDE_PROJECT_DIR;
        const projectRulesPath = projectDir
            ? join(projectDir, '.claude', 'skills', 'skill-rules.json')
            : null;

        const globalRulesPath = join(__dirname, 'skill-rules.json');

        let rules = null;
        let rulesPathUsed = null;

        if (projectRulesPath && existsSync(projectRulesPath)) {
            rulesPathUsed = projectRulesPath;
        } else if (existsSync(globalRulesPath)) {
            rulesPathUsed = globalRulesPath;
        }

        // If no rules exist, exit successfully with no output.
        if (!rulesPathUsed) {
            process.exit(0);
        }

        rules = JSON.parse(readFileSync(rulesPathUsed, 'utf-8'));

        // Defensive: if rules are missing expected structure, do nothing.
        if (!rules || typeof rules !== 'object' || !rules.skills || typeof rules.skills !== 'object') {
            process.exit(0);
        }

        // State file for tracking recommendations per session
        const stateFilePath = join(__dirname, 'recommendation-log.json');

        // Load existing state
        let state = {};
        if (existsSync(stateFilePath)) {
            try {
                state = JSON.parse(readFileSync(stateFilePath, 'utf-8'));
            } catch (err) {
                // If state file is corrupted, start fresh
                state = {};
            }
        }

        // Cleanup old sessions (older than 7 days)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const sevenDaysAgoISO = sevenDaysAgo.toISOString();

        for (const [sid, sessionData] of Object.entries(state)) {
            if (sessionData.lastUpdated && sessionData.lastUpdated < sevenDaysAgoISO) {
                delete state[sid];
            }
        }

        // Get already recommended skills for this session
        const alreadyRecommended = state[sessionId]?.skills || [];
        const now = new Date();
        const lastUpdated = now.toISOString();
        const lastUpdatedDate = now.toLocaleString('en-US', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        }).replace(',', '');

        const matchedSkills = [];

        // Check each skill for matches
        for (const [skillName, config] of Object.entries(rules.skills)) {
            const triggers = config.promptTriggers;
            if (!triggers) {
                continue;
            }

            // Skip if already recommended in this session
            if (alreadyRecommended.includes(skillName)) {
                continue;
            }

            // Keyword matching
            if (triggers.keywords) {
                const keywordMatch = triggers.keywords.some(kw =>
                    prompt.includes(kw.toLowerCase())
                );
                if (keywordMatch) {
                    matchedSkills.push({ name: skillName, matchType: 'keyword', config });
                    continue;
                }
            }

            // Intent pattern matching
            if (triggers.intentPatterns) {
                const intentMatch = triggers.intentPatterns.some(pattern => {
                    const regex = new RegExp(pattern, 'i');
                    return regex.test(prompt);
                });
                if (intentMatch) {
                    matchedSkills.push({ name: skillName, matchType: 'intent', config });
                }
            }
        }

        // Generate output if NEW matches found
        if (matchedSkills.length > 0) {
            let output = '🎯 SKILL ACTIVATION CHECK\n\n';

            // Group by priority
            const critical = matchedSkills.filter(s => s.config.priority === 'critical');
            const high = matchedSkills.filter(s => s.config.priority === 'high');
            const medium = matchedSkills.filter(s => s.config.priority === 'medium');
            const low = matchedSkills.filter(s => s.config.priority === 'low');

            if (critical.length > 0) {
                output += '⚠️  CRITICAL SKILLS (REQUIRED):\n';
                critical.forEach(s => output += `  → ${s.name}\n`);
                output += '\n';
            }

            if (high.length > 0) {
                output += '📚 RECOMMENDED SKILLS:\n';
                high.forEach(s => output += `  → ${s.name}\n`);
                output += '\n';
            }

            if (medium.length > 0) {
                output += '💡 SUGGESTED SKILLS:\n';
                medium.forEach(s => output += `  → ${s.name}\n`);
                output += '\n';
            }

            if (low.length > 0) {
                output += '📌 OPTIONAL SKILLS:\n';
                low.forEach(s => output += `  → ${s.name}\n`);
                output += '\n';
            }

            output += 'ACTION: Use Skill tool BEFORE responding\n';

            console.log(output);

            // Update state with newly recommended skills
            const newlyRecommendedSkills = matchedSkills.map(s => s.name);
            state[sessionId] = {
                skills: [...alreadyRecommended, ...newlyRecommendedSkills],
                lastUpdated,
                lastUpdatedDate
            };

            // Write updated state
            writeFileSync(stateFilePath, JSON.stringify(state, null, 2), 'utf-8');
        }

        process.exit(0);
    } catch (err) {
        console.error('Error in skill-activation-prompt hook:', err);
        process.exit(1);
    }
}

main().catch(err => {
    console.error('Uncaught error:', err);
    process.exit(1);
});
