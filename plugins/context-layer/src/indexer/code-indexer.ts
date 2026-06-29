/**
 * Code-map indexer.
 *
 * Walks a project's source files, parses each with the highest-tier available
 * backend, and writes files/symbols/edges into code-map.db. Cross-file edges
 * (imports, extends/implements) are resolved in a post-pass once every file's
 * symbols are known. Staleness is tracked by content hash + mtime.
 *
 * Pure orchestration over an injected CodeMap + backends, so tests run against
 * an in-memory DB with a fixture tree. Gated by PUNTAX_CODE_MAP at the caller.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

import { getLanguageFromExtension } from "./parser";
import type { IndexBackend, BackendParseResult } from "./backends/types";
import { RegexBackend } from "./backends/regex";
import {
  CodeMap,
  type Confidence,
  type EdgeInput,
  type SymbolInput,
} from "../storage/code-map";

const DEFAULT_MAX_FILE_SIZE = 500 * 1024; // 500KB
const TS_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

const SKIP_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".nuxt",
  "out",
  "__pycache__",
  ".venv",
  "venv",
  ".mypy_cache",
  ".pytest_cache",
  ".tox",
  "target",
  ".cargo",
  "vendor",
  "coverage",
  ".nyc_output",
  ".cache",
  ".parcel-cache",
  ".turbo",
]);

export interface IndexProjectOptions {
  mode?: "full" | "incremental";
  /** Repo-relative paths to refresh; required for incremental mode. */
  changedFiles?: string[];
  maxFileSizeBytes?: number;
  /** Backends ordered high-tier first; defaults to [RegexBackend]. */
  backends?: IndexBackend[];
}

export interface IndexProjectResult {
  projectId: string;
  mode: "full" | "incremental";
  filesSeen: number;
  filesIndexed: number;
  errors: number;
  runId: string;
}

interface Candidate {
  relPath: string;
  absPath: string;
  size: number;
  mtimeMs: number;
  language: string;
}

interface ParsedFile {
  fileId: string;
  relPath: string;
  language: string;
  result: BackendParseResult;
  backend: IndexBackend;
}

/** Pick the highest-tier available backend that supports a language. */
export function pickBackend(
  language: string,
  backends: IndexBackend[],
): IndexBackend | null {
  for (const b of backends) {
    if (b.isAvailable() && b.supports(language)) return b;
  }
  return null;
}

