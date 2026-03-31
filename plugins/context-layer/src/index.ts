/**
 * Intelligent Context Layer Plugin
 *
 * Provides semantic file summaries, impact analysis, symbol context,
 * and context health monitoring for Claude Code.
 *
 * @packageDocumentation
 */

// =============================================================================
// Tool Exports
// =============================================================================

// Chunk Reference Tool
export {
  getChunkRef,
  cacheChunk,
  extractChunk,
  extractAndCacheChunk,
  getOrExtractChunk,
  invalidateChunk,
  listChunksForFile,
  parseChunkId,
  computeContentHash,
  getSymbolLocations,
  type ChunkRefInput,
  type ChunkRefResult,
  type CacheChunkInput,
  type SymbolLocation as ChunkSymbolLocation,
} from './tools/chunk-ref';

// Swarm Coordination Tools
export {
  swarmInit,
  swarmQueryBoard,
  swarmClaimTask,
  swarmCompleteTask,
  swarmSendMessage,
  swarmReadMessages,
  swarmLogDecision,
  swarmToolDefinitions,
} from './tools/swarm-tools';

// Semantic Lookup Tool
export {
  semanticLookup,
  batchSemanticLookup,
  handleSemanticLookup,
  semanticLookupToolDefinition,
  SemanticLookupError,
  type SemanticLookupInput,
  type SemanticLookupResult,
  type SemanticLookupOptions,
  type SemanticLookupErrorCode,
  type BatchLookupResult,
} from './tools/semantic-lookup';

// Import these for local use in this file
import { handleSemanticLookup as _handleSemanticLookup } from './tools/semantic-lookup';
import { semanticLookupToolDefinition as _semanticLookupToolDefinition } from './tools/semantic-lookup';
import * as _swarmTools from './tools/swarm-tools';

// Symbol Context Tool
export {
  getSymbolContext,
  getCachedParseResult,
  collectSourceFiles,
  findSymbolInParseResult,
  extractTypeName,
  isPrimitiveType,
  type SymbolContextInput,
  type SymbolContextResult,
  type SymbolKind as SymbolContextKind,
  type RelatedSymbol,
} from './tools/symbol-context';

// Impact Check Tool
export {
  checkImpact,
  type ImpactCheckInput,
  type ImpactResult,
  type Dependent,
} from './tools/impact-check';

// =============================================================================
// Storage Exports
// =============================================================================

export type {
  ContextStorage,
  ProjectProfile,
  FileIndexEntry,
  ContextRead,
  CodeChunk,
  StorageOptions,
  BulkOperationResult,
} from './storage/interface';

export {
  SQLiteStorage,
  DEFAULT_DB_PATH,
  createStorage,
  createTestStorage,
  generateFileIndexId,
  generateChunkId,
  generateReadId,
  computeProjectHash,
} from './storage';

// =============================================================================
// Personality Exports
// =============================================================================

export type {
  ProjectPersonality,
  StackInfo,
  Pattern,
  Convention,
  Gotcha,
  KeyFile,
  ExtractionOptions,
  CacheValidityResult,
} from './personality';

// =============================================================================
// Indexer Exports
// =============================================================================

export type {
  ParseResult,
  ExportInfo,
  ImportInfo,
  FunctionInfo,
  ClassInfo,
  TypeInfo,
  ParserOptions,
  ExportKind,
  FileSummary,
} from './indexer';

export {
  DEFAULT_PARSER_OPTIONS,
  createEmptyParseResult,
  parseFile,
  getLanguageFromExtension,
  generateSummary,
  formatSummaryAsText,
} from './indexer';

// =============================================================================
// LSP Exports
// =============================================================================

export {
  Reference,
  CallInfo,
  HoverInfo,
  SymbolLocation,
  SymbolInfo,
  SymbolKind,
  LSPResult,
  LSPConfig,
  DEFAULT_LSP_CONFIG,
  LanguageId,
  EXTENSION_TO_LANGUAGE,
  getLanguageFromPath,
  CacheEntry,
  LSPCache,
  generateCacheKey,
  generateSymbolSearchCacheKey,
  computeFileHash,
  getGlobalCache,
  resetGlobalCache,
} from './lsp';

// =============================================================================
// Hooks Exports
// =============================================================================

export {
  personalityHook,
  contextHealthHook,
  hooks,
  type PersonalityContext,
  type HookResult,
  type HookInput,
  type ContextHealthStatus,
} from './hooks';

