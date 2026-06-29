/**
 * LSP operations — definition / references / hover / documentSymbol /
 * diagnostics, each returning a uniform LSPResult<T>.
 *
 * Every op resolves a started client via the server manager (null => server
 * unavailable => `success: false`, so the caller falls back to the code-map or
 * regex tiers), syncs the document, sends the request, and maps the LSP reply
 * into the project's existing aggregator types. Results are memoised in the
 * shared LSPCache keyed by file content hash.
 *
 * Position convention (public): `line` is 1-based, `character` is 0-based,
 * matching the code-map's 1-based line numbers. LSP is 0-based on both axes;
 * conversion happens at this boundary only.
 */

import * as fs from "fs";
import { pathToFileURL, fileURLToPath } from "url";
import {
  type LSPResult,
  type Reference,
  type SymbolLocation,
  type HoverInfo,
  type SymbolInfo,
  type SymbolKind,
  getLanguageFromPath,
} from "./types";
import {
  LSPCache,
  getGlobalCache,
  computeFileHash,
  generateCacheKey,
} from "./cache";
import { LspServerManager, getGlobalServerManager } from "./server-manager";
import type { Diagnostic } from "./client";

export interface Position {
  /** 1-based line. */
  line: number;
  /** 0-based character offset. */
  character: number;
}

export interface OperationOptions {
  projectRoot: string;
  manager?: LspServerManager;
  cache?: LSPCache;
  /** How long to wait for push diagnostics after a sync (ms). */
  diagnosticsTimeoutMs?: number;
}

interface LspRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}
interface LspLocation {
  uri: string;
  range: LspRange;
}
interface LspLocationLink {
  targetUri: string;
  targetRange: LspRange;
  targetSelectionRange?: LspRange;
}

// ---------------------------------------------------------------------------
// operations
// ---------------------------------------------------------------------------

export async function definition(
  filePath: string,
  pos: Position,
  opts: OperationOptions,
): Promise<LSPResult<SymbolLocation[]>> {
  return run("definition", filePath, pos, opts, async (client, uri) => {
    const raw = await client.request("textDocument/definition", {
      textDocument: { uri },
      position: toLspPosition(pos),
    });
    return normalizeLocations(raw).map(locationToSymbol);
  });
}

export async function references(
  filePath: string,
  pos: Position,
  opts: OperationOptions & { includeDeclaration?: boolean },
): Promise<LSPResult<Reference[]>> {
  return run("references", filePath, pos, opts, async (client, uri) => {
    const raw = await client.request("textDocument/references", {
      textDocument: { uri },
      position: toLspPosition(pos),
      context: { includeDeclaration: opts.includeDeclaration ?? true },
    });
    return normalizeLocations(raw).map(locationToReference);
  });
}

export async function hover(
  filePath: string,
  pos: Position,
  opts: OperationOptions,
): Promise<LSPResult<HoverInfo>> {
  return run("hover", filePath, pos, opts, async (client, uri) => {
    const raw = (await client.request("textDocument/hover", {
      textDocument: { uri },
      position: toLspPosition(pos),
    })) as { contents?: unknown } | null;
    return hoverToInfo(raw);
  });
}

export async function documentSymbols(
  filePath: string,
  opts: OperationOptions,
): Promise<LSPResult<SymbolInfo[]>> {
  return run(
    "documentSymbol",
    filePath,
    { line: 1, character: 0 },
    opts,
    async (client, uri) => {
      const raw = await client.request("textDocument/documentSymbol", {
        textDocument: { uri },
      });
      return flattenDocumentSymbols(raw, filePath);
    },
  );
}

export async function diagnostics(
  filePath: string,
  opts: OperationOptions,
): Promise<LSPResult<Diagnostic[]>> {
  const start = Date.now();
  const manager = opts.manager ?? getGlobalServerManager();
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch (err) {
    return fail(messageOf(err), start);
  }
  const client = await manager.getClientForFile(opts.projectRoot, filePath);
  if (!client) return unavailable(start);

  const uri = pathToFileURL(filePath).toString();
  const language = getLanguageFromPath(filePath);
  client.syncDocument(uri, language, content);
  const data = await manager.waitForDiagnostics(
    opts.projectRoot,
    language,
    uri,
    opts.diagnosticsTimeoutMs ?? 1500,
  );
  return {
    success: true,
    data,
    metadata: {
      cached: false,
      duration: Date.now() - start,
      usedFallback: false,
    },
  };
}

// ---------------------------------------------------------------------------
// shared runner
// ---------------------------------------------------------------------------

