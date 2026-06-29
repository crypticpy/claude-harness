-- PUNTAX Code Map Schema
-- SQLite target. Use WAL mode in the application layer.
--
-- Canonical reference copy. The runtime schema is embedded as CODE_MAP_SCHEMA in
-- code-map.ts (the bare `tsc` build does not copy .sql into dist); keep the two
-- byte-for-byte identical. Mirrors puntax-v2-docs/schemas/code-map.schema.sql.

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
