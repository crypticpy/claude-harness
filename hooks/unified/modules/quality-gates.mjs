/**
 * Quality Gates Module
 * Runs quality checks on Stop event (end of turn)
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';

/**
 * Check whether any files were actually edited during this session turn.
 * Uses git diff as a reliable heuristic — if there are no uncommitted changes,
 * there's nothing to lint or type-check.
 */
function hasFilesChanged(cwd) {
    try {
        // Check both staged and unstaged changes
        const diff = execSync('git diff --name-only HEAD 2>/dev/null || git diff --name-only', {
            cwd,
            timeout: 5000,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe']
        }).trim();

        // Also check for untracked new files that may have been written
        const untracked = execSync('git ls-files --others --exclude-standard', {
            cwd,
            timeout: 5000,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe']
        }).trim();

        return diff.length > 0 || untracked.length > 0;
    } catch (e) {
        // If git fails (not a repo, etc.), fall back to running gates
        return true;
    }
}

/**
 * Detect whether the project has an ESLint configuration.
 */
function hasEslintConfig(cwd) {
    const configFiles = [
        '.eslintrc',
        '.eslintrc.js',
        '.eslintrc.cjs',
        '.eslintrc.mjs',
        '.eslintrc.json',
        '.eslintrc.yml',
        '.eslintrc.yaml',
        'eslint.config.js',
        'eslint.config.mjs',
        'eslint.config.cjs',
        'eslint.config.ts',
        'eslint.config.mts',
        'eslint.config.cts'
    ];

    for (const file of configFiles) {
        if (existsSync(`${cwd}/${file}`)) return true;
    }

    // Check for eslintConfig key in package.json
    try {
        const pkg = JSON.parse(readFileSync(`${cwd}/package.json`, 'utf-8'));
        if (pkg.eslintConfig) return true;
    } catch (e) {
        // No package.json or invalid JSON
    }

    return false;
}

export async function runGates(_event, config) {
    try {
        if (!config.qualityGates?.onStop?.enabled) return;

        const commands = config.qualityGates.onStop.commands;
        const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();

        // Skip gates entirely if no files were edited this turn
        if (!hasFilesChanged(cwd)) {
            if (process.env.DEBUG) {
                console.error('[QualityGates] No file changes detected, skipping gates');
            }
            return;
        }

        // Check for TypeScript
        if (commands.typescript && existsSync(`${cwd}/tsconfig.json`)) {
            try {
                execSync(commands.typescript, { cwd, timeout: 30000, stdio: 'inherit' });
            } catch (e) {
                console.error('⚠️  TypeScript check failed');
            }
        }

        // Check for ESLint
        if (commands.eslint && hasEslintConfig(cwd)) {
            try {
                execSync(commands.eslint, { cwd, timeout: 60000, stdio: 'inherit' });
            } catch (e) {
                console.error('⚠️  ESLint check failed');
            }
        }

        // Run default command if specified
        if (commands.default) {
            try {
                execSync(commands.default, { cwd, timeout: 30000, stdio: 'inherit' });
            } catch (e) {
                console.error('⚠️  Quality gate check failed');
            }
        }
    } catch (err) {
        // Silent
    }
}
