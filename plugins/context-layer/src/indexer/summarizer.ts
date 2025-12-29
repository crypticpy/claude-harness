/**
 * File summarization utilities.
 */

import type { ParseResult } from './types';

export interface FileSummary {
  purpose: string;
  exports: string[];
  imports: string[];
  complexity: 'low' | 'medium' | 'high';
  keySymbols: string[];
}

export function generateSummary(parseResult: ParseResult, filePath: string): FileSummary {
  const exports = parseResult.exports.map(e => e.name);
  const imports = parseResult.imports.map(i => `${i.name} from ${i.source}`);
  const complexity = calculateComplexity(parseResult);
  const keySymbols = extractKeySymbols(parseResult);
  const purpose = inferPurpose(parseResult, filePath);

  return {
    purpose,
    exports,
    imports,
    complexity,
    keySymbols,
  };
}

function calculateComplexity(result: ParseResult): 'low' | 'medium' | 'high' {
  const score =
    result.functions.length * 2 +
    result.classes.length * 3 +
    result.types.length +
    result.imports.length * 0.5 +
    (result.lineCount > 300 ? 2 : 0) +
    (result.lineCount > 500 ? 3 : 0);

  if (score < 10) return 'low';
  if (score < 25) return 'medium';
  return 'high';
}

function extractKeySymbols(result: ParseResult): string[] {
  const symbols: string[] = [];

  // Add exported functions
  for (const func of result.functions.filter(f => f.isExported)) {
    symbols.push(`fn:${func.name}`);
  }

  // Add exported classes
  for (const cls of result.classes.filter(c => c.isExported)) {
    symbols.push(`class:${cls.name}`);
  }

  // Add exported types
  for (const type of result.types.filter(t => t.isExported)) {
    symbols.push(`${type.kind}:${type.name}`);
  }

  return symbols.slice(0, 10); // Limit to top 10
}

