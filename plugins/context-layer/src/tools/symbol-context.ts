/**
 * Symbol Context Tool
 *
 * Gets type information and documentation for any symbol without reading the full file.
 * Uses the LSP cache for performance and parses files on demand if not cached.
 */

import * as fs from "fs";
import * as path from "path";
import {
  LSPCache,
  getGlobalCache,
  computeFileHash,
  generateSymbolSearchCacheKey,
  DEFAULT_LSP_CONFIG,
} from "../lsp";
import {
  parseFile,
  ParseResult,
  FunctionInfo,
  ClassInfo,
  TypeInfo,
} from "../indexer";
import {
  codeMapEnabled,
  projectRoot,
  openCodeMap,
  fileFreshnessByMtime,
} from "../indexer/code-map-service";
import {
  lspEnabled,
  lspDocumentSymbols,
  lspDefinition,
  lspHover,
} from "../lsp/lsp-service";
import {
  CodeMap,
  projectIdFor,
  fileIdFor,
  type SymbolRecord,
} from "../storage/code-map";

// ============================================================================
// Types
// ============================================================================

export interface SymbolContextInput {
  symbolName: string;
  filePath?: string;
  projectPath: string;
}

export type SymbolKind =
  "function" | "class" | "type" | "interface" | "variable" | "unknown";

export interface RelatedSymbol {
  name: string;
  relationship: "extends" | "implements" | "uses" | "returns";
}

export interface SymbolContextResult {
  name: string;
  kind: SymbolKind;
  signature: string;
  documentation: string;
  location: {
    filePath: string;
    line: number;
  };
  related: RelatedSymbol[];
}

interface CachedParseResult {
  parseResult: ParseResult;
  fileHash: string;
}

// ============================================================================
// Constants
// ============================================================================

const SYMBOL_CONTEXT_CACHE_KEY_PREFIX = "symbol_context";
const FILE_PARSE_CACHE_KEY_PREFIX = "file_parse";

// ============================================================================
// Main Function
// ============================================================================

/**
 * Gets detailed context for a symbol including type signature, documentation,
 * and related types.
 */
export async function getSymbolContext(
  input: SymbolContextInput,
): Promise<SymbolContextResult | null> {
  const { symbolName, filePath, projectPath } = input;
  const cache = getGlobalCache();

  // Check cache first
  const cacheKey = generateSymbolSearchCacheKey(
    SYMBOL_CONTEXT_CACHE_KEY_PREFIX,
    `${symbolName}:${filePath || ""}`,
    projectPath,
  );

  const cached = cache.get<SymbolContextResult>(cacheKey);
  if (cached) {
    return cached;
  }

  // LSP tier (docs/06 Tier 1): when enabled and a defining file is known, ask
  // the language server for the symbol's span + hover signature. Highest
  // confidence; falls through on any miss (no server, symbol not found).
  if (filePath && lspEnabled()) {
    const viaLsp = await symbolContextFromLsp(
      symbolName,
      filePath,
      projectPath,
    );
    if (viaLsp) {
      cache.set(cacheKey, viaLsp, "lsp_result", projectPath);
      return viaLsp;
    }
  }

  // Index-first tier (code-map): answer from the symbol table without scanning
  // the project, when the defining file is fresh. Falls through on any miss.
  if (codeMapEnabled()) {
    const indexed = symbolContextFromIndex(symbolName, filePath, projectPath);
    if (indexed) {
      cache.set(cacheKey, indexed, "index_result", projectPath);
      return indexed;
    }
  }

  let result: SymbolContextResult | null = null;

  if (filePath) {
    // Search in specific file
    result = await searchInFile(symbolName, filePath, cache);
  } else {
    // Search project for symbol definition
    result = await searchProject(symbolName, projectPath, cache);
  }

  if (result) {
    // Cache the result
    cache.set(cacheKey, result, "search_result", projectPath);
  }

  return result;
}

// ============================================================================
// File Search
// ============================================================================

