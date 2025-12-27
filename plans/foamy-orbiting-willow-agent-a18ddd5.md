# Implementation Plan: Network Reliability Fixes for Transcription Route

## File Ownership
- **Exclusive ownership:** `app/api/transcribe/route.ts`

## Issues to Fix

### Issue 1: Add Fetch Timeout to Diarize API Call

**Location:** `transcribeDiarizeDirectAPI` function, lines 141-147

**Current Code:**
```typescript
const response = await fetch(url, {
  method: 'POST',
  headers: {
    'api-key': apiKey,
  },
  body: formData,
});
```

**Fix:** Add AbortController with 120-second timeout

**Implementation:**
```typescript
// Create AbortController for timeout handling
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 minute timeout

try {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'api-key': apiKey,
    },
    body: formData,
    signal: controller.signal,
  });
  clearTimeout(timeoutId);

  // ... rest of existing response handling
} catch (error) {
  clearTimeout(timeoutId);
  if (error instanceof Error && error.name === 'AbortError') {
    throw new Error('Diarization request timed out after 120 seconds');
  }
  throw error;
}
```

---

### Issue 2: Expand Retry Detection in isRetryableError

**Location:** `isRetryableError` function, lines 551-578

**Current patterns checked:**
- `network`, `timeout`, `econnreset`, `enotfound`
- `rate limit`, `429`
- `500`, `502`, `503`

**Missing patterns to add:**
- `504` (Gateway Timeout)
- `408` (Request Timeout)
- `econnrefused`
- `etimedout`
- `abort` / `AbortError` (for timeout aborts)

**Implementation:**
```typescript
function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();

  // Network errors are retryable
  if (
    message.includes('network') ||
    message.includes('timeout') ||
    message.includes('econnreset') ||
    message.includes('enotfound') ||
    message.includes('econnrefused') ||
    message.includes('etimedout')
  ) {
    return true;
  }

  // Abort errors (from timeout) are retryable
  if (error.name === 'AbortError' || message.includes('abort')) {
    return true;
  }

  // Rate limit errors are retryable (429)
  if (message.includes('rate limit') || message.includes('429')) {
    return true;
  }

  // Server errors (5xx) are retryable
  if (
    message.includes('500') ||
    message.includes('502') ||
    message.includes('503') ||
    message.includes('504')
  ) {
    return true;
  }

  // Request timeout (408) is retryable
  if (message.includes('408')) {
    return true;
  }

  // Default: not retryable
  return false;
}
```

---

### Issue 3: Relax Segment Validation - Log Warning Instead of Error

**Location:** Lines 803-821

**Current behavior:** Returns error response when segment validation fails

**Current Code:**
```typescript
// Validate segments
const segmentValidation = validateSegments(segments, {
  allowOverlaps: allowSegmentOverlaps,
  overlapEpsilon: 0.05,
  minDuration: 0.001,
});
if (!segmentValidation.valid) {
  console.error('[Transcribe] Segment validation failed:', segmentValidation.errors);
  return errorResponse(
    'Transcription produced invalid segments.',
    500,
    {
      type: 'validation_error',
      errors: segmentValidation.errors,
      ...(sanitationWarnings.length > 0
        ? { warnings: sanitationWarnings }
        : {}),
    }
  );
}
```

**Fix:** Change to warning log and continue processing

**Implementation:**
```typescript
// Validate segments - log warnings but don't fail the request
const segmentValidation = validateSegments(segments, {
  allowOverlaps: allowSegmentOverlaps,
  overlapEpsilon: 0.05,
  minDuration: 0.001,
});
if (!segmentValidation.valid) {
  // Log validation issues as warnings, but continue processing with valid segments
  console.warn('[Transcribe] Segment validation warnings (continuing with available segments):', {
    errors: segmentValidation.errors,
    segmentCount: segments.length,
    ...(sanitationWarnings.length > 0 ? { sanitationWarnings } : {}),
  });
}
```

---

## Execution Checklist

- [ ] Apply Issue 1 fix: Add AbortController timeout to `transcribeDiarizeDirectAPI`
- [ ] Apply Issue 2 fix: Expand `isRetryableError` with additional patterns
- [ ] Apply Issue 3 fix: Change segment validation from error to warning
- [ ] Verify no syntax errors
- [ ] Confirm all imports are present (none needed - AbortController is global)

## Notes

- AbortController is a global Web API, no imports needed
- The 120-second timeout aligns with typical long-running transcription operations
- Segment validation relaxation allows partial transcriptions to succeed
