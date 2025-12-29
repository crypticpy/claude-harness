"use strict";
/**
 * Active Indexer with Lazy Initialization
 *
 * Provides background indexing for projects with intelligent caching and
 * lazy initialization. Only re-indexes when project content has changed
 * or sufficient time has passed.
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
exports.loadIndexState = loadIndexState;
exports.saveIndexState = saveIndexState;
exports.triggerActiveIndex = triggerActiveIndex;
exports.shouldIndex = shouldIndex;
exports.getIndexStatus = getIndexStatus;
exports.clearIndexState = clearIndexState;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
// =============================================================================
// Constants
// =============================================================================
const INDEXER_VERSION = '1.0.0';
const DEFAULT_MAX_AGE_HOURS = 24;
const DEFAULT_MAX_FILE_SIZE = 500 * 1024; // 500KB
const INDEX_STATE_FILE = 'index-state.json';
/** Directories to skip during indexing */
const SKIP_DIRECTORIES = new Set([
    'node_modules',
    '.git',
    'dist',
    'build',
    '.next',
    '.nuxt',
    'out',
    '__pycache__',
    '.venv',
    'venv',
    '.env',
    'env',
    '.mypy_cache',
    '.pytest_cache',
    '.tox',
    'target', // Rust target directory
    '.cargo',
    'vendor',
    'coverage',
    '.nyc_output',
    '.cache',
    '.parcel-cache',
    '.turbo',
]);
/** File extensions to index */
const INDEXABLE_EXTENSIONS = new Set([
    // JavaScript/TypeScript
    '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
    // Python
    '.py', '.pyi',
    // Rust
    '.rs',
    // Go
    '.go',
    // Web
    '.html', '.css', '.scss', '.sass', '.less',
    // Config
    '.json', '.yaml', '.yml', '.toml',
    // Documentation
    '.md', '.mdx',
    // Other
    '.sql', '.graphql', '.prisma',
]);
/** Patterns for key files (indexed first) */
const KEY_FILE_PATTERNS = [
    // Entry points
    /^src\/index\.[jt]sx?$/,
    /^src\/main\.[jt]sx?$/,
    /^src\/app\.[jt]sx?$/,
    /^index\.[jt]sx?$/,
    /^main\.[jt]sx?$/,
    /^lib\.rs$/,
    /^main\.rs$/,
    /^main\.py$/,
    /^app\.py$/,
    /^__init__\.py$/,
    // Config files
    /^package\.json$/,
    /^tsconfig\.json$/,
    /^Cargo\.toml$/,
    /^pyproject\.toml$/,
    /^CLAUDE\.md$/i,
    // Type definitions
    /types?\.[jt]s$/,
    /\.d\.ts$/,
    // API routes
    /^src\/api\//,
    /^app\/api\//,
    /^pages\/api\//,
];
// =============================================================================
// Index State Management
// =============================================================================
function getIndexStatePath(projectPath) {
    return path.join(projectPath, '.claude', 'context-layer', INDEX_STATE_FILE);
}
/**
 * Load the current index state for a project
 */
function loadIndexState(projectPath) {
    const statePath = getIndexStatePath(projectPath);
    if (!fs.existsSync(statePath)) {
        return null;
    }
    try {
        const content = fs.readFileSync(statePath, 'utf-8');
        return JSON.parse(content);
    }
    catch {
        return null;
    }
}
/**
 * Save index state for a project
 */
function saveIndexState(projectPath, state) {
    const statePath = getIndexStatePath(projectPath);
    const stateDir = path.dirname(statePath);
    // Ensure directory exists
    if (!fs.existsSync(stateDir)) {
        fs.mkdirSync(stateDir, { recursive: true });
    }
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}
// =============================================================================
// Project Hash Computation
// =============================================================================
/**
 * Compute a hash of the project structure for change detection.
 * Uses file list and modification times rather than content.
 */