/**
 * Searches for a symbol definition in a specific file.
 */
async function searchInFile(
  symbolName: string,
  filePath: string,
  cache: LSPCache,
): Promise<SymbolContextResult | null> {
  const parseResult = await getCachedParseResult(filePath, cache);
  if (!parseResult) {
    return null;
  }

  return findSymbolInParseResult(symbolName, parseResult, filePath);
}

/**
 * Gets a parsed file result, using cache when available.
 */
async function getCachedParseResult(
  filePath: string,
  cache: LSPCache,
): Promise<ParseResult | null> {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const content = fs.readFileSync(filePath, "utf-8");
    const fileHash = computeFileHash(content);
    const cacheKey = `${FILE_PARSE_CACHE_KEY_PREFIX}:${filePath}`;

    // Check cache with hash validation
    const cached = cache.get<CachedParseResult>(cacheKey, fileHash);
    if (cached && cached.fileHash === fileHash) {
      return cached.parseResult;
    }

    // Parse file
    const parseResult = parseFile(content, filePath);

    // Cache the result
    cache.set(cacheKey, { parseResult, fileHash }, fileHash, filePath);

    return parseResult;
  } catch (error) {
    console.error(`Error parsing file ${filePath}:`, error);
    return null;
  }
}

// ============================================================================
// Project Search
// ============================================================================

/**
 * Searches the entire project for a symbol definition.
 */
async function searchProject(
  symbolName: string,
  projectPath: string,
  cache: LSPCache,
): Promise<SymbolContextResult | null> {
  const files = collectSourceFiles(projectPath);

  for (const file of files) {
    const parseResult = await getCachedParseResult(file, cache);
    if (!parseResult) continue;

    const result = findSymbolInParseResult(symbolName, parseResult, file);
    if (result) {
      return result;
    }
  }

  return null;
}

/**
 * Collects all source files in a project directory.
 */
function collectSourceFiles(
  projectPath: string,
  maxFiles: number = DEFAULT_LSP_CONFIG.maxFilesToSearch,
): string[] {
  const files: string[] = [];
  const excludeDirs = new Set(DEFAULT_LSP_CONFIG.excludeDirs);
  const includeExtensions = new Set(DEFAULT_LSP_CONFIG.includeExtensions);

  function walk(dir: string): void {
    if (files.length >= maxFiles) return;

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (files.length >= maxFiles) break;

        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          if (!excludeDirs.has(entry.name) && !entry.name.startsWith(".")) {
            walk(fullPath);
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if (includeExtensions.has(ext)) {
            files.push(fullPath);
          }
        }
      }
    } catch (error) {
      // Skip directories we can't read
    }
  }

  walk(projectPath);
  return files;
}

// ============================================================================
// Symbol Extraction
// ============================================================================

/**
 * Finds a symbol in a parsed file result and builds the context.
 */
function findSymbolInParseResult(
  symbolName: string,
  parseResult: ParseResult,
  filePath: string,
): SymbolContextResult | null {
  // Check functions
  const func = parseResult.functions.find((f) => f.name === symbolName);
  if (func) {
    return buildFunctionContext(func, filePath, parseResult);
  }

  // Check classes
  const cls = parseResult.classes.find((c) => c.name === symbolName);
  if (cls) {
    return buildClassContext(cls, filePath, parseResult);
  }

  // Check types (interfaces, types, enums)
  const typeInfo = parseResult.types.find((t) => t.name === symbolName);
  if (typeInfo) {
    return buildTypeContext(typeInfo, filePath, parseResult);
  }

  // Check exports for variables/constants
  const exp = parseResult.exports.find((e) => e.name === symbolName);
  if (
    exp &&
    (exp.kind === "const" || exp.kind === "let" || exp.kind === "var")
  ) {
    return buildVariableContext(exp.name, exp.line, filePath);
  }

  return null;
}

/**
 * Builds context for a function symbol.
 */
