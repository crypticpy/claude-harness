/**
 * LSP Aggregator Module
 */

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
} from "./types";

export {
  CacheEntry,
  LSPCache,
  generateCacheKey,
  generateSymbolSearchCacheKey,
  computeFileHash,
  getGlobalCache,
  resetGlobalCache,
} from "./cache";

export { encodeMessage, MessageBuffer, JsonRpcMessage } from "./protocol";
export { LspClient, ILspClient, LspClientOptions, Diagnostic } from "./client";
export {
  LspServerManager,
  ServerManagerOptions,
  ResolvedSpec,
  serversFor,
  commandOnPath,
  getGlobalServerManager,
  resetGlobalServerManager,
  setGlobalServerManager,
} from "./server-manager";
export {
  Position,
  OperationOptions,
  definition,
  references,
  hover,
  documentSymbols,
  diagnostics,
} from "./operations";
export {
  lspEnabled,
  lspDocumentSymbols,
  lspDefinition,
  lspReferences,
  lspHover,
  lspDiagnostics,
  shutdownLsp,
} from "./lsp-service";
