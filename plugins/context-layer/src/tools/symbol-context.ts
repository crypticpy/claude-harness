/**
 * Symbol Context Tool
 *
 * Gets type information and documentation for any symbol without reading the full file.
 * Uses the result cache for performance and parses files on demand if not cached.
 */

import * as fs from "fs";
import * as path from "path";
import {
  ResultCache,
  getGlobalCache,
  computeFileHash,
  generateSymbolSearchCacheKey,
} from "./result-cache";
import {
  parseFile,
  ParseResult,
  FunctionInfo,
  ClassInfo,
  TypeInfo,
} from "../indexer";
import { getLanguageFromExtension } from "../indexer/parser";
import {
  warmTreeSitter,
  readyTreeSitterBackend,
} from "../indexer/backends/tree-sitter";
import {
  codeMapEnabled,
  projectRoot,
  openCodeMap,
  fileFreshnessByMtime,
  ensureProjectIndexed,
  refreshFile,
} from "../indexer/code-map-service";
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
  /**
   * Compact output: return just name, kind, signature, and location — drop the
   * related-symbols list and documentation. Use when you only need the shape of a
   * symbol to decide whether it's the one you want, not its full neighborhood.
   */
  signatureOnly?: boolean;
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
  /**
   * Which tier resolved this symbol. `strategy`: "index" = the code-map symbol
   * table; "parse" = a live syntactic parse of the file (tree-sitter, or the
   * regex parser as the last fallback). `complete` is ALWAYS false — these
   * tiers give an accurate structural signature but do NOT resolve cross-file
   * types. For type-resolved answers use the built-in LSP tool (hover /
   * findReferences). Stamped at the resolution boundary, so it is present on
   * every tool output.
   */
  provenance?: {
    strategy: "index" | "parse";
    complete: boolean;
  };
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

// Project-search bounds for the parse fallback (formerly DEFAULT_LSP_CONFIG).
const MAX_FILES_TO_SEARCH = 500;
const SEARCH_EXCLUDE_DIRS = [
  "node_modules",
  ".git",
  "dist",
  "build",
  "__pycache__",
  "target",
  ".venv",
  "venv",
];
const SEARCH_INCLUDE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".rs",
  ".go",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
];

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
  const result = await resolveSymbolContext(input);
  // signatureOnly trims AFTER resolution (and after the internal cache read), so
  // the cache always holds the full result and both modes share one entry.
  if (result && input.signatureOnly) {
    return { ...result, related: [], documentation: "" };
  }
  return result;
}

/**
 * Stamp the resolving tier onto a result. Never `complete` — structural tiers
 * can't prove cross-file type resolution (that's the built-in LSP tool's job).
 */
function withProvenance(
  r: SymbolContextResult,
  strategy: "index" | "parse",
): SymbolContextResult {
  return { ...r, provenance: { strategy, complete: false } };
}

async function resolveSymbolContext(
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

  // Index-first tier (code-map): answer from the symbol table without scanning
  // the project, when the defining file is fresh. Falls through on any miss.
  if (codeMapEnabled()) {
    const indexed = symbolContextFromIndex(symbolName, filePath, projectPath);
    if (indexed) {
      const stamped = withProvenance(indexed, "index");
      cache.set(cacheKey, stamped, "index_result", projectPath);
      return stamped;
    }
  }

  let result: SymbolContextResult | null = null;

  if (filePath) {
    // On-demand tree-sitter parse of the defining file: real AST spans and a
    // literal declaration signature. Falls through when no grammar covers the
    // language or the symbol isn't found.
    result = await symbolContextFromTreeSitter(
      symbolName,
      filePath,
      projectPath,
    );
    // Regex-parser fallback (existing tier).
    if (!result) {
      result = await searchInFile(symbolName, filePath, cache);
    }
  } else {
    // Search project for symbol definition
    result = await searchProject(symbolName, projectPath, cache);
  }

  if (result) {
    // Cache the result
    const stamped = withProvenance(result, "parse");
    cache.set(cacheKey, stamped, "search_result", projectPath);
    return stamped;
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
  cache: ResultCache,
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
  cache: ResultCache,
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
  cache: ResultCache,
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
  maxFiles: number = MAX_FILES_TO_SEARCH,
): string[] {
  const files: string[] = [];
  const excludeDirs = new Set(SEARCH_EXCLUDE_DIRS);
  const includeExtensions = new Set(SEARCH_INCLUDE_EXTENSIONS);

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
 * Builtin/utility generic wrappers whose own name carries no navigational value
 * — the interesting type is the argument, so these get unwrapped.
 */
const CONTAINER_GENERICS = new Set([
  "Promise",
  "Array",
  "ReadonlyArray",
  "Set",
  "ReadonlySet",
  "Map",
  "ReadonlyMap",
  "WeakMap",
  "WeakSet",
  "Record",
  "Partial",
  "Required",
  "Readonly",
  "NonNullable",
  "Awaited",
  "Iterable",
  "AsyncIterable",
  "Iterator",
  "Generator",
  "AsyncGenerator",
]);

/**
 * Extracts the most navigationally-useful type name from a type annotation.
 *
 * A builtin container generic is unwrapped to its first non-primitive type
 * argument; a user-defined generic keeps its outer name. This also makes `T[]`
 * and `Array<T>` agree.
 *   "Promise<User>" -> "User"   "User[]" -> "User"   "Array<User>" -> "User"
 *   "Map<string, Cfg>" -> "Cfg"  "Result<T>" -> "Result"  "Promise<void>" -> null
 * Returns null when there is no navigable identifier (e.g. a container of only
 * primitives, or an empty annotation).
 */
function extractTypeName(typeAnnotation: string): string | null {
  const type = typeAnnotation.trim();

  // Array shorthand: peel one level (recurse for nested arrays like User[][]).
  if (type.endsWith("[]")) {
    return extractTypeName(type.slice(0, -2));
  }

  // Generic: outer name + inner args. Require a closing `>` so a truncated
  // annotation falls through to the plain-identifier branch below.
  const genericMatch = type.match(/^(\w+)\s*<(.+)>$/);
  if (genericMatch) {
    const outer = genericMatch[1];
    // Container wrapper: surface the first non-primitive type argument instead
    // of the wrapper itself; null if every argument is a primitive.
    if (CONTAINER_GENERICS.has(outer)) {
      for (const arg of splitTypeArgs(genericMatch[2])) {
        const inner = extractTypeName(arg);
        if (inner && !isPrimitiveType(inner)) return inner;
      }
      return null;
    }
    return outer; // user-defined generic — the outer name IS the type
  }

  // Union/intersection or a plain identifier — take the leading identifier.
  const leadMatch = type.match(/^(\w+)/);
  return leadMatch ? leadMatch[1] : null;
}

/**
 * Split top-level generic type arguments on commas, respecting nested `<>`/`[]`.
 * E.g. "string, Record<string, X>" -> ["string", "Record<string, X>"]. Depth is
 * clamped at 0 so a stray `>` (e.g. inside `=>`) cannot corrupt later splits.
 */
function splitTypeArgs(args: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < args.length; i++) {
    const ch = args[i];
    if (ch === "<" || ch === "[") depth++;
    else if (ch === ">" || ch === "]") depth = Math.max(0, depth - 1);
    else if (ch === "," && depth === 0) {
      out.push(args.slice(start, i));
      start = i + 1;
    }
  }
  out.push(args.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
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

// ============================================================================
// Literal declaration extraction (signature + leading doc comment)
// ============================================================================

/**
 * Literal declaration signature read straight from source: join lines starting
 * at the declaration until the first top-level `{` or `;` (TS) or the `:`
 * ending a Python def/class header, cap at 5 lines, collapse whitespace.
 * Depth-tracked so a `{`/`:` inside a parameter list doesn't cut the header.
 * Returns null when the span is out of range or nothing was collected.
 */
function declarationSignature(
  content: string,
  startLine: number,
  language: string,
): string | null {
  const lines = content.split("\n");
  if (startLine < 1 || startLine > lines.length) return null;
  const isPython = language === "python";
  const cap = Math.min(startLine - 1 + 5, lines.length);
  let collected = "";
  let depth = 0;
  for (let i = startLine - 1; i < cap; i++) {
    const line = lines[i];
    let cut = -1;
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (ch === "(" || ch === "[" || ch === "<") depth++;
      else if (ch === ")" || ch === "]" || ch === ">") {
        depth = Math.max(0, depth - 1);
      } else if (!isPython && depth === 0 && ch === "{") {
        cut = j; // exclude the body-opening brace
        break;
      } else if (!isPython && depth === 0 && ch === ";") {
        cut = j + 1; // include the terminating semicolon
        break;
      } else if (isPython && depth === 0 && ch === ":") {
        cut = j + 1; // include the header-ending colon
        break;
      }
    }
    collected += (collected ? " " : "") + (cut === -1 ? line : line.slice(0, cut));
    if (cut !== -1) break;
  }
  const signature = collected.replace(/\s+/g, " ").trim();
  return signature.length > 0 ? signature : null;
}

/**
 * The contiguous comment block immediately preceding a declaration (`/** *\/`,
 * `//`, or `#` styles), or "" when the line above is not a comment.
 */
function leadingCommentBlock(content: string, startLine: number): string {
  const lines = content.split("\n");
  let i = startLine - 2; // 0-based index of the line above the declaration
  if (i < 0 || i >= lines.length) return "";

  const block: string[] = [];
  const above = lines[i].trim();
  if (above.endsWith("*/")) {
    // Walk up to the /* or /** opener, inclusive.
    for (; i >= 0; i--) {
      const t = lines[i].trim();
      block.unshift(t);
      if (t.startsWith("/*")) break;
    }
    if (i < 0) return ""; // unterminated walk — not a well-formed block
  } else if (above.startsWith("//") || above.startsWith("#")) {
    const marker = above.startsWith("//") ? "//" : "#";
    for (; i >= 0; i--) {
      const t = lines[i].trim();
      if (!t.startsWith(marker)) break;
      block.unshift(t);
    }
  } else {
    return "";
  }

  return block
    .map((l) =>
      l
        .replace(/^\/\*\*?/, "")
        .replace(/\*\/$/, "")
        .replace(/^\*\s?/, "")
        .replace(/^\/\/\s?/, "")
        .replace(/^#\s?/, "")
        .trim(),
    )
    .filter(Boolean)
    .join("\n")
    .trim();
}

/**
 * Derive related types from a function's literal signature text: parameter
 * annotations become "uses", the return annotation (`: T` / `-> T`) "returns".
 * Best-effort — a fail-open enrichment for the structural tiers, which have no
 * type resolver.
 */
function relatedTypesFromSignature(signature: string): RelatedSymbol[] {
  const open = signature.indexOf("(");
  if (open === -1) return [];
  let depth = 0;
  let close = -1;
  for (let i = open; i < signature.length; i++) {
    const ch = signature[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close === -1) return [];

  const related: RelatedSymbol[] = [];
  for (const param of splitTypeArgs(signature.slice(open + 1, close))) {
    const colon = param.indexOf(":");
    if (colon === -1) continue;
    const typeName = extractTypeName(param.slice(colon + 1).trim());
    if (typeName && !isPrimitiveType(typeName)) {
      related.push({ name: typeName, relationship: "uses" });
    }
  }

  const retMatch = signature.slice(close + 1).match(/^\s*(?::|->)\s*(.+)$/);
  if (retMatch) {
    const typeName = extractTypeName(retMatch[1].trim());
    if (typeName && !isPrimitiveType(typeName)) {
      related.push({ name: typeName, relationship: "returns" });
    }
  }

  return deduplicateRelated(related);
}

/**
 * On-demand tree-sitter tier: parse the defining file against the warmed
 * grammars and answer from the real AST — precise spans, a literal declaration
 * signature, and extends/implements relations. Returns null on any miss
 * (grammar unavailable, unsupported language, symbol absent) so the caller
 * falls back to the regex parser.
 */
async function symbolContextFromTreeSitter(
  symbolName: string,
  filePath: string,
  projectPath: string,
): Promise<SymbolContextResult | null> {
  try {
    const backend = readyTreeSitterBackend() ?? (await warmTreeSitter());
    if (!backend) return null;

    const absFile = path.resolve(projectPath, filePath);
    const language = getLanguageFromExtension(
      path.extname(absFile).toLowerCase(),
    );
    if (!backend.supports(language)) return null;
    if (!fs.existsSync(absFile)) return null;
    const content = fs.readFileSync(absFile, "utf-8");

    const parsed = backend.parse(content, absFile);
    const matches = parsed.symbols.filter((s) => s.name === symbolName);
    if (matches.length === 0) return null;
    // Prefer top-level declarations over class members.
    matches.sort(
      (a, b) =>
        (a.parentQualifiedName ? 1 : 0) - (b.parentQualifiedName ? 1 : 0) ||
        a.startLine - b.startLine,
    );
    const sym = matches[0];

    const signature =
      sym.signature && sym.signature !== sym.name
        ? sym.signature
        : (declarationSignature(content, sym.startLine, language) ?? sym.name);

    const kind = mapSymbolKind(sym.kind);
    const related: RelatedSymbol[] = parsed.relations
      .filter((r) => r.fromQualifiedName === sym.qualifiedName)
      .map((r) => ({ name: r.toName, relationship: r.kind }));
    if (kind === "function") {
      related.push(...relatedTypesFromSignature(signature));
    }

    return {
      name: sym.name,
      kind,
      signature,
      documentation: sym.doc ?? leadingCommentBlock(content, sym.startLine),
      location: { filePath: absFile, line: sym.startLine },
      related: deduplicateRelated(related),
    };
  } catch {
    return null;
  }
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
    // Auto-build trigger: bootstrap the index once if this project has never
    // been walked. Without this, a fresh project's empty symbol table drops
    // every lookup to the slower scan path and the index is never populated
    // (impact_check force-builds, but symbol_context previously did not). No
    // `force` — this is a one-time full index, then a fast counts() no-op.
    ensureProjectIndexed(root);
    const cm = openCodeMap(root);
    if (!cm) return null;
    let result: SymbolContextResult | null = null;
    // Defining-file path to incrementally re-walk AFTER cm is closed, so we
    // never hold a read connection open while refreshFile writes (avoids any
    // same-process WAL lock contention).
    let stalePath: string | null = null;
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
      if (fresh.state !== "fresh") {
        // Stale (edited since the last walk): mark it for an incremental
        // re-walk so the NEXT lookup hits the fast path. This call still
        // returns null → the caller's scan produces the correct fresh answer.
        if (fresh.state === "stale") stalePath = file.path;
      } else {
        const absPath = path.join(root, file.path);
        // Stored signatures are backend-dependent (the regex backend records
        // parameter names without their types). The file is verified fresh, so
        // the literal declaration text from source is authoritative; the index
        // row is the fallback, the bare symbol name last.
        let signature: string | null = null;
        let documentation = sym.doc ?? "";
        try {
          const content = fs.readFileSync(absPath, "utf-8");
          const language =
            file.language ??
            getLanguageFromExtension(path.extname(file.path).toLowerCase());
          signature = declarationSignature(content, sym.startLine, language);
          if (!documentation) {
            documentation = leadingCommentBlock(content, sym.startLine);
          }
        } catch {
          // Source unreadable — keep whatever the index had.
        }
        signature =
          signature ??
          (sym.signature && sym.signature !== sym.name
            ? sym.signature
            : null) ??
          sym.name;

        const kind = mapSymbolKind(sym.kind);
        const related = relatedFromEdges(cm, sym);
        if (kind === "function") {
          related.push(...relatedTypesFromSignature(signature));
        }
        result = {
          name: sym.name,
          kind,
          signature,
          documentation,
          location: {
            filePath: absPath,
            line: sym.startLine,
          },
          related: deduplicateRelated(related),
        };
      }
    } finally {
      cm.close();
    }

    // cm is closed — safe to open the write connection refreshFile needs.
    if (stalePath) refreshFile(root, stalePath);
    return result;
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
  collectSourceFiles,
  findSymbolInParseResult,
  extractTypeName,
  isPrimitiveType,
};
