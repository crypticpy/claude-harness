/**
 * Symbol Context Tool
 *
 * Gets type information and documentation for any symbol without reading the full file.
 * Uses the LSP cache for performance and parses files on demand if not cached.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  LSPCache,
  getGlobalCache,
  computeFileHash,
  generateSymbolSearchCacheKey,
  DEFAULT_LSP_CONFIG,
} from '../lsp';
import {
  parseFile,
  ParseResult,
  FunctionInfo,
  ClassInfo,
  TypeInfo,
} from '../indexer';

// ============================================================================
// Types
// ============================================================================

export interface SymbolContextInput {
  symbolName: string;
  filePath?: string;
  projectPath: string;
}

export type SymbolKind = 'function' | 'class' | 'type' | 'interface' | 'variable' | 'unknown';

export interface RelatedSymbol {
  name: string;
  relationship: 'extends' | 'implements' | 'uses' | 'returns';
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

const SYMBOL_CONTEXT_CACHE_KEY_PREFIX = 'symbol_context';
const FILE_PARSE_CACHE_KEY_PREFIX = 'file_parse';

// ============================================================================
// Main Function
// ============================================================================

/**
 * Gets detailed context for a symbol including type signature, documentation,
 * and related types.
 */
export async function getSymbolContext(
  input: SymbolContextInput
): Promise<SymbolContextResult | null> {
  const { symbolName, filePath, projectPath } = input;
  const cache = getGlobalCache();

  // Check cache first
  const cacheKey = generateSymbolSearchCacheKey(
    SYMBOL_CONTEXT_CACHE_KEY_PREFIX,
    `${symbolName}:${filePath || ''}`,
    projectPath
  );

  const cached = cache.get<SymbolContextResult>(cacheKey);
  if (cached) {
    return cached;
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
    cache.set(cacheKey, result, 'search_result', projectPath);
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
  cache: LSPCache
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
  cache: LSPCache
): Promise<ParseResult | null> {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
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
  cache: LSPCache
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
  maxFiles: number = DEFAULT_LSP_CONFIG.maxFilesToSearch
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
          if (!excludeDirs.has(entry.name) && !entry.name.startsWith('.')) {
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
  filePath: string
): SymbolContextResult | null {
  // Check functions
  const func = parseResult.functions.find(f => f.name === symbolName);
  if (func) {
    return buildFunctionContext(func, filePath, parseResult);
  }

  // Check classes
  const cls = parseResult.classes.find(c => c.name === symbolName);
  if (cls) {
    return buildClassContext(cls, filePath, parseResult);
  }

  // Check types (interfaces, types, enums)
  const typeInfo = parseResult.types.find(t => t.name === symbolName);
  if (typeInfo) {
    return buildTypeContext(typeInfo, filePath, parseResult);
  }

  // Check exports for variables/constants
  const exp = parseResult.exports.find(e => e.name === symbolName);
  if (exp && (exp.kind === 'const' || exp.kind === 'let' || exp.kind === 'var')) {
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
  _parseResult: ParseResult
): SymbolContextResult {
  const related: RelatedSymbol[] = [];

  // Extract return type relationship
  if (func.returnType) {
    const returnTypeName = extractTypeName(func.returnType);
    if (returnTypeName && !isPrimitiveType(returnTypeName)) {
      related.push({ name: returnTypeName, relationship: 'returns' });
    }
  }

  // Extract parameter type relationships
  const paramTypes = extractParameterTypes(func.params);
  for (const paramType of paramTypes) {
    if (!isPrimitiveType(paramType)) {
      related.push({ name: paramType, relationship: 'uses' });
    }
  }

  // Build signature
  const asyncPrefix = func.isAsync ? 'async ' : '';
  const generatorMark = func.isGenerator ? '*' : '';
  const params = func.params.join(', ');
  const returnType = func.returnType ? `: ${func.returnType}` : '';
  const signature = `${asyncPrefix}function${generatorMark} ${func.name}(${params})${returnType}`;

  return {
    name: func.name,
    kind: 'function',
    signature,
    documentation: func.docstring || '',
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
  _parseResult: ParseResult
): SymbolContextResult {
  const related: RelatedSymbol[] = [];

  // Extract extends relationship
  if (cls.extends) {
    related.push({ name: cls.extends, relationship: 'extends' });
  }

  // Extract implements relationships
  if (cls.implements) {
    for (const impl of cls.implements) {
      related.push({ name: impl.trim(), relationship: 'implements' });
    }
  }

  // Build signature
  const abstractPrefix = cls.isAbstract ? 'abstract ' : '';
  const extendsClause = cls.extends ? ` extends ${cls.extends}` : '';
  const implementsClause = cls.implements?.length
    ? ` implements ${cls.implements.join(', ')}`
    : '';
  const methodsList = cls.methods.length > 0
    ? `\n  // Methods: ${cls.methods.slice(0, 5).join(', ')}${cls.methods.length > 5 ? '...' : ''}`
    : '';
  const propertiesList = cls.properties.length > 0
    ? `\n  // Properties: ${cls.properties.slice(0, 5).join(', ')}${cls.properties.length > 5 ? '...' : ''}`
    : '';

  const signature = `${abstractPrefix}class ${cls.name}${extendsClause}${implementsClause} {${methodsList}${propertiesList}\n}`;

  return {
    name: cls.name,
    kind: 'class',
    signature,
    documentation: '', // Classes typically don't have inline docstrings parsed
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
  _parseResult: ParseResult
): SymbolContextResult {
  const related: RelatedSymbol[] = [];

  // Extract extends relationships
  if (typeInfo.extends) {
    for (const ext of typeInfo.extends) {
      related.push({ name: ext.trim(), relationship: 'extends' });
    }
  }

  // Build signature based on kind
  let signature: string;
  const kind: SymbolKind = typeInfo.kind === 'interface' ? 'interface' : 'type';

  if (typeInfo.kind === 'interface') {
    const extendsClause = typeInfo.extends?.length
      ? ` extends ${typeInfo.extends.join(', ')}`
      : '';
    const membersList = typeInfo.members?.length
      ? `\n  ${typeInfo.members.slice(0, 5).join(';\n  ')}${typeInfo.members.length > 5 ? ';...' : ''}`
      : '';
    signature = `interface ${typeInfo.name}${extendsClause} {${membersList}\n}`;
  } else if (typeInfo.kind === 'enum') {
    const membersList = typeInfo.members?.length
      ? `\n  ${typeInfo.members.slice(0, 5).join(',\n  ')}${typeInfo.members.length > 5 ? ',...' : ''}`
      : '';
    signature = `enum ${typeInfo.name} {${membersList}\n}`;
  } else {
    // type alias
    const extendsClause = typeInfo.extends?.length
      ? ` = ${typeInfo.extends.join(' & ')}`
      : ' = { ... }';
    signature = `type ${typeInfo.name}${extendsClause}`;
  }

  return {
    name: typeInfo.name,
    kind,
    signature,
    documentation: '',
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
  filePath: string
): SymbolContextResult {
  return {
    name,
    kind: 'variable',
    signature: `const ${name} = ...`,
    documentation: '',
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
  if (type.endsWith('[]')) {
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
    const colonIndex = param.indexOf(':');
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
    'string', 'number', 'boolean', 'void', 'null', 'undefined',
    'any', 'unknown', 'never', 'object', 'symbol', 'bigint',
    'String', 'Number', 'Boolean', 'Object', 'Symbol', 'BigInt',
    'Array', 'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet',
    'Date', 'RegExp', 'Error', 'Function',
    // Python primitives
    'str', 'int', 'float', 'bool', 'None', 'list', 'dict', 'tuple', 'set',
  ]);

  return primitives.has(typeName);
}

/**
 * Removes duplicate related symbols.
 */
function deduplicateRelated(related: RelatedSymbol[]): RelatedSymbol[] {
  const seen = new Set<string>();
  return related.filter(r => {
    const key = `${r.name}:${r.relationship}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
