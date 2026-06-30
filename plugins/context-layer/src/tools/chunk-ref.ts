/**
 * Chunk Reference Tool
 *
 * References already-read code chunks without re-reading entire files.
 * Optimizes context window usage by caching and retrieving code chunks.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  createStorage,
  generateChunkId,
  type ContextStorage,
  type CodeChunk,
} from '../storage';
import { parseFile } from '../indexer/parser';
import type { ParseResult } from '../indexer/types';

// =============================================================================
// Types
// =============================================================================

export interface ChunkRefInput {
  chunkId: string; // Format: "filePath:symbolName"
  sessionId: string; // Current session for cache lookup
}

export interface ChunkRefResult {
  chunkId: string;
  content: string; // The code chunk
  filePath: string;
  symbolName: string;
  isStale: boolean; // True if source file changed since caching
  cachedAt: number; // Timestamp
}

export interface CacheChunkInput {
  filePath: string;
  symbolName: string;
  content: string;
  sessionId: string;
}

interface SymbolLocation {
  startLine: number;
  endLine: number;
  name: string;
  kind: 'function' | 'class' | 'type' | 'interface' | 'enum' | 'const' | 'unknown';
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Computes a content hash for staleness detection.
 */
function computeContentHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * Parses a chunk ID into its components.
 */
function parseChunkId(chunkId: string): { filePath: string; symbolName: string } | null {
  const lastColonIndex = chunkId.lastIndexOf(':');
  if (lastColonIndex === -1 || lastColonIndex === 0) {
    return null;
  }
  return {
    filePath: chunkId.slice(0, lastColonIndex),
    symbolName: chunkId.slice(lastColonIndex + 1),
  };
}

/**
 * Reads file content safely, returning null on error.
 */
async function readFileSafely(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}


// =============================================================================
// Symbol Extraction
// =============================================================================

/**
 * Finds the end line of a code block starting at a given line.
 * Uses brace/indentation tracking depending on language.
 */
function findBlockEnd(
  lines: string[],
  startLine: number,
  language: ParseResult['language']
): number {
  if (language === 'python') {
    return findPythonBlockEnd(lines, startLine);
  }
  return findBraceBlockEnd(lines, startLine);
}

/**
 * Finds end of a brace-delimited block (TypeScript/JavaScript).
 */
function findBraceBlockEnd(lines: string[], startLine: number): number {
  let braceCount = 0;
  let foundFirstBrace = false;

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];

    // Count braces, ignoring those in strings/comments (simplified)
    for (const char of line) {
      if (char === '{') {
        braceCount++;
        foundFirstBrace = true;
      } else if (char === '}') {
        braceCount--;
      }
    }

    if (foundFirstBrace && braceCount === 0) {
      return i;
    }
  }

  // Fallback: return a reasonable chunk size
  return Math.min(startLine + 50, lines.length - 1);
}

/**
 * Finds end of an indentation-based block (Python).
 */
function findPythonBlockEnd(lines: string[], startLine: number): number {
  if (startLine >= lines.length) return startLine;

  const startLine_content = lines[startLine];
  const baseIndent = startLine_content.match(/^(\s*)/)?.[1]?.length ?? 0;

  for (let i = startLine + 1; i < lines.length; i++) {
    const line = lines[i];

    // Skip empty lines and comments
    if (line.trim() === '' || line.trim().startsWith('#')) {
      continue;
    }

    const currentIndent = line.match(/^(\s*)/)?.[1]?.length ?? 0;

    // If we find a line at the same or less indentation, block ends at previous line
    if (currentIndent <= baseIndent && line.trim() !== '') {
      return i - 1;
    }
  }

  return lines.length - 1;
}

/**
 * Extracts all symbol locations from parsed file.
 */
function getSymbolLocations(parsed: ParseResult, lines: string[]): SymbolLocation[] {
  const locations: SymbolLocation[] = [];

  // Add functions
  for (const func of parsed.functions) {
    const endLine = findBlockEnd(lines, func.line - 1, parsed.language);
    locations.push({
      name: func.name,
      startLine: func.line,
      endLine: endLine + 1,
      kind: 'function',
    });
  }

  // Add classes
  for (const cls of parsed.classes) {
    const endLine = findBlockEnd(lines, cls.line - 1, parsed.language);
    locations.push({
      name: cls.name,
      startLine: cls.line,
      endLine: endLine + 1,
      kind: 'class',
    });
  }

  // Add types/interfaces
  for (const type of parsed.types) {
    const endLine = findBlockEnd(lines, type.line - 1, parsed.language);
    locations.push({
      name: type.name,
      startLine: type.line,
      endLine: endLine + 1,
      kind: type.kind,
    });
  }

  return locations;
}

