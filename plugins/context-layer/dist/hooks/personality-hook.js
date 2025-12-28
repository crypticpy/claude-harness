"use strict";
/**
 * Project Personality Hook
 *
 * Runs on UserPromptSubmit to inject project context into Claude's context.
 * Extracts stack, patterns, conventions, and gotchas from project configuration files.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleUserPromptSubmit = handleUserPromptSubmit;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
const storage_1 = require("../storage");
// =============================================================================
// Configuration
// =============================================================================
const CONFIG_FILES = [
    'package.json',
    'tsconfig.json',
    'Cargo.toml',
    'pyproject.toml',
    'CLAUDE.md',
    '.clauderc',
    'go.mod',
    'pom.xml',
    'build.gradle',
    'Gemfile',
    'composer.json',
    'requirements.txt',
    'setup.py',
];
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const SESSION_MARKER_FILE = '.claude/context-layer/.last-session';
// =============================================================================
// Token Stats Reader
// =============================================================================
const TOKEN_STATS_FILE = '/tmp/claude-context-stats.json';
const COMPACTION_THRESHOLD = 154000; // Auto-compaction happens at ~154K, not 200K
function loadTokenStats() {
    try {
        if (fs.existsSync(TOKEN_STATS_FILE)) {
            const content = fs.readFileSync(TOKEN_STATS_FILE, 'utf-8');
            return JSON.parse(content);
        }
    }
    catch { /* ignore */ }
    return null;
}
function formatTokenAwareness(stats) {
    // Calculate remaining until COMPACTION (154K), not total context (200K)
    const compactionK = Math.round(COMPACTION_THRESHOLD / 1000);
    const remainingUntilCompaction = COMPACTION_THRESHOLD - stats.current_tokens;
    const remainingK = Math.round(remainingUntilCompaction / 1000);
    // Percentage toward compaction threshold, not total context
    const percentTowardCompaction = Math.min(100, Math.round((stats.current_tokens / COMPACTION_THRESHOLD) * 100));
    let statusEmoji = '🟢';
    let warning = '';
    if (remainingUntilCompaction <= 10000) { // <10K until compaction
        statusEmoji = '🔴';
        warning = ' ⚠️ COMPACTION IMMINENT - save context!';
    }
    else if (remainingUntilCompaction <= 30000) { // <30K until compaction
        statusEmoji = '🟠';
        warning = ' - consider saving key learnings';
    }
    else if (remainingUntilCompaction <= 50000) { // <50K until compaction
        statusEmoji = '🟡';
    }
    return `${statusEmoji} Context: ${stats.current_k}K/${compactionK}K (${percentTowardCompaction}%) | ~${remainingK}K until compaction${warning}`;
}
function checkAndTriggerPreCompactionSave(projectPath) {
    const stats = loadTokenStats();
    // Trigger warning when within 10K of compaction threshold
    const warningThreshold = COMPACTION_THRESHOLD - 10000;
    if (!stats || stats.current_tokens < warningThreshold) {
        return null;
    }
    // We're approaching compaction! Generate a save reminder
    const brainDir = path.join(projectPath, '.claude', 'context-layer');
    const saveFile = path.join(brainDir, 'pre-compaction-state.json');
    // Check if we already saved recently (within last 5 min)
    try {
        if (fs.existsSync(saveFile)) {
            const saved = JSON.parse(fs.readFileSync(saveFile, 'utf-8'));
            if (Date.now() - saved.timestamp < 5 * 60 * 1000) {
                return null; // Already saved recently
            }
        }
    }
    catch { /* continue */ }
    // Save current state marker
    const compactionK = Math.round(COMPACTION_THRESHOLD / 1000);
    const remainingK = Math.round((COMPACTION_THRESHOLD - stats.current_tokens) / 1000);
    const state = {
        timestamp: Date.now(),
        tokens_at_save: stats.current_tokens,
        remaining_until_compaction: COMPACTION_THRESHOLD - stats.current_tokens,
        session_cost: stats.session_cost_usd,
    };
    try {
        fs.mkdirSync(brainDir, { recursive: true });
        fs.writeFileSync(saveFile, JSON.stringify(state, null, 2));
    }
    catch { /* ignore */ }
    return `
🚨 PRE-COMPACTION CHECKPOINT (${stats.current_k}K/${compactionK}K - ~${remainingK}K remaining)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Save anything important to your brain NOW:
• Add lessons to .claude/context-layer/lessons.jsonl
• Update hot-files.json with frequently accessed files
• Note any discoveries in file-insights.json

Compaction will happen soon. Your brain files will persist!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
}
// =============================================================================
// Persistent Brain Loader
// =============================================================================
// =============================================================================
// Auto-Bootstrap: Create brain on first run
// =============================================================================
function bootstrapBrain(projectPath) {
    const brainDir = path.join(projectPath, '.claude', 'context-layer');
    // Create directory structure
    fs.mkdirSync(brainDir, { recursive: true });
    // Detect stack info
    const stack = extractStackInfo(projectPath);
    const projectName = extractProjectName(projectPath);
    // Find key entry points and high-value files
    const keyFiles = identifyKeyFiles(projectPath);
    const patterns = extractPatterns(projectPath, 10);
    // Create initial lessons.jsonl
    const lessonsPath = path.join(brainDir, 'lessons.jsonl');
    const initialLessons = [
        {
            timestamp: new Date().toISOString(),
            type: 'bootstrap',
            lesson: `Project "${projectName}" initialized. Stack: ${[...stack.languages, ...stack.frameworks].join(', ') || 'unknown'}`,
            severity: 'low',
            files: [],
        },
    ];
    fs.writeFileSync(lessonsPath, initialLessons.map(l => JSON.stringify(l)).join('\n') + '\n');
    // Create file-insights.json with key files
    const insightsPath = path.join(brainDir, 'file-insights.json');
    const insights = {};
    for (const kf of keyFiles.slice(0, 10)) {
        insights[kf.path] = {
            role: kf.purpose,
            risk: kf.importance === 'critical' ? 'high' : 'medium',
            notes: [`Identified as ${kf.importance} file`],
        };
    }
    fs.writeFileSync(insightsPath, JSON.stringify({ lastUpdated: new Date().toISOString(), insights }, null, 2));
    // Create conventions.json with detected patterns
    const conventionsPath = path.join(brainDir, 'conventions.json');
    const conventions = {};
    for (const p of patterns) {
        conventions[p.name] = { location: p.location || '', description: p.description || '' };
    }
    fs.writeFileSync(conventionsPath, JSON.stringify({
        lastUpdated: new Date().toISOString(),
        patterns: conventions,
        namingConventions: {},
    }, null, 2));
    // Create empty hot-files.json
    const hotFilesPath = path.join(brainDir, 'hot-files.json');
    fs.writeFileSync(hotFilesPath, JSON.stringify({
        lastUpdated: new Date().toISOString(),
        hotFiles: keyFiles.slice(0, 5).map(kf => ({
            path: kf.path,
            accessCount: 0,
            lastAccessed: null,
            reason: kf.purpose,
        })),
    }, null, 2));
    // Create user-prefs.json skeleton
    const prefsPath = path.join(brainDir, 'user-prefs.json');
    fs.writeFileSync(prefsPath, JSON.stringify({
        lastUpdated: new Date().toISOString(),
        preferences: {
            communicationStyle: {},
            codeStyle: {},
            workflow: {},
            quirks: [],
        },
    }, null, 2));
    // Create .gitignore for session marker
    const gitignorePath = path.join(brainDir, '.gitignore');
    fs.writeFileSync(gitignorePath, '.last-session\n');
}
function loadPersistentBrain(projectPath) {
    const brainDir = path.join(projectPath, '.claude', 'context-layer');
    // AUTO-BOOTSTRAP: If no brain exists, create one!
    if (!fs.existsSync(brainDir)) {
        try {
            bootstrapBrain(projectPath);
        }
        catch (err) {
            // Bootstrap failed, fall back to dynamic detection
            if (process.env.DEBUG) {
                console.error('[PersonalityHook] Bootstrap failed:', err);
            }
            return null;
        }
    }
    const brain = {
        lessons: [],
        conventions: {},
        fileInsights: {},
        hotFiles: [],
        userQuirks: [],
    };
    // Load lessons (JSONL format)
    const lessonsPath = path.join(brainDir, 'lessons.jsonl');
    if (fs.existsSync(lessonsPath)) {
        try {
            const content = fs.readFileSync(lessonsPath, 'utf-8');
            brain.lessons = content
                .split('\n')
                .filter(line => line.trim())
                .map(line => JSON.parse(line));
        }
        catch { /* ignore */ }
    }
    // Load conventions
    const conventionsPath = path.join(brainDir, 'conventions.json');
    if (fs.existsSync(conventionsPath)) {
        try {
            const data = JSON.parse(fs.readFileSync(conventionsPath, 'utf-8'));
            brain.conventions = data.patterns || {};
        }
        catch { /* ignore */ }
    }
    // Load file insights
    const insightsPath = path.join(brainDir, 'file-insights.json');
    if (fs.existsSync(insightsPath)) {
        try {
            const data = JSON.parse(fs.readFileSync(insightsPath, 'utf-8'));
            brain.fileInsights = data.insights || {};
        }
        catch { /* ignore */ }
    }
    // Load hot files
    const hotFilesPath = path.join(brainDir, 'hot-files.json');
    if (fs.existsSync(hotFilesPath)) {
        try {
            const data = JSON.parse(fs.readFileSync(hotFilesPath, 'utf-8'));
            brain.hotFiles = data.hotFiles || [];
        }
        catch { /* ignore */ }
    }
    // Load user preferences/quirks
    const prefsPath = path.join(brainDir, 'user-prefs.json');
    if (fs.existsSync(prefsPath)) {
        try {
            const data = JSON.parse(fs.readFileSync(prefsPath, 'utf-8'));
            brain.userQuirks = data.preferences?.quirks || [];
        }
        catch { /* ignore */ }
    }
    return brain;
}
function formatBrainContext(brain, projectPath) {
    const lines = ['<project-personality>'];
    // Token awareness - show context usage
    const tokenStats = loadTokenStats();
    if (tokenStats) {
        lines.push(formatTokenAwareness(tokenStats));
        lines.push('');
    }
    // Stack detection (still do this dynamically)
    const stack = extractStackInfo(projectPath);
    const stackParts = [...stack.languages, ...stack.frameworks];
    if (stack.database)
        stackParts.push(stack.database);
    if (stackParts.length > 0) {
        lines.push(`Stack: ${stackParts.join(', ')}`);
    }
    // Critical lessons (high severity only)
    const criticalLessons = brain.lessons
        .filter(l => l.severity === 'high')
        .slice(-3);
    if (criticalLessons.length > 0) {
        lines.push('');
        lines.push('Lessons learned:');
        for (const lesson of criticalLessons) {
            lines.push(`- ${lesson.lesson}`);
        }
    }
    // High-risk files
    const riskyFiles = Object.entries(brain.fileInsights)
        .filter(([_, insight]) => insight.risk === 'high')
        .slice(0, 3);
    if (riskyFiles.length > 0) {
        lines.push('');
        lines.push('High-risk files:');
        for (const [filePath, insight] of riskyFiles) {
            const deps = insight.dependents ? ` (${insight.dependents} deps)` : '';
            lines.push(`- ${filePath}: ${insight.role}${deps}`);
        }
    }
    // Key patterns
    const patternEntries = Object.entries(brain.conventions).slice(0, 3);
    if (patternEntries.length > 0) {
        lines.push('');
        lines.push('Patterns:');
        for (const [name, pattern] of patternEntries) {
            lines.push(`- ${name}: ${pattern.location}`);
        }
    }
    // Hot files with pre-cached intelligence
    const hotFilesWithIntel = brain.hotFiles.filter(h => h.intelligence);
    if (hotFilesWithIntel.length > 0) {
        lines.push('');
        lines.push('Hot files (auto-learned):');
        for (const hf of hotFilesWithIntel.slice(0, 5)) {
            const intel = hf.intelligence;
            const deps = intel.dependents ? ` [${intel.dependents} deps]` : '';
            const exports = intel.exports.length > 0 ? ` exports: ${intel.exports.slice(0, 3).join(', ')}` : '';
            lines.push(`- ${hf.path}${deps}: ${intel.summary.split('\n')[0]}`);
            if (exports) {
                lines.push(`  ${exports}`);
            }
        }
    }
    // User quirks
    if (brain.userQuirks.length > 0) {
        lines.push('');
        lines.push('User notes:');
        for (const quirk of brain.userQuirks.slice(0, 2)) {
            lines.push(`- ${quirk}`);
        }
    }
    lines.push('</project-personality>');
    return lines.join('\n');
}
// =============================================================================
// Session-Once Injection (only inject personality once per session)
// =============================================================================
function shouldInjectThisSession(projectPath, sessionId) {
    const markerPath = path.join(projectPath, SESSION_MARKER_FILE);
    try {
        if (fs.existsSync(markerPath)) {
            const lastSession = fs.readFileSync(markerPath, 'utf-8').trim();
            if (lastSession === sessionId) {
                // Already injected this session, skip
                return false;
            }
        }
    }
    catch {
        // If we can't read, assume we should inject
    }
    return true;
}
function markSessionInjected(projectPath, sessionId) {
    const markerPath = path.join(projectPath, SESSION_MARKER_FILE);
    const markerDir = path.dirname(markerPath);
    try {
        if (!fs.existsSync(markerDir)) {
            fs.mkdirSync(markerDir, { recursive: true });
        }
        fs.writeFileSync(markerPath, sessionId);
    }
    catch {
        // Non-critical, ignore failures
    }
}
// =============================================================================
// Main Hook Handler
// =============================================================================
async function handleUserPromptSubmit(input) {
    try {
        const projectPath = getProjectPath();
        if (!projectPath || !fs.existsSync(projectPath)) {
            return { continue: true };
        }
        const sessionId = input.session_id || 'unknown';
        // CHECK: Have we already injected personality this session?
        if (!shouldInjectThisSession(projectPath, sessionId)) {
            // Already done for this session, skip silently
            return { continue: true };
        }
        // CHECK: Pre-compaction save trigger
        const preCompactionWarning = checkAndTriggerPreCompactionSave(projectPath);
        // PRIORITY 1: Check for persistent brain (Claude's accumulated knowledge)
        const brain = loadPersistentBrain(projectPath);
        if (brain && (brain.lessons.length > 0 || Object.keys(brain.fileInsights).length > 0)) {
            let context = formatBrainContext(brain, projectPath);
            if (preCompactionWarning) {
                context = preCompactionWarning + '\n\n' + context;
            }
            markSessionInjected(projectPath, sessionId);
            return { continue: true, result: context };
        }
        // PRIORITY 2: Fall back to dynamic detection + SQLite cache
        const projectId = computeProjectId(projectPath);
        const storage = (0, storage_1.createStorage)();
        try {
            // Check for cached personality
            const cached = await getCachedPersonality(storage, projectId, projectPath);
            if (cached) {
                const context = formatPersonalityContext(cached);
                await storage.close();
                markSessionInjected(projectPath, sessionId);
                return { continue: true, result: context };
            }
            // Extract fresh personality
            const personality = await extractProjectPersonality(projectPath, projectId);
            if (!personality) {
                await storage.close();
                markSessionInjected(projectPath, sessionId); // Mark even if nothing to inject
                return { continue: true };
            }
            // Cache the personality
            await cachePersonality(storage, personality);
            await storage.close();
            const context = formatPersonalityContext(personality);
            markSessionInjected(projectPath, sessionId);
            return { continue: true, result: context };
        }
        catch (error) {
            await storage.close().catch(() => { });
            throw error;
        }
    }
    catch (error) {
        // Fail silently - don't block the user's prompt
        if (process.env.DEBUG) {
            console.error('[PersonalityHook] Error:', error);
        }
        return { continue: true };
    }
}
// =============================================================================
// Project Path Resolution
// =============================================================================
function getProjectPath() {
    // Priority: CLAUDE_PROJECT_DIR > cwd
    const projectDir = process.env.CLAUDE_PROJECT_DIR;
    if (projectDir && fs.existsSync(projectDir)) {
        return projectDir;
    }
    const cwd = process.cwd();
    if (cwd && fs.existsSync(cwd)) {
        return cwd;
    }
    return null;
}
function computeProjectId(projectPath) {
    // Use path hash as stable project identifier
    const hash = crypto.createHash('sha256').update(projectPath).digest('hex');
    return hash.substring(0, 16);
}
// =============================================================================
// Cache Management
// =============================================================================
async function getCachedPersonality(storage, projectId, projectPath) {
    const profile = await storage.getProjectProfile(projectId);
    if (!profile) {
        return null;
    }
    // Check if cache is stale by time
    const age = Date.now() - profile.updatedAt;
    if (age > CACHE_TTL_MS) {
        return null;
    }
    // Check if config files have changed
    const currentHash = computeConfigHash(projectPath);
    if (currentHash !== profile.projectHash) {
        return null;
    }
    // Parse cached personality
    try {
        return JSON.parse(profile.personality);
    }
    catch {
        return null;
    }
}
async function cachePersonality(storage, personality) {
    const profile = {
        projectId: personality.projectId,
        personality: JSON.stringify(personality),
        updatedAt: Date.now(),
        projectHash: personality.configHash || '',
    };
    await storage.upsertProjectProfile(profile);
}
function computeConfigHash(projectPath) {
    const contents = [];
    for (const configFile of CONFIG_FILES) {
        const filePath = path.join(projectPath, configFile);
        if (fs.existsSync(filePath)) {
            try {
                const stat = fs.statSync(filePath);
                contents.push(`${configFile}:${stat.mtimeMs}`);
            }
            catch {
                // Skip inaccessible files
            }
        }
    }
    return (0, storage_1.computeProjectHash)(contents.join('|'));
}
// =============================================================================
// Personality Extraction
// =============================================================================
async function extractProjectPersonality(projectPath, projectId, options = {}) {
    const stack = extractStackInfo(projectPath);
    const patterns = extractPatterns(projectPath, options.maxPatterns || 5);
    const gotchas = extractGotchas(projectPath, options.maxGotchas || 5);
    const keyFiles = identifyKeyFiles(projectPath);
    const projectName = extractProjectName(projectPath);
    // Only return personality if we found meaningful info
    if (stack.languages.length === 0 &&
        stack.frameworks.length === 0 &&
        patterns.length === 0 &&
        gotchas.length === 0) {
        return null;
    }
    return {
        projectId,
        name: projectName,
        stack,
        patterns,
        conventions: [],
        gotchas,
        keyFiles,
        extractedAt: Date.now(),
        configHash: computeConfigHash(projectPath),
    };
}
function extractProjectName(projectPath) {
    // Try package.json
    const packageJsonPath = path.join(projectPath, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
            if (pkg.name)
                return pkg.name;
        }
        catch {
            // Fall through
        }
    }
    // Try Cargo.toml
    const cargoPath = path.join(projectPath, 'Cargo.toml');
    if (fs.existsSync(cargoPath)) {
        try {
            const cargo = fs.readFileSync(cargoPath, 'utf-8');
            const match = cargo.match(/name\s*=\s*"([^"]+)"/);
            if (match)
                return match[1];
        }
        catch {
            // Fall through
        }
    }
    // Try pyproject.toml
    const pyprojectPath = path.join(projectPath, 'pyproject.toml');
    if (fs.existsSync(pyprojectPath)) {
        try {
            const pyproject = fs.readFileSync(pyprojectPath, 'utf-8');
            const match = pyproject.match(/name\s*=\s*"([^"]+)"/);
            if (match)
                return match[1];
        }
        catch {
            // Fall through
        }
    }
    // Fall back to directory name
    return path.basename(projectPath);
}
// =============================================================================
// Stack Detection
// =============================================================================
function extractStackInfo(projectPath) {
    const stack = {
        languages: [],
        frameworks: [],
        buildTools: [],
    };
    // Detect from package.json
    const packageJsonPath = path.join(projectPath, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
            detectFromPackageJson(pkg, stack);
        }
        catch {
            // Skip invalid JSON
        }
    }
    // Detect from tsconfig.json
    const tsconfigPath = path.join(projectPath, 'tsconfig.json');
    if (fs.existsSync(tsconfigPath)) {
        if (!stack.languages.includes('TypeScript')) {
            stack.languages.push('TypeScript');
        }
    }
    // Detect from Cargo.toml
    const cargoPath = path.join(projectPath, 'Cargo.toml');
    if (fs.existsSync(cargoPath)) {
        stack.languages.push('Rust');
        stack.buildTools.push('Cargo');
        try {
            const cargo = fs.readFileSync(cargoPath, 'utf-8');
            detectFromCargoToml(cargo, stack);
        }
        catch {
            // Skip
        }
    }
    // Detect from pyproject.toml or requirements.txt
    const pyprojectPath = path.join(projectPath, 'pyproject.toml');
    const requirementsPath = path.join(projectPath, 'requirements.txt');
    if (fs.existsSync(pyprojectPath) || fs.existsSync(requirementsPath)) {
        stack.languages.push('Python');
        if (fs.existsSync(pyprojectPath)) {
            try {
                const pyproject = fs.readFileSync(pyprojectPath, 'utf-8');
                detectFromPyproject(pyproject, stack);
            }
            catch {
                // Skip
            }
        }
    }
    // Detect from go.mod
    const goModPath = path.join(projectPath, 'go.mod');
    if (fs.existsSync(goModPath)) {
        stack.languages.push('Go');
        stack.buildTools.push('go');
    }
    return stack;
}
function detectFromPackageJson(pkg, stack) {
    const deps = { ...asRecord(pkg.dependencies), ...asRecord(pkg.devDependencies) };
    // Languages
    if (deps['typescript']) {
        stack.languages.push('TypeScript');
    }
    else {
        stack.languages.push('JavaScript');
    }
    // Frameworks
    if (deps['next'])
        stack.frameworks.push('Next.js');
    if (deps['react'])
        stack.frameworks.push('React');
    if (deps['vue'])
        stack.frameworks.push('Vue');
    if (deps['svelte'])
        stack.frameworks.push('Svelte');
    if (deps['express'])
        stack.frameworks.push('Express');
    if (deps['fastify'])
        stack.frameworks.push('Fastify');
    if (deps['nestjs'] || deps['@nestjs/core'])
        stack.frameworks.push('NestJS');
    if (deps['electron'])
        stack.frameworks.push('Electron');
    if (deps['@tauri-apps/api'])
        stack.frameworks.push('Tauri');
    // State management
    if (deps['zustand'])
        stack.stateManagement = 'Zustand';
    if (deps['redux'] || deps['@reduxjs/toolkit'])
        stack.stateManagement = 'Redux';
    if (deps['jotai'])
        stack.stateManagement = 'Jotai';
    if (deps['recoil'])
        stack.stateManagement = 'Recoil';
    if (deps['mobx'])
        stack.stateManagement = 'MobX';
    // Testing
    if (deps['vitest'])
        stack.testing = 'Vitest';
    if (deps['jest'])
        stack.testing = 'Jest';
    if (deps['mocha'])
        stack.testing = 'Mocha';
    if (deps['playwright'] || deps['@playwright/test'])
        stack.testing = 'Playwright';
    // Styling
    if (deps['tailwindcss'])
        stack.styling = 'Tailwind CSS';
    if (deps['styled-components'])
        stack.styling = 'Styled Components';
    if (deps['@emotion/react'])
        stack.styling = 'Emotion';
    if (deps['sass'])
        stack.styling = 'Sass';
    // Database
    if (deps['prisma'] || deps['@prisma/client'])
        stack.database = 'Prisma';
    if (deps['drizzle-orm'])
        stack.database = 'Drizzle';
    if (deps['@supabase/supabase-js'])
        stack.database = 'Supabase';
    if (deps['mongoose'])
        stack.database = 'MongoDB';
    if (deps['pg'])
        stack.database = 'PostgreSQL';
    if (deps['better-sqlite3'])
        stack.database = 'SQLite';
    // Build tools
    if (deps['vite'])
        stack.buildTools.push('Vite');
    if (deps['webpack'])
        stack.buildTools.push('Webpack');
    if (deps['esbuild'])
        stack.buildTools.push('esbuild');
    if (deps['turbo'])
        stack.buildTools.push('Turborepo');
    // Note: Package manager detection would need projectPath - skip for now
}
function detectFromCargoToml(cargo, stack) {
    // Detect common Rust frameworks
    if (cargo.includes('tauri'))
        stack.frameworks.push('Tauri');
    if (cargo.includes('actix'))
        stack.frameworks.push('Actix');
    if (cargo.includes('axum'))
        stack.frameworks.push('Axum');
    if (cargo.includes('rocket'))
        stack.frameworks.push('Rocket');
    if (cargo.includes('tokio'))
        stack.frameworks.push('Tokio');
    if (cargo.includes('sqlx'))
        stack.database = 'SQLx';
    if (cargo.includes('diesel'))
        stack.database = 'Diesel';
    if (cargo.includes('rusqlite'))
        stack.database = 'SQLite';
}
function detectFromPyproject(pyproject, stack) {
    // Detect common Python frameworks
    if (pyproject.includes('fastapi'))
        stack.frameworks.push('FastAPI');
    if (pyproject.includes('django'))
        stack.frameworks.push('Django');
    if (pyproject.includes('flask'))
        stack.frameworks.push('Flask');
    if (pyproject.includes('pytest'))
        stack.testing = 'pytest';
    if (pyproject.includes('sqlalchemy'))
        stack.database = 'SQLAlchemy';
    // Build tools
    if (pyproject.includes('[tool.poetry]'))
        stack.buildTools.push('Poetry');
    if (pyproject.includes('[tool.uv]') || pyproject.includes('uv ='))
        stack.buildTools.push('uv');
}
function asRecord(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value;
    }
    return {};
}
// =============================================================================
// Pattern Extraction
// =============================================================================
function extractPatterns(projectPath, maxPatterns) {
    const patterns = [];
    // Look for common pattern directories
    const patternDirs = [
        { dir: 'src/components', pattern: 'React components' },
        { dir: 'src/hooks', pattern: 'Custom React hooks' },
        { dir: 'src/stores', pattern: 'State management stores' },
        { dir: 'src/lib', pattern: 'Utility libraries' },
        { dir: 'src/utils', pattern: 'Utility functions' },
        { dir: 'src/api', pattern: 'API routes/handlers' },
        { dir: 'src/services', pattern: 'Service layer' },
        { dir: 'src/models', pattern: 'Data models' },
        { dir: 'src/types', pattern: 'TypeScript types' },
        { dir: 'src/main', pattern: 'Main process (Electron/Tauri)' },
        { dir: 'src/renderer', pattern: 'Renderer process' },
        { dir: 'src/ipc-handlers', pattern: 'IPC handlers' },
        { dir: 'src/main/ipc-handlers', pattern: 'IPC handler pattern' },
        { dir: 'app', pattern: 'Next.js app router' },
        { dir: 'pages', pattern: 'Next.js pages router' },
        { dir: 'crates', pattern: 'Rust crates' },
        { dir: 'tests', pattern: 'Test files' },
    ];
    for (const { dir, pattern } of patternDirs) {
        const fullPath = path.join(projectPath, dir);
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
            patterns.push({
                name: pattern,
                description: `Located in ${dir}/`,
                location: dir,
            });
            if (patterns.length >= maxPatterns)
                break;
        }
    }
    return patterns;
}
// =============================================================================
// Gotcha Extraction (from CLAUDE.md)
// =============================================================================
function extractGotchas(projectPath, maxGotchas) {
    const gotchas = [];
    const claudeMdPath = path.join(projectPath, 'CLAUDE.md');
    if (!fs.existsSync(claudeMdPath)) {
        return gotchas;
    }
    try {
        const content = fs.readFileSync(claudeMdPath, 'utf-8');
        // Look for common gotcha patterns
        const gotchaPatterns = [
            /never\s+(.+)/gi,
            /don['']t\s+(.+)/gi,
            /always\s+(.+)/gi,
            /must\s+(.+)/gi,
            /avoid\s+(.+)/gi,
            /use\s+(\w+)\s+(?:for|instead|over)\s+(.+)/gi,
            /important[:\s]+(.+)/gi,
        ];
        const lines = content.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            // Skip headings and empty lines
            if (trimmed.startsWith('#') || trimmed.length === 0)
                continue;
            for (const pattern of gotchaPatterns) {
                pattern.lastIndex = 0;
                const match = pattern.exec(trimmed);
                if (match) {
                    const issue = trimmed.length > 100 ? trimmed.substring(0, 97) + '...' : trimmed;
                    gotchas.push({
                        issue,
                        prevention: 'See CLAUDE.md',
                        source: 'CLAUDE.md',
                    });
                    break;
                }
            }
            if (gotchas.length >= maxGotchas)
                break;
        }
    }
    catch {
        // Skip unreadable files
    }
    return gotchas;
}
// =============================================================================
// Key File Identification
// =============================================================================
function identifyKeyFiles(projectPath) {
    const keyFiles = [];
    const candidates = [
        { path: 'CLAUDE.md', purpose: 'Project instructions', importance: 'critical' },
        { path: 'package.json', purpose: 'Node.js dependencies', importance: 'critical' },
        { path: 'tsconfig.json', purpose: 'TypeScript config', importance: 'important' },
        { path: 'Cargo.toml', purpose: 'Rust dependencies', importance: 'critical' },
        { path: 'pyproject.toml', purpose: 'Python project config', importance: 'critical' },
        { path: 'src/main/index.ts', purpose: 'Main entry (Electron/Tauri)', importance: 'important' },
        { path: 'src/index.ts', purpose: 'Main entry point', importance: 'important' },
        { path: 'app/layout.tsx', purpose: 'Next.js root layout', importance: 'important' },
        { path: '.env.example', purpose: 'Environment variables', importance: 'reference' },
        { path: 'README.md', purpose: 'Project documentation', importance: 'reference' },
    ];
    for (const candidate of candidates) {
        const fullPath = path.join(projectPath, candidate.path);
        if (fs.existsSync(fullPath)) {
            keyFiles.push({
                path: candidate.path,
                purpose: candidate.purpose,
                importance: candidate.importance,
            });
        }
    }
    return keyFiles;
}
// =============================================================================
// Context Formatting
// =============================================================================
function formatPersonalityContext(personality) {
    const lines = ['<project-personality>'];
    // Stack line
    const stackParts = [];
    if (personality.stack.languages.length > 0) {
        stackParts.push(...personality.stack.languages);
    }
    if (personality.stack.frameworks.length > 0) {
        stackParts.push(...personality.stack.frameworks);
    }
    if (personality.stack.stateManagement) {
        stackParts.push(personality.stack.stateManagement);
    }
    if (personality.stack.testing) {
        stackParts.push(personality.stack.testing);
    }
    if (personality.stack.database) {
        stackParts.push(personality.stack.database);
    }
    if (stackParts.length > 0) {
        lines.push(`Stack: ${stackParts.join(', ')}`);
    }
    // Patterns line
    if (personality.patterns.length > 0) {
        const patternDescriptions = personality.patterns
            .map((p) => `${p.name} in ${p.location || 'src/'}`)
            .join(', ');
        lines.push(`Patterns: ${patternDescriptions}`);
    }
    // Gotchas line
    if (personality.gotchas.length > 0) {
        const gotchaList = personality.gotchas.map((g) => g.issue).join('; ');
        // Truncate if too long
        const truncated = gotchaList.length > 150 ? gotchaList.substring(0, 147) + '...' : gotchaList;
        lines.push(`Gotchas: ${truncated}`);
    }
    // Key files line
    if (personality.keyFiles.length > 0) {
        const criticalFiles = personality.keyFiles
            .filter((f) => f.importance === 'critical' || f.importance === 'important')
            .map((f) => f.path)
            .slice(0, 5)
            .join(', ');
        if (criticalFiles) {
            lines.push(`Key files: ${criticalFiles}`);
        }
    }
    lines.push('</project-personality>');
    return lines.join('\n');
}
//# sourceMappingURL=personality-hook.js.map