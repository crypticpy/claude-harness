/**
 * PUNTAX Code Map store (better-sqlite3)
 *
 * Project-local `code-map.db` implementing schemas/code-map.schema.sql:
 *   files -> symbols -> edges -> reads/chunks -> diagnostics  (+ index_runs)
 *
 * IDs are deterministic (sha1 of stable key fields), so re-indexing a file
 * REPLACES its rows instead of accumulating duplicates. Per-file writes
 * (symbols, edges, diagnostics) run in a single transaction.
 *
 * Gated by PUNTAX_CODE_MAP at the tool layer — this module is pure storage and
 * does not read config itself. Mirrors the better-sqlite3 conventions in
 * sqlite.ts (synchronous, WAL, prepared statements).
 */

import Database, { type Database as DatabaseType } from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

export type Confidence =
  "lsp" | "extracted" | "resolved" | "inferred" | "ambiguous";

export type EdgeKind =
  | "contains"
  | "imports"
  | "exports"
  | "calls"
  | "references"
  | "extends"
  | "implements"
  | "tests"
  | "configures"
  | "reads_table"
  | "writes_table";

export interface FileRecord {
  id: string;
  projectId: string;
  path: string;
  language: string | null;
  hash: string;
  mtime: number;
  sizeBytes: number;
  lineCount: number;
  indexedAt: number;
  stale: boolean;
}

export interface SymbolRecord {
  id: string;
  projectId: string;
  fileId: string;
  kind: string;
  name: string;
  qualifiedName: string;
  parentSymbolId: string | null;
  startLine: number;
  endLine: number;
  startByte: number | null;
  endByte: number | null;
  signature: string | null;
  doc: string | null;
  confidence: Confidence;
}

export interface EdgeRecord {
  id: string;
  projectId: string;
  sourceFileId: string | null;
  targetFileId: string | null;
  sourceSymbolId: string | null;
  targetSymbolId: string | null;
  kind: EdgeKind;
  confidence: Confidence;
  provenance: string | null;
  line: number | null;
  createdAt: number;
}

export interface DiagnosticRecord {
  id: string;
  projectId: string;
  fileId: string;
  source: string;
  severity: string;
  message: string;
  startLine: number | null;
  endLine: number | null;
  code: string | null;
  observedAt: number;
}

export interface IndexRunRecord {
  id: string;
  projectId: string;
  startedAt: number;
  finishedAt: number | null;
  filesSeen: number;
  filesIndexed: number;
  errors: number;
  mode: string;
}

/** Per-file symbol payload (id/fileId/projectId are assigned by the store). */
export type SymbolInput = Omit<SymbolRecord, "id" | "projectId" | "fileId">;

/** Per-file edge payload (id/projectId/createdAt are assigned by the store). */
export type EdgeInput = Omit<EdgeRecord, "id" | "projectId" | "createdAt">;

/** Per-file diagnostic payload (id/projectId/fileId are assigned by the store). */
export type DiagnosticInput = Omit<
  DiagnosticRecord,
  "id" | "projectId" | "fileId" | "observedAt"
>;

export interface CodeMapOptions {
  dbPath: string;
  /** Injected clock for deterministic timestamps in tests. */
  clock?: () => number;
  debug?: boolean;
}

// Embedded schema — must stay byte-identical to code-map.schema.sql (the bare
// `tsc` build does not copy .sql into dist, mirroring sqlite.ts).
const CODE_MAP_SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  root_path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  language TEXT,
  hash TEXT NOT NULL,
  mtime INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL,
  line_count INTEGER NOT NULL,
  indexed_at INTEGER NOT NULL,
  stale INTEGER NOT NULL DEFAULT 0,
  UNIQUE(project_id, path)
);

CREATE TABLE IF NOT EXISTS symbols (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  qualified_name TEXT NOT NULL,
  parent_symbol_id TEXT REFERENCES symbols(id) ON DELETE SET NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  start_byte INTEGER,
  end_byte INTEGER,
  signature TEXT,
  doc TEXT,
  confidence TEXT NOT NULL DEFAULT 'extracted',
  UNIQUE(project_id, qualified_name, file_id, start_line)
);

CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_file_id TEXT REFERENCES files(id) ON DELETE CASCADE,
  target_file_id TEXT REFERENCES files(id) ON DELETE CASCADE,
  source_symbol_id TEXT REFERENCES symbols(id) ON DELETE CASCADE,
  target_symbol_id TEXT REFERENCES symbols(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  confidence TEXT NOT NULL,
  provenance TEXT,
  line INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reads (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_id TEXT REFERENCES files(id) ON DELETE CASCADE,
  symbol_id TEXT REFERENCES symbols(id) ON DELETE SET NULL,
  content_hash TEXT,
  read_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  symbol_id TEXT REFERENCES symbols(id) ON DELETE SET NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  cached_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS diagnostics (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  start_line INTEGER,
  end_line INTEGER,
  code TEXT,
  observed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS index_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  files_seen INTEGER NOT NULL DEFAULT 0,
  files_indexed INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_files_project_path ON files(project_id, path);
CREATE INDEX IF NOT EXISTS idx_symbols_project_name ON symbols(project_id, name);
CREATE INDEX IF NOT EXISTS idx_symbols_project_qn ON symbols(project_id, qualified_name);
CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_id);
CREATE INDEX IF NOT EXISTS idx_edges_project_kind ON edges(project_id, kind);
CREATE INDEX IF NOT EXISTS idx_edges_source_symbol ON edges(source_symbol_id);
CREATE INDEX IF NOT EXISTS idx_edges_target_symbol ON edges(target_symbol_id);
CREATE INDEX IF NOT EXISTS idx_edges_target_file ON edges(target_file_id);
CREATE INDEX IF NOT EXISTS idx_edges_source_file ON edges(source_file_id);
CREATE INDEX IF NOT EXISTS idx_reads_session ON reads(session_id);
CREATE INDEX IF NOT EXISTS idx_diagnostics_file ON diagnostics(file_id);
`;

function sha1(...parts: (string | number)[]): string {
  return crypto.createHash("sha1").update(parts.join("\x00")).digest("hex");
}

/**
 * Deterministic project id from its absolute root path. Resolves internally so
 * a relative and an absolute path to the same project key identically — mirrors
 * memory-store.mjs's projectIdFor (both must agree: memory-write derives its
 * projectId here, the .mjs distill path derives it there, and they share one
 * memories.jsonl).
 */
export function projectIdFor(rootPath: string): string {
  return "prj_" + sha1(path.resolve(rootPath)).slice(0, 20);
}

/** Deterministic file id from project + repo-relative path. */
export function fileIdFor(projectId: string, relPath: string): string {
  return "fil_" + sha1(projectId, relPath).slice(0, 20);
}

/** Deterministic symbol id matching the UNIQUE(project,qn,file,start_line). */
export function symbolIdFor(
  projectId: string,
  qualifiedName: string,
  fileId: string,
  startLine: number,
): string {
  return (
    "sym_" + sha1(projectId, qualifiedName, fileId, startLine).slice(0, 20)
  );
}

function edgeIdFor(projectId: string, e: EdgeInput): string {
  return (
    "edg_" +
    sha1(
      projectId,
      e.kind,
      e.sourceFileId ?? "",
      e.targetFileId ?? "",
      e.sourceSymbolId ?? "",
      e.targetSymbolId ?? "",
      e.line ?? -1,
    ).slice(0, 20)
  );
}

export class CodeMap {
  private db: DatabaseType;
  private clock: () => number;

  constructor(options: CodeMapOptions) {
    const dbPath = options.dbPath;
    this.clock = options.clock ?? Date.now;

    if (dbPath !== ":memory:") {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(CODE_MAP_SCHEMA);
    if (options.debug) {
      console.error(`[CodeMap] opened ${dbPath}`);
    }
  }

  // ---------------------------------------------------------------------------
  // projects
  // ---------------------------------------------------------------------------

  /** Insert the project row if absent, bump updated_at otherwise. */
  ensureProject(rootPath: string, name: string): string {
    const id = projectIdFor(rootPath);
    const now = this.clock();
    this.db
      .prepare(
        `INSERT INTO projects (id, root_path, name, created_at, updated_at)
         VALUES (@id, @rootPath, @name, @now, @now)
         ON CONFLICT(id) DO UPDATE SET updated_at = @now`,
      )
      .run({ id, rootPath, name, now });
    return id;
  }

  getProject(rootPath: string): { id: string; name: string } | null {
    const row = this.db
      .prepare("SELECT id, name FROM projects WHERE root_path = ?")
      .get(rootPath) as { id: string; name: string } | undefined;
    return row ?? null;
  }

  // ---------------------------------------------------------------------------
  // files
  // ---------------------------------------------------------------------------

  getFile(projectId: string, relPath: string): FileRecord | null {
    const row = this.db
      .prepare("SELECT * FROM files WHERE project_id = ? AND path = ?")
      .get(projectId, relPath) as FileRow | undefined;
    return row ? rowToFile(row) : null;
  }

  listFiles(projectId: string): FileRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM files WHERE project_id = ? ORDER BY path")
      .all(projectId) as FileRow[];
    return rows.map(rowToFile);
  }

  /** Upsert a file row by (project_id, path). Returns the file id. */
  upsertFile(input: {
    projectId: string;
    path: string;
    language: string | null;
    hash: string;
    mtime: number;
    sizeBytes: number;
    lineCount: number;
    stale?: boolean;
  }): string {
    const id = fileIdFor(input.projectId, input.path);
    this.db
      .prepare(
        `INSERT INTO files
           (id, project_id, path, language, hash, mtime, size_bytes, line_count, indexed_at, stale)
         VALUES
           (@id, @projectId, @path, @language, @hash, @mtime, @sizeBytes, @lineCount, @indexedAt, @stale)
         ON CONFLICT(id) DO UPDATE SET
           language = @language,
           hash = @hash,
           mtime = @mtime,
           size_bytes = @sizeBytes,
           line_count = @lineCount,
           indexed_at = @indexedAt,
           stale = @stale`,
      )
      .run({
        id,
        projectId: input.projectId,
        path: input.path,
        language: input.language,
        hash: input.hash,
        mtime: input.mtime,
        sizeBytes: input.sizeBytes,
        lineCount: input.lineCount,
        indexedAt: this.clock(),
        stale: input.stale ? 1 : 0,
      });
    return id;
  }

  /** Flag/unflag a file as stale (cheap; no reparse). */
  setFileStale(fileId: string, stale: boolean): void {
    this.db
      .prepare("UPDATE files SET stale = ? WHERE id = ?")
      .run(stale ? 1 : 0, fileId);
  }

  /** Remove a file and (via cascade) its symbols/edges/chunks/diagnostics. */
  deleteFile(fileId: string): void {
    this.db.prepare("DELETE FROM files WHERE id = ?").run(fileId);
  }

  // ---------------------------------------------------------------------------
  // symbols
  // ---------------------------------------------------------------------------

  /**
   * Replace all symbols for a file in one transaction. Returns the qualified
   * name -> symbol id map for the freshly written symbols (used to wire edges).
   */
  replaceFileSymbols(
    projectId: string,
    fileId: string,
    symbols: SymbolInput[],
  ): Map<string, string> {
    const del = this.db.prepare("DELETE FROM symbols WHERE file_id = ?");
    const ins = this.db.prepare(
      `INSERT OR REPLACE INTO symbols
         (id, project_id, file_id, kind, name, qualified_name, parent_symbol_id,
          start_line, end_line, start_byte, end_byte, signature, doc, confidence)
       VALUES
         (@id, @projectId, @fileId, @kind, @name, @qualifiedName, @parentSymbolId,
          @startLine, @endLine, @startByte, @endByte, @signature, @doc, @confidence)`,
    );
    const idByQn = new Map<string, string>();
    const txn = this.db.transaction((rows: SymbolInput[]) => {
      del.run(fileId);
      for (const s of rows) {
        const id = symbolIdFor(projectId, s.qualifiedName, fileId, s.startLine);
        ins.run({
          id,
          projectId,
          fileId,
          kind: s.kind,
          name: s.name,
          qualifiedName: s.qualifiedName,
          parentSymbolId: s.parentSymbolId,
          startLine: s.startLine,
          endLine: s.endLine,
          startByte: s.startByte,
          endByte: s.endByte,
          signature: s.signature,
          doc: s.doc,
          confidence: s.confidence,
        });
        idByQn.set(s.qualifiedName, id);
      }
    });
    txn(symbols);
    return idByQn;
  }

  /** Wire parent_symbol_id for child symbols within a file (e.g. methods). */
  setSymbolParents(
    fileId: string,
    updates: { childId: string; parentId: string }[],
  ): void {
    const stmt = this.db.prepare(
      "UPDATE symbols SET parent_symbol_id = ? WHERE id = ? AND file_id = ?",
    );
    const txn = this.db.transaction(
      (rows: { childId: string; parentId: string }[]) => {
        for (const u of rows) stmt.run(u.parentId, u.childId, fileId);
      },
    );
    txn(updates);
  }

  getSymbolsByName(projectId: string, name: string): SymbolRecord[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM symbols WHERE project_id = ? AND name = ? ORDER BY qualified_name",
      )
      .all(projectId, name) as SymbolRow[];
    return rows.map(rowToSymbol);
  }

  getSymbolsForFile(fileId: string): SymbolRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM symbols WHERE file_id = ? ORDER BY start_line")
      .all(fileId) as SymbolRow[];
    return rows.map(rowToSymbol);
  }

  getSymbolById(id: string): SymbolRecord | null {
    const row = this.db
      .prepare("SELECT * FROM symbols WHERE id = ?")
      .get(id) as SymbolRow | undefined;
    return row ? rowToSymbol(row) : null;
  }

  getFileById(id: string): FileRecord | null {
    const row = this.db.prepare("SELECT * FROM files WHERE id = ?").get(id) as
      FileRow | undefined;
    return row ? rowToFile(row) : null;
  }

  /** Outgoing edges from a symbol (e.g. it extends/implements a target). */
  edgesFromSymbol(symbolId: string): EdgeRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM edges WHERE source_symbol_id = ?")
      .all(symbolId) as EdgeRow[];
    return rows.map(rowToEdge);
  }

  // ---------------------------------------------------------------------------
  // edges
  // ---------------------------------------------------------------------------

  /** Replace all edges sourced from a file in one transaction. */
  replaceFileEdges(
    projectId: string,
    sourceFileId: string,
    edges: EdgeInput[],
  ): void {
    const del = this.db.prepare("DELETE FROM edges WHERE source_file_id = ?");
    const ins = this.db.prepare(
      `INSERT OR REPLACE INTO edges
         (id, project_id, source_file_id, target_file_id, source_symbol_id,
          target_symbol_id, kind, confidence, provenance, line, created_at)
       VALUES
         (@id, @projectId, @sourceFileId, @targetFileId, @sourceSymbolId,
          @targetSymbolId, @kind, @confidence, @provenance, @line, @createdAt)`,
    );
    const now = this.clock();
    const txn = this.db.transaction((rows: EdgeInput[]) => {
      del.run(sourceFileId);
      for (const e of rows) {
        ins.run({
          id: edgeIdFor(projectId, e),
          projectId,
          sourceFileId: e.sourceFileId,
          targetFileId: e.targetFileId,
          sourceSymbolId: e.sourceSymbolId,
          targetSymbolId: e.targetSymbolId,
          kind: e.kind,
          confidence: e.confidence,
          provenance: e.provenance,
          line: e.line,
          createdAt: now,
        });
      }
    });
    txn(edges);
  }

  /** Edges whose target is this file (e.g. who imports it). */
  edgesTargetingFile(projectId: string, targetFileId: string): EdgeRecord[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM edges WHERE project_id = ? AND target_file_id = ?",
      )
      .all(projectId, targetFileId) as EdgeRow[];
    return rows.map(rowToEdge);
  }

  /** Edges whose target is this symbol (callers/references). */
  edgesTargetingSymbol(symbolId: string): EdgeRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM edges WHERE target_symbol_id = ?")
      .all(symbolId) as EdgeRow[];
    return rows.map(rowToEdge);
  }

  edgesFromFile(sourceFileId: string): EdgeRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM edges WHERE source_file_id = ?")
      .all(sourceFileId) as EdgeRow[];
    return rows.map(rowToEdge);
  }

  // ---------------------------------------------------------------------------
  // diagnostics
  // ---------------------------------------------------------------------------

  replaceFileDiagnostics(
    projectId: string,
    fileId: string,
    diagnostics: DiagnosticInput[],
  ): void {
    const del = this.db.prepare("DELETE FROM diagnostics WHERE file_id = ?");
    const ins = this.db.prepare(
      `INSERT INTO diagnostics
         (id, project_id, file_id, source, severity, message, start_line, end_line, code, observed_at)
       VALUES
         (@id, @projectId, @fileId, @source, @severity, @message, @startLine, @endLine, @code, @observedAt)`,
    );
    const now = this.clock();
    const txn = this.db.transaction((rows: DiagnosticInput[]) => {
      del.run(fileId);
      let n = 0;
      for (const d of rows) {
        ins.run({
          id:
            "dgn_" +
            sha1(fileId, n++, d.message, d.startLine ?? -1).slice(0, 20),
          projectId,
          fileId,
          source: d.source,
          severity: d.severity,
          message: d.message,
          startLine: d.startLine,
          endLine: d.endLine,
          code: d.code,
          observedAt: now,
        });
      }
    });
    txn(diagnostics);
  }

  getDiagnosticsForFile(fileId: string): DiagnosticRecord[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM diagnostics WHERE file_id = ? ORDER BY start_line",
      )
      .all(fileId) as DiagnosticRow[];
    return rows.map(rowToDiagnostic);
  }

  // ---------------------------------------------------------------------------
  // index_runs
  // ---------------------------------------------------------------------------

  startRun(projectId: string, mode: string): string {
    const startedAt = this.clock();
    const id = "run_" + sha1(projectId, mode, startedAt).slice(0, 20);
    this.db
      .prepare(
        `INSERT INTO index_runs (id, project_id, started_at, mode)
         VALUES (?, ?, ?, ?)`,
      )
      .run(id, projectId, startedAt, mode);
    return id;
  }

  finishRun(
    runId: string,
    stats: { filesSeen: number; filesIndexed: number; errors: number },
  ): void {
    this.db
      .prepare(
        `UPDATE index_runs
           SET finished_at = ?, files_seen = ?, files_indexed = ?, errors = ?
         WHERE id = ?`,
      )
      .run(
        this.clock(),
        stats.filesSeen,
        stats.filesIndexed,
        stats.errors,
        runId,
      );
  }

  latestRun(projectId: string): IndexRunRecord | null {
    const row = this.db
      .prepare(
        "SELECT * FROM index_runs WHERE project_id = ? ORDER BY started_at DESC LIMIT 1",
      )
      .get(projectId) as IndexRunRow | undefined;
    return row ? rowToIndexRun(row) : null;
  }

  // ---------------------------------------------------------------------------
  // stats / lifecycle
  // ---------------------------------------------------------------------------

  counts(projectId: string): {
    files: number;
    symbols: number;
    edges: number;
    staleFiles: number;
  } {
    const one = (sql: string) =>
      (this.db.prepare(sql).get(projectId) as { n: number }).n;
    return {
      files: one("SELECT COUNT(*) n FROM files WHERE project_id = ?"),
      symbols: one("SELECT COUNT(*) n FROM symbols WHERE project_id = ?"),
      edges: one("SELECT COUNT(*) n FROM edges WHERE project_id = ?"),
      staleFiles: one(
        "SELECT COUNT(*) n FROM files WHERE project_id = ? AND stale = 1",
      ),
    };
  }

  close(): void {
    this.db.close();
  }
}

// ---------------------------------------------------------------------------
// row mappers
// ---------------------------------------------------------------------------

interface FileRow {
  id: string;
  project_id: string;
  path: string;
  language: string | null;
  hash: string;
  mtime: number;
  size_bytes: number;
  line_count: number;
  indexed_at: number;
  stale: number;
}

interface SymbolRow {
  id: string;
  project_id: string;
  file_id: string;
  kind: string;
  name: string;
  qualified_name: string;
  parent_symbol_id: string | null;
  start_line: number;
  end_line: number;
  start_byte: number | null;
  end_byte: number | null;
  signature: string | null;
  doc: string | null;
  confidence: string;
}

interface EdgeRow {
  id: string;
  project_id: string;
  source_file_id: string | null;
  target_file_id: string | null;
  source_symbol_id: string | null;
  target_symbol_id: string | null;
  kind: string;
  confidence: string;
  provenance: string | null;
  line: number | null;
  created_at: number;
}

interface DiagnosticRow {
  id: string;
  project_id: string;
  file_id: string;
  source: string;
  severity: string;
  message: string;
  start_line: number | null;
  end_line: number | null;
  code: string | null;
  observed_at: number;
}

interface IndexRunRow {
  id: string;
  project_id: string;
  started_at: number;
  finished_at: number | null;
  files_seen: number;
  files_indexed: number;
  errors: number;
  mode: string;
}

function rowToFile(r: FileRow): FileRecord {
  return {
    id: r.id,
    projectId: r.project_id,
    path: r.path,
    language: r.language,
    hash: r.hash,
    mtime: r.mtime,
    sizeBytes: r.size_bytes,
    lineCount: r.line_count,
    indexedAt: r.indexed_at,
    stale: r.stale === 1,
  };
}

function rowToSymbol(r: SymbolRow): SymbolRecord {
  return {
    id: r.id,
    projectId: r.project_id,
    fileId: r.file_id,
    kind: r.kind,
    name: r.name,
    qualifiedName: r.qualified_name,
    parentSymbolId: r.parent_symbol_id,
    startLine: r.start_line,
    endLine: r.end_line,
    startByte: r.start_byte,
    endByte: r.end_byte,
    signature: r.signature,
    doc: r.doc,
    confidence: r.confidence as Confidence,
  };
}

function rowToEdge(r: EdgeRow): EdgeRecord {
  return {
    id: r.id,
    projectId: r.project_id,
    sourceFileId: r.source_file_id,
    targetFileId: r.target_file_id,
    sourceSymbolId: r.source_symbol_id,
    targetSymbolId: r.target_symbol_id,
    kind: r.kind as EdgeKind,
    confidence: r.confidence as Confidence,
    provenance: r.provenance,
    line: r.line,
    createdAt: r.created_at,
  };
}

function rowToDiagnostic(r: DiagnosticRow): DiagnosticRecord {
  return {
    id: r.id,
    projectId: r.project_id,
    fileId: r.file_id,
    source: r.source,
    severity: r.severity,
    message: r.message,
    startLine: r.start_line,
    endLine: r.end_line,
    code: r.code,
    observedAt: r.observed_at,
  };
}

function rowToIndexRun(r: IndexRunRow): IndexRunRecord {
  return {
    id: r.id,
    projectId: r.project_id,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    filesSeen: r.files_seen,
    filesIndexed: r.files_indexed,
    errors: r.errors,
    mode: r.mode,
  };
}
