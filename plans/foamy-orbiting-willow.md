# Implementation Plan: Recording and Transcription Pipeline Robustness Audit

Created: 2025-12-26
Status: READY FOR APPROVAL

## Summary

Comprehensive audit and fixes for the recording, file upload, and transcription pipeline to address reported failed transcriptions (especially web uploads) and improve performance on underpowered hardware.

## Critical Bugs Found

| # | Issue | File | Line | Severity |
|---|-------|------|------|----------|
| 1 | **Silence Detection Regex Bug** - Uses `\\d` instead of `\d`, so silence detection NEVER works | `lib/audio-processing.ts` | 203, 209, 210 | CRITICAL |
| 2 | **Segment Duration Bug** - Uses `+=` instead of `=`, causing wrong duration in multi-part uploads | `hooks/use-file-upload.ts` | 148 | HIGH |
| 3 | **FFmpeg Progress Overflow** - Progress can exceed 100% | `lib/audio-processing.ts` | 117 | MEDIUM |
| 4 | **No FFmpeg Cleanup on Error** - Virtual FS files not cleaned up, causing memory leak | `lib/audio-processing.ts` | 163-166 | HIGH |
| 5 | **FFmpeg Loading Race Condition** - Concurrent calls can double-load FFmpeg | `lib/audio-processing.ts` | 68-96 | HIGH |

## High-Priority Issues

| # | Issue | File | Impact |
|---|-------|------|--------|
| 6 | **No XHR Timeout** - Uploads hang indefinitely on slow networks | `hooks/use-transcription-flow.ts` | Hung requests |
| 7 | **No Diarize API Timeout** - REST API call can hang forever | `app/api/transcribe/route.ts` | Hung requests |
| 8 | **No Client-Side Retry** - Single network hiccup = total failure | `hooks/use-transcription-flow.ts` | Failed uploads |
| 9 | **Narrow Retry Detection** - Missing 504, 408, ECONNREFUSED | `app/api/transcribe/route.ts` | Missed retries |
| 10 | **Progress Stuck at 55%** - No updates during transcription | `hooks/use-transcription-flow.ts` | User thinks it failed |

## Medium-Priority Issues

| # | Issue | File |
|---|-------|------|
| 11 | No magic number file validation | `lib/validations/transcript.ts` |
| 12 | Video duration returns 0 on timeout (silent failure) | `hooks/use-file-upload.ts` |
| 13 | AudioContext memory leak on concurrent uploads | `hooks/use-file-upload.ts` |
| 15 | Segment validation too strict (rejects entire transcript) | `app/api/transcribe/route.ts` |
| 16 | Recording cleanup race condition | `hooks/use-recording.ts` |
| 17 | No minimum recording duration check | `hooks/use-recording.ts` |
| 18 | MIME type fallback not validated | `hooks/use-recording.ts` |
| 20 | Conversion threshold too low (5MB) | `lib/audio-processing.ts` |
| 21 | No storage quota warnings | `lib/db.ts` |

---

## Implementation Phases

### Phase 1: Critical Bug Fixes (Parallel)

**Agent 1A - FFmpeg Fixes**
- File: `lib/audio-processing.ts`
- Tasks:
  - Fix regex patterns (lines 203, 209, 210): `\\d` → `\d`
  - Clamp progress to 0-99 (line 117)
  - Add FFmpeg cleanup in try/finally blocks
  - Add loading promise guard to prevent race condition

**Agent 1B - Duration Fix**
- File: `hooks/use-file-upload.ts`
- Task: Fix cumulative duration logic (line 148)

### Phase 2: Network Reliability (Sequential after Phase 1)

**Agent 2A - Server-Side**
- File: `app/api/transcribe/route.ts`
- Tasks:
  - Add AbortController timeout (120s) to diarize API fetch
  - Expand retryable errors: add 504, 408, ECONNREFUSED, ETIMEDOUT

**Agent 2B - Client-Side**
- File: `hooks/use-transcription-flow.ts`
- Tasks:
  - Add XHR timeout (5 minutes)
  - Add retry wrapper with exponential backoff (3 retries)
  - Add progress simulation during transcription phase

### Phase 3: Validation & Error Recovery (Parallel)

**Agent 3A - File Validation**
- File: `lib/validations/transcript.ts`
- Task: Add magic number validation for audio files

