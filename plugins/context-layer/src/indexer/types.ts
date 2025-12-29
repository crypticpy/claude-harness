/**
 * Type definitions for the file parser and indexer system.
 */

export interface ParseResult {
  exports: ExportInfo[];
  imports: ImportInfo[];
  functions: FunctionInfo[];
  classes: ClassInfo[];
  types: TypeInfo[];
  lineCount: number;
  language: 'typescript' | 'python' | 'unknown';
  errors: string[];
}

export interface ExportInfo {
  name: string;
  kind: ExportKind;
  line: number;
  isReexport: boolean;
  originalName?: string;
}

export type ExportKind =
  | 'function' | 'class' | 'const' | 'let' | 'var'
  | 'type' | 'interface' | 'enum' | 'default'
  | 'variable' | 'namespace' | 'unknown';

export interface ImportInfo {
  name: string;
  source: string;
  isDefault: boolean;
  isNamespace: boolean;
  isTypeOnly: boolean;
  line: number;
  originalName?: string;
}

export interface FunctionInfo {
  name: string;
  line: number;
  isAsync: boolean;
  isExported: boolean;
  isGenerator: boolean;
  params: string[];
  returnType?: string;
  docstring?: string;
  decorators?: string[];
}

export interface ClassInfo {
  name: string;
  line: number;
  isExported: boolean;
  methods: string[];
  properties: string[];
  extends?: string;
  implements?: string[];
  decorators?: string[];
  isAbstract: boolean;
}

export interface TypeInfo {
  name: string;
  kind: 'type' | 'interface' | 'enum';
  line: number;
  isExported: boolean;
  extends?: string[];
  members?: string[];
}

export interface ParserOptions {
  extractDocstrings?: boolean;
  extractDecorators?: boolean;
  maxFileSize?: number;
  includeInternal?: boolean;
}

export const DEFAULT_PARSER_OPTIONS: Required<ParserOptions> = {
  extractDocstrings: true,
  extractDecorators: true,
  maxFileSize: 1024 * 1024,
  includeInternal: true,
};

export function createEmptyParseResult(language: ParseResult['language'] = 'unknown'): ParseResult {
  return {
    exports: [],
    imports: [],
    functions: [],
    classes: [],
    types: [],
    lineCount: 0,
    language,
    errors: [],
  };
}
