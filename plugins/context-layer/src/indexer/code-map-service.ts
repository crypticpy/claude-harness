/**
 * Code-map service — the seam between MCP tools / hooks and code-map.db.
 *
 * Centralizes: the PUNTAX_CODE_MAP gate, opening the project-local DB, lazy
 * bootstrap (full index on first use), single-file incremental refresh, and
 * mtime-based freshness checks (so a fresh file can be answered WITHOUT a read).
 *
 * Every helper is fail-open: any error returns a null/empty result so the
 * caller falls back to its existing scan path. Tools open + close the DB per
 * call (WAL allows concurrent readers).
 */

import * as fs from "fs";
import * as path from "path";

import { loadPuntaxConfig } from "../config/puntax-config";
import { contextPaths } from "../storage/paths";
import { CodeMap, projectIdFor, type FileRecord } from "../storage/code-map";
import {
  indexProject,
  type IndexProjectResult,
  type IndexProjectOptions,
} from "./code-indexer";
import type { IndexBackend } from "./backends/types";

/** True when the code-map index is enabled (config + PUNTAX_CODE_MAP env). */
export function codeMapEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return loadPuntaxConfig({ env }).codeMap.enabled;
}

/** Canonical project root used as the code-map `projects.root_path`. */
export function projectRoot(projectPath: string): string {
  return path.resolve(projectPath);
}

/** Open the project-local code-map.db, or null on any failure. */
export function openCodeMap(projectPathAbs: string): CodeMap | null {
  try {
    return new CodeMap({ dbPath: contextPaths(projectPathAbs).codeMapDb });
  } catch {
    return null;
  }
}

export type FreshnessState = "fresh" | "stale" | "missing";

export interface Freshness {
  state: FreshnessState;
  record?: FileRecord;
}

/**
 * Freshness by mtime only — no file read. A file is `fresh` when its on-disk
 * mtime equals the indexed mtime and the row is not flagged stale.
 */
export function fileFreshnessByMtime(
  cm: CodeMap,
  projectId: string,
  projectPathAbs: string,
  relPath: string,
): Freshness {
  const record = cm.getFile(projectId, relPath);
  if (!record) return { state: "missing" };
  try {
    const stat = fs.statSync(path.join(projectPathAbs, relPath));
    if (Math.floor(stat.mtimeMs) === record.mtime && !record.stale) {
      return { state: "fresh", record };
    }
    return { state: "stale", record };
  } catch {
    return { state: "missing", record };
  }
}

/**
 * Ensure the project has been indexed at least once. Returns the index result
 * if a full index ran, or null if the index already had files (fast no-op) or
 * the code map could not be opened.
 */
export function ensureProjectIndexed(
  projectPathAbs: string,
  opts: { force?: boolean; backends?: IndexBackend[] } = {},
): IndexProjectResult | null {
  const cm = openCodeMap(projectPathAbs);
  if (!cm) return null;
  try {
    const projectId = projectIdFor(projectPathAbs);
    if (!opts.force) {
      const existing = cm.getProject(projectPathAbs);
      if (existing && cm.counts(projectId).files > 0) return null;
    }
    return indexProject(cm, projectPathAbs, {
      mode: "full",
      backends: opts.backends,
    });
  } catch {
    return null;
  } finally {
    cm.close();
  }
}

/** Incrementally refresh a single changed file. Returns true on success. */
export function refreshFile(
  projectPathAbs: string,
  relPath: string,
  opts: { backends?: IndexBackend[] } = {},
): boolean {
  const cm = openCodeMap(projectPathAbs);
  if (!cm) return false;
  try {
    indexProject(cm, projectPathAbs, {
      mode: "incremental",
      changedFiles: [relPath],
      backends: opts.backends,
    });
    return true;
  } catch {
    return false;
  } finally {
    cm.close();
  }
}

/** Run a full or incremental index with an already-open CodeMap (no lifecycle). */
export function runIndex(
  cm: CodeMap,
  projectPathAbs: string,
  options: IndexProjectOptions,
): IndexProjectResult {
  return indexProject(cm, projectPathAbs, options);
}

export interface IndexStatusReport {
  enabled: boolean;
  indexed: boolean;
  projectRoot: string;
  files: number;
  symbols: number;
  edges: number;
  staleFiles: number;
  lastRun: {
    mode: string;
    startedAt: number;
    finishedAt: number | null;
    filesSeen: number;
    filesIndexed: number;
    errors: number;
  } | null;
}

/** Summarize index freshness/coverage for the index_status MCP tool. */
export function indexStatus(projectPathAbs: string): IndexStatusReport {
  const base: IndexStatusReport = {
    enabled: codeMapEnabled(),
    indexed: false,
    projectRoot: projectPathAbs,
    files: 0,
    symbols: 0,
    edges: 0,
    staleFiles: 0,
    lastRun: null,
  };
  const cm = openCodeMap(projectPathAbs);
  if (!cm) return base;
  try {
    const existing = cm.getProject(projectPathAbs);
    if (!existing) return base;
    const projectId = projectIdFor(projectPathAbs);
    const counts = cm.counts(projectId);
    const run = cm.latestRun(projectId);
    return {
      ...base,
      indexed: counts.files > 0,
      files: counts.files,
      symbols: counts.symbols,
      edges: counts.edges,
      staleFiles: counts.staleFiles,
      lastRun: run
        ? {
            mode: run.mode,
            startedAt: run.startedAt,
            finishedAt: run.finishedAt,
            filesSeen: run.filesSeen,
            filesIndexed: run.filesIndexed,
            errors: run.errors,
          }
        : null,
    };
  } catch {
    return base;
  } finally {
    cm.close();
  }
}
