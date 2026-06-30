/**
 * Regex-based parser for TypeScript and Python files.
 */

import * as path from 'path';
import type {
  ParseResult,
  ParserOptions,
  ExportKind,
} from './types';
import { DEFAULT_PARSER_OPTIONS, createEmptyParseResult } from './types';

export function parseFile(
  content: string,
  filePath: string,
  options: ParserOptions = {}
): ParseResult {
  const opts = { ...DEFAULT_PARSER_OPTIONS, ...options };
  const ext = path.extname(filePath).toLowerCase();

  if (content.length > opts.maxFileSize) {
    return {
      ...createEmptyParseResult('unknown'),
      errors: [`File exceeds max size of ${opts.maxFileSize} bytes`],
    };
  }

  const language = detectLanguage(ext);
  const result = createEmptyParseResult(language);
  result.lineCount = content.split('\n').length;

  try {
    if (language === 'typescript') {
      parseTypeScript(content, result, opts);
    } else if (language === 'python') {
      parsePython(content, result, opts);
    }
  } catch (error) {
    result.errors.push(`Parse error: ${error instanceof Error ? error.message : String(error)}`);
  }

  return result;
}

function detectLanguage(ext: string): ParseResult['language'] {
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
    return 'typescript';
  }
  if (['.py', '.pyw', '.pyi'].includes(ext)) {
    return 'python';
  }
  return 'unknown';
}