/**
 * Extracts a code chunk from a file by symbol name.
 * Parses the file and finds the named function/class/type/etc.
 */
export async function extractChunk(
  filePath: string,
  symbolName: string
): Promise<string | null> {
  const content = await readFileSafely(filePath);
  if (!content) {
    return null;
  }

  const lines = content.split('\n');
  const parsed = parseFile(content, filePath);

  if (parsed.errors.length > 0 && parsed.functions.length === 0 && parsed.classes.length === 0) {
    // File couldn't be parsed, try regex fallback
    return extractChunkFallback(content, symbolName, filePath);
  }

  const locations = getSymbolLocations(parsed, lines);
  const symbol = locations.find(loc => loc.name === symbolName);

  if (!symbol) {
    // Symbol not found in parsed result, try fallback
    return extractChunkFallback(content, symbolName, filePath);
  }

  // Extract lines (convert from 1-indexed to 0-indexed)
  const chunkLines = lines.slice(symbol.startLine - 1, symbol.endLine);
  return chunkLines.join('\n');
}

export interface BatchChunk {
  symbolName: string;
  content: string | null; // null when the symbol isn't found
  found: boolean;
}

/**
 * Extract several symbols from ONE file with a single read + parse, instead of
 * re-reading and re-parsing the file once per symbol. Order-preserving; repeated
 * names are resolved once. Symbols missing from the parse fall back to the same
 * regex extractor over the already-read content (still no extra read).
 */
export async function extractChunksBatch(
  filePath: string,
  symbolNames: string[],
): Promise<BatchChunk[]> {
  const content = await readFileSafely(filePath);
  if (!content) {
    return symbolNames.map((symbolName) => ({
      symbolName,
      content: null,
      found: false,
    }));
  }

  const lines = content.split('\n');
  const parsed = parseFile(content, filePath);
  const parseUnusable =
    parsed.errors.length > 0 &&
    parsed.functions.length === 0 &&
    parsed.classes.length === 0;
  const byName = new Map<string, SymbolLocation>();
  if (!parseUnusable) {
    for (const loc of getSymbolLocations(parsed, lines)) {
      if (!byName.has(loc.name)) byName.set(loc.name, loc);
    }
  }

  const resolved = new Map<string, string | null>();
  for (const name of symbolNames) {
    if (resolved.has(name)) continue; // resolve each distinct name once
    const loc = byName.get(name);
    resolved.set(
      name,
      loc
        ? lines.slice(loc.startLine - 1, loc.endLine).join('\n')
        : extractChunkFallback(content, name, filePath),
    );
  }

  return symbolNames.map((symbolName) => {
    const c = resolved.get(symbolName) ?? null;
    return { symbolName, content: c, found: c !== null };
  });
}

/**
 * Fallback extraction using regex patterns when parser fails.
 */
function extractChunkFallback(
  content: string,
  symbolName: string,
  filePath: string
): string | null {
  const ext = path.extname(filePath).toLowerCase();
  const lines = content.split('\n');
  const language = detectLanguageFromExt(ext);

  // Build pattern based on language
  let patterns: RegExp[];

  if (language === 'python') {
    patterns = [
      new RegExp(`^(\\s*)(?:async\\s+)?def\\s+${escapeRegex(symbolName)}\\s*\\(`),
      new RegExp(`^(\\s*)class\\s+${escapeRegex(symbolName)}\\s*[:(]`),
    ];
  } else {
    patterns = [
      new RegExp(`^\\s*(?:export\\s+)?(?:async\\s+)?function\\s*\\*?\\s*${escapeRegex(symbolName)}\\s*[(<]`),
      new RegExp(`^\\s*(?:export\\s+)?(?:const|let|var)\\s+${escapeRegex(symbolName)}\\s*[=:]`),
      new RegExp(`^\\s*(?:export\\s+)?class\\s+${escapeRegex(symbolName)}\\s*[{<]`),
      new RegExp(`^\\s*(?:export\\s+)?(?:type|interface)\\s+${escapeRegex(symbolName)}\\s*[{<=]`),
    ];
  }

  for (let i = 0; i < lines.length; i++) {
    for (const pattern of patterns) {
      if (pattern.test(lines[i])) {
        const endLine = findBlockEnd(lines, i, language);
        return lines.slice(i, endLine + 1).join('\n');
      }
    }
  }

  return null;
}

function detectLanguageFromExt(ext: string): ParseResult['language'] {
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
    return 'typescript';
  }
  if (['.py', '.pyw', '.pyi'].includes(ext)) {
    return 'python';
  }
  return 'unknown';
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// =============================================================================
// Main Tool Functions
// =============================================================================

/**
 * Gets a cached chunk reference.
 * Returns null if chunk is not found in cache.
 */
