"use strict";
/**
 * Learn Module
 *
 * Auto-learning capabilities for the context layer.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getHotFilesFromPatterns = exports.clearPatternState = exports.getFileStats = exports.getDetectedPatterns = exports.endSession = exports.startSession = exports.recordAccess = exports.forceUnlockSync = exports.forceUnlock = exports.isFileLockedSync = exports.isFileLocked = exports.withFileLockSync = exports.withFileLock = exports.cleanupAccessLog = exports.getAccessStats = exports.recordFileAccess = void 0;
var file_tracker_1 = require("./file-tracker");
Object.defineProperty(exports, "recordFileAccess", { enumerable: true, get: function () { return file_tracker_1.recordFileAccess; } });
Object.defineProperty(exports, "getAccessStats", { enumerable: true, get: function () { return file_tracker_1.getAccessStats; } });
Object.defineProperty(exports, "cleanupAccessLog", { enumerable: true, get: function () { return file_tracker_1.cleanupAccessLog; } });
var file_lock_1 = require("./file-lock");
Object.defineProperty(exports, "withFileLock", { enumerable: true, get: function () { return file_lock_1.withFileLock; } });
Object.defineProperty(exports, "withFileLockSync", { enumerable: true, get: function () { return file_lock_1.withFileLockSync; } });
Object.defineProperty(exports, "isFileLocked", { enumerable: true, get: function () { return file_lock_1.isFileLocked; } });
Object.defineProperty(exports, "isFileLockedSync", { enumerable: true, get: function () { return file_lock_1.isFileLockedSync; } });
Object.defineProperty(exports, "forceUnlock", { enumerable: true, get: function () { return file_lock_1.forceUnlock; } });
Object.defineProperty(exports, "forceUnlockSync", { enumerable: true, get: function () { return file_lock_1.forceUnlockSync; } });
var pattern_detector_1 = require("./pattern-detector");
Object.defineProperty(exports, "recordAccess", { enumerable: true, get: function () { return pattern_detector_1.recordAccess; } });
Object.defineProperty(exports, "startSession", { enumerable: true, get: function () { return pattern_detector_1.startSession; } });
Object.defineProperty(exports, "endSession", { enumerable: true, get: function () { return pattern_detector_1.endSession; } });
Object.defineProperty(exports, "getDetectedPatterns", { enumerable: true, get: function () { return pattern_detector_1.getDetectedPatterns; } });
Object.defineProperty(exports, "getFileStats", { enumerable: true, get: function () { return pattern_detector_1.getFileStats; } });
Object.defineProperty(exports, "clearPatternState", { enumerable: true, get: function () { return pattern_detector_1.clearPatternState; } });
Object.defineProperty(exports, "getHotFilesFromPatterns", { enumerable: true, get: function () { return pattern_detector_1.getHotFilesFromPatterns; } });
//# sourceMappingURL=index.js.map