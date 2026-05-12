/**
 * Context Layer Tools Module
 *
 * Exports all tool implementations for the context layer plugin.
 */

export {
  // Core functions
  getChunkRef,
  cacheChunk,
  extractChunk,
  extractAndCacheChunk,
  getOrExtractChunk,
  invalidateChunk,
  listChunksForFile,

  // Utility exports
  parseChunkId,
  computeContentHash,
  getSymbolLocations,

  // Types
  type ChunkRefInput,
  type ChunkRefResult,
  type CacheChunkInput,
  type SymbolLocation,
} from "./chunk-ref";

export {
  // Core functions
  semanticLookup,
  batchSemanticLookup,

  // MCP handler
  handleSemanticLookup,
  semanticLookupToolDefinition,

  // Error handling
  SemanticLookupError,

  // Types
  type SemanticLookupInput,
  type SemanticLookupResult,
  type SemanticLookupOptions,
  type SemanticLookupErrorCode,
  type BatchLookupResult,
} from "./semantic-lookup";

export {
  // Main function
  getSymbolContext,
  // Types
  type SymbolContextInput,
  type SymbolContextResult,
  type SymbolKind,
  type RelatedSymbol,
  // Utilities
  getCachedParseResult,
  collectSourceFiles,
  findSymbolInParseResult,
  extractTypeName,
  isPrimitiveType,
} from "./symbol-context";

export {
  // Main function
  checkImpact,
  // Types
  type ImpactCheckInput,
  type ImpactResult,
  type Dependent,
} from "./impact-check";

export {
  // Brain tools
  brainSearch,
  mistakeLog,
  sessionSummary,
  brainToolDefinitions,
  // Types
  type BrainSearchInput,
  type BrainSearchResult,
  type MistakeLogInput,
  type MistakeLogResult,
  type SessionSummaryInput,
  type SessionSummaryResult,
} from "./brain-tools";

export {
  // What changed
  whatChanged,
  whatChangedToolDefinition,
  // Types
  type WhatChangedInput,
  type ChangeInfo,
} from "./what-changed";