function computeProjectStructureHash(projectPath) {
    const hash = crypto.createHash('sha256');
    const files = [];
    // Collect key config files and their mtimes
    const configFiles = [
        'package.json',
        'package-lock.json',
        'pnpm-lock.yaml',
        'yarn.lock',
        'Cargo.toml',
        'Cargo.lock',
        'pyproject.toml',
        'requirements.txt',
        'go.mod',
        'go.sum',
    ];
    for (const file of configFiles) {
        const filePath = path.join(projectPath, file);
        if (fs.existsSync(filePath)) {
            try {
                const stat = fs.statSync(filePath);
                files.push(`${file}:${stat.mtime.toISOString()}`);
            }
            catch { /* skip */ }
        }
    }
    // Add source directory structure (names only, not content)
    const srcDir = path.join(projectPath, 'src');
    if (fs.existsSync(srcDir)) {
        try {
            const srcFiles = collectFileNames(srcDir, 2); // Only 2 levels deep
            files.push(...srcFiles.map(f => `src:${f}`));
        }
        catch { /* skip */ }
    }
    hash.update(files.sort().join('\n'));
    return hash.digest('hex').slice(0, 16);
}
/**
 * Collect file names (not full paths) up to a certain depth
 */
function collectFileNames(dirPath, maxDepth, currentDepth = 0) {
    if (currentDepth >= maxDepth) {
        return [];
    }
    const names = [];
    try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            if (SKIP_DIRECTORIES.has(entry.name))
                continue;
            if (entry.isFile()) {
                names.push(entry.name);
            }
            else if (entry.isDirectory()) {
                names.push(`${entry.name}/`);
                const subNames = collectFileNames(path.join(dirPath, entry.name), maxDepth, currentDepth + 1);
                names.push(...subNames.map(n => `${entry.name}/${n}`));
            }
        }
    }
    catch { /* skip */ }
    return names;
}
// =============================================================================
// File Collection
// =============================================================================
/**
 * Collect all indexable files from a project
 */
