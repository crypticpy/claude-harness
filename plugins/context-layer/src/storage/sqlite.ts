/**
 * SQLite Storage Implementation for Context Layer
 *
 * Uses better-sqlite3 for synchronous, high-performance local storage.
 * All methods are wrapped in async for interface consistency.
 */

import Database, { type Database as DatabaseType } from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import type {
  ContextStorage,
  ProjectProfile,
  FileIndexEntry,
  ContextRead,
  CodeChunk,
  StorageOptions,
} from './interface';

const DEFAULT_DB_PATH = path.join(
  process.env.HOME || '~',
  '.claude',
  'plugins',
  'context-layer',
  'data',
  'context.db'
);

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

export class SQLiteStorage implements ContextStorage {
  private db: DatabaseType;
  private debug: boolean;

  private statements: {
    getProfile?: ReturnType<DatabaseType['prepare']>;
    upsertProfile?: ReturnType<DatabaseType['prepare']>;
    getFileIndex?: ReturnType<DatabaseType['prepare']>;
    upsertFileIndex?: ReturnType<DatabaseType['prepare']>;
    deleteFileIndex?: ReturnType<DatabaseType['prepare']>;
    recordRead?: ReturnType<DatabaseType['prepare']>;
    getReads?: ReturnType<DatabaseType['prepare']>;
    getReadForFile?: ReturnType<DatabaseType['prepare']>;
    clearSession?: ReturnType<DatabaseType['prepare']>;
    cacheChunk?: ReturnType<DatabaseType['prepare']>;
    getChunk?: ReturnType<DatabaseType['prepare']>;
  } = {};

