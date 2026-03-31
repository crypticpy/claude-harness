-- Context Layer SQLite Schema
-- Persistent storage for project profiles, file indexes, context reads, and chunks

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
CREATE INDEX IF NOT EXISTS idx_file_index_type ON file_index(project_id, file_type);

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
CREATE INDEX IF NOT EXISTS idx_context_reads_time ON context_reads(session_id, read_at);

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
INSERT OR IGNORE INTO _schema_meta (key, value) VALUES ('created_at', CAST(strftime('%s', 'now') * 1000 AS TEXT));