function parseTypeScript(content: string, result: ParseResult, _opts: Required<ParserOptions>): void {

  // Parse imports
  const importRegex = /^import\s+(?:type\s+)?(?:(\*\s+as\s+(\w+))|(\{[^}]+\})|(\w+))?\s*(?:,\s*(?:(\{[^}]+\})|(\w+)))?\s*from\s+['"]([^'"]+)['"]/gm;
  let match: RegExpExecArray | null;

  while ((match = importRegex.exec(content)) !== null) {
    const line = content.slice(0, match.index).split('\n').length;
    const source = match[7];
    // Anchor the `type` keyword: `import typeOf from './x'` is a default import,
    // not a type-only import, even though it contains the substring "import type".
    const isTypeOnly = /^import\s+type\s/.test(match[0]);

    // Namespace import
    if (match[2]) {
      result.imports.push({
        name: match[2],
        source,
        isDefault: false,
        isNamespace: true,
        isTypeOnly,
        line,
      });
    }

    // Named imports
    if (match[3] || match[5]) {
      const namedImports = (match[3] || match[5] || '').replace(/[{}]/g, '').split(',');
      for (const imp of namedImports) {
        const parts = imp.trim().split(/\s+as\s+/);
        if (parts[0]) {
          result.imports.push({
            name: parts[1] || parts[0],
            source,
            isDefault: false,
            isNamespace: false,
            isTypeOnly,
            line,
            originalName: parts[1] ? parts[0] : undefined,
          });
        }
      }
    }

    // Default import
    if (match[4] || match[6]) {
      result.imports.push({
        name: match[4] || match[6],
        source,
        isDefault: true,
        isNamespace: false,
        isTypeOnly,
        line,
      });
    }
  }

  // Parse exports
  const exportPatterns = [
    /^export\s+(?:default\s+)?(?:async\s+)?function\s*\*?\s*(\w+)?/gm,
    /^export\s+(?:default\s+)?class\s+(\w+)/gm,
    /^export\s+(const|let|var)\s+(\w+)/gm,
    /^export\s+(?:type|interface)\s+(\w+)/gm,
    /^export\s+enum\s+(\w+)/gm,
    /^export\s+\{([^}]+)\}/gm,
  ];

  for (const pattern of exportPatterns) {
    pattern.lastIndex = 0;
    while ((match = pattern.exec(content)) !== null) {
      const line = content.slice(0, match.index).split('\n').length;

      // Dispatch on the declaration keyword anchored at the start of the match,
      // not a naive substring scan — `export const functionList = []` must not be
      // mistaken for a function export just because the name contains "function".
      if (/^export\s+(?:default\s+)?(?:async\s+)?function\b/.test(match[0])) {
        result.exports.push({
          name: match[1] || 'default',
          kind: 'function',
          line,
          isReexport: false,
        });
      } else if (/^export\s+(?:default\s+)?class\b/.test(match[0])) {
        result.exports.push({
          name: match[1],
          kind: 'class',
          line,
          isReexport: false,
        });
      } else if (/^export\s+(?:const|let|var)\b/.test(match[0])) {
        result.exports.push({
          name: match[2],
          kind: match[1] as ExportKind,
          line,
          isReexport: false,
        });
      } else if (/^export\s+(?:type|interface)\b/.test(match[0])) {
        result.exports.push({
          name: match[1],
          kind: /^export\s+interface\b/.test(match[0]) ? 'interface' : 'type',
          line,
          isReexport: false,
        });
      } else if (/^export\s+enum\b/.test(match[0])) {
        result.exports.push({
          name: match[1],
          kind: 'enum',
          line,
          isReexport: false,
        });
      } else if (match[1]) {
        // Named exports: export { x, y }
        const names = match[1].split(',').map(n => n.trim());
        for (const name of names) {
          const parts = name.split(/\s+as\s+/);
          result.exports.push({
            name: parts[1] || parts[0],
            kind: 'unknown',
            line,
            isReexport: false,
            originalName: parts[1] ? parts[0] : undefined,
          });
        }
      }
    }
  }

  // Parse functions
  const funcRegex = /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*(\w+)\s*\(([^)]*)\)(?:\s*:\s*([^{]+))?/g;
  while ((match = funcRegex.exec(content)) !== null) {
    const line = content.slice(0, match.index).split('\n').length;
    // Anchor keywords to the declaration so an identifier/param that merely
    // contains "export"/"async"/"*" (e.g. `exportData`, `asyncHandler`, a
    // `2 * 3` default) doesn't flip the flag.
    const isExported = /(?:^|\n)\s*export\b/.test(match[0]);
    const isAsync = /\basync\s+function\b/.test(match[0]);
    const isGenerator = /function\s*\*/.test(match[0]);
    const params = match[2].split(',').map(p => p.trim().split(':')[0].trim()).filter(Boolean);

    result.functions.push({
      name: match[1],
      line,
      isAsync,
      isExported,
      isGenerator,
      params,
      returnType: match[3]?.trim(),
    });
  }

  // Parse classes
  const classRegex = /(?:^|\n)\s*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^{]+))?/g;
  while ((match = classRegex.exec(content)) !== null) {
    const line = content.slice(0, match.index).split('\n').length;
    const isExported = /(?:^|\n)\s*export\b/.test(match[0]);
    const isAbstract = /\babstract\s+class\b/.test(match[0]);

    result.classes.push({
      name: match[1],
      line,
      isExported,
      isAbstract,
      methods: [],
      properties: [],
      extends: match[2],
      implements: match[3]?.split(',').map(i => i.trim()),
    });
  }

  // Parse interfaces and types
  const typeRegex = /(?:^|\n)\s*(?:export\s+)?(interface|type)\s+(\w+)(?:\s+extends\s+([^{=]+))?/g;
  while ((match = typeRegex.exec(content)) !== null) {
    const line = content.slice(0, match.index).split('\n').length;
    const isExported = /(?:^|\n)\s*export\b/.test(match[0]);

    result.types.push({
      name: match[2],
      kind: match[1] as 'type' | 'interface',
      line,
      isExported,
      extends: match[3]?.split(',').map(e => e.trim()),
    });
  }
}