function buildFunctionContext(
  func: FunctionInfo,
  filePath: string,
  _parseResult: ParseResult,
): SymbolContextResult {
  const related: RelatedSymbol[] = [];

  // Extract return type relationship
  if (func.returnType) {
    const returnTypeName = extractTypeName(func.returnType);
    if (returnTypeName && !isPrimitiveType(returnTypeName)) {
      related.push({ name: returnTypeName, relationship: "returns" });
    }
  }

  // Extract parameter type relationships
  const paramTypes = extractParameterTypes(func.params);
  for (const paramType of paramTypes) {
    if (!isPrimitiveType(paramType)) {
      related.push({ name: paramType, relationship: "uses" });
    }
  }

  // Build signature
  const asyncPrefix = func.isAsync ? "async " : "";
  const generatorMark = func.isGenerator ? "*" : "";
  const params = func.params.join(", ");
  const returnType = func.returnType ? `: ${func.returnType}` : "";
  const signature = `${asyncPrefix}function${generatorMark} ${func.name}(${params})${returnType}`;

  return {
    name: func.name,
    kind: "function",
    signature,
    documentation: func.docstring || "",
    location: {
      filePath,
      line: func.line,
    },
    related: deduplicateRelated(related),
  };
}

/**
 * Builds context for a class symbol.
 */
function buildClassContext(
  cls: ClassInfo,
  filePath: string,
  _parseResult: ParseResult,
): SymbolContextResult {
  const related: RelatedSymbol[] = [];

  // Extract extends relationship
  if (cls.extends) {
    related.push({ name: cls.extends, relationship: "extends" });
  }

  // Extract implements relationships
  if (cls.implements) {
    for (const impl of cls.implements) {
      related.push({ name: impl.trim(), relationship: "implements" });
    }
  }

  // Build signature
  const abstractPrefix = cls.isAbstract ? "abstract " : "";
  const extendsClause = cls.extends ? ` extends ${cls.extends}` : "";
  const implementsClause = cls.implements?.length
    ? ` implements ${cls.implements.join(", ")}`
    : "";
  const methodsList =
    cls.methods.length > 0
      ? `\n  // Methods: ${cls.methods.slice(0, 5).join(", ")}${cls.methods.length > 5 ? "..." : ""}`
      : "";
  const propertiesList =
    cls.properties.length > 0
      ? `\n  // Properties: ${cls.properties.slice(0, 5).join(", ")}${cls.properties.length > 5 ? "..." : ""}`
      : "";

  const signature = `${abstractPrefix}class ${cls.name}${extendsClause}${implementsClause} {${methodsList}${propertiesList}\n}`;

  return {
    name: cls.name,
    kind: "class",
    signature,
    documentation: "", // Classes typically don't have inline docstrings parsed
    location: {
      filePath,
      line: cls.line,
    },
    related: deduplicateRelated(related),
  };
}

/**
 * Builds context for a type/interface symbol.
 */
function buildTypeContext(
  typeInfo: TypeInfo,
  filePath: string,
  _parseResult: ParseResult,
): SymbolContextResult {
  const related: RelatedSymbol[] = [];

  // Extract extends relationships
  if (typeInfo.extends) {
    for (const ext of typeInfo.extends) {
      related.push({ name: ext.trim(), relationship: "extends" });
    }
  }

  // Build signature based on kind
  let signature: string;
  const kind: SymbolKind = typeInfo.kind === "interface" ? "interface" : "type";

  if (typeInfo.kind === "interface") {
    const extendsClause = typeInfo.extends?.length
      ? ` extends ${typeInfo.extends.join(", ")}`
      : "";
    const membersList = typeInfo.members?.length
      ? `\n  ${typeInfo.members.slice(0, 5).join(";\n  ")}${typeInfo.members.length > 5 ? ";..." : ""}`
      : "";
    signature = `interface ${typeInfo.name}${extendsClause} {${membersList}\n}`;
  } else if (typeInfo.kind === "enum") {
    const membersList = typeInfo.members?.length
      ? `\n  ${typeInfo.members.slice(0, 5).join(",\n  ")}${typeInfo.members.length > 5 ? ",..." : ""}`
      : "";
    signature = `enum ${typeInfo.name} {${membersList}\n}`;
  } else {
    // type alias
    const extendsClause = typeInfo.extends?.length
      ? ` = ${typeInfo.extends.join(" & ")}`
      : " = { ... }";
    signature = `type ${typeInfo.name}${extendsClause}`;
  }

  return {
    name: typeInfo.name,
    kind,
    signature,
    documentation: "",
    location: {
      filePath,
      line: typeInfo.line,
    },
    related: deduplicateRelated(related),
  };
}