**Agent 3B - Segment Validation**
- File: `app/api/transcribe/route.ts`
- Task: Change segment validation from error to warning (continue processing)

**Agent 3C - Duration Extraction**
- File: `hooks/use-file-upload.ts`
- Task: Return null instead of 0 on timeout, add proper warnings

### Phase 4: Performance & UX (Parallel)

**Agent 4A - Recording Hook**
- File: `hooks/use-recording.ts`
- Tasks:
  - Fix cleanup race condition with processing flag
  - Add 1-second minimum duration check
  - Validate MIME type fallback before use

**Agent 4B - Memory & Storage**
- Files: `hooks/use-file-upload.ts`, `lib/db.ts`
- Tasks:
  - Add singleton AudioContext pattern
  - Add storage quota check function

**Agent 4C - Threshold Optimization**
- File: `lib/audio-processing.ts`
- Task: Increase conversion threshold from 5MB to 10MB

---

## File Ownership Matrix

| Phase | Agent | Files (Exclusive) |
|-------|-------|-------------------|
| 1 | 1A | `lib/audio-processing.ts` |
| 1 | 1B | `hooks/use-file-upload.ts` |
| 2 | 2A | `app/api/transcribe/route.ts` |
| 2 | 2B | `hooks/use-transcription-flow.ts` |
| 3 | 3A | `lib/validations/transcript.ts` |
| 3 | 3B | `app/api/transcribe/route.ts` |
| 3 | 3C | `hooks/use-file-upload.ts` |
| 4 | 4A | `hooks/use-recording.ts` |
| 4 | 4B | `hooks/use-file-upload.ts`, `lib/db.ts` |
| 4 | 4C | `lib/audio-processing.ts` |

**Note:** Phases 3 and 4 have file overlaps - will run agents sequentially within each phase to avoid conflicts.

---

## Specific Code Changes

### Issue 1: Silence Detection Regex (CRITICAL)
```typescript
// BEFORE (line 203, 209, 210):
const startMatch = message.match(/silence_start: (\\d+(\\.\\d+)?)/);

// AFTER:
const startMatch = message.match(/silence_start: (\d+(\.\d+)?)/);
```

### Issue 5: FFmpeg Race Condition
```typescript
// Add at module level:
let ffmpegLoadingPromise: Promise<FFmpeg> | null = null;

async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance && ffmpegLoaded) return ffmpegInstance;
  if (ffmpegLoadingPromise) return ffmpegLoadingPromise;

  ffmpegLoadingPromise = (async () => {
    // ... loading logic
  })();

  try {
    return await ffmpegLoadingPromise;
  } finally {
    ffmpegLoadingPromise = null;
  }
}
```

### Issue 6: XHR Timeout
```typescript
// Add after xhr.open():
xhr.timeout = 300000; // 5 minutes
xhr.ontimeout = () => reject(new Error('Upload timed out after 5 minutes'));
```

### Issue 7: Diarize API Timeout
```typescript
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 120000);

const response = await fetch(url, {
  ...options,
  signal: controller.signal,
});
clearTimeout(timeoutId);
```

---

## Testing Strategy

1. **Regex Fix**: Unit test with sample FFmpeg silence detection output
2. **Timeouts**: Test with Chrome DevTools network throttling
3. **Retry Logic**: Simulate 503 responses, verify exponential backoff
4. **Progress**: Test long transcription, verify UI updates
5. **Recording**: Rapid start/stop, verify no audio loss
6. **Storage**: Test with limited IndexedDB quota

---

## Risk Assessment

| Phase | Risk | Mitigation |
|-------|------|------------|
| 1 | Low | Regex/progress fixes are isolated |
| 2 | Medium | Make timeout values configurable via constants |
| 3 | Low | Validation changes are additive |
| 4 | Medium | Recording race condition needs thorough testing |

---

## Success Metrics

- 50% reduction in failed transcription reports
- 90%+ success rate for web file uploads (Teams/Zoom)
- Zero hung requests (timeout protection)
- Stable memory usage in 30-minute sessions

---

## Out of Scope

- UI component redesign
- Server-side audio processing
- New feature development
- Database schema changes

---

**USER: Please review this plan. Confirm to proceed with implementation.**
