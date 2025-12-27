# Implementation Plan: Network Reliability Fixes for use-transcription-flow.ts

## Overview

This plan addresses three network reliability issues in the transcription flow hook:
1. No XHR timeout (requests hang indefinitely)
2. No client-side retry logic (single network error = total failure)
3. Progress stuck at 55% during transcription phase

## File Ownership

- **File**: `/Users/aiml/Documents/transcriber_code/meeting-transcriber/hooks/use-transcription-flow.ts`
- **Exclusive ownership**: Yes

---

## Issue 1: Add XHR Timeout

### Current State
- Lines 252-318: XMLHttpRequest is created and configured
- No `xhr.timeout` is set
- No `ontimeout` handler exists

### Fix Required
After line 253 (`xhrRef.current = xhr;`), add:
```typescript
// Set 5-minute timeout for slow networks
xhr.timeout = 300000; // 5 minutes
xhr.ontimeout = () => {
  xhrRef.current = null;
  reject(new Error('Upload timed out after 5 minutes. Please check your connection and try again.'));
};
```

---

## Issue 2: Add Client-Side Retry Logic

### Current State
- The `startTranscription` function (lines 202-359) makes a single XHR request
- No retry mechanism exists on the client side
- A single network hiccup causes total failure

### Fix Required

1. **Add `withRetry` helper function** before the `useTranscriptionFlow` hook definition (before line 136):

```typescript
/**
 * Retry wrapper with exponential backoff for network resilience
 *
 * @param fn - Async function to retry
 * @param maxRetries - Maximum number of retry attempts (default: 3)
 * @param baseDelay - Base delay in ms between retries (default: 2000)
 * @returns Result of the function or throws the last error
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 2000
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Determine if error is retryable (network/timeout issues)
      const message = lastError.message.toLowerCase();
      const isRetryable =
        message.includes('network') ||
        message.includes('timeout') ||
        message.includes('timed out') ||
        message.includes('503') ||
        message.includes('502') ||
        message.includes('504') ||
        message.includes('abort');

      // Don't retry non-retryable errors or on last attempt
      if (!isRetryable || attempt === maxRetries - 1) {
        throw lastError;
      }

      // Exponential backoff: 2s, 4s, 8s
      const delay = baseDelay * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
```

2. **Wrap the XHR Promise with `withRetry`** around lines 251-319:

The XHR promise creation needs to be wrapped so that the entire upload/transcribe operation can be retried on network failures.

---

## Issue 3: Progress Simulation During Transcription

### Current State
- Line 269-275: After upload completes, status changes to 'transcribing' with progress at 55%
- Progress never updates again until completion at 100%
- User sees progress stuck at 55% during potentially long transcription

### Fix Required

1. **Add a ref to track the progress interval** near other refs (after line 154):
```typescript
// Progress simulation interval for transcription phase
const progressIntervalRef = React.useRef<NodeJS.Timeout | null>(null);
```

2. **Add cleanup for the interval** in `reset` function (after line 175) and `cancelTranscription` (after line 190).

3. **Add cleanup in useEffect** (lines 364-373).

4. **Start progress simulation** after upload completes (inside the `xhr.upload.addEventListener('load', ...)` handler around line 269):
```typescript
// Start progress simulation during transcription
let simulatedProgress = 55;
progressIntervalRef.current = setInterval(() => {
  if (simulatedProgress < 95) {
    simulatedProgress += Math.random() * 5 + 2; // Random 2-7% increment
    simulatedProgress = Math.min(simulatedProgress, 95);
    updateState({
      progress: Math.round(simulatedProgress),
      message: `Transcribing audio... ${Math.round(simulatedProgress)}%`,
    });
  }
}, 3000); // Update every 3 seconds
```

5. **Clear interval on completion** in the `xhr.addEventListener('load', ...)` handler (around line 278):
```typescript
// Clear progress simulation
if (progressIntervalRef.current) {
  clearInterval(progressIntervalRef.current);
  progressIntervalRef.current = null;
}
```

6. **Clear interval on error/abort** handlers as well.

---

## Implementation Checklist

- [ ] Add `progressIntervalRef` ref declaration
- [ ] Update `reset` function to clear progress interval
- [ ] Update `cancelTranscription` function to clear progress interval
- [ ] Update `useEffect` cleanup to clear progress interval
- [ ] Add `withRetry` helper function with exponential backoff
- [ ] Add XHR timeout configuration (5 minutes)
- [ ] Add `xhr.ontimeout` handler
- [ ] Add progress simulation in upload 'load' handler
- [ ] Clear progress interval in XHR 'load' handler (success)
- [ ] Clear progress interval in XHR 'error' handler
- [ ] Clear progress interval in XHR 'abort' handler
- [ ] Wrap XHR Promise with `withRetry` for network resilience

---

## Risks and Considerations

1. **Retry on user cancellation**: The retry logic should NOT retry when user explicitly cancels. The current `abort` error message check handles this.

2. **Interval cleanup**: Must ensure interval is cleaned up in ALL exit paths (success, error, abort, component unmount).

3. **State updates after unmount**: The progress interval could potentially update state after unmount. The existing abort pattern should handle this, but cleanup is critical.

4. **Progress simulation accuracy**: The simulated progress (55-95%) is purely cosmetic but provides better UX than a stuck progress bar.
