/**
 * Context Layer Tools Module
 *
 * Exports all tool implementations for the context layer plugin.
 */

export {
  // Core functions
  semanticLookup,
  batchSemanticLookup,
  formatLookupResult,

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
  type ToolResult,
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

export {
  // PUNTAX context router (primary tool)
  puntaxContext,
  puntaxContextToolDefinition,
  // Types
  type PuntaxContextInput,
  type PuntaxContextOutput,
  type PuntaxMode,
  type PuntaxSource,
} from "./puntax-context";

export {
  // Deterministic session checkpoint
  sessionCheckpoint,
  sessionCheckpointToolDefinition,
  // Types
  type SessionCheckpointInput,
  type SessionCheckpointResult,
  type Checkpoint,
} from "./session-checkpoint";

export {
  // Code-map incremental refresh
  refreshIndex,
  refreshIndexToolDefinition,
  // Types
  type RefreshIndexInput,
  type RefreshIndexResult,
} from "./refresh-index";

export {
  // Code-map status
  indexStatusTool,
  indexStatusToolDefinition,
  // Types
  type IndexStatusInput,
  type IndexStatusResult,
} from "./index-status";

export {
  // Typed memory write
  memoryWrite,
  memoryWriteToolDefinition,
  // Types
  type MemoryWriteInput,
  type MemoryWriteResult,
} from "./memory-write";

export {
  // Tree-sitter syntax-validity gate
  syntaxCheckTool,
  syntaxCheckToolDefinition,
  // Types
  type SyntaxCheckInput,
  type SyntaxCheckToolResult,
} from "./syntax-check";

export {
  // Token-cheap structural directory map
  codeMapOutlineTool,
  codeMapOutlineToolDefinition,
  // Types
  type CodeMapOutlineInput,
  type CodeMapOutlineResult,
  type OutlineFile,
  type OutlineSymbol,
} from "./code-map-outline";

export {
  // Steering charter (anti-drift anchor for long sessions)
  missionCharter,
  missionCharterToolDefinition,
  // Types
  type MissionCharterInput,
  type MissionCharterResult,
} from "./mission-charter";

export {
  // Append-only refactor work-list
  refactorManifest,
  refactorManifestToolDefinition,
  // Types
  type RefactorManifestInput,
  type RefactorManifestResult,
} from "./refactor-manifest";
