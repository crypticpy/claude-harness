/**
 * Session Start Module — Deep Environment Bootstrapping
 *
 * Inspired by Meta-Harness (Terminal-Bench 2.0): gathers a comprehensive
 * environment snapshot at session start to eliminate 2-5 early exploration turns.
 *
 * Uses a single compound shell command with @@MARKER@@ delimiters for performance.
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { checkSwarm } from './swarm-agent.mjs';

/**
 * Parse @@MARKER@@ delimited output from a compound shell command.
 * Returns a map of section name -> content string.
 */
function parseMarkerSections(stdout) {
    const sections = {};
    let currentKey = null;
    let currentLines = [];

    for (const line of stdout.split('\n')) {
        const marker = line.match(/^@@(\w+)@@$/);
        if (marker) {
            if (currentKey) {
                sections[currentKey] = currentLines.join('\n').trim();
            }
            currentKey = marker[1];
            currentLines = [];
        } else {
            currentLines.push(line);
        }
    }
    if (currentKey) {
        sections[currentKey] = currentLines.join('\n').trim();
    }
    return sections;
}

/**
 * Gather stack detection via a single compound shell command.
 * Checks languages, package managers, project markers, disk space, and recent git log.
 */
function gatherStackSnapshot(cwd) {
    // Single compound command — each section delimited by @@MARKER@@
    // Uses `which` for presence checks (fast), `|| true` guards for safety
    //
    // IMPORTANT: Shell variables like $f and $4 must use regular strings (not
    // template literals) or be escaped to avoid JS template literal interpolation.
    const escapedCwd = cwd.replace(/'/g, "'\\''");

    const cmd = [
        // -- Languages --
        "echo '@@LANGUAGES@@'",
        "(which python3 >/dev/null 2>&1 && python3 --version 2>&1 || true)",
        "(which node >/dev/null 2>&1 && node --version 2>&1 | sed 's/^/node /' || true)",
        "(which go >/dev/null 2>&1 && go version 2>&1 | sed 's/go version //' || true)",
        "(which rustc >/dev/null 2>&1 && rustc --version 2>&1 || true)",
        "(which java >/dev/null 2>&1 && java -version 2>&1 | head -1 || true)",
        "(which gcc >/dev/null 2>&1 && gcc --version 2>&1 | head -1 || true)",
        "(which ruby >/dev/null 2>&1 && ruby --version 2>&1 | head -1 || true)",
        "(which swift >/dev/null 2>&1 && swift --version 2>&1 | head -1 || true)",

        // -- Package managers --
        "echo '@@PKGMGRS@@'",
        "(which pip3 >/dev/null 2>&1 && echo 'pip3' || true)",
        "(which npm >/dev/null 2>&1 && echo 'npm' || true)",
        "(which yarn >/dev/null 2>&1 && echo 'yarn' || true)",
        "(which pnpm >/dev/null 2>&1 && echo 'pnpm' || true)",
        "(which cargo >/dev/null 2>&1 && echo 'cargo' || true)",
        "(which go >/dev/null 2>&1 && echo 'go modules' || true)",
        "(which brew >/dev/null 2>&1 && echo 'brew' || true)",

        // -- Project markers --
        // NOTE: use single-quoted cwd and escaped $f to avoid JS interpolation
        "echo '@@PROJECT@@'",
        "(cd '" + escapedCwd + "' && for f in package.json pyproject.toml Cargo.toml go.mod Makefile docker-compose.yml Dockerfile requirements.txt Gemfile Package.swift; do [ -f \"$f\" ] && echo \"$f\"; done || true)",

        // -- Disk space --
        "echo '@@DISK@@'",
        "df -h '" + escapedCwd + "' 2>/dev/null | tail -1 | awk '{print $4}' || true",

        // -- Key config files --
        "echo '@@CONFIGS@@'",
        "(cd '" + escapedCwd + "' && for f in .env.example .editorconfig tsconfig.json .eslintrc.json .eslintrc.js .prettierrc .prettierrc.json biome.json vite.config.ts vite.config.js next.config.js next.config.mjs webpack.config.js jest.config.ts jest.config.js vitest.config.ts .github/workflows CLAUDE.md; do [ -e \"$f\" ] && echo \"$f\"; done || true)",
        "(cd '" + escapedCwd + "' && [ -d '.claude' ] && echo '.claude/' || true)",

        // -- Recent git log --
        "echo '@@GITLOG@@'",
        "(cd '" + escapedCwd + "' && git log --oneline -5 2>/dev/null || true)",

        // -- Git branch --
        "echo '@@GITBRANCH@@'",
        "(cd '" + escapedCwd + "' && git branch --show-current 2>/dev/null || true)",
    ].join(' && ');

    try {
        const stdout = execSync(cmd, { cwd, encoding: 'utf-8', timeout: 5000 });
        return parseMarkerSections(stdout);
    } catch (e) {
        if (process.env.DEBUG) console.error('[session-start] stack detection failed:', e.message);
        return {};
    }
}

/**
 * Load recent lessons from context-layer JSONL files.
 * Checks project-local first, then user-global.
 */
function loadRecentLessons(cwd, count = 5) {
    const paths = [
        join(cwd, '.claude', 'context-layer', 'lessons.jsonl'),
        join(process.env.HOME || '', '.claude', 'context-layer', 'lessons.jsonl'),
    ];

    for (const p of paths) {
        try {
            if (!existsSync(p)) continue;

            const content = readFileSync(p, 'utf-8').trim();
            if (!content) continue;

            const lines = content.split('\n').filter(l => l.trim());
            const recent = lines.slice(-count);

            const lessons = [];
            for (const line of recent) {
                try {
                    const obj = JSON.parse(line);
                    // Handle both singular (bootstrap/manual) and plural (trace-diagnosis) formats
                    const summary = obj.lesson || obj.summary || obj.message ||
                        (Array.isArray(obj.lessons) ? obj.lessons.filter(Boolean).join('; ') : null);
                    if (summary) {
                        lessons.push({
                            lesson: summary,
                            type: obj.type || 'unknown',
                            severity: obj.severity || (obj.efficiency != null && obj.efficiency <= 5 ? 'high' : 'info'),
                            ts: obj.timestamp || null,
                        });
                    }
                } catch (_) { /* skip malformed lines */ }
            }

            if (lessons.length > 0) return lessons;
        } catch (_) { /* skip inaccessible paths */ }
    }
    return [];
}

/**
 * Gather uncommitted changes (existing behavior, preserved).
 */
function getGitStatus(cwd) {
    try {
        const status = execSync('git status --short 2>/dev/null', { cwd, encoding: 'utf-8', timeout: 2000 });
        return status.trim() || null;
    } catch (_) {
        return null;
    }
}

/**
 * Gather active TODOs across common source file types.
 */
function getTodos(cwd) {
    try {
        const todos = execSync(
            'rg "TODO:" ' +
            '-t ts -t js -t py -t go -t rust -t ruby ' +
            '--glob "!node_modules" --glob "!.git" --glob "!vendor" ' +
            '--glob "!dist" --glob "!build" --glob "!target" ' +
            '--glob "!.claude-worktrees" ' +
            '--max-count 10 --no-heading ' +
            '2>/dev/null || true',
            { cwd, encoding: 'utf-8', timeout: 2000 }
        );
        return todos.trim() || null;
    } catch (_) {
        return null;
    }
}

/**
 * Format the stack detection sections into compact markdown.
 */
function formatStackSection(sections) {
    const parts = [];

    // Languages
    if (sections.LANGUAGES) {
        const langs = sections.LANGUAGES.split('\n').filter(l => l.trim());
        if (langs.length > 0) {
            parts.push('**Languages**: ' + langs.join(', '));
        }
    }

    // Package managers
    if (sections.PKGMGRS) {
        const pkgs = sections.PKGMGRS.split('\n').filter(l => l.trim());
        if (pkgs.length > 0) {
            parts.push('**Pkg managers**: ' + pkgs.join(', '));
        }
    }

    // Project type markers
    if (sections.PROJECT) {
        const markers = sections.PROJECT.split('\n').filter(l => l.trim());
        if (markers.length > 0) {
            parts.push('**Project files**: ' + markers.join(', '));
        }
    }

    // Disk space
    if (sections.DISK && sections.DISK.trim()) {
        parts.push('**Disk free**: ' + sections.DISK.trim());
    }

    return parts.length > 0 ? parts.join('\n') : null;
}

/**
 * Format key config files section.
 */
function formatConfigsSection(sections) {
    if (!sections.CONFIGS) return null;
    const configs = sections.CONFIGS.split('\n').filter(l => l.trim());
    return configs.length > 0 ? '**Key configs**: ' + configs.join(', ') : null;
}

/**
 * Format recent git activity.
 */
function formatGitLog(sections) {
    if (!sections.GITLOG) return null;
    const lines = sections.GITLOG.split('\n').filter(l => l.trim());
    if (lines.length === 0) return null;

    const branch = sections.GITBRANCH?.trim() || 'unknown';
    return '**Branch**: `' + branch + '`\n**Recent commits**:\n' +
        lines.map(l => '  ' + l).join('\n');
}

/**
 * Format lessons section.
 */
function formatLessons(lessons) {
    if (!lessons || lessons.length === 0) return null;
    return lessons.map(l => {
        const badge = l.severity === 'high' ? '[!]' : '[-]';
        return `  ${badge} ${l.lesson}`;
    }).join('\n');
}

export async function injectContext(_event, _config) {
    try {
        const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
        let output = '';

        // ---- Swarm coordination (highest priority) ----
        try {
            const swarmContext = await checkSwarm(cwd);
            if (swarmContext) {
                output += swarmContext + '\n\n---\n\n';
            }
        } catch (e) {
            if (process.env.DEBUG) console.error('[session-start] swarm check failed:', e);
        }

        // ---- Compound environment detection (single exec) ----
        const sections = gatherStackSnapshot(cwd);

        // ---- Begin project snapshot ----
        output += '<project-snapshot>\n';

        // Stack detection
        const stackInfo = formatStackSection(sections);
        if (stackInfo) {
            output += '### Stack\n' + stackInfo + '\n\n';
        }

        // Key config files
        const configsInfo = formatConfigsSection(sections);
        if (configsInfo) {
            output += '### Config\n' + configsInfo + '\n\n';
        }

        // Git activity
        const gitLog = formatGitLog(sections);
        if (gitLog) {
            output += '### Git Activity\n' + gitLog + '\n\n';
        }

        // Uncommitted changes (preserved from original)
        const gitStatus = getGitStatus(cwd);
        if (gitStatus) {
            output += '### Uncommitted Changes\n```\n' + gitStatus + '\n```\n\n';
        }

        // Recent lessons from context-layer
        const lessons = loadRecentLessons(cwd);
        const lessonsFormatted = formatLessons(lessons);
        if (lessonsFormatted) {
            output += '### Recent Lessons\n' + lessonsFormatted + '\n\n';
        }

        // Active TODOs (expanded file types)
        const todos = getTodos(cwd);
        if (todos) {
            output += '### Active TODOs\n```\n' + todos + '\n```\n\n';
        }

        output += '</project-snapshot>';

        // Only return if we have meaningful content beyond the wrapper tags
        const innerContent = output.replace(/<\/?project-snapshot>/g, '').trim();
        return innerContent.length > 20 ? output : null;
    } catch (err) {
        if (process.env.DEBUG) console.error('[session-start] fatal:', err);
        return null;
    }
}
