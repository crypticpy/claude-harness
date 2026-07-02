/**
 * PUNTAX storage-tier paths (MCP-server runtime)
 *
 * TypeScript port of hooks/unified/modules/storage-paths.mjs. Same tier layout
 * (see puntax-v2-docs/00-MASTER-IMPLEMENTATION-PLAN.md §4 / D2). Path resolution
 * is pure; call ensureDir() only at write time.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface ContextPaths {
  dir: string;
  events: string;
  checkpoints: string;
  memories: string;
  codeMapDb: string;
  charter: string;
  manifest: string;
  lessons: string;
  hotFiles: string;
  fileInsights: string;
  conventions: string;
}

/** Project-local context-layer directory: `<projectDir>/.claude/context-layer`. */
export function resolveContextDir(projectDir: string): string {
  if (!projectDir || typeof projectDir !== "string") {
    throw new TypeError("resolveContextDir requires a projectDir string");
  }
  return path.join(projectDir, ".claude", "context-layer");
}

/** Cross-project global directory: `~/.claude/context-layer/global`. */
export function resolveGlobalDir(home: string = os.homedir()): string {
  return path.join(home, ".claude", "context-layer", "global");
}

/** Transient cache directory: `~/.claude/cache/context-layer`. */
export function resolveCacheDir(home: string = os.homedir()): string {
  return path.join(home, ".claude", "cache", "context-layer");
}

/** Named project-local files derived from resolveContextDir(). */
export function contextPaths(projectDir: string): ContextPaths {
  const dir = resolveContextDir(projectDir);
  return {
    dir,
    events: path.join(dir, "events.jsonl"),
    checkpoints: path.join(dir, "checkpoints.jsonl"),
    memories: path.join(dir, "memories.jsonl"),
    codeMapDb: path.join(dir, "code-map.db"),
    charter: path.join(dir, "charter.json"),
    manifest: path.join(dir, "manifest.jsonl"),
    lessons: path.join(dir, "lessons.jsonl"),
    hotFiles: path.join(dir, "hot-files.json"),
    fileInsights: path.join(dir, "file-insights.json"),
    conventions: path.join(dir, "conventions.json"),
  };
}

/** Create a directory (recursive) if missing. Returns the path. */
export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