export function indexProject(
  codeMap: CodeMap,
  projectPath: string,
  options: IndexProjectOptions = {},
): IndexProjectResult {
  const mode = options.mode ?? "full";
  const maxSize = options.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE;
  const backends = options.backends ?? [new RegexBackend()];

  const projectId = codeMap.ensureProject(
    projectPath,
    path.basename(projectPath),
  );
  const runId = codeMap.startRun(projectId, mode);

  let filesSeen = 0;
  let filesIndexed = 0;
  let errors = 0;

  const candidates =
    mode === "incremental"
      ? collectChangedCandidates(
          projectPath,
          options.changedFiles ?? [],
          maxSize,
        )
      : collectSourceFiles(projectPath, maxSize);

  // Incremental: drop rows for changed files that no longer exist on disk.
  if (mode === "incremental") {
    for (const rel of options.changedFiles ?? []) {
      const onDisk = candidates.some((c) => c.relPath === rel);
      if (!onDisk) {
        const existing = codeMap.getFile(projectId, rel);
        if (existing) codeMap.deleteFile(existing.id);
      }
    }
  } else {
    // Full: prune file rows whose source no longer exists on disk.
    const present = new Set(candidates.map((c) => c.relPath));
    for (const f of codeMap.listFiles(projectId)) {
      if (!present.has(f.path)) codeMap.deleteFile(f.id);
    }
  }

  const parsed: ParsedFile[] = [];
  // Files whose inbound symbol edges get cascade-dropped when a dependency is
  // re-parsed below; their edges are rebuilt in Phase C.
  const reverseDepFileIds = new Set<string>();

  // Phase A — parse + write files/symbols.
  for (const cand of candidates) {
    filesSeen++;
    try {
      const content = fs.readFileSync(cand.absPath, "utf-8");
      const hash = sha256(content);
      const existing = codeMap.getFile(projectId, cand.relPath);

      const backend = pickBackend(cand.language, backends);
      if (!backend) continue; // unsupported language; counted as seen, not indexed

      // Skip reparse if unchanged and fresh (cheap re-run within a full pass).
      if (existing && existing.hash === hash && !existing.stale) {
        continue;
      }

      // Before delete+reinsert drops this file's symbols (cascade-dropping the
      // edges that target them), remember which OTHER files own those inbound
      // edges so Phase C can rebuild them — they are unchanged and would not
      // otherwise re-resolve.
      if (existing) {
        for (const sym of codeMap.getSymbolsForFile(existing.id)) {
          for (const e of codeMap.edgesTargetingSymbol(sym.id)) {
            if (e.sourceFileId && e.sourceFileId !== existing.id) {
              reverseDepFileIds.add(e.sourceFileId);
            }
          }
        }
      }

      const result = backend.parse(content, cand.absPath);
      const fileId = codeMap.upsertFile({
        projectId,
        path: cand.relPath,
        language: cand.language,
        hash,
        mtime: Math.floor(cand.mtimeMs),
        sizeBytes: cand.size,
        lineCount: result.lineCount,
        stale: false,
      });

      const symbolInputs: SymbolInput[] = result.symbols.map((s) => ({
        kind: s.kind,
        name: s.name,
        qualifiedName: s.qualifiedName,
        parentSymbolId: null, // wired below within the file
        startLine: s.startLine,
        endLine: s.endLine,
        startByte: s.startByte,
        endByte: s.endByte,
        signature: s.signature,
        doc: s.doc,
        confidence: s.confidence,
      }));
      const idByQn = codeMap.replaceFileSymbols(
        projectId,
        fileId,
        symbolInputs,
      );
      wireParents(codeMap, result, idByQn, fileId);

      parsed.push({
        fileId,
        relPath: cand.relPath,
        language: cand.language,
        result,
        backend,
      });
      filesIndexed++;
      if (result.errors.length) errors += result.errors.length;
    } catch (err) {
      errors++;
    }
  }

  // Phase B — resolve cross-file edges now that all symbols exist.
  const fileIdByRel = new Map<string, string>();
  for (const f of codeMap.listFiles(projectId)) fileIdByRel.set(f.path, f.id);

  for (const pf of parsed) {
    codeMap.replaceFileEdges(
      projectId,
      pf.fileId,
      buildEdgesForFile(codeMap, projectId, pf, fileIdByRel),
    );
  }

  // Phase C — rebuild edges for unchanged files whose inbound symbol edges were
  // cascade-dropped when a dependency was re-parsed in Phase A. Without this,
  // re-indexing base.ts silently deletes `Child extends Base` and impact_check
  // under-reports dependents until child.ts itself happens to be re-parsed.
  const parsedIds = new Set(parsed.map((p) => p.fileId));
  for (const depFileId of reverseDepFileIds) {
    if (parsedIds.has(depFileId)) continue; // already rebuilt in Phase B
    const dep = reparseForEdges(codeMap, projectPath, depFileId, backends);
    if (!dep) continue;
    codeMap.replaceFileEdges(
      projectId,
      depFileId,
      buildEdgesForFile(codeMap, projectId, dep, fileIdByRel),
    );
  }

  codeMap.finishRun(runId, { filesSeen, filesIndexed, errors });

  return { projectId, mode, filesSeen, filesIndexed, errors, runId };
}

/** Compute the cross-file edges (imports + relations) sourced from one file. */
function buildEdgesForFile(
  codeMap: CodeMap,
  projectId: string,
  pf: ParsedFile,
  fileIdByRel: Map<string, string>,
): EdgeInput[] {
  const edges: EdgeInput[] = [];

  for (const imp of pf.result.imports) {
    const targetRel = resolveImport(
      pf.relPath,
      imp.source,
      pf.language,
      fileIdByRel,
    );
    if (!targetRel) continue;
    const targetFileId = fileIdByRel.get(targetRel);
    if (!targetFileId || targetFileId === pf.fileId) continue;
    edges.push({
      sourceFileId: pf.fileId,
      targetFileId,
      sourceSymbolId: null,
      targetSymbolId: null,
      kind: "imports",
      confidence: "resolved",
      provenance: `${pf.backend.name}:import`,
      line: imp.line,
    });
  }

  for (const rel of pf.result.relations) {
    const matches = codeMap.getSymbolsByName(projectId, rel.toName);
    if (matches.length === 0) continue;
    const target = matches[0];
    const sourceSymbolId = symbolIdInFile(
      codeMap,
      pf.fileId,
      rel.fromQualifiedName,
    );
    if (!sourceSymbolId) continue;
    const confidence: Confidence =
      matches.length === 1 ? "resolved" : "ambiguous";
    edges.push({
      sourceFileId: pf.fileId,
      targetFileId: target.fileId,
      sourceSymbolId,
      targetSymbolId: target.id,
      kind: rel.kind,
      confidence,
      provenance: `${pf.backend.name}:${rel.kind}`,
      line: rel.line,
    });
  }

  return edges;
}

/**
 * Re-parse an unchanged file purely to recompute its edges (its symbols stay
 * as-is in the DB). Returns null if the file vanished or no backend supports it.
 */
function reparseForEdges(
  codeMap: CodeMap,
  projectPath: string,
  fileId: string,
  backends: IndexBackend[],
): ParsedFile | null {
  const rec = codeMap.getFileById(fileId);
  if (!rec) return null;
  const backend = pickBackend(rec.language ?? "", backends);
  if (!backend) return null;
  const abs = path.join(projectPath, rec.path);
  let content: string;
  try {
    content = fs.readFileSync(abs, "utf-8");
  } catch {
    return null; // file removed; pruned on the next full pass
  }
  return {
    fileId,
    relPath: rec.path,
    language: rec.language ?? "",
    result: backend.parse(content, abs),
    backend,
  };
}