function parsePython(content: string, result: ParseResult, _opts: Required<ParserOptions>): void {
  const lines = content.split('\n');

  // Parse imports - handle multiline and various formats
  let i = 0;
  while (i < lines.length) {
    const lineNum = i + 1;
    let line = lines[i].trim();

    // Skip comments and empty lines
    if (line.startsWith('#') || !line) {
      i++;
      continue;
    }

    // Handle "from X import ..." (including multiline with parens)
    const fromMatch = line.match(/^from\s+(\S+)\s+import\s+(.*)$/);
    if (fromMatch) {
      const source = fromMatch[1];
      let importPart = fromMatch[2];

      // Handle multiline imports with parentheses: from X import (
      if (importPart.includes('(') && !importPart.includes(')')) {
        // Collect continuation lines
        while (i + 1 < lines.length && !importPart.includes(')')) {
          i++;
          importPart += ' ' + lines[i].trim();
        }
      }

      // Clean up the import part
      importPart = importPart
        .replace(/\(|\)/g, '')      // Remove parens
        .replace(/#.*$/gm, '')       // Remove comments
        .replace(/\\$/gm, '')        // Remove line continuations
        .trim();

      // Handle star import
      if (importPart === '*' || importPart.startsWith('*')) {
        result.imports.push({
          name: '*',
          source,
          isDefault: false,
          isNamespace: true,
          isTypeOnly: false,
          line: lineNum,
        });
        i++;
        continue;
      }

      // Parse individual imports
      const names = importPart.split(',');
      for (const name of names) {
        const cleaned = name.trim();
        if (!cleaned || cleaned === '*') continue;

        const parts = cleaned.split(/\s+as\s+/);
        const importName = parts[0].trim();

        // Skip if it looks like a comment fragment or special char
        if (!importName || /^[^a-zA-Z_]/.test(importName)) continue;

        result.imports.push({
          name: parts[1]?.trim() || importName,
          source,
          isDefault: false,
          isNamespace: false,
          isTypeOnly: false,
          line: lineNum,
          originalName: parts[1] ? importName : undefined,
        });
      }
      i++;
      continue;
    }

    // Handle "import X" or "import X, Y"
    const importMatch = line.match(/^import\s+(.+)$/);
    if (importMatch) {
      let importPart = importMatch[1].replace(/#.*$/, '').trim();
      const names = importPart.split(',');

      for (const name of names) {
        const parts = name.trim().split(/\s+as\s+/);
        const moduleName = parts[0].trim();
        if (!moduleName) continue;

        result.imports.push({
          name: parts[1]?.trim() || moduleName,
          source: moduleName,
          isDefault: true,
          isNamespace: false,
          isTypeOnly: false,
          line: lineNum,
          originalName: parts[1] ? moduleName : undefined,
        });
      }
    }

    i++;
  }

  // Parse functions and classes using regex
  let match: RegExpExecArray | null;
  const funcRegex = /^(?:@(\w+)(?:\([^)]*\))?\n)*\s*(async\s+)?def\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*([^:]+))?:/gm;
  while ((match = funcRegex.exec(content)) !== null) {
    const line = content.slice(0, match.index).split('\n').length;
    const isAsync = !!match[2];
    const params = match[4].split(',').map(p => p.trim().split(':')[0].split('=')[0].trim()).filter(Boolean);

    result.functions.push({
      name: match[3],
      line,
      isAsync,
      isExported: !match[3].startsWith('_'),
      isGenerator: false,
      params,
      returnType: match[5]?.trim(),
      decorators: match[1] ? [match[1]] : undefined,
    });
  }

  // Parse classes
  const classRegex = /^(?:@(\w+)(?:\([^)]*\))?\n)*\s*class\s+(\w+)(?:\(([^)]*)\))?:/gm;
  while ((match = classRegex.exec(content)) !== null) {
    const line = content.slice(0, match.index).split('\n').length;
    const bases = match[3]?.split(',').map(b => b.trim()).filter(Boolean);

    result.classes.push({
      name: match[2],
      line,
      isExported: !match[2].startsWith('_'),
      isAbstract: false,
      methods: [],
      properties: [],
      extends: bases?.[0],
      decorators: match[1] ? [match[1]] : undefined,
    });
  }

  // Find __all__ for exports
  const allMatch = content.match(/__all__\s*=\s*\[([^\]]+)\]/);
  if (allMatch) {
    const names = allMatch[1].match(/['"](\w+)['"]/g);
    if (names) {
      for (const name of names) {
        const cleanName = name.replace(/['"]/g, '');
        result.exports.push({
          name: cleanName,
          kind: 'unknown',
          line: 1,
          isReexport: false,
        });
      }
    }
  }
}

export function getLanguageFromExtension(ext: string): ParseResult['language'] {
  return detectLanguage(ext);
}
