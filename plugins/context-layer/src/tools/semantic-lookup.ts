/**
 * Semantic Lookup Tool
 *
 * Allows Claude to get file summaries BEFORE reading full content,
 * saving context window space by providing structured metadata about files.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  createStorage,
  generateFileIndexId,
  type ContextStorage,
  type FileIndexEntry,
} from '../storage';
import {
  parseFile,
  generateSummary,
  formatSummaryAsText,
} from '../indexer';

// =============================================================================
// Types
// =============================================================================

export interface SemanticLookupInput {
  filePath: string;      // File to look up
  projectPath: string;   // Project root for index lookup
}

export interface SemanticLookupResult {
  filePath: string;
  summary: string;           // AI-generated description of file purpose
  exports: string[];         // List of exported symbols
  imports: string[];         // Dependencies
  lineCount: number;
  complexity: 'low' | 'medium' | 'high';
  lastIndexed: number;       // Timestamp
  needsFullRead: boolean;    // True if file changed since last index
}

export interface SemanticLookupOptions {
  storage?: ContextStorage;
  forceReindex?: boolean;
  maxFileSize?: number;
}

// =============================================================================
// Constants
// =============================================================================

const SUPPORTED_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.pyw', '.pyi',
]);

const DEFAULT_MAX_FILE_SIZE = 1024 * 1024; // 1MB

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Compute a content hash for the file to detect changes.
 */
function computeContentHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * Generate a stable project ID from the project path.
 */
function generateProjectId(projectPath: string): string {
  const normalized = path.resolve(projectPath);
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

/**
 * Determine file type from extension.
 */
function getFileType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const typeMap: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescript-react',
    '.js': 'javascript',
    '.jsx': 'javascript-react',
    '.mjs': 'javascript-module',
    '.cjs': 'javascript-commonjs',
    '.py': 'python',
    '.pyw': 'python',
    '.pyi': 'python-stub',
  };
  return typeMap[ext] || 'unknown';
}

/**
 * Check if a file extension is supported for parsing.
 */
function isSupportedFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return SUPPORTED_EXTENSIONS.has(ext);
}

/**
 * Read file content safely with size limits.
 */
