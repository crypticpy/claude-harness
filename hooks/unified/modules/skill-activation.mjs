/**
 * Skill Activation Module
 * Consolidated from SkillActivationHook
 * Suggests relevant skills based on prompt content
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const STATE_FILE = join(__dirname, '..', 'skill-state.json');

export async function checkSkills(event, _config) {
    try {
        const { prompt, session_id } = event;
        if (!prompt || !session_id) return null;

        const promptLower = prompt.toLowerCase();

        // Load skill rules
        const projectDir = process.env.CLAUDE_PROJECT_DIR;
        const projectRulesPath = projectDir 
            ? join(projectDir, '.claude', 'skills', 'skill-rules.json')
            : null;
        const globalRulesPath = join(__dirname, '..', 'skill-rules.json');

        // Try project-level first, but fall through if it's a redirect stub
        let rules = null;
        if (projectRulesPath && existsSync(projectRulesPath)) {
            const parsed = JSON.parse(readFileSync(projectRulesPath, 'utf-8'));
            if (parsed?.skills && !parsed.redirect) {
                rules = parsed;
            }
        }
        // Fall back to canonical location in hooks/unified/
        if (!rules && existsSync(globalRulesPath)) {
            const parsed = JSON.parse(readFileSync(globalRulesPath, 'utf-8'));
            if (parsed?.skills) {
                rules = parsed;
            }
        }
        if (!rules) return null;

        // Load state
        let state = {};
        if (existsSync(STATE_FILE)) {
            try {
                state = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
            } catch (e) {
                state = {};
            }
        }

        // Cleanup old sessions (7 days)
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        for (const [sid, data] of Object.entries(state)) {
            if (data.lastUpdated && data.lastUpdated < sevenDaysAgo) {
                delete state[sid];
            }
        }

        const alreadyRecommended = state[session_id]?.skills || [];
        const matchedSkills = [];

        // Check each skill
        for (const [skillName, skillConfig] of Object.entries(rules.skills)) {
            const triggers = skillConfig.promptTriggers;
            if (!triggers) continue;
            if (alreadyRecommended.includes(skillName)) continue;

            // Check exclude patterns
            if (triggers.excludePatterns?.some(p => new RegExp(p, 'i').test(promptLower))) {
                continue;
            }

            // Keyword matching
            if (triggers.keywords?.some(kw => promptLower.includes(kw.toLowerCase()))) {
                matchedSkills.push({ name: skillName, config: skillConfig });
                continue;
            }

            // Intent pattern matching
            if (triggers.intentPatterns?.some(p => new RegExp(p, 'i').test(promptLower))) {
                matchedSkills.push({ name: skillName, config: skillConfig });
            }
        }

        if (matchedSkills.length === 0) return null;

        // Group by priority
        const groups = {
            critical: matchedSkills.filter(s => s.config.priority === 'critical'),
            high: matchedSkills.filter(s => s.config.priority === 'high'),
            medium: matchedSkills.filter(s => s.config.priority === 'medium'),
            low: matchedSkills.filter(s => s.config.priority === 'low')
        };

        let output = '🎯 SKILL ACTIVATION CHECK\n\n';

        // Helper to format a skill entry with type-aware action
        const formatSkill = (s) => {
            if (s.config.type === 'slash-command' && s.config.action) {
                return `  → ${s.name} — ${s.config.action}\n`;
            }
            return `  → ${s.name}\n`;
        };

        if (groups.critical.length > 0) {
            output += '⚠️  CRITICAL SKILLS (REQUIRED):\n';
            groups.critical.forEach(s => output += formatSkill(s));
            output += '\n';
        }

        if (groups.high.length > 0) {
            output += '📚 RECOMMENDED SKILLS:\n';
            groups.high.forEach(s => output += formatSkill(s));
            output += '\n';
        }

        if (groups.medium.length > 0) {
            output += '💡 SUGGESTED SKILLS:\n';
            groups.medium.forEach(s => output += formatSkill(s));
            output += '\n';
        }

        // Proactive hints
        const proactive = matchedSkills.filter(s =>
            s.config.type === 'proactive' && s.config.promptTriggers?.proactiveHint
        );
        if (proactive.length > 0) {
            output += '💡 PROACTIVE HINTS:\n';
            proactive.forEach(s => {
                output += `  ${s.config.promptTriggers.proactiveHint}\n`;
                if (s.config.promptTriggers.mcpTools) {
                    output += `  Tools: ${s.config.promptTriggers.mcpTools.join(', ')}\n`;
                }
            });
            output += '\n';
        }

        // Build context-aware action line
        const skillToolSkills = matchedSkills.filter(s => s.config.type !== 'slash-command');
        const slashCmdSkills = matchedSkills.filter(s => s.config.type === 'slash-command');
        const actions = [];
        if (skillToolSkills.length > 0) {
            actions.push('Use Skill tool BEFORE responding');
        }
        if (slashCmdSkills.length > 0) {
            slashCmdSkills.forEach(s => {
                if (s.config.action) actions.push(s.config.action);
            });
        }
        output += `ACTION: ${actions.join(' | ')}\n`;

        // Update state
        state[session_id] = {
            skills: [...alreadyRecommended, ...matchedSkills.map(s => s.name)],
            lastUpdated: new Date().toISOString()
        };
        writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

        return output;

    } catch (err) {
        return null;
    }
}