export async function getChunkRef(
  input: ChunkRefInput,
  storage?: ContextStorage
): Promise<ChunkRefResult | null> {
  const parsed = parseChunkId(input.chunkId);
  if (!parsed) {
    return null;
  }

  const { filePath } = parsed;
  const storageInstance = storage || createStorage();

  try {
    const chunk = await storageInstance.getChunk(input.chunkId);

    if (!chunk) {
      return null;
    }

    // Check staleness by comparing current file hash with cached hash
    let isStale = false;
    const currentContent = await readFileSafely(filePath);

    if (currentContent === null) {
      // File no longer exists
      isStale = true;
    } else {
      const currentHash = computeContentHash(currentContent);
      isStale = currentHash !== chunk.contentHash;
    }

    return {
      chunkId: input.chunkId,
      content: chunk.content,
      filePath: chunk.filePath,
      symbolName: chunk.symbolName,
      isStale,
      cachedAt: chunk.cachedAt,
    };
  } finally {
    if (!storage) {
      await storageInstance.close();
    }
  }
}

/**
 * Caches a code chunk for later retrieval.
 */
export async function cacheChunk(
  input: CacheChunkInput,
  storage?: ContextStorage
): Promise<void> {
  const chunkId = generateChunkId(input.filePath, input.symbolName);
  const storageInstance = storage || createStorage();

  try {
    // Get the current file content hash for staleness detection
    const fileContent = await readFileSafely(input.filePath);
    const contentHash = fileContent
      ? computeContentHash(fileContent)
      : computeContentHash(input.content);

    const chunk: CodeChunk = {
      id: chunkId,
      filePath: input.filePath,
      symbolName: input.symbolName,
      content: input.content,
      contentHash,
      cachedAt: Date.now(),
    };

    await storageInstance.cacheChunk(chunk);
  } finally {
    if (!storage) {
      await storageInstance.close();
    }
  }
}

/**
 * Extracts and caches a chunk in one operation.
 * Returns the cached result or null if extraction failed.
 */
export async function extractAndCacheChunk(
  filePath: string,
  symbolName: string,
  sessionId: string,
  storage?: ContextStorage
): Promise<ChunkRefResult | null> {
  const content = await extractChunk(filePath, symbolName);

  if (!content) {
    return null;
  }

  const storageInstance = storage || createStorage();

  try {
    await cacheChunk(
      { filePath, symbolName, content, sessionId },
      storageInstance
    );

    const chunkId = generateChunkId(filePath, symbolName);
    return {
      chunkId,
      content,
      filePath,
      symbolName,
      isStale: false,
      cachedAt: Date.now(),
    };
  } finally {
    if (!storage) {
      await storageInstance.close();
    }
  }
}

/**
 * Gets a chunk reference, extracting and caching if not found.
 */
export async function getOrExtractChunk(
  filePath: string,
  symbolName: string,
  sessionId: string,
  storage?: ContextStorage
): Promise<ChunkRefResult | null> {
  const chunkId = generateChunkId(filePath, symbolName);
  const storageInstance = storage || createStorage();

  try {
    // Try cache first
    const cached = await getChunkRef({ chunkId, sessionId }, storageInstance);

    if (cached && !cached.isStale) {
      return cached;
    }

    // Extract fresh and cache
    return await extractAndCacheChunk(filePath, symbolName, sessionId, storageInstance);
  } finally {
    if (!storage) {
      await storageInstance.close();
    }
  }
}

/**
 * Invalidates a cached chunk.
 * Returns true if chunk existed and was invalidated.
 */
export async function invalidateChunk(
  filePath: string,
  symbolName: string,
  storage?: ContextStorage
): Promise<boolean> {
  const chunkId = generateChunkId(filePath, symbolName);
  const storageInstance = storage || createStorage();

  try {
    const existing = await storageInstance.getChunk(chunkId);
    if (!existing) {
      return false;
    }

    // Mark as stale by updating with empty content hash
    // This will cause isStale to be true on next retrieval
    const staleChunk: CodeChunk = {
      ...existing,
      contentHash: 'invalidated',
      cachedAt: Date.now(),
    };
    await storageInstance.cacheChunk(staleChunk);
    return true;
  } finally {
    if (!storage) {
      await storageInstance.close();
    }
  }
}

/**
 * Lists all cached chunks for a file.
 */
export async function listChunksForFile(
  _filePath: string,
  _sessionId: string,
  _storage?: ContextStorage
): Promise<ChunkRefResult[]> {
  // Note: This would require adding a query method to storage
  // For now, return empty array as the storage interface doesn't support this
  return [];
}

// =============================================================================
// Exports
// =============================================================================

export {
  parseChunkId,
  computeContentHash,
  getSymbolLocations,
  type SymbolLocation,
};
