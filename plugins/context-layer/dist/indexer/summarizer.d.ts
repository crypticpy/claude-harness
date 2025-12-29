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
export declare function generateSummary(parseResult: ParseResult, filePath: string): FileSummary;
export declare function formatSummaryAsText(summary: FileSummary): string;
//# sourceMappingURL=summarizer.d.ts.map