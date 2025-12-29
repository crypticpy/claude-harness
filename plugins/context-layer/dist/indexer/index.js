"use strict";
/**
 * Indexer Module
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveIndexState = exports.loadIndexState = exports.clearIndexState = exports.getIndexStatus = exports.shouldIndex = exports.triggerActiveIndex = exports.formatSummaryAsText = exports.generateSummary = exports.getLanguageFromExtension = exports.parseFile = exports.createEmptyParseResult = exports.DEFAULT_PARSER_OPTIONS = void 0;
var types_1 = require("./types");
Object.defineProperty(exports, "DEFAULT_PARSER_OPTIONS", { enumerable: true, get: function () { return types_1.DEFAULT_PARSER_OPTIONS; } });
Object.defineProperty(exports, "createEmptyParseResult", { enumerable: true, get: function () { return types_1.createEmptyParseResult; } });
var parser_1 = require("./parser");
Object.defineProperty(exports, "parseFile", { enumerable: true, get: function () { return parser_1.parseFile; } });
Object.defineProperty(exports, "getLanguageFromExtension", { enumerable: true, get: function () { return parser_1.getLanguageFromExtension; } });
var summarizer_1 = require("./summarizer");
Object.defineProperty(exports, "generateSummary", { enumerable: true, get: function () { return summarizer_1.generateSummary; } });
Object.defineProperty(exports, "formatSummaryAsText", { enumerable: true, get: function () { return summarizer_1.formatSummaryAsText; } });
var active_indexer_1 = require("./active-indexer");
Object.defineProperty(exports, "triggerActiveIndex", { enumerable: true, get: function () { return active_indexer_1.triggerActiveIndex; } });
Object.defineProperty(exports, "shouldIndex", { enumerable: true, get: function () { return active_indexer_1.shouldIndex; } });
Object.defineProperty(exports, "getIndexStatus", { enumerable: true, get: function () { return active_indexer_1.getIndexStatus; } });
Object.defineProperty(exports, "clearIndexState", { enumerable: true, get: function () { return active_indexer_1.clearIndexState; } });
Object.defineProperty(exports, "loadIndexState", { enumerable: true, get: function () { return active_indexer_1.loadIndexState; } });
Object.defineProperty(exports, "saveIndexState", { enumerable: true, get: function () { return active_indexer_1.saveIndexState; } });
//# sourceMappingURL=index.js.map