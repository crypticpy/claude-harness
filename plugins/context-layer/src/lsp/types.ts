/**
 * LSP Aggregator Types
 */

export interface Reference {
  filePath: string;
  line: number;
  character: number;
  context: string;
  referenceKind?: 'usage' | 'import' | 'export' | 'definition' | 'unknown';
}

export interface CallInfo {
  name: string;
  filePath: string;
  line: number;
  kind: 'function' | 'method' | 'constructor';
  containerName?: string;
}

export interface HoverInfo {
  type: string;
  documentation: string;
  name?: string;
  kind?: string;
}

export interface SymbolLocation {
  filePath: string;
  line: number;
  character: number;
  endLine?: number;
  endCharacter?: number;
}

export interface SymbolInfo {
  name: string;
  kind: SymbolKind;
  filePath: string;
  line: number;
  character?: number;
  containerName?: string;
  fullName?: string;
}

export type SymbolKind =
  | 'file' | 'module' | 'namespace' | 'package' | 'class'
  | 'method' | 'property' | 'field' | 'constructor' | 'enum'
  | 'interface' | 'function' | 'variable' | 'constant' | 'string'
  | 'number' | 'boolean' | 'array' | 'object' | 'key' | 'null'
  | 'enumMember' | 'struct' | 'event' | 'operator' | 'typeParameter' | 'unknown';

export interface LSPResult<T> {
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

export interface LSPConfig {
  maxFilesToSearch?: number;
  includeExtensions?: string[];
  excludeDirs?: string[];
  enableCache?: boolean;
  cacheTimeout?: number;
}

export const DEFAULT_LSP_CONFIG: Required<LSPConfig> = {
  maxFilesToSearch: 500,
  includeExtensions: ['.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.java', '.c', '.cpp', '.h', '.hpp'],
  excludeDirs: ['node_modules', '.git', 'dist', 'build', '__pycache__', 'target', '.venv', 'venv'],
  enableCache: true,
  cacheTimeout: 60000,
};

export type LanguageId =
  | 'typescript' | 'typescriptreact' | 'javascript' | 'javascriptreact'
  | 'python' | 'rust' | 'go' | 'java' | 'c' | 'cpp' | 'unknown';

export const EXTENSION_TO_LANGUAGE: Record<string, LanguageId> = {
  '.ts': 'typescript',
  '.tsx': 'typescriptreact',
  '.js': 'javascript',
  '.jsx': 'javascriptreact',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.c': 'c',
  '.cpp': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
};

export function getLanguageFromPath(filePath: string): LanguageId {
  // Guard the no-dot case: lastIndexOf('.') === -1 would make slice(-1) return
  // the final character (e.g. "Makefile" -> "e") instead of an empty extension.
  const dot = filePath.lastIndexOf('.');
  const ext = dot >= 0 ? filePath.slice(dot) : '';
  return EXTENSION_TO_LANGUAGE[ext] || 'unknown';
}