// =============================================================================
// Plugin Metadata
// =============================================================================

/** Plugin name for MCP registration */
export const PLUGIN_NAME = '@anthropic/context-layer';

/** Plugin version */
export const PLUGIN_VERSION = '0.1.0';

/** Plugin description */
export const PLUGIN_DESCRIPTION =
  'Intelligent context management with semantic file summaries, ' +
  'impact analysis, symbol context, and context health monitoring.';

// =============================================================================
// Plugin Lifecycle
// =============================================================================

import { createStorage } from './storage';
import { resetGlobalCache as _resetGlobalCache } from './lsp';
import type { ContextStorage } from './storage/interface';

/** Global storage instance for plugin lifecycle */
let globalStorage: ContextStorage | null = null;

/**
 * Plugin initialization options
 */
export interface PluginInitOptions {
  /** Path to the SQLite database file */
  dbPath?: string;
  /** Enable debug logging */
  debug?: boolean;
  /** Skip database initialization (for testing) */
  skipDbInit?: boolean;
}

/**
 * Initialize the context layer plugin.
 *
 * This function should be called once at startup to:
 * - Initialize storage connections
 * - Warm up caches
 * - Set up any required resources
 *
 * @param options - Initialization options
 * @returns Promise that resolves when initialization is complete
 *
 * @example
 * ```typescript
 * await initializePlugin({ debug: true });
 * ```
 */
export async function initializePlugin(options?: PluginInitOptions): Promise<void> {
  const { dbPath, debug = false, skipDbInit = false } = options ?? {};

  if (debug) {
    console.log(`[${PLUGIN_NAME}] Initializing v${PLUGIN_VERSION}...`);
  }

  if (!skipDbInit) {
    // Initialize storage
    globalStorage = createStorage(dbPath);

    if (debug) {
      console.log(`[${PLUGIN_NAME}] Storage initialized at: ${dbPath ?? 'default path'}`);
    }
  }

  if (debug) {
    console.log(`[${PLUGIN_NAME}] Initialization complete.`);
  }
}

/**
 * Get the global storage instance.
 *
 * @returns The storage instance, or null if not initialized
 */
export function getStorage(): ContextStorage | null {
  return globalStorage;
}

/**
 * Shutdown the context layer plugin.
 *
 * This function should be called during cleanup to:
 * - Close storage connections
 * - Clear caches
 * - Release resources
 *
 * @returns Promise that resolves when shutdown is complete
 *
 * @example
 * ```typescript
 * await shutdownPlugin();
 * ```
 */
export async function shutdownPlugin(): Promise<void> {
  if (globalStorage) {
    await globalStorage.close();
    globalStorage = null;
  }

  // Reset LSP cache
  _resetGlobalCache();
}

/**
 * Check if the plugin is initialized.
 *
 * @returns true if initialized, false otherwise
 */
export function isInitialized(): boolean {
  return globalStorage !== null;
}

// =============================================================================
// Tool Registry (for MCP server registration)
// =============================================================================

/**
 * All available tools for MCP server registration.
 *
 * Each tool is exported with its handler function and definition.
 */
export const tools = {
  semanticLookup: {
    definition: _semanticLookupToolDefinition,
    handler: _handleSemanticLookup,
  },
  swarm_init: {
    definition: _swarmTools.swarmToolDefinitions[0],
    handler: _swarmTools.swarmInit,
  },
  swarm_query_board: {
    definition: _swarmTools.swarmToolDefinitions[1],
    handler: _swarmTools.swarmQueryBoard,
  },
  swarm_claim_task: {
    definition: _swarmTools.swarmToolDefinitions[2],
    handler: _swarmTools.swarmClaimTask,
  },
  swarm_complete_task: {
    definition: _swarmTools.swarmToolDefinitions[3],
    handler: _swarmTools.swarmCompleteTask,
  },
  swarm_send_message: {
    definition: _swarmTools.swarmToolDefinitions[4],
    handler: _swarmTools.swarmSendMessage,
  },
  swarm_read_messages: {
    definition: _swarmTools.swarmToolDefinitions[5],
    handler: _swarmTools.swarmReadMessages,
  },
  swarm_log_decision: {
    definition: _swarmTools.swarmToolDefinitions[6],
    handler: _swarmTools.swarmLogDecision,
  },
  // Additional tools can be registered here as they get MCP handlers
} as const;