/**
 * Builds context for a variable/constant symbol.
 */
function buildVariableContext(
  name: string,
  line: number,
  filePath: string,
): SymbolContextResult {
  return {
    name,
    kind: "variable",
    signature: `const ${name} = ...`,
    documentation: "",
    location: {
      filePath,
      line,
    },
    related: [],
  };
}

// ============================================================================
// Type Utilities
// ============================================================================

/**
 * Extracts the primary type name from a type annotation.
 * E.g., "Promise<User>" -> "Promise", "User[]" -> "User"
 */
function extractTypeName(typeAnnotation: string): string | null {
  // Remove Promise, Array wrappers
  let type = typeAnnotation.trim();

  // Handle array types
  if (type.endsWith("[]")) {
    type = type.slice(0, -2);
  }

  // Handle generic types - extract outer type
  const genericMatch = type.match(/^(\w+)</);
  if (genericMatch) {
    return genericMatch[1];
  }

  // Handle union/intersection - take first type
  const unionMatch = type.match(/^(\w+)/);
  if (unionMatch) {
    return unionMatch[1];
  }

  return null;
}

/**
 * Extracts type names from function parameters.
 * Handles "param: Type" format.
 */
function extractParameterTypes(params: string[]): string[] {
  const types: string[] = [];

  for (const param of params) {
    // Check if parameter has type annotation
    const colonIndex = param.indexOf(":");
    if (colonIndex > -1) {
      const typeAnnotation = param.slice(colonIndex + 1).trim();
      const typeName = extractTypeName(typeAnnotation);
      if (typeName) {
        types.push(typeName);
      }
    }
  }

  return types;
}

/**
 * Checks if a type name is a primitive type.
 */
function isPrimitiveType(typeName: string): boolean {
  const primitives = new Set([
    "string",
    "number",
    "boolean",
    "void",
    "null",
    "undefined",
    "any",
    "unknown",
    "never",
    "object",
    "symbol",
    "bigint",
    "String",
    "Number",
    "Boolean",
    "Object",
    "Symbol",
    "BigInt",
    "Array",
    "Promise",
    "Map",
    "Set",
    "WeakMap",
    "WeakSet",
    "Date",
    "RegExp",
    "Error",
    "Function",
    // Python primitives
    "str",
    "int",
    "float",
    "bool",
    "None",
    "list",
    "dict",
    "tuple",
    "set",
  ]);

  return primitives.has(typeName);
}

/**
 * Removes duplicate related symbols.
 */