async function run<T>(
  operation: string,
  filePath: string,
  pos: Position,
  opts: OperationOptions,
  query: (
    client: NonNullable<
      Awaited<ReturnType<LspServerManager["getClientForFile"]>>
    >,
    uri: string,
  ) => Promise<T>,
): Promise<LSPResult<T>> {
  const start = Date.now();
  const manager = opts.manager ?? getGlobalServerManager();
  const cache = opts.cache ?? getGlobalCache();

  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch (err) {
    return fail(messageOf(err), start);
  }
  const fileHash = computeFileHash(content);
  const cacheKey = generateCacheKey(
    operation,
    filePath,
    pos.line,
    pos.character,
  );
  const cached = cache.get<T>(cacheKey, fileHash);
  if (cached !== null) {
    return {
      success: true,
      data: cached,
      metadata: {
        cached: true,
        duration: Date.now() - start,
        usedFallback: false,
      },
    };
  }

  const client = await manager.getClientForFile(opts.projectRoot, filePath);
  if (!client) return unavailable(start);

  try {
    const uri = pathToFileURL(filePath).toString();
    client.syncDocument(uri, getLanguageFromPath(filePath), content);
    const data = await query(client, uri);
    cache.set(cacheKey, data, fileHash, filePath);
    return {
      success: true,
      data,
      metadata: {
        cached: false,
        duration: Date.now() - start,
        usedFallback: false,
      },
    };
  } catch (err) {
    return fail(messageOf(err), start);
  }
}

function unavailable(start: number): LSPResult<never> {
  return {
    success: false,
    error: "no language server available",
    metadata: {
      cached: false,
      duration: Date.now() - start,
      usedFallback: false,
    },
  };
}

function fail(error: string, start: number): LSPResult<never> {
  return {
    success: false,
    error,
    metadata: {
      cached: false,
      duration: Date.now() - start,
      usedFallback: false,
    },
  };
}

// ---------------------------------------------------------------------------
// mapping
// ---------------------------------------------------------------------------

function toLspPosition(pos: Position): { line: number; character: number } {
  return {
    line: Math.max(0, pos.line - 1),
    character: Math.max(0, pos.character),
  };
}

/** Coerce Location | Location[] | LocationLink[] | null into Location[]. */
function normalizeLocations(raw: unknown): LspLocation[] {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  const out: LspLocation[] = [];
  for (const item of arr) {
    const link = item as LspLocationLink;
    if (link && link.targetUri && link.targetRange) {
      out.push({ uri: link.targetUri, range: link.targetRange });
      continue;
    }
    const loc = item as LspLocation;
    if (loc && loc.uri && loc.range)
      out.push({ uri: loc.uri, range: loc.range });
  }
  return out;
}

function locationToSymbol(loc: LspLocation): SymbolLocation {
  return {
    filePath: uriToPath(loc.uri),
    line: loc.range.start.line + 1,
    character: loc.range.start.character,
    endLine: loc.range.end.line + 1,
    endCharacter: loc.range.end.character,
  };
}

function locationToReference(loc: LspLocation): Reference {
  return {
    filePath: uriToPath(loc.uri),
    line: loc.range.start.line + 1,
    character: loc.range.start.character,
    context: "",
    referenceKind: "usage",
  };
}

function hoverToInfo(raw: { contents?: unknown } | null): HoverInfo {
  if (!raw || raw.contents == null) return { type: "", documentation: "" };
  const text = hoverContentsToString(raw.contents);
  return { type: text, documentation: text };
}

function hoverContentsToString(contents: unknown): string {
  if (typeof contents === "string") return contents;
  if (Array.isArray(contents)) {
    return contents.map(hoverContentsToString).filter(Boolean).join("\n");
  }
  const obj = contents as { value?: string; language?: string };
  return obj?.value ?? "";
}

interface LspDocumentSymbol {
  name: string;
  kind: number;
  range?: LspRange;
  location?: LspLocation;
  containerName?: string;
  children?: LspDocumentSymbol[];
}

function flattenDocumentSymbols(raw: unknown, filePath: string): SymbolInfo[] {
  if (!Array.isArray(raw)) return [];
  const out: SymbolInfo[] = [];
  const walk = (nodes: LspDocumentSymbol[], container?: string) => {
    for (const n of nodes) {
      const range = n.range ?? n.location?.range;
      const path = n.location ? uriToPath(n.location.uri) : filePath;
      out.push({
        name: n.name,
        kind: lspSymbolKind(n.kind),
        filePath: path,
        line: (range?.start.line ?? 0) + 1,
        character: range?.start.character,
        containerName: n.containerName ?? container,
      });
      if (n.children?.length) walk(n.children, n.name);
    }
  };
  walk(raw as LspDocumentSymbol[]);
  return out;
}

const LSP_SYMBOL_KINDS: SymbolKind[] = [
  "unknown", // 0 (unused; LSP kinds are 1-based)
  "file",
  "module",
  "namespace",
  "package",
  "class",
  "method",
  "property",
  "field",
  "constructor",
  "enum",
  "interface",
  "function",
  "variable",
  "constant",
  "string",
  "number",
  "boolean",
  "array",
  "object",
  "key",
  "null",
  "enumMember",
  "struct",
  "event",
  "operator",
  "typeParameter",
];

function lspSymbolKind(kind: number): SymbolKind {
  return LSP_SYMBOL_KINDS[kind] ?? "unknown";
}

function uriToPath(uri: string): string {
  try {
    return fileURLToPath(uri);
  } catch {
    return uri.replace(/^file:\/\//, "");
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
