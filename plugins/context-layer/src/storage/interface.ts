/**
 * Context Layer Storage Interface
 *
 * Defines the contract for persistent storage of context layer data including
 * project profiles, file indexes, context reads, and code chunks.
 */

// =============================================================================
// Core Entity Types
// =============================================================================

export interface ProjectProfile {
  projectId: string;
  personality: string;
  updatedAt: number;
  projectHash: string;
}

export interface FileIndexEntry {
  id: string;
  projectId: string;
  filePath: string;
  fileType: string;
  lineCount: number;
  exports: string[];
  imports: string[];
  summary: string;
  complexity: 'low' | 'medium' | 'high';
  contentHash: string;
  indexedAt: number;
}

export interface ContextRead {
  id: string;
  sessionId: string;
  filePath: string;
  contentHash: string;
  messageIndex: number;
  readAt: number;
}

export interface CodeChunk {
  id: string;
  filePath: string;
  symbolName: string;
  content: string;
  contentHash: string;
  cachedAt: number;
}

// =============================================================================
// Storage Interface
// =============================================================================

export interface ContextStorage {
  // Project profiles
  getProjectProfile(projectId: string): Promise<ProjectProfile | null>;
  upsertProjectProfile(profile: ProjectProfile): Promise<void>;

  // File index
  getFileIndex(projectId: string, pattern?: string): Promise<FileIndexEntry[]>;
  upsertFileIndex(entry: FileIndexEntry): Promise<void>;
  deleteFileIndex(projectId: string, filePath: string): Promise<void>;

  // Context reads
  recordRead(read: ContextRead): Promise<void>;
  getReads(sessionId: string): Promise<ContextRead[]>;
  getReadForFile(sessionId: string, filePath: string): Promise<ContextRead | null>;

  // Chunk cache
  cacheChunk(chunk: CodeChunk): Promise<void>;
  getChunk(chunkId: string): Promise<CodeChunk | null>;

  // Cleanup
  clearSession(sessionId: string): Promise<void>;
  close(): Promise<void>;
}

export interface StorageOptions {
  dbPath?: string;
  debug?: boolean;
}

export interface BulkOperationResult {
  success: number;
  failed: number;
  errors: string[];
}
