# FFmpeg Bug Fixes Plan for `lib/audio-processing.ts`

## Summary

This plan addresses 5 critical bugs in the audio processing pipeline that affect recording and transcription functionality.

---

## Bug 1: Silence Detection Regex (CRITICAL)

**Location**: Lines 203, 209, 210

**Problem**: The regex patterns use `\\d` (escaped backslash followed by 'd') instead of `\d` (digit character class). This means:
- The regex will NEVER match FFmpeg's silence detection output
- Silence detection always fails silently
- Audio splitting falls back to time-based splitting (less accurate)

**Current Code**:
```typescript
const startMatch = message.match(/silence_start: (\\d+(\\.\\d+)?)/);
const endMatch = message.match(/silence_end: (\\d+(\\.\\d+)?)/);
const durationMatch = message.match(/silence_duration: (\\d+(\\.\\d+)?)/);
```

**Fixed Code**:
```typescript
const startMatch = message.match(/silence_start: (\d+(\.\d+)?)/);
const endMatch = message.match(/silence_end: (\d+(\.\d+)?)/);
const durationMatch = message.match(/silence_duration: (\d+(\.\d+)?)/);
```

---

## Bug 2: FFmpeg Progress Overflow

**Location**: Line 117

**Problem**: `Math.round(progress * 100)` can exceed 100% due to FFmpeg reporting progress > 1.0 in some edge cases.

**Current Code**:
```typescript
const progressListener = ({ progress }: { progress: number }) => {
  onProgress?.(Math.round(progress * 100));
};
```

**Fixed Code**:
```typescript
const progressListener = ({ progress }: { progress: number }) => {
  onProgress?.(Math.min(99, Math.max(0, Math.round(progress * 100))));
};
```

Note: Clamped to 99 (not 100) because the function explicitly sets 100 at the end after successful completion.

---

## Bug 3: No FFmpeg Cleanup on Error

**Location**: Lines 163-166 in `convertMP4ToMP3` catch block, and lines 343-346 in `splitAudioAtSilence` catch block

**Problem**: When conversion or splitting fails, virtual FS files are not cleaned up, causing memory leaks and potential conflicts on retry.

**Fix for `convertMP4ToMP3`**:
Wrap the main logic in try/finally to ensure cleanup of input/output files.

**Fix for `splitAudioAtSilence`**:
Add similar cleanup logic for input file and any partial output files.

---

## Bug 4: FFmpeg Loading Race Condition

**Location**: Lines 68-96 in `getFFmpeg` function

**Problem**: Two concurrent `getFFmpeg()` calls can both pass the `ffmpegLoaded` check and try to load FFmpeg simultaneously, causing errors or duplicate instances.

**Current Code**:
```typescript
let ffmpegInstance: FFmpeg | null = null;
let ffmpegLoaded = false;

async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance && ffmpegLoaded) {
    return ffmpegInstance;
  }

  if (!ffmpegInstance) {
    ffmpegInstance = new FFmpeg();
  }

  if (!ffmpegLoaded) {
    // ... load FFmpeg
  }

  return ffmpegInstance;
}
```

**Fixed Code**:
```typescript
let ffmpegInstance: FFmpeg | null = null;
let ffmpegLoaded = false;
let ffmpegLoadingPromise: Promise<FFmpeg> | null = null;

async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance && ffmpegLoaded) {
    return ffmpegInstance;
  }

  if (ffmpegLoadingPromise) {
    return ffmpegLoadingPromise;
  }

  ffmpegLoadingPromise = (async () => {
    if (!ffmpegInstance) {
      ffmpegInstance = new FFmpeg();
    }

    try {
      const baseURL = '/ffmpeg-core';

      await ffmpegInstance.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      });

      ffmpegLoaded = true;
      console.log('FFmpeg loaded successfully');
      return ffmpegInstance;
    } catch (error) {
      console.error('Failed to load FFmpeg:', error);
      throw new Error(`Failed to initialize FFmpeg: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  })();

  try {
    return await ffmpegLoadingPromise;
  } finally {
    ffmpegLoadingPromise = null;
  }
}
```

---

## Bug 5: Conversion Threshold Too Low

**Location**: Line 38

**Problem**: `CONVERSION_THRESHOLD` is 5MB, which triggers conversion for moderately-sized audio files unnecessarily, adding processing overhead.

**Current Code**:
```typescript
export const CONVERSION_THRESHOLD = 5 * 1024 * 1024;
```

**Fixed Code**:
```typescript
export const CONVERSION_THRESHOLD = 10 * 1024 * 1024;
```

---

## Implementation Order

1. **Bug 5**: Simple constant change (line 38)
2. **Bug 4**: Race condition fix - add `ffmpegLoadingPromise` variable and refactor `getFFmpeg` (lines 55-96)
3. **Bug 2**: Progress clamping in `convertMP4ToMP3` (line 117)
4. **Bug 3a**: Add cleanup in `convertMP4ToMP3` (lines 106-167)
5. **Bug 1**: Fix regex patterns in `splitAudioAtSilence` (lines 203, 209, 210)
6. **Bug 3b**: Add cleanup in `splitAudioAtSilence` catch block (lines 343-346)

---

## Files Modified

- `/Users/aiml/Documents/transcriber_code/meeting-transcriber/lib/audio-processing.ts` (exclusively owned)

---

## Verification Checklist

After applying fixes:
- [ ] Regex patterns use single backslash `\d` not double `\\d`
- [ ] Progress callback values are clamped to 0-99 range
- [ ] FFmpeg virtual FS files cleaned up in finally blocks
- [ ] Loading promise guard prevents race conditions
- [ ] Conversion threshold increased to 10MB
- [ ] No syntax errors or type issues
- [ ] All other functionality preserved