function readFileSafe(
  filePath: string,
  maxSize: number = DEFAULT_MAX_FILE_SIZE
): { content: string; error?: string } {
  try {
    const stats = fs.statSync(filePath);

    if (!stats.isFile()) {
      return { content: '', error: `Not a file: ${filePath}` };
    }

    if (stats.size > maxSize) {
      return { content: '', error: `File exceeds max size of ${maxSize} bytes` };
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    return { content };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { content: '', error: `Failed to read file: ${message}` };
  }
}

// =============================================================================
// Main Lookup Function
// =============================================================================

/**
 * Perform semantic lookup on a file.
 *
 * This function checks the storage for a cached file index entry,
 * and if not found or stale, parses the file and generates a summary.
 *
 * @param input - The lookup input containing file and project paths
 * @param options - Optional configuration for the lookup
 * @returns The semantic lookup result with file metadata and summary
 */
export async function semanticLookup(
  input: SemanticLookupInput,
  options: SemanticLookupOptions = {}
): Promise<SemanticLookupResult> {
  const {
    storage: providedStorage,
    forceReindex = false,
    maxFileSize = DEFAULT_MAX_FILE_SIZE,
  } = options;

  // Resolve paths
  const absoluteFilePath = path.resolve(input.projectPath, input.filePath);
  const relativePath = path.relative(input.projectPath, absoluteFilePath);
  const projectId = generateProjectId(input.projectPath);

  // Validate file exists
  if (!fs.existsSync(absoluteFilePath)) {
    throw new SemanticLookupError(
      `File not found: ${absoluteFilePath}`,
      'FILE_NOT_FOUND'
    );
  }

  // Check if file type is supported
  if (!isSupportedFile(absoluteFilePath)) {
    throw new SemanticLookupError(
      `Unsupported file type: ${path.extname(absoluteFilePath)}`,
      'UNSUPPORTED_FILE_TYPE'
    );
  }

  // Get or create storage
  const storage = providedStorage || createStorage();
  const shouldCloseStorage = !providedStorage;

  try {
    // Read file content
    const { content, error: readError } = readFileSafe(absoluteFilePath, maxFileSize);
    if (readError) {
      throw new SemanticLookupError(readError, 'FILE_READ_ERROR');
    }

    // Compute current content hash
    const currentHash = computeContentHash(content);

    // Check for existing index entry
    const indexId = generateFileIndexId(projectId, relativePath);
    const existingEntries = await storage.getFileIndex(projectId, relativePath);
    const existingEntry = existingEntries.find(e => e.filePath === relativePath);

    // Determine if we need to reindex
    const needsReindex = forceReindex ||
      !existingEntry ||
      existingEntry.contentHash !== currentHash;

    if (existingEntry && !needsReindex) {
      // Return cached result
      return {
        filePath: relativePath,
        summary: existingEntry.summary,
        exports: existingEntry.exports,
        imports: existingEntry.imports,
        lineCount: existingEntry.lineCount,
        complexity: existingEntry.complexity,
        lastIndexed: existingEntry.indexedAt,
        needsFullRead: false,
      };
    }

    // Parse and index the file
    const parseResult = parseFile(content, absoluteFilePath);

    if (parseResult.errors.length > 0 && parseResult.lineCount === 0) {
      throw new SemanticLookupError(
        `Parse error: ${parseResult.errors.join(', ')}`,
        'PARSE_ERROR'
      );
    }

    // Generate summary
    const fileSummary = generateSummary(parseResult, relativePath);
    const summaryText = formatSummaryAsText(fileSummary);

    // Create index entry
    const now = Date.now();
    const newEntry: FileIndexEntry = {
      id: indexId,
      projectId,
      filePath: relativePath,
      fileType: getFileType(absoluteFilePath),
      lineCount: parseResult.lineCount,
      exports: fileSummary.exports,
      imports: parseResult.imports.map(i => `${i.name} from ${i.source}`),
      summary: summaryText,
      complexity: fileSummary.complexity,
      contentHash: currentHash,
      indexedAt: now,
    };

    // Store the new entry
    await storage.upsertFileIndex(newEntry);

    return {
      filePath: relativePath,
      summary: summaryText,
      exports: newEntry.exports,
      imports: newEntry.imports,
      lineCount: newEntry.lineCount,
      complexity: newEntry.complexity,
      lastIndexed: now,
      needsFullRead: needsReindex && !!existingEntry,
    };
  } finally {
    // Clean up storage if we created it
    if (shouldCloseStorage) {
      await storage.close();
    }
  }
}

// =============================================================================
// Batch Operations
// =============================================================================

export interface BatchLookupResult {
  results: Map<string, SemanticLookupResult>;
  errors: Map<string, Error>;
}

/**
 * Perform semantic lookup on multiple files.
 *
 * @param filePaths - Array of file paths to look up
 * @param projectPath - Project root path
 * @param options - Optional configuration
 * @returns Map of file paths to their lookup results and any errors
 */
export async function batchSemanticLookup(
  filePaths: string[],
  projectPath: string,
  options: SemanticLookupOptions = {}
): Promise<BatchLookupResult> {
  const storage = options.storage || createStorage();
  const shouldCloseStorage = !options.storage;

  const results = new Map<string, SemanticLookupResult>();
  const errors = new Map<string, Error>();

  try {
    for (const filePath of filePaths) {
      try {
        const result = await semanticLookup(
          { filePath, projectPath },
          { ...options, storage }
        );
        results.set(filePath, result);
      } catch (error) {
        errors.set(
          filePath,
          error instanceof Error ? error : new Error(String(error))
        );
      }
    }

    return { results, errors };
  } finally {
    if (shouldCloseStorage) {
      await storage.close();
    }
  }
}

// =============================================================================
// Error Handling
// =============================================================================

export type SemanticLookupErrorCode =
  | 'FILE_NOT_FOUND'
  | 'UNSUPPORTED_FILE_TYPE'
  | 'FILE_READ_ERROR'
  | 'PARSE_ERROR'
  | 'STORAGE_ERROR';

export class SemanticLookupError extends Error {
  public readonly code: SemanticLookupErrorCode;

  constructor(message: string, code: SemanticLookupErrorCode) {
    super(message);
    this.name = 'SemanticLookupError';
    this.code = code;
    Object.setPrototypeOf(this, SemanticLookupError.prototype);
  }
}

// =============================================================================
// MCP Tool Handler
// =============================================================================

/**
 * MCP tool handler for semantic_lookup.
 *
 * This is the entry point called by the MCP server when the tool is invoked.
 */
export async function handleSemanticLookup(
  args: Record<string, unknown>
): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}> {
  try {
    // Validate input
    const filePath = args.filePath;
    const projectPath = args.projectPath;

    if (typeof filePath !== 'string' || !filePath) {
      return {
        content: [{
          type: 'text',
          text: 'Error: filePath is required and must be a non-empty string',
        }],
        isError: true,
      };
    }

    if (typeof projectPath !== 'string' || !projectPath) {
      return {
        content: [{
          type: 'text',
          text: 'Error: projectPath is required and must be a non-empty string',
        }],
        isError: true,
      };
    }

    // Perform lookup
    const result = await semanticLookup({ filePath, projectPath });

    // Format output
    const output = formatLookupResult(result);

    return {
      content: [{
        type: 'text',
        text: output,
      }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof SemanticLookupError ? error.code : 'UNKNOWN';

    return {
      content: [{
        type: 'text',
        text: `Error [${code}]: ${message}`,
      }],
      isError: true,
    };
  }
}

/**
 * Format lookup result as human-readable text.
 */
function formatLookupResult(result: SemanticLookupResult): string {
  const lines: string[] = [
    `File: ${result.filePath}`,
    `Lines: ${result.lineCount} | Complexity: ${result.complexity}`,
    '',
    result.summary,
    '',
  ];

  if (result.exports.length > 0) {
    lines.push(`Exports (${result.exports.length}):`);
    const displayExports = result.exports.slice(0, 10);
    for (const exp of displayExports) {
      lines.push(`  - ${exp}`);
    }
    if (result.exports.length > 10) {
      lines.push(`  ... and ${result.exports.length - 10} more`);
    }
    lines.push('');
  }

  if (result.imports.length > 0) {
    lines.push(`Dependencies (${result.imports.length}):`);
    const displayImports = result.imports.slice(0, 10);
    for (const imp of displayImports) {
      lines.push(`  - ${imp}`);
    }
    if (result.imports.length > 10) {
      lines.push(`  ... and ${result.imports.length - 10} more`);
    }
    lines.push('');
  }

  if (result.needsFullRead) {
    lines.push('Note: File has changed since last index. Consider reading full content.');
  }

  const indexedDate = new Date(result.lastIndexed).toISOString();
  lines.push(`Last indexed: ${indexedDate}`);

  return lines.join('\n');
}

// =============================================================================
// Tool Definition for MCP Registration
// =============================================================================

export const semanticLookupToolDefinition = {
  name: 'semantic_lookup',
  description:
    'Get a semantic summary of a file without reading its full content. ' +
    'Returns file purpose, exports, imports, complexity, and line count. ' +
    'Use this to decide if you need to read the full file content.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      filePath: {
        type: 'string',
        description: 'Path to the file to look up (relative to project root)',
      },
      projectPath: {
        type: 'string',
        description: 'Absolute path to the project root directory',
      },
    },
    required: ['filePath', 'projectPath'],
  },
};