function inferPurpose(result: ParseResult, filePath: string): string {
  const parts: string[] = [];
  const filename = (filePath.split('/').pop() || '').toLowerCase();
  const dirname = filePath.split('/').slice(-2, -1)[0]?.toLowerCase() || '';

  // Infer from directory structure
  const dirPatterns: Record<string, string> = {
    'agents': 'AI agent implementation',
    'tools': 'Tool definitions',
    'api': 'API endpoints',
    'routes': 'Route handlers',
    'models': 'Data models',
    'schemas': 'Schema definitions',
    'services': 'Service layer',
    'hooks': 'Hooks/middleware',
    'components': 'UI components',
    'utils': 'Utility functions',
    'helpers': 'Helper functions',
    'lib': 'Library code',
    'core': 'Core logic',
    'config': 'Configuration',
    'tests': 'Test suite',
    '__tests__': 'Test suite',
  };

  if (dirPatterns[dirname]) {
    parts.push(dirPatterns[dirname]);
  }

  // Infer from filename patterns
  const filePatterns: Array<[RegExp, string]> = [
    [/^index\.(ts|js|py)x?$/i, 'Module entry point'],
    [/^main\.(ts|js|py)x?$/i, 'Main entry point'],
    [/types?\.(ts|d\.ts)$/i, 'Type definitions'],
    [/\.test\.|\.spec\.|_test\.|test_/i, 'Test file'],
    [/config|settings|constants/i, 'Configuration'],
    [/utils?|helpers?/i, 'Utility functions'],
    [/client/i, 'Client/SDK'],
    [/server/i, 'Server logic'],
    [/handler|controller/i, 'Request handler'],
    [/middleware/i, 'Middleware'],
    [/router?|routes?/i, 'Routing'],
    [/model|entity|schema/i, 'Data model'],
    [/service/i, 'Service layer'],
    [/factory/i, 'Factory pattern'],
    [/interface|contract/i, 'Interface definitions'],
    [/hook/i, 'Hook implementation'],
    [/provider/i, 'Provider/context'],
    [/store|state/i, 'State management'],
    [/parser|lexer/i, 'Parser/lexer'],
    [/validator|validation/i, 'Validation logic'],
    [/auth|login|session/i, 'Authentication'],
    [/security|permission/i, 'Security'],
    [/cache|memo/i, 'Caching'],
    [/queue|worker|job/i, 'Background jobs'],
    [/migration/i, 'Database migration'],
    [/seed/i, 'Database seeding'],
  ];

  for (const [pattern, label] of filePatterns) {
    if (pattern.test(filename)) {
      if (!parts.includes(label)) parts.push(label);
      break;
    }
  }

  // Infer from main class name
  if (result.classes.length > 0) {
    const mainClass = result.classes[0];
    const classPatterns: Array<[RegExp, string]> = [
      [/Agent$/i, 'AI agent'],
      [/Client$/i, 'API client'],
      [/Service$/i, 'Service class'],
      [/Controller$/i, 'Controller'],
      [/Handler$/i, 'Handler'],
      [/Manager$/i, 'Manager class'],
      [/Factory$/i, 'Factory'],
      [/Builder$/i, 'Builder pattern'],
      [/Repository$/i, 'Data repository'],
      [/Provider$/i, 'Provider'],
      [/Validator$/i, 'Validator'],
      [/Parser$/i, 'Parser'],
      [/Error$/i, 'Error definitions'],
      [/Exception$/i, 'Exception definitions'],
    ];

    for (const [pattern, label] of classPatterns) {
      if (pattern.test(mainClass.name)) {
        parts.push(label);
        break;
      }
    }
  }

  // Infer from main function names
  const mainFunctions = result.functions.filter(f =>
    /^(main|run|execute|start|init|setup|create|build|handle|process)$/i.test(f.name)
  );
  if (mainFunctions.length > 0) {
    parts.push(`Entry: ${mainFunctions.map(f => f.name + '()').join(', ')}`);
  }

  // Infer from structure
  if (result.classes.length > 0 && result.functions.length < result.classes.length) {
    if (!parts.some(p => p.includes('class'))) {
      parts.push('Class-based');
    }
  } else if (result.functions.length > 5) {
    parts.push('Function library');
  }

  if (result.types.length > result.functions.length + result.classes.length) {
    parts.push('Type-heavy');
  }

  // Check for framework patterns
  const importSources = result.imports.map(i => i.source.toLowerCase());

  const frameworkPatterns: Array<[string[], string]> = [
    [['react', '@react'], 'React component'],
    [['vue', '@vue'], 'Vue component'],
    [['express', 'fastify', 'koa', 'hono'], 'HTTP framework'],
    [['anthropic', 'claude'], 'Claude/Anthropic SDK'],
    [['openai'], 'OpenAI SDK'],
    [['prisma', 'drizzle', 'typeorm', 'sequelize'], 'ORM/database'],
    [['zod', 'yup', 'joi'], 'Schema validation'],
    [['axios', 'fetch', 'got', 'node-fetch'], 'HTTP client'],
    [['redis', 'ioredis'], 'Redis integration'],
    [['bull', 'bullmq', 'agenda'], 'Job queue'],
    [['socket.io', 'ws'], 'WebSocket'],
    [['pytest', 'unittest', 'jest', 'vitest', 'mocha'], 'Testing'],
  ];

  for (const [patterns, label] of frameworkPatterns) {
    if (importSources.some(src => patterns.some(p => src.includes(p)))) {
      if (!parts.includes(label)) parts.push(label);
    }
  }

  return parts.slice(0, 4).join(' | ') || 'General module';
}

export function formatSummaryAsText(summary: FileSummary): string {
  const lines: string[] = [];

  // Purpose is the headline
  lines.push(`📋 ${summary.purpose}`);
  lines.push(`   Complexity: ${summary.complexity}`);

  // Key symbols tell you what's in the file
  if (summary.keySymbols.length > 0) {
    lines.push('');
    lines.push('Key exports:');
    for (const sym of summary.keySymbols.slice(0, 8)) {
      lines.push(`  • ${sym}`);
    }
    if (summary.keySymbols.length > 8) {
      lines.push(`  ... +${summary.keySymbols.length - 8} more`);
    }
  }

  // Exports that aren't in keySymbols
  const exportedNotInKey = summary.exports.filter(e =>
    !summary.keySymbols.some(k => k.includes(e))
  );
  if (exportedNotInKey.length > 0) {
    lines.push('');
    lines.push(`Also exports: ${exportedNotInKey.slice(0, 5).join(', ')}${exportedNotInKey.length > 5 ? ` (+${exportedNotInKey.length - 5} more)` : ''}`);
  }

  return lines.join('\n');
}
