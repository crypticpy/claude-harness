# Fix Audio Duration Validation and Progress Display

## Problem Summary

### Bug 1: Duration Validation Not Triggering After Conversion
- **Symptom**: Audio files >1500 seconds fail with "Audio duration exceeds maximum" instead of being auto-split
- **Root Cause**: `uploadFile()` in `use-file-upload.ts` calls `getFileProcessingStrategy()` WITHOUT passing the known duration. For WebM files, metadata extraction fails (returns `duration: 0`), causing `estimatedDuration` to be `null`, which bypasses the split logic.
- **Location**: `hooks/use-file-upload.ts` line 485

### Bug 2: Decimal Display in Upload Progress
- **Symptom**: Progress percentage briefly shows 10-digit decimal values (e.g., "34.55555555%")
- **Root Cause**: Upload progress calculation `30 + (uploadPercent * 0.1)` produces decimals, but unlike other stages, doesn't use `Math.round()` before setting state.
- **Location**: `hooks/use-file-upload.ts` line 573-581

## Implementation Plan

### Fix 1: Pass Duration to Processing Strategy During Upload

**File**: `hooks/use-file-upload.ts`

**Change at line ~485** (in `uploadFile()` function):
```typescript
// BEFORE:
const strategy = await getFileProcessingStrategy(state.file);

// AFTER:
const strategy = await getFileProcessingStrategy(state.file, state.audioMetadata?.duration);
```

This ensures the known duration from metadata extraction (which succeeded during `selectFile()`) is passed through to the processing strategy calculation during upload.

### Fix 2: Round Upload Progress to Whole Numbers

**File**: `hooks/use-file-upload.ts`

**Change at line ~573-581** (in the upload XMLHttpRequest progress handler):
```typescript
// BEFORE:
const adjustedProgress = 30 + (uploadPercent * 0.1);
// ...
const uploadingProgress: TranscriptionProgress = {
  status: 'uploading',
  progress: safeAdjustedProgress,
  // ...
};

// AFTER:
const adjustedProgress = 30 + (uploadPercent * 0.1);
// ...
const uploadingProgress: TranscriptionProgress = {
  status: 'uploading',
  progress: Math.round(safeAdjustedProgress),
  // ...
};
```

This makes the upload stage consistent with processing and transcription stages, which already use `Math.round()`.

## Files to Modify

1. **`hooks/use-file-upload.ts`**
   - Line ~485: Add duration parameter to `getFileProcessingStrategy()` call
   - Line ~581: Add `Math.round()` to progress value

## Testing Checklist

1. Upload a WebM recording >25 minutes (1500+ seconds)
   - Should see "Splitting audio file" message during processing
   - Should complete successfully with merged transcript parts
2. Monitor upload progress display
   - Should only show whole number percentages (no decimals)
   - Progress should smoothly increment from 0% to 100%
