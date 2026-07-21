import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getConfigDir, loadConfig, ensureConfigDir } from './config.js';
import { CacheFileSchema } from './types.js';
const CACHE_FILE = 'approval_cache.json';
function getCachePath() {
    return join(getConfigDir(), CACHE_FILE);
}
function generateCacheKey(toolName, toolInput, cwd) {
    // Key on what determines the verdict: the tool and its semantic input.
    // cwd and Bash metadata (description, timeout) vary freely across
    // sessions and worktrees without changing whether the action is safe,
    // so including them would fragment the cache into near-duplicates.
    let keyInput = toolInput;
    if (toolName === 'Bash' && toolInput && typeof toolInput.command === 'string') {
        keyInput = { command: toolInput.command.replace(/\s+/g, ' ').trim() };
    }
    const data = JSON.stringify({
        toolName,
        toolInput: keyInput,
    });
    return createHash('sha256').update(data).digest('hex');
}
function loadCache() {
    const cachePath = getCachePath();
    if (!existsSync(cachePath)) {
        return {};
    }
    try {
        const raw = readFileSync(cachePath, 'utf-8');
        const parsed = JSON.parse(raw);
        return CacheFileSchema.parse(parsed);
    }
    catch {
        // Corrupted cache, return empty
        return {};
    }
}
function saveCache(cache) {
    ensureConfigDir();
    const cachePath = getCachePath();
    writeFileSync(cachePath, JSON.stringify(cache, null, 2));
}
export function getCachedDecision(toolName, toolInput, cwd) {
    const config = loadConfig();
    if (!config.cache.enabled) {
        return null;
    }
    const key = generateCacheKey(toolName, toolInput, cwd);
    const cache = loadCache();
    const entry = cache[key];
    if (!entry) {
        return null;
    }
    // Check TTL
    const ttlMs = config.cache.ttlHours * 60 * 60 * 1000;
    const age = Date.now() - entry.timestamp;
    if (age > ttlMs) {
        // Expired, remove it
        delete cache[key];
        saveCache(cache);
        return null;
    }
    return entry;
}
export function setCachedDecision(toolName, toolInput, decision, reason, cwd) {
    const config = loadConfig();
    if (!config.cache.enabled) {
        return;
    }
    const key = generateCacheKey(toolName, toolInput, cwd);
    const cache = loadCache();
    const entry = {
        key,
        decision,
        reason,
        timestamp: Date.now(),
        toolName,
        cwd,
    };
    cache[key] = entry;
    saveCache(cache);
}
export function clearCache() {
    const cache = loadCache();
    const count = Object.keys(cache).length;
    saveCache({});
    return count;
}
export function getCacheStats() {
    const cache = loadCache();
    const entries = Object.values(cache);
    if (entries.length === 0) {
        return { entries: 0 };
    }
    const timestamps = entries.map((e) => e.timestamp);
    return {
        entries: entries.length,
        oldestTimestamp: Math.min(...timestamps),
    };
}
//# sourceMappingURL=cache.js.map