  constructor(options: StorageOptions = {}) {
    const dbPath = options.dbPath || DEFAULT_DB_PATH;
    this.debug = options.debug || false;

    const dataDir = path.dirname(dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initializeSchema();
    this.prepareStatements();

    if (this.debug) {
      console.log(`[SQLiteStorage] Initialized at ${dbPath}`);
    }
  }

  private initializeSchema(): void {
    let schemaSQL: string;

    if (fs.existsSync(SCHEMA_PATH)) {
      schemaSQL = fs.readFileSync(SCHEMA_PATH, 'utf-8');
    } else {
      schemaSQL = this.getEmbeddedSchema();
    }

    this.db.exec(schemaSQL);
  }

  private getEmbeddedSchema(): string {
    return `
      CREATE TABLE IF NOT EXISTS project_profiles (
        project_id TEXT PRIMARY KEY,
        personality TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        project_hash TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS file_index (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_type TEXT NOT NULL,
        line_count INTEGER NOT NULL,
        exports TEXT NOT NULL,
        imports TEXT NOT NULL,
        summary TEXT NOT NULL,
        complexity TEXT NOT NULL CHECK (complexity IN ('low', 'medium', 'high')),
        content_hash TEXT NOT NULL,
        indexed_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_file_index_project ON file_index(project_id);
      CREATE INDEX IF NOT EXISTS idx_file_index_path ON file_index(file_path);
      CREATE INDEX IF NOT EXISTS idx_file_index_project_path ON file_index(project_id, file_path);

      CREATE TABLE IF NOT EXISTS context_reads (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        message_index INTEGER NOT NULL,
        read_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_context_reads_session ON context_reads(session_id);
      CREATE INDEX IF NOT EXISTS idx_context_reads_file ON context_reads(session_id, file_path);

      CREATE TABLE IF NOT EXISTS code_chunks (
        id TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        symbol_name TEXT NOT NULL,
        content TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        cached_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_code_chunks_file ON code_chunks(file_path);
      CREATE INDEX IF NOT EXISTS idx_code_chunks_symbol ON code_chunks(symbol_name);

      CREATE TABLE IF NOT EXISTS _schema_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      INSERT OR IGNORE INTO _schema_meta (key, value) VALUES ('version', '1');
    `;
  }

  private prepareStatements(): void {
    this.statements.getProfile = this.db.prepare(
      'SELECT * FROM project_profiles WHERE project_id = ?'
    );

    this.statements.upsertProfile = this.db.prepare(`
      INSERT INTO project_profiles (project_id, personality, updated_at, project_hash)
      VALUES (@projectId, @personality, @updatedAt, @projectHash)
      ON CONFLICT(project_id) DO UPDATE SET
        personality = @personality,
        updated_at = @updatedAt,
        project_hash = @projectHash
    `);

    this.statements.getFileIndex = this.db.prepare(
      'SELECT * FROM file_index WHERE project_id = ? ORDER BY file_path'
    );

    this.statements.upsertFileIndex = this.db.prepare(`
      INSERT INTO file_index (id, project_id, file_path, file_type, line_count, exports, imports, summary, complexity, content_hash, indexed_at)
      VALUES (@id, @projectId, @filePath, @fileType, @lineCount, @exports, @imports, @summary, @complexity, @contentHash, @indexedAt)
      ON CONFLICT(id) DO UPDATE SET
        file_type = @fileType,
        line_count = @lineCount,
        exports = @exports,
        imports = @imports,
        summary = @summary,
        complexity = @complexity,
        content_hash = @contentHash,
        indexed_at = @indexedAt
    `);

    this.statements.deleteFileIndex = this.db.prepare(
      'DELETE FROM file_index WHERE project_id = ? AND file_path = ?'
    );

    this.statements.recordRead = this.db.prepare(`
      INSERT INTO context_reads (id, session_id, file_path, content_hash, message_index, read_at)
      VALUES (@id, @sessionId, @filePath, @contentHash, @messageIndex, @readAt)
    `);

    this.statements.getReads = this.db.prepare(
      'SELECT * FROM context_reads WHERE session_id = ? ORDER BY read_at'
    );

    this.statements.getReadForFile = this.db.prepare(
      'SELECT * FROM context_reads WHERE session_id = ? AND file_path = ? ORDER BY read_at DESC LIMIT 1'
    );

    this.statements.clearSession = this.db.prepare(
      'DELETE FROM context_reads WHERE session_id = ?'
    );

    this.statements.cacheChunk = this.db.prepare(`
      INSERT INTO code_chunks (id, file_path, symbol_name, content, content_hash, cached_at)
      VALUES (@id, @filePath, @symbolName, @content, @contentHash, @cachedAt)
      ON CONFLICT(id) DO UPDATE SET
        content = @content,
        content_hash = @contentHash,
        cached_at = @cachedAt
    `);

    this.statements.getChunk = this.db.prepare(
      'SELECT * FROM code_chunks WHERE id = ?'
    );
  }

  async getProjectProfile(projectId: string): Promise<ProjectProfile | null> {
    const row = this.statements.getProfile!.get(projectId) as ProjectProfileRow | undefined;
    if (!row) return null;
    return this.rowToProjectProfile(row);
  }

  async upsertProjectProfile(profile: ProjectProfile): Promise<void> {
    this.statements.upsertProfile!.run({
      projectId: profile.projectId,
      personality: profile.personality,
      updatedAt: profile.updatedAt,
      projectHash: profile.projectHash,
    });
  }

  async getFileIndex(projectId: string, pattern?: string): Promise<FileIndexEntry[]> {
    let rows: FileIndexRow[];

    if (pattern) {
      const sqlPattern = this.globToSqlLike(pattern);
      const stmt = this.db.prepare(
        'SELECT * FROM file_index WHERE project_id = ? AND file_path LIKE ? ORDER BY file_path'
      );
      rows = stmt.all(projectId, sqlPattern) as FileIndexRow[];
    } else {
      rows = this.statements.getFileIndex!.all(projectId) as FileIndexRow[];
    }

    return rows.map((row) => this.rowToFileIndexEntry(row));
  }

  async upsertFileIndex(entry: FileIndexEntry): Promise<void> {
    this.statements.upsertFileIndex!.run({
      id: entry.id,
      projectId: entry.projectId,
      filePath: entry.filePath,
      fileType: entry.fileType,
      lineCount: entry.lineCount,
      exports: JSON.stringify(entry.exports),
      imports: JSON.stringify(entry.imports),
      summary: entry.summary,
      complexity: entry.complexity,
      contentHash: entry.contentHash,
      indexedAt: entry.indexedAt,
    });
  }

  async deleteFileIndex(projectId: string, filePath: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.statements.deleteFileIndex as any).run(projectId, filePath);
  }

  async recordRead(read: ContextRead): Promise<void> {
    this.statements.recordRead!.run({
      id: read.id,
      sessionId: read.sessionId,
      filePath: read.filePath,
      contentHash: read.contentHash,
      messageIndex: read.messageIndex,
      readAt: read.readAt,
    });
  }

  async getReads(sessionId: string): Promise<ContextRead[]> {
    const rows = this.statements.getReads!.all(sessionId) as ContextReadRow[];
    return rows.map((row) => this.rowToContextRead(row));
  }

  async getReadForFile(sessionId: string, filePath: string): Promise<ContextRead | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = (this.statements.getReadForFile as any).get(sessionId, filePath) as ContextReadRow | undefined;
    if (!row) return null;
    return this.rowToContextRead(row);
  }

  async cacheChunk(chunk: CodeChunk): Promise<void> {
    this.statements.cacheChunk!.run({
      id: chunk.id,
      filePath: chunk.filePath,
      symbolName: chunk.symbolName,
      content: chunk.content,
      contentHash: chunk.contentHash,
      cachedAt: chunk.cachedAt,
    });
  }

  async getChunk(chunkId: string): Promise<CodeChunk | null> {
    const row = this.statements.getChunk!.get(chunkId) as CodeChunkRow | undefined;
    if (!row) return null;
    return this.rowToCodeChunk(row);
  }

  async clearSession(sessionId: string): Promise<void> {
    this.statements.clearSession!.run(sessionId);
  }

  async close(): Promise<void> {
    this.db.close();
  }

  private globToSqlLike(glob: string): string {
    return glob
      .replace(/%/g, '\\%')
      .replace(/_/g, '\\_')
      .replace(/\*\*/g, '%')
      .replace(/\*/g, '%')
      .replace(/\?/g, '_');
  }

  private rowToProjectProfile(row: ProjectProfileRow): ProjectProfile {
    return {
      projectId: row.project_id,
      personality: row.personality,
      updatedAt: row.updated_at,
      projectHash: row.project_hash,
    };
  }

  private rowToFileIndexEntry(row: FileIndexRow): FileIndexEntry {
    return {
      id: row.id,
      projectId: row.project_id,
      filePath: row.file_path,
      fileType: row.file_type,
      lineCount: row.line_count,
      exports: this.parseJsonArray(row.exports),
      imports: this.parseJsonArray(row.imports),
      summary: row.summary,
      complexity: row.complexity as 'low' | 'medium' | 'high',
      contentHash: row.content_hash,
      indexedAt: row.indexed_at,
    };
  }

  private rowToContextRead(row: ContextReadRow): ContextRead {
    return {
      id: row.id,
      sessionId: row.session_id,
      filePath: row.file_path,
      contentHash: row.content_hash,
      messageIndex: row.message_index,
      readAt: row.read_at,
    };
  }

  private rowToCodeChunk(row: CodeChunkRow): CodeChunk {
    return {
      id: row.id,
      filePath: row.file_path,
      symbolName: row.symbol_name,
      content: row.content,
      contentHash: row.content_hash,
      cachedAt: row.cached_at,
    };
  }

  private parseJsonArray(jsonStr: string): string[] {
    try {
      const parsed = JSON.parse(jsonStr);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}

interface ProjectProfileRow {
  project_id: string;
  personality: string;
  updated_at: number;
  project_hash: string;
}

interface FileIndexRow {
  id: string;
  project_id: string;
  file_path: string;
  file_type: string;
  line_count: number;
  exports: string;
  imports: string;
  summary: string;
  complexity: string;
  content_hash: string;
  indexed_at: number;
}

interface ContextReadRow {
  id: string;
  session_id: string;
  file_path: string;
  content_hash: string;
  message_index: number;
  read_at: number;
}

interface CodeChunkRow {
  id: string;
  file_path: string;
  symbol_name: string;
  content: string;
  content_hash: string;
  cached_at: number;
}