function deduplicateRelated(related: RelatedSymbol[]): RelatedSymbol[] {
  const seen = new Set<string>();
  return related.filter((r) => {
    const key = `${r.name}:${r.relationship}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ============================================================================
// Index-backed symbol context (code-map tier)
// ============================================================================

/** Map a stored code-map symbol kind to the tool's SymbolKind. */
function mapSymbolKind(kind: string): SymbolKind {
  switch (kind) {
    case "function":
    case "method":
      return "function";
    case "class":
      return "class";
    case "interface":
      return "interface";
    case "type":
    case "enum":
      return "type";
    default:
      return "unknown";
  }
}

/**
 * Resolve a symbol via the LSP tier: locate it in the file's document symbols,
 * then hover its declaration for signature/type info. Returns null on any miss
 * (server unavailable, symbol absent) so the caller falls back to lower tiers.
 */
async function symbolContextFromLsp(
  symbolName: string,
  filePath: string,
  projectPath: string,
): Promise<SymbolContextResult | null> {
  const root = projectRoot(projectPath);
  const absFile = path.resolve(projectPath, filePath);

  const symbols = await lspDocumentSymbols(absFile, root);
  if (!symbols || symbols.length === 0) return null;

  const named = symbols.filter((s) => s.name === symbolName);
  if (named.length === 0) return null;
  // Prefer a top-level declaration (no container) over a member.
  named.sort(
    (a, b) =>
      (a.containerName ? 1 : 0) - (b.containerName ? 1 : 0) || a.line - b.line,
  );
  const sym = named[0];
  const pos = { line: sym.line, character: sym.character ?? 0 };

  // Resolve the canonical definition (follows imports/re-exports); fall back to
  // the document-symbol's own span when the server returns nothing.
  const defs = await lspDefinition(absFile, pos, root);
  const location =
    defs && defs.length > 0
      ? { filePath: defs[0].filePath, line: defs[0].line }
      : { filePath: absFile, line: sym.line };

  const hover = await lspHover(absFile, pos, root);

  return {
    name: sym.name,
    kind: mapSymbolKind(sym.kind),
    signature: hover?.type || sym.name,
    documentation: hover?.documentation ?? "",
    location,
    related: [],
  };
}

/**
 * Resolve a symbol from the code-map index. Prefers top-level decls over
 * methods. Returns null on any miss or when the defining file is stale, so the
 * caller falls back to the on-demand parse/scan path.
 */
function symbolContextFromIndex(
  symbolName: string,
  filePath: string | undefined,
  projectPath: string,
): SymbolContextResult | null {
  try {
    const root = projectRoot(projectPath);
    const cm = openCodeMap(root);
    if (!cm) return null;
    try {
      const projectId = projectIdFor(root);
      let matches = cm.getSymbolsByName(projectId, symbolName);
      if (filePath) {
        const rel = path
          .relative(root, path.resolve(projectPath, filePath))
          .split(path.sep)
          .join("/");
        const fid = fileIdFor(projectId, rel);
        matches = matches.filter((s) => s.fileId === fid);
      }
      if (matches.length === 0) return null;

      // Prefer top-level declarations (no parent) over methods.
      matches.sort(
        (a, b) =>
          (a.parentSymbolId ? 1 : 0) - (b.parentSymbolId ? 1 : 0) ||
          a.startLine - b.startLine,
      );
      const sym = matches[0];

      const file = cm.getFileById(sym.fileId);
      if (!file) return null;

      // Only answer from the index when the defining file is unchanged.
      const fresh = fileFreshnessByMtime(cm, projectId, root, file.path);
      if (fresh.state !== "fresh") return null;

      const related = relatedFromEdges(cm, sym);
      return {
        name: sym.name,
        kind: mapSymbolKind(sym.kind),
        signature: sym.signature ?? sym.name,
        documentation: sym.doc ?? "",
        location: {
          filePath: path.join(root, file.path),
          line: sym.startLine,
        },
        related,
      };
    } finally {
      cm.close();
    }
  } catch {
    return null;
  }
}

/** Derive extends/implements relations from the symbol's outgoing edges. */
function relatedFromEdges(cm: CodeMap, sym: SymbolRecord): RelatedSymbol[] {
  const related: RelatedSymbol[] = [];
  for (const edge of cm.edgesFromSymbol(sym.id)) {
    if (edge.kind !== "extends" && edge.kind !== "implements") continue;
    const target = edge.targetSymbolId
      ? cm.getSymbolById(edge.targetSymbolId)
      : null;
    if (target) related.push({ name: target.name, relationship: edge.kind });
  }
  return deduplicateRelated(related);
}

// ============================================================================
// Exports
// ============================================================================

export {
  getCachedParseResult,
  collectSourceFiles,
  findSymbolInParseResult,
  extractTypeName,
  isPrimitiveType,
};
