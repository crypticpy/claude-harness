"use strict";
/**
 * Type definitions for the file parser and indexer system.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_PARSER_OPTIONS = void 0;
exports.createEmptyParseResult = createEmptyParseResult;
exports.DEFAULT_PARSER_OPTIONS = {
    extractDocstrings: true,
    extractDecorators: true,
    maxFileSize: 1024 * 1024,
    includeInternal: true,
};
function createEmptyParseResult(language = 'unknown') {
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
//# sourceMappingURL=types.js.map