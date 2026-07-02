/**
 * PUNTAX storage-tier paths (hook runtime)
 *
 * Single source of truth for where v2 reads/writes structured state. Mirrors the
 * tier layout in puntax-v2-docs/00-MASTER-IMPLEMENTATION-PLAN.md §4 (D2):
 *
 *   <repo>/.claude/context-layer/   project-local: events, checkpoints, memories, code-map.db, brain files
 *   ~/.claude/context-layer/global/ cross-project: global memory, user prefs
 *   ~/.claude/cache/context-layer/  transient: indexes, temp responses
 *
 * Path resolution is pure (no I/O). Use ensureDir() at the call site right
 * before writing — never create directories outside the project without an
 * explicit, user-approved path.
 *
 * A parallel TypeScript port lives at plugins/context-layer/src/storage/paths.ts.
 */

import { mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/** Project-local context-layer directory: `<projectDir>/.claude/context-layer`. */
export function resolveContextDir(projectDir) {
  if (!projectDir || typeof projectDir !== 'string') {
    throw new TypeError('resolveContextDir requires a projectDir string');
  }
  return join(projectDir, '.claude', 'context-layer');
}

/** Cross-project global directory: `~/.claude/context-layer/global`. */
export function resolveGlobalDir(home = homedir()) {
  return join(home, '.claude', 'context-layer', 'global');
}

/** Transient cache directory: `~/.claude/cache/context-layer`. */
export function resolveCacheDir(home = homedir()) {
  return join(home, '.claude', 'cache', 'context-layer');
}

/** Named project-local files derived from resolveContextDir(). */
export function contextPaths(projectDir) {
  const dir = resolveContextDir(projectDir);
  return {
    dir,
    events: join(dir, 'events.jsonl'),
    checkpoints: join(dir, 'checkpoints.jsonl'),
    memories: join(dir, 'memories.jsonl'),
    codeMapDb: join(dir, 'code-map.db'),
    charter: join(dir, 'charter.json'),
    manifest: join(dir, 'manifest.jsonl'),
    // Legacy v1 brain files (read during migration)
    lessons: join(dir, 'lessons.jsonl'),
    hotFiles: join(dir, 'hot-files.json'),
    fileInsights: join(dir, 'file-insights.json'),
    conventions: join(dir, 'conventions.json'),
  };
}

/** Create a directory (recursive) if missing. Returns the path. */
export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
  return dir;
}

export default { resolveContextDir, resolveGlobalDir, resolveCacheDir, contextPaths, ensureDir };