function collectIndexableFiles(projectPath, maxFileSize) {
    const files = [];
    function walk(dirPath, relativePath = '') {
        let entries;
        try {
            entries = fs.readdirSync(dirPath, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            const name = entry.name;
            const fullPath = path.join(dirPath, name);
            const relPath = relativePath ? `${relativePath}/${name}` : name;
            if (entry.isDirectory()) {
                if (!SKIP_DIRECTORIES.has(name) && !name.startsWith('.')) {
                    walk(fullPath, relPath);
                }
            }
            else if (entry.isFile()) {
                const ext = path.extname(name).toLowerCase();
                if (INDEXABLE_EXTENSIONS.has(ext)) {
                    try {
                        const stat = fs.statSync(fullPath);
                        if (stat.size <= maxFileSize) {
                            const isKeyFile = KEY_FILE_PATTERNS.some(p => p.test(relPath));
                            files.push({
                                path: relPath,
                                size: stat.size,
                                isKeyFile,
                            });
                        }
                    }
                    catch { /* skip */ }
                }
            }
        }
    }
    walk(projectPath);
    // Sort: key files first, then by path
    return files.sort((a, b) => {
        if (a.isKeyFile && !b.isKeyFile)
            return -1;
        if (!a.isKeyFile && b.isKeyFile)
            return 1;
        return a.path.localeCompare(b.path);
    });
}
// =============================================================================
// Index Validation
// =============================================================================
/**
 * Check if the current index is still valid
 */
function isIndexValid(projectPath, state, options) {
    if (!state) {
        return { valid: false, reason: 'No existing index state' };
    }
    // Check indexer version
    if (state.indexerVersion !== INDEXER_VERSION) {
        return { valid: false, reason: `Indexer version changed (${state.indexerVersion} → ${INDEXER_VERSION})` };
    }
    // Check if indexing is in progress
    if (state.inProgress) {
        return { valid: true, reason: 'Indexing already in progress' };
    }
    // Check age
    const maxAge = (options.maxAgeHours ?? DEFAULT_MAX_AGE_HOURS) * 60 * 60 * 1000;
    const indexAge = Date.now() - new Date(state.lastIndexed).getTime();
    if (indexAge > maxAge) {
        return { valid: false, reason: `Index expired (${Math.round(indexAge / 3600000)}h old)` };
    }
    // Check project hash
    const currentHash = computeProjectStructureHash(projectPath);
    if (currentHash !== state.projectHash) {
        return { valid: false, reason: 'Project structure changed' };
    }
    return { valid: true, reason: 'Index is current' };
}
// =============================================================================
// Core Indexing
// =============================================================================
/**
 * Perform the actual indexing work
 * Note: This is a placeholder that collects files. The actual indexing
 * (parsing, symbol extraction) would integrate with the existing indexer.
 */
async function performIndexing(projectPath, files, options) {
    const errors = [];
    const keyFiles = [];
    let filesIndexed = 0;
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fullPath = path.join(projectPath, file.path);
        try {
            // For now, just verify the file is readable
            // In a full implementation, this would:
            // 1. Parse the file
            // 2. Extract symbols
            // 3. Store in the index database
            fs.accessSync(fullPath, fs.constants.R_OK);
            filesIndexed++;
            if (file.isKeyFile) {
                keyFiles.push(file.path);
            }
            // Report progress
            if (options.onProgress) {
                options.onProgress(i + 1, files.length);
            }
        }
        catch (err) {
            errors.push(`Failed to index ${file.path}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    return { filesIndexed, keyFiles, errors };
}
// =============================================================================
// Public API
// =============================================================================
/**
 * Trigger active indexing for a project.
 *
 * This checks if indexing is needed based on:
 * 1. Whether an index exists
 * 2. How old the existing index is
 * 3. Whether the project structure has changed
 *
 * @param projectPath - Path to the project root
 * @param options - Indexing options
 * @returns Result of the indexing operation
 */
async function triggerActiveIndex(projectPath, options = {}) {
    const startTime = Date.now();
    const maxFileSize = options.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE;
    // Load existing state
    const existingState = loadIndexState(projectPath);
    // Check if we need to index
    if (!options.force) {
        const validation = isIndexValid(projectPath, existingState, options);
        if (validation.valid) {
            return {
                triggered: false,
                reason: validation.reason,
            };
        }
    }
    // Mark indexing as in progress
    const inProgressState = {
        lastIndexed: existingState?.lastIndexed ?? new Date().toISOString(),
        filesIndexed: existingState?.filesIndexed ?? 0,
        projectHash: existingState?.projectHash ?? '',
        indexerVersion: INDEXER_VERSION,
        keyFilesIndexed: existingState?.keyFilesIndexed ?? [],
        inProgress: true,
    };
    saveIndexState(projectPath, inProgressState);
    try {
        // Collect files to index
        const files = collectIndexableFiles(projectPath, maxFileSize);
        if (files.length === 0) {
            const state = {
                lastIndexed: new Date().toISOString(),
                filesIndexed: 0,
                projectHash: computeProjectStructureHash(projectPath),
                indexerVersion: INDEXER_VERSION,
                keyFilesIndexed: [],
                inProgress: false,
            };
            saveIndexState(projectPath, state);
            return {
                triggered: true,
                reason: 'No indexable files found',
                filesIndexed: 0,
                durationMs: Date.now() - startTime,
            };
        }
        // Perform indexing
        const result = await performIndexing(projectPath, files, options);
        // Save final state
        const finalState = {
            lastIndexed: new Date().toISOString(),
            filesIndexed: result.filesIndexed,
            projectHash: computeProjectStructureHash(projectPath),
            indexerVersion: INDEXER_VERSION,
            keyFilesIndexed: result.keyFiles,
            inProgress: false,
        };
        saveIndexState(projectPath, finalState);
        return {
            triggered: true,
            reason: options.force ? 'Forced re-index' : 'Index update needed',
            filesIndexed: result.filesIndexed,
            durationMs: Date.now() - startTime,
            errors: result.errors.length > 0 ? result.errors : undefined,
        };
    }
    catch (err) {
        // Clear in-progress state on error
        if (existingState) {
            existingState.inProgress = false;
            saveIndexState(projectPath, existingState);
        }
        return {
            triggered: true,
            reason: 'Indexing failed',
            errors: [err instanceof Error ? err.message : String(err)],
            durationMs: Date.now() - startTime,
        };
    }
}
/**
 * Check if indexing is needed without triggering it
 */
function shouldIndex(projectPath, options = {}) {
    const state = loadIndexState(projectPath);
    const validation = isIndexValid(projectPath, state, options);
    return { needed: !validation.valid, reason: validation.reason };
}
/**
 * Get the current index status for a project
 */
function getIndexStatus(projectPath) {
    const state = loadIndexState(projectPath);
    if (!state) {
        return { indexed: false, state: null, age: null };
    }
    const age = Date.now() - new Date(state.lastIndexed).getTime();
    return { indexed: true, state, age };
}
/**
 * Clear the index state for a project (forces re-indexing on next trigger)
 */
function clearIndexState(projectPath) {
    const statePath = getIndexStatePath(projectPath);
    if (fs.existsSync(statePath)) {
        fs.unlinkSync(statePath);
    }
}
//# sourceMappingURL=active-indexer.js.map