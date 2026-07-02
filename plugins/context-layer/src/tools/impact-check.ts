/**
 * Impact Check Tool
 *
 * Analyzes what might break when modifying a symbol or file.
 * Critical for safe refactoring operations.
 */

import * as fs from "fs";
import * as path from "path";
import { glob } from "glob";
import {
  getGlobalCache,
  generateSymbolSearchCacheKey,
  computeFileHash,
} from "./result-cache";
import { parseFile } from "../indexer/parser";
import type { ImportInfo, ParseResult } from "../indexer/types";
import {
  codeMapEnabled,
  ensureProjectIndexed,
  openCodeMap,
} from "../indexer/code-map-service";
import { projectIdFor } from "../storage/code-map";

// ============================================================================
// Types
// ============================================================================

export interface ImpactCheckInput {
  filePath: string; // File being modified
  symbolName?: string; // Specific symbol (optional)
  projectPath: string; // Project root
}

/** Standard tool result envelope (success flag + optional data/error). */
export interface ToolResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  metadata?: {
    cached?: boolean;
    duration?: number;
    usedFallback?: boolean;
    filesSearched?: number;
  };
}

export interface Dependent {
  filePath: string;
  line: number;
  usage:
    | "import"
    | "call"
    | "extends"
    | "implements"
    | "type-reference"
    | "property-access"
    | "unknown";
  context?: string; // Surrounding code context
  symbolUsed?: string; // Which symbol from the file is used
}

export interface ImpactResult {
  symbol: string;
  filePath: string;
  dependents: Dependent[];
  riskLevel: "low" | "medium" | "high" | "critical";
  suggestions: string[];
  /** Kept for output-shape compat; always [] (the LSP tier that filled it is gone). */
  diagnostics?: Array<{ line: number; severity?: number; message: string }>;
  /**
   * Which tier produced this result. `strategy`: "index" = the code-map import
   * graph (SQLite DB); "scan" = a live file scan. `complete` is ALWAYS false —
   * import-level analysis finds files that IMPORT the target but cannot prove
   * symbol-level completeness (same-file, dynamic, or re-export usages are
   * missed). For an exhaustive symbol-level answer, use the built-in LSP tool
   * (findReferences / incomingCalls) — a suggestion points there when a
   * symbolName is given.
   */
  provenance: {
    strategy: "index" | "scan";
    complete: boolean;
  };
  metadata: {
    totalFiles: number;
    filesSearched: number;
    duration: number;
    cached: boolean;
  };
}

interface FileImportMap {
  filePath: string;
  imports: ImportInfo[];
  parseResult: ParseResult;
}

// ============================================================================
// Constants
// ============================================================================

const RISK_THRESHOLDS = {
  low: 3,
  medium: 10,
  high: 25,
  // Above high is critical
};

const USAGE_RISK_WEIGHTS: Record<Dependent["usage"], number> = {
  extends: 3, // Breaking changes cascade heavily
  implements: 3, // Interface changes affect all implementers
  import: 1, // Direct dependency
  call: 1.5, // Function call sites
  "type-reference": 2, // Type changes can cause widespread issues
  "property-access": 1,
  unknown: 1,
};

// ============================================================================
// Main Implementation
// ============================================================================

/**
 * Check the impact of modifying a file or symbol.
 * Returns all dependents and risk assessment.
 */
export async function checkImpact(
  input: ImpactCheckInput,
): Promise<ToolResult<ImpactResult>> {
  const startTime = Date.now();
  const cache = getGlobalCache();

  // Validate input
  const validation = validateInput(input);
  if (!validation.valid) {
    return {
      success: false,
      error: validation.error,
    };
  }

  const { filePath, symbolName, projectPath } = input;
  const normalizedFilePath = path.resolve(filePath);
  const normalizedProjectPath = path.resolve(projectPath);

  // The index path re-walks the code map on every call, so it is both fresh and
  // cheap. Caching its result by the TARGET's hash would be unsound — who
  // imports a file depends on OTHER files, so an unchanged target could return
  // a stale importer list after an importer is added/removed. So the index path
  // bypasses the hash cache entirely; only the scan tier (when the code map is
  // disabled/unavailable) uses it.
  const indexPathApplies = codeMapEnabled();

  // Check cache
  const cacheKey = generateSymbolSearchCacheKey(
    "impact-check",
    symbolName || path.basename(filePath),
    `${normalizedProjectPath}:${normalizedFilePath}`,
  );

  let fileHash: string;
  let targetContent: string;
  try {
    targetContent = fs.readFileSync(normalizedFilePath, "utf-8");
    fileHash = computeFileHash(targetContent);

    const cached = indexPathApplies
      ? null
      : cache.get<ImpactResult>(cacheKey, fileHash);
    if (cached) {
      return {
        success: true,
        data: {
          ...cached,
          metadata: { ...cached.metadata, cached: true },
        },
      };
    }
  } catch (error) {
    return {
      success: false,
      error: `Cannot read file: ${normalizedFilePath}`,
    };
  }

  try {
    // Index-first: code-map import edges capture which files import the target.
    // Symbol-level narrows those importers to the ones that actually bind/use
    // the symbol. Falls through to the scan on any miss (db unavailable, target
    // unindexed).
    if (indexPathApplies) {
      const indexed = await impactFromIndex(
        normalizedProjectPath,
        normalizedFilePath,
        symbolName,
        startTime,
      );
      if (indexed) {
        appendLspConfirmSuggestion(
          indexed,
          symbolName,
          targetContent,
          normalizedFilePath,
        );
        // No cache.set: the index path is freshness-sensitive (see indexPathApplies)
        // and bypasses the hash cache on both read and write.
        return {
          success: true,
          data: indexed,
          metadata: {
            cached: false,
            duration: indexed.metadata.duration,
            filesSearched: indexed.metadata.filesSearched,
          },
        };
      }
    }

    // Find all project files
    const projectFiles = await findProjectFiles(normalizedProjectPath);

    // Build import map for all files
    const importMaps = await buildImportMaps(
      projectFiles,
      normalizedProjectPath,
    );

    // Find dependents
    const dependents = symbolName
      ? await findSymbolDependents(
          normalizedFilePath,
          symbolName,
          importMaps,
          normalizedProjectPath,
        )
      : await findFileDependents(
          normalizedFilePath,
          importMaps,
          normalizedProjectPath,
        );

    // Calculate risk level
    const riskLevel = calculateRiskLevel(dependents);

    // Generate suggestions
    const suggestions = generateSuggestions(dependents, symbolName, riskLevel);

    const result: ImpactResult = {
      symbol: symbolName || path.basename(filePath),
      filePath: normalizedFilePath,
      dependents,
      riskLevel,
      suggestions,
      diagnostics: [],
      provenance: { strategy: "scan", complete: false },
      metadata: {
        totalFiles: projectFiles.length,
        filesSearched: importMaps.length,
        duration: Date.now() - startTime,
        cached: false,
      },
    };
    appendLspConfirmSuggestion(
      result,
      symbolName,
      targetContent,
      normalizedFilePath,
    );

    // Cache the result — but never under an index-path key. When indexPathApplies
    // we reach the scan fallback only because impactFromIndex returned null
    // (unparseable/unindexed target); caching that scan result by the target's
    // own hash is the unsound, never-read entry the cache.get bypass is
    // designed to avoid. Skipping the write keeps get/set symmetric.
    if (!indexPathApplies) {
      cache.set(cacheKey, result, fileHash, normalizedFilePath);
    }

    return {
      success: true,
      data: result,
      metadata: {
        cached: false,
        duration: result.metadata.duration,
        filesSearched: result.metadata.filesSearched,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `Impact check failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ============================================================================
// File Discovery
// ============================================================================

async function findProjectFiles(projectPath: string): Promise<string[]> {
  const patterns = [
    "**/*.ts",
    "**/*.tsx",
    "**/*.js",
    "**/*.jsx",
    "**/*.mjs",
    "**/*.cjs",
    "**/*.py",
  ];

  const ignorePatterns = [
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/.git/**",
    "**/__pycache__/**",
    "**/venv/**",
    "**/.venv/**",
    "**/target/**",
    "**/.next/**",
    "**/coverage/**",
  ];

  const files: string[] = [];

  for (const pattern of patterns) {
    const matches = await glob(pattern, {
      cwd: projectPath,
      absolute: true,
      ignore: ignorePatterns,
      nodir: true,
    });
    files.push(...matches);
  }

  // Deduplicate
  return Array.from(new Set(files));
}

// ============================================================================
// Import Map Building
// ============================================================================

async function buildImportMaps(
  files: string[],
  _projectPath: string,
): Promise<FileImportMap[]> {
  const maps: FileImportMap[] = [];

  for (const filePath of files) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const parseResult = parseFile(content, filePath);

      if (parseResult.imports.length > 0 || parseResult.classes.length > 0) {
        maps.push({
          filePath,
          imports: parseResult.imports,
          parseResult,
        });
      }
    } catch {
      // Skip files that can't be read or parsed
      continue;
    }
  }

  return maps;
}

// ============================================================================
// Dependent Finding
// ============================================================================

/**
 * Format import context based on file language.
 */
function formatImportContext(
  filePath: string,
  symbolName: string,
  source: string,
): string {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".py") {
    // Python style: from module import symbol
    return `from ${source} import ${symbolName}`;
  }

  // JS/TS style: import { symbol } from 'source'
  return `import { ${symbolName} } from '${source}'`;
}

/**
 * Find all files that import from the target file.
 */
async function findFileDependents(
  targetFile: string,
  importMaps: FileImportMap[],
  projectPath: string,
): Promise<Dependent[]> {
  const dependents: Dependent[] = [];

  for (const map of importMaps) {
    if (map.filePath === targetFile) continue;

    for (const imp of map.imports) {
      if (isImportFromFile(imp.source, targetFile, map.filePath, projectPath)) {
        dependents.push({
          filePath: map.filePath,
          line: imp.line,
          usage: "import",
          symbolUsed: imp.name,
          context: formatImportContext(map.filePath, imp.name, imp.source),
        });
      }
    }
  }

  return dependents;
}

/**
 * Find all usages of a specific symbol.
 */
async function findSymbolDependents(
  targetFile: string,
  symbolName: string,
  importMaps: FileImportMap[],
  projectPath: string,
): Promise<Dependent[]> {
  const dependents: Dependent[] = [];

  for (const map of importMaps) {
    if (map.filePath === targetFile) continue;

    // Check if this file imports the target file
    const targetImports = map.imports.filter((imp) =>
      isImportFromFile(imp.source, targetFile, map.filePath, projectPath),
    );

    // Check if the symbol is imported
    const symbolImport = targetImports.find(
      (imp) => imp.name === symbolName || imp.originalName === symbolName,
    );

    if (symbolImport) {
      dependents.push({
        filePath: map.filePath,
        line: symbolImport.line,
        usage: "import",
        symbolUsed: symbolName,
        context: formatImportContext(
          map.filePath,
          symbolName,
          symbolImport.source,
        ),
      });

      // Search for additional usages in the file
      const additionalUsages = await findSymbolUsagesInFile(
        map.filePath,
        map.parseResult,
        symbolName,
      );
      dependents.push(...additionalUsages);
    }

    // Check for namespace imports that might use the symbol
    const namespaceImports = targetImports.filter((imp) => imp.isNamespace);
    for (const nsImport of namespaceImports) {
      const usages = await findNamespaceSymbolUsages(
        map.filePath,
        nsImport.name,
        symbolName,
      );
      dependents.push(...usages);
    }
  }

  return dependents;
}

/**
 * Find additional usages of a symbol within a file (calls, extends, etc.)
 */
async function findSymbolUsagesInFile(
  filePath: string,
  parseResult: ParseResult,
  symbolName: string,
): Promise<Dependent[]> {
  const dependents: Dependent[] = [];

  // Check for class extensions
  for (const cls of parseResult.classes) {
    if (cls.extends === symbolName) {
      dependents.push({
        filePath,
        line: cls.line,
        usage: "extends",
        symbolUsed: symbolName,
        context: `class ${cls.name} extends ${symbolName}`,
      });
    }

    if (cls.implements?.includes(symbolName)) {
      dependents.push({
        filePath,
        line: cls.line,
        usage: "implements",
        symbolUsed: symbolName,
        context: `class ${cls.name} implements ${symbolName}`,
      });
    }
  }

  // Check for type extensions
  for (const type of parseResult.types) {
    if (type.extends?.includes(symbolName)) {
      dependents.push({
        filePath,
        line: type.line,
        usage: "type-reference",
        symbolUsed: symbolName,
        context: `${type.kind} ${type.name} extends ${symbolName}`,
      });
    }
  }

  // Search for function calls and property access in file content
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const callUsages = findCallUsages(content, symbolName, filePath);
    dependents.push(...callUsages);
  } catch {
    // Ignore read errors
  }

  return dependents;
}

/**
 * Find usages of a symbol accessed through a namespace import.
 */
export async function findNamespaceSymbolUsages(
  filePath: string,
  namespaceName: string,
  symbolName: string,
): Promise<Dependent[]> {
  const dependents: Dependent[] = [];

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    // Escape both halves — an identifier may carry regex metacharacters (e.g. an
    // RxJS observable named `data$`), which would otherwise build a broken or
    // wrong pattern and silently miss every usage. escapeRegex is used the same
    // way at the symbol-call site below.
    const pattern = new RegExp(
      `\\b${escapeRegex(namespaceName)}\\.${escapeRegex(symbolName)}\\b`,
      "g",
    );

    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i])) {
        dependents.push({
          filePath,
          line: i + 1,
          usage: "property-access",
          symbolUsed: symbolName,
          context: lines[i].trim(),
        });
      }
      pattern.lastIndex = 0;
    }
  } catch {
    // Ignore read errors
  }

  return dependents;
}

/**
 * Find function call usages in file content.
 */
function findCallUsages(
  content: string,
  symbolName: string,
  filePath: string,
): Dependent[] {
  const dependents: Dependent[] = [];
  const lines = content.split("\n");

  // Match function calls: symbolName( or symbolName<...>(
  const callPattern = new RegExp(
    `\\b${escapeRegex(symbolName)}\\s*(?:<[^>]*>)?\\s*\\(`,
    "g",
  );

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip import statements
    if (/^\s*(import|from)\s/.test(line)) continue;

    if (callPattern.test(line)) {
      dependents.push({
        filePath,
        line: i + 1,
        usage: "call",
        symbolUsed: symbolName,
        context: line.trim(),
      });
    }
    callPattern.lastIndex = 0;
  }

  return dependents;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if an import source points to the target file.
 */
function isImportFromFile(
  importSource: string,
  targetFile: string,
  importingFile: string,
  projectPath: string,
): boolean {
  // Handle relative imports
  if (importSource.startsWith(".")) {
    const importingDir = path.dirname(importingFile);
    const resolvedImport = path.resolve(importingDir, importSource);

    // Try with different extensions
    const extensions = [
      "",
      ".ts",
      ".tsx",
      ".js",
      ".jsx",
      ".mjs",
      ".cjs",
      ".py",
      "/index.ts",
      "/index.tsx",
      "/index.js",
      "/index.jsx",
      "/index.mjs",
      "/index.cjs",
      "/__init__.py",
    ];

    for (const ext of extensions) {
      if (resolvedImport + ext === targetFile) {
        return true;
      }
    }

    // Check if importing directory with index file
    const targetDir = path.dirname(targetFile);
    const targetBasename = path.basename(targetFile);
    if (
      (targetBasename.startsWith("index.") ||
        targetBasename === "__init__.py") &&
      resolvedImport === targetDir
    ) {
      return true;
    }

    return false;
  }

  // Skip obvious third-party packages (contain hyphen or @scope)
  if (importSource.includes("-") || importSource.startsWith("@")) {
    return false;
  }

  // Handle Python-style imports (dot-separated modules)
  const targetRelative = path.relative(projectPath, targetFile);
  const targetExt = path.extname(targetFile);

  if (targetExt === ".py") {
    // Convert file path to Python module path: auto-claude/client.py -> auto-claude.client
    const targetModule = targetRelative
      .replace(/\.py$/, "")
      .replace(/\/__init__$/, "")
      .replace(/\//g, ".");

    // Check exact match or if import is a parent module
    if (
      importSource === targetModule ||
      importSource.endsWith("." + path.basename(targetFile, ".py")) ||
      targetModule.endsWith("." + importSource) ||
      targetModule === importSource.replace(/\./g, "/").replace(/^/, "") + ".py"
    ) {
      return true;
    }

    // Handle "from X import Y" where X is a package containing the target
    const targetParts = targetModule.split(".");
    const importParts = importSource.split(".");

    // Check if import path matches target path prefix
    if (importParts.length <= targetParts.length) {
      const matches = importParts.every((part, i) => part === targetParts[i]);
      if (matches) return true;
    }

    return false;
  }

  // Handle JS/TS absolute/alias imports
  const targetBaseName = path.basename(targetFile, path.extname(targetFile));

  // Must be a path-like import (contains /) to avoid matching packages
  if (!importSource.includes("/")) {
    return false;
  }

  // Check if import path ends with target file path segment
  const targetPathSegment = "/" + targetBaseName;
  if (
    importSource.endsWith(targetPathSegment) ||
    importSource.endsWith(
      targetRelative.replace(/\\/g, "/").replace(/\.[^.]+$/, ""),
    )
  ) {
    return true;
  }

  return false;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function validateInput(input: ImpactCheckInput): {
  valid: boolean;
  error?: string;
} {
  if (!input.filePath) {
    return { valid: false, error: "filePath is required" };
  }

  if (!input.projectPath) {
    return { valid: false, error: "projectPath is required" };
  }

  if (!fs.existsSync(input.projectPath)) {
    return {
      valid: false,
      error: `Project path does not exist: ${input.projectPath}`,
    };
  }

  if (!fs.existsSync(input.filePath)) {
    return { valid: false, error: `File does not exist: ${input.filePath}` };
  }

  return { valid: true };
}

// ============================================================================
// Risk Assessment
// ============================================================================

function calculateRiskLevel(
  dependents: Dependent[],
): ImpactResult["riskLevel"] {
  if (dependents.length === 0) {
    return "low";
  }

  // Calculate weighted score
  let weightedScore = 0;
  for (const dep of dependents) {
    weightedScore += USAGE_RISK_WEIGHTS[dep.usage] || 1;
  }

  // Check for high-risk usage patterns
  const hasExtends = dependents.some((d) => d.usage === "extends");
  const hasImplements = dependents.some((d) => d.usage === "implements");

  if (hasExtends || hasImplements) {
    weightedScore *= 1.5;
  }

  // Count unique files
  const uniqueFiles = new Set(dependents.map((d) => d.filePath)).size;

  if (weightedScore > RISK_THRESHOLDS.high || uniqueFiles > 20) {
    return "critical";
  }

  if (weightedScore > RISK_THRESHOLDS.medium || uniqueFiles > 10) {
    return "high";
  }

  if (weightedScore > RISK_THRESHOLDS.low || uniqueFiles > 3) {
    return "medium";
  }

  return "low";
}

// ============================================================================
// Suggestion Generation
// ============================================================================

function generateSuggestions(
  dependents: Dependent[],
  symbolName: string | undefined,
  riskLevel: ImpactResult["riskLevel"],
): string[] {
  const suggestions: string[] = [];
  const uniqueFiles = new Set(dependents.map((d) => d.filePath));

  // File count suggestions
  if (uniqueFiles.size > 0) {
    suggestions.push(
      `Update ${uniqueFiles.size} file${uniqueFiles.size > 1 ? "s" : ""} that depend${uniqueFiles.size > 1 ? "" : "s"} on this ${symbolName ? "symbol" : "file"}`,
    );
  }

  // Usage-specific suggestions
  const usageCounts: Partial<Record<Dependent["usage"], number>> = {};
  for (const dep of dependents) {
    usageCounts[dep.usage] = (usageCounts[dep.usage] || 0) + 1;
  }

  if (usageCounts.extends) {
    suggestions.push(
      `${usageCounts.extends} class${usageCounts.extends > 1 ? "es" : ""} extend this - changes will cascade`,
    );
  }

  if (usageCounts.implements) {
    suggestions.push(
      `${usageCounts.implements} class${usageCounts.implements > 1 ? "es" : ""} implement this interface`,
    );
  }

  if (usageCounts.call && usageCounts.call > 5) {
    suggestions.push(
      `${usageCounts.call} call sites - consider backward-compatible changes`,
    );
  }

  if (usageCounts["type-reference"]) {
    suggestions.push(
      `${usageCounts["type-reference"]} type reference${usageCounts["type-reference"] > 1 ? "s" : ""} - type changes may cause compilation errors`,
    );
  }

  // Risk-specific suggestions
  if (riskLevel === "critical") {
    suggestions.push(
      "CRITICAL: Consider creating a migration plan before making changes",
    );
    suggestions.push("Consider deprecating instead of removing");
  } else if (riskLevel === "high") {
    suggestions.push("Run full test suite after changes");
    suggestions.push("Consider gradual rollout");
  } else if (riskLevel === "medium") {
    suggestions.push("Review affected files after changes");
  }

  // Test file suggestions
  const testFiles = Array.from(uniqueFiles).filter(
    (f) =>
      f.includes(".test.") || f.includes(".spec.") || f.includes("__tests__"),
  );
  if (testFiles.length > 0) {
    suggestions.push(
      `Update ${testFiles.length} test file${testFiles.length > 1 ? "s" : ""}`,
    );
  }

  return suggestions;
}

// ============================================================================
// Index-backed impact
// ============================================================================

/**
 * When a symbol is named, point at the built-in LSP tool for the exhaustive
 * symbol-level answer this import-graph analysis cannot give. Appended to the
 * result's suggestions on BOTH tiers, anchored at the symbol's declaration.
 */
function appendLspConfirmSuggestion(
  result: ImpactResult,
  symbolName: string | undefined,
  targetContent: string,
  targetFileAbs: string,
): void {
  if (!symbolName) return;
  const line = declarationLine(targetContent, targetFileAbs, symbolName);
  const at = line ? `${targetFileAbs}:${line}` : targetFileAbs;
  result.suggestions.push(
    `Confirm symbol-level impact with the built-in LSP tool ` +
      `(findReferences / incomingCalls) at ${at}`,
  );
}

/** Declaration line of a symbol in the target file, or null when not found. */
function declarationLine(
  content: string,
  filePathAbs: string,
  symbolName: string,
): number | null {
  try {
    const parsed = parseFile(content, filePathAbs);
    const hit =
      parsed.functions.find((f) => f.name === symbolName) ??
      parsed.classes.find((c) => c.name === symbolName) ??
      parsed.types.find((t) => t.name === symbolName) ??
      parsed.exports.find((e) => e.name === symbolName);
    return hit ? hit.line : null;
  } catch {
    return null;
  }
}

/**
 * Answer an impact check from code-map import edges. File-level: every file
 * with an `imports` edge onto the target is a dependent. Symbol-level: the
 * import graph narrows the candidate set to the target's importers, which are
 * then parsed for bindings/usages of the named symbol (import lines, call
 * sites, extends/implements, namespace access). Returns null on any miss
 * (file not indexed, db unavailable, file outside project) so the caller
 * falls back to the scan. Bootstraps a full index on first use.
 */
async function impactFromIndex(
  projectRootAbs: string,
  targetFileAbs: string,
  symbolName: string | undefined,
  startTime: number,
): Promise<ImpactResult | null> {
  try {
    const relPath = path
      .relative(projectRootAbs, targetFileAbs)
      .split(path.sep)
      .join("/");
    if (!relPath || relPath.startsWith("..")) return null;

    // Self-heal staleness: the index is otherwise built once and never
    // refreshed, so files added or edited since then are missing/stale here and
    // silently drop us to the slower regex scan — or worse, return an INCOMPLETE
    // importer list (a new importer's edge lives on its own row, absent from the
    // index until re-walked). `force: true` runs a full re-walk that is cheap
    // because unchanged files are skipped by hash; only changed files re-parse,
    // and Phase C rebuilds every edge — so the importer set is complete and
    // correct, and still faster than parsing every file in the fallback.
    ensureProjectIndexed(projectRootAbs, { force: true });
    const cm = openCodeMap(projectRootAbs);
    if (!cm) return null;
    try {
      const projectId = projectIdFor(projectRootAbs);
      const targetFile = cm.getFile(projectId, relPath);
      if (!targetFile) return null; // still unresolved (e.g. unparseable file)

      const pathById = new Map(
        cm.listFiles(projectId).map((f) => [f.id, f.path] as const),
      );
      let dependents: Dependent[] = [];
      let filesSearched = pathById.size;
      if (symbolName) {
        // Symbol-level: importer files from the graph, then a parse of just
        // those files for import bindings + call/extends/namespace usages.
        const importerAbs: string[] = [];
        for (const edge of cm.edgesTargetingFile(projectId, targetFile.id)) {
          if (edge.kind !== "imports" || !edge.sourceFileId) continue;
          const src = pathById.get(edge.sourceFileId);
          if (!src) continue;
          importerAbs.push(path.join(projectRootAbs, src));
        }
        const importMaps = await buildImportMaps(
          Array.from(new Set(importerAbs)),
          projectRootAbs,
        );
        dependents = await findSymbolDependents(
          targetFileAbs,
          symbolName,
          importMaps,
          projectRootAbs,
        );
        filesSearched = importMaps.length;
      } else {
        for (const edge of cm.edgesTargetingFile(projectId, targetFile.id)) {
          if (edge.kind !== "imports" || !edge.sourceFileId) continue;
          const src = pathById.get(edge.sourceFileId);
          if (!src) continue;
          dependents.push({
            filePath: path.join(projectRootAbs, src),
            line: edge.line ?? 0,
            usage: "import",
            context: `imports ${relPath}`,
          });
        }
      }

      const riskLevel = calculateRiskLevel(dependents);
      const suggestions = generateSuggestions(dependents, symbolName, riskLevel);
      return {
        symbol: symbolName || path.basename(targetFileAbs),
        filePath: targetFileAbs,
        dependents,
        riskLevel,
        suggestions,
        diagnostics: [],
        provenance: { strategy: "index", complete: false },
        metadata: {
          totalFiles: pathById.size,
          filesSearched,
          duration: Date.now() - startTime,
          cached: false,
        },
      };
    } finally {
      cm.close();
    }
  } catch {
    return null;
  }
}

// Types are already exported at their definition above