/** Set parent_symbol_id for child symbols (e.g. methods -> class). */
function wireParents(
  codeMap: CodeMap,
  result: BackendParseResult,
  idByQn: Map<string, string>,
  fileId: string,
): void {
  const updates: { childId: string; parentId: string }[] = [];
  for (const s of result.symbols) {
    if (!s.parentQualifiedName) continue;
    const childId = idByQn.get(s.qualifiedName);
    const parentId = idByQn.get(s.parentQualifiedName);
    if (childId && parentId) updates.push({ childId, parentId });
  }
  if (updates.length) codeMap.setSymbolParents(fileId, updates);
}

function symbolIdInFile(
  codeMap: CodeMap,
  fileId: string,
  qualifiedName: string,
): string | null {
  for (const s of codeMap.getSymbolsForFile(fileId)) {
    if (s.qualifiedName === qualifiedName) return s.id;
  }
  return null;
}

// ---------------------------------------------------------------------------
// import resolution
// ---------------------------------------------------------------------------

/** Resolve an import specifier to a repo-relative file path in the project. */
export function resolveImport(
  fromRel: string,
  source: string,
  language: string,
  fileSet: Map<string, string>,
): string | null {
  if (language === "python")
    return resolvePythonImport(fromRel, source, fileSet);
  return resolveTsImport(fromRel, source, fileSet);
}

function resolveTsImport(
  fromRel: string,
  source: string,
  fileSet: Map<string, string>,
): string | null {
  if (!source.startsWith(".")) return null; // bare/external module
  const baseDir = path.posix.dirname(toPosix(fromRel));
  let target = path.posix.normalize(path.posix.join(baseDir, source));
  // A specifier may carry a .js extension that maps to a .ts source.
  const stripped = target.replace(/\.(js|jsx|mjs|cjs)$/, "");
  const tries = new Set<string>();
  for (const t of [target, stripped]) {
    if (fileSet.has(t)) return t;
    for (const ext of TS_EXTS) tries.add(t + ext);
    for (const ext of TS_EXTS) tries.add(path.posix.join(t, "index" + ext));
  }
  for (const t of tries) if (fileSet.has(t)) return t;
  return null;
}

function resolvePythonImport(
  fromRel: string,
  source: string,
  fileSet: Map<string, string>,
): string | null {
  if (!source) return null;
  let baseDir = "";
  let mod = source;
  if (source.startsWith(".")) {
    // Relative import: leading dots climb packages from the file's dir.
    const dots = source.match(/^\.+/)?.[0].length ?? 1;
    let dir = path.posix.dirname(toPosix(fromRel));
    for (let i = 1; i < dots; i++) dir = path.posix.dirname(dir);
    baseDir = dir === "." ? "" : dir;
    mod = source.slice(dots);
  }
  const rel = mod ? mod.replace(/\./g, "/") : "";
  const stem = baseDir ? path.posix.join(baseDir, rel) : rel;
  const candidates = [stem + ".py", path.posix.join(stem, "__init__.py")];
  for (const c of candidates) {
    const norm = path.posix.normalize(c);
    if (fileSet.has(norm)) return norm;
  }
  return null;
}

// ---------------------------------------------------------------------------
// file collection
// ---------------------------------------------------------------------------

function collectSourceFiles(projectPath: string, maxSize: number): Candidate[] {
  const out: Candidate[] = [];

  function walk(dirAbs: string, relDir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const name = entry.name;
      const abs = path.join(dirAbs, name);
      const rel = relDir ? `${relDir}/${name}` : name;
      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(name) && !name.startsWith("."))
          walk(abs, rel);
      } else if (entry.isFile()) {
        const cand = toCandidate(abs, rel, maxSize);
        if (cand) out.push(cand);
      }
    }
  }

  walk(projectPath, "");
  return out;
}

function collectChangedCandidates(
  projectPath: string,
  changed: string[],
  maxSize: number,
): Candidate[] {
  const out: Candidate[] = [];
  for (const rel of changed) {
    const norm = toPosix(rel);
    const abs = path.join(projectPath, norm);
    const cand = toCandidate(abs, norm, maxSize);
    if (cand) out.push(cand);
  }
  return out;
}

function toCandidate(
  abs: string,
  rel: string,
  maxSize: number,
): Candidate | null {
  const language = getLanguageFromExtension(path.extname(abs).toLowerCase());
  if (language === "unknown") return null;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(abs);
  } catch {
    return null;
  }
  if (!stat.isFile() || stat.size > maxSize) return null;
  return {
    relPath: toPosix(rel),
    absPath: abs,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    language,
  };
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}
