/**
 * Regex-based parser for TypeScript and Python files.
 */
import type { ParseResult, ParserOptions } from './types';
export declare function parseFile(content: string, filePath: string, options?: ParserOptions): ParseResult;
export declare function getLanguageFromExtension(ext: string): ParseResult['language'];
//# sourceMappingURL=parser.d.ts.map