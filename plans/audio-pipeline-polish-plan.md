# Audio Pipeline Polish & Refinement Plan

## Overview

Following the Phase 1 modularization that refactored AudioEngine from 4479 to 2439 lines, this plan addresses opportunities for elegance, polish, finesse, and stability across the audio pipeline.

## Priority Categories

### P0: Critical DSP Quality Issues
Issues that affect audio fidelity and professional mastering quality.

### P1: Robustness & Reliability
Issues that could cause failures or degraded user experience.

### P2: Performance Optimizations
Improvements that enhance responsiveness and reduce resource usage.

### P3: Code Elegance & Maintainability
Refinements that improve code quality without changing behavior.

---

## P0: Critical DSP Quality Issues

### 1. True Peak Limiter Ceiling Correction
**File:** `src/audio/worklets/true-peak-limiter.worklet.ts:179`

**Issue:** Soft clipping at ±0.999 corresponds to approximately -0.0087dB, not -0.1dB. Professional mastering requires -0.1dBTP ceiling which equals ±0.9886.

**Current:**
```typescript
outChannel[i] = Math.max(-0.999, Math.min(0.999, output)); // Soft limiting at -0.1dB
```

**Fix:**
```typescript
const TRUE_PEAK_CEILING = 0.9886; // -0.1 dBTP
outChannel[i] = Math.max(-TRUE_PEAK_CEILING, Math.min(TRUE_PEAK_CEILING, output));
```

**Impact:** Ensures broadcast-compliant true peak limiting.

---

### 2. Equal-Power Crossfade for Dry/Wet Mixing
**Files:**
- `src/audio/modules/SpectralLimiterStage.ts:146-149`
- `src/audio/graph/stages/MultibandCompressorStage.ts:179-180`

**Issue:** Linear crossfade causes perceived loudness dip at 50% mix. Professional audio uses equal-power crossfade.

**Current:**
```typescript
const dryLevel = 1 - mix;
const wetLevel = mix;
```

**Fix:**
```typescript
// Equal-power crossfade for consistent perceived loudness
const dryLevel = Math.cos(mix * Math.PI * 0.5);
const wetLevel = Math.sin(mix * Math.PI * 0.5);
```

**Impact:** Smooth mix transitions without loudness artifacts.

---

### 3. K-Weighting for LUFS Metering
**File:** `src/audio/analysis/MeteringService.ts:368-380`

**Issue:** LUFS measurement lacks K-weighting filter required by ITU-R BS.1770-4 standard. Current implementation produces inaccurate LUFS readings.

**Fix:** Implement 2-stage K-weighting filter:
1. High-shelf pre-filter (+4dB @ 1681Hz)
2. High-pass filter (38Hz, Q=0.5)

Create new utility: `src/audio/dsp/kWeightingFilter.ts`

**Impact:** Broadcast-compliant LUFS metering for streaming platform targets.

---

### 4. Standardize Parameter Smoothing Time Constants
**Files:** Multiple modules with inconsistent smoothing coefficients

**Issue:** Smoothing time constants vary from 0.01 to 0.05 across modules, causing inconsistent parameter response.

**Current State:**
- Ceiling: 0.01s
- Release: 0.05s
- Mix/Blend: 0.05s
- Gain: 0.02s

**Fix:** Define standard time constants in shared utility:
```typescript
// src/audio/utils/smoothingConstants.ts
export const SMOOTHING = {
  INSTANT: 0.001,   // Critical parameters (bypass)
  FAST: 0.01,       // Level-sensitive (ceiling, threshold)
  NORMAL: 0.02,     // Standard controls (gain, mix)
  SLOW: 0.05,       // Envelope times (release)
} as const;
```

**Impact:** Consistent feel across all parameter controls.

---

## P1: Robustness & Reliability

### 5. Worklet Loading Timeout Protection
**File:** `src/audio/modules/workletLoader.ts`

**Issue:** No timeout on `audioContext.audioWorklet.addModule()`. A hung network request blocks audio initialization indefinitely.

**Fix:**
```typescript
async function loadWorkletWithTimeout(
  ctx: AudioContext,
  url: string,
  timeoutMs = 10000
): Promise<void> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    await Promise.race([
      ctx.audioWorklet.addModule(url),
      new Promise((_, reject) =>
        controller.signal.addEventListener('abort', () =>
          reject(new Error(`Worklet load timeout: ${url}`))
        )
      )
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}
```

**Impact:** Prevents indefinite hangs during worklet loading.

---

### 6. Export Rendering Timeout Protection
**File:** `src/audio/io/ExportEngine.ts`

**Issue:** `startRendering()` on OfflineAudioContext has no timeout. A processing bug could hang export indefinitely.

**Fix:** Wrap rendering in timeout:
```typescript
async function renderWithTimeout(
  offlineCtx: OfflineAudioContext,
  timeoutMs: number
): Promise<AudioBuffer> {
  return Promise.race([
    offlineCtx.startRendering(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Export render timeout')), timeoutMs)
    )
  ]);
}
```

Calculate timeout based on audio duration: `duration * 2 + 30000` (2x realtime + 30s buffer).

**Impact:** Prevents hung exports with clear error feedback.

---

### 7. AudioContext Resume Error Handling
**File:** `src/audio/core/AudioTransport.ts:192-194`

**Issue:** AudioContext resume failures are silently swallowed.

**Current:**
```typescript
if (this.context.state === 'suspended') {
  this.context.resume().catch(() => {});
}
```

**Fix:**
```typescript
if (this.context.state === 'suspended') {
  try {
    await this.context.resume();
  } catch (error) {
    logger.error('Failed to resume AudioContext:', error);
    this.emitEvent({ type: 'error', error: new Error('Audio resume failed') });
    return; // Don't proceed with playback
  }
}
```

**Impact:** Users are informed when audio playback fails to resume.

---

### 8. Worklet Retry Mechanism
**File:** `src/audio/modules/workletLoader.ts`

**Issue:** Worklet loading failures are permanent. No retry logic for transient network errors.

**Fix:** Implement exponential backoff retry:
```typescript
async function loadWorkletWithRetry(
  ctx: AudioContext,
  url: string,
  maxRetries = 3,
  baseDelay = 1000
): Promise<void> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await loadWorkletWithTimeout(ctx, url);
      return;
    } catch (error) {
      if (attempt === maxRetries) throw error;
      const delay = baseDelay * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
```

**Impact:** Resilience to transient network issues.

---

## P2: Performance Optimizations

### 9. RAF Coordinator Sorted Subscription Cache
**File:** `src/utils/rafCoordinator.ts:123-125`

**Issue:** Subscriptions are sorted O(n log n) every frame at 60fps.

**Current:**
```typescript
const sortedSubs = Array.from(this.subscriptions.values()).sort(
  (a, b) => a.priority - b.priority
);
```

**Fix:** Maintain sorted array, invalidate on subscribe/unsubscribe:
```typescript
private sortedCache: Subscription[] | null = null;

subscribe(...) {
  this.sortedCache = null; // Invalidate cache
  // ... existing logic
}

private loop = (timestamp: number) => {
  if (!this.sortedCache) {
    this.sortedCache = Array.from(this.subscriptions.values())
      .sort((a, b) => a.priority - b.priority);
  }
  for (const sub of this.sortedCache) {
    // ...
  }
}
```

**Impact:** Eliminates per-frame sort overhead.

---

### 10. True Peak Interpolation Optimization
**File:** `src/audio/worklets/true-peak-limiter.worklet.ts:31-50`

**Issue:** Current interpolation uses linear + parabolic. 4-tap sinc interpolation provides better accuracy with similar performance.

**Fix:** Replace with optimized 4-tap sinc:
```typescript
function computeTruePeak4xSinc(samples: Float32Array, index: number): number {
  // Pre-computed 4x oversampling sinc coefficients
  const SINC_COEFFS = [
    [0.0, 1.0, 0.0, 0.0],           // t=0
    [-0.0636, 0.5732, 0.5732, -0.0636], // t=0.25
    [-0.0909, 0.4545, 0.7273, -0.0909], // t=0.5
    [-0.0636, 0.2197, 0.8166, -0.0303], // t=0.75
  ];
  // ... implementation
}
```

**Impact:** More accurate true peak detection.

---

### 11. Frame Time Array Pre-allocation
**File:** `src/utils/rafCoordinator.ts:174-177`

**Issue:** Frame times array uses shift() which is O(n).

**Current:**
```typescript
this.frameTimes.push(frameTime);
if (this.frameTimes.length > 60) {
  this.frameTimes.shift();
}
```

**Fix:** Use circular buffer:
```typescript
private frameTimes = new Float32Array(60);
private frameTimeIndex = 0;

private updatePerformanceMetrics(frameTime: number): void {
  this.frameTimes[this.frameTimeIndex] = frameTime;
  this.frameTimeIndex = (this.frameTimeIndex + 1) % 60;
}
```

**Impact:** O(1) frame time tracking.

---

## P3: Code Elegance & Maintainability

### 12. Unified Error Event Type
**Files:** Multiple modules with different error event shapes

**Issue:** Each module defines its own error event structure.

**Fix:** Create shared error event type:
```typescript
// src/audio/types/events.ts
export interface AudioErrorEvent {
  type: 'error';
  code: string;
  message: string;
  module: string;
  recoverable: boolean;
  originalError?: Error;
}
```

**Impact:** Consistent error handling across modules.

---

### 13. Module State Type Refinement
**File:** `src/audio/utils/moduleState.ts`

**Issue:** Boolean `enabled` vs `bypassed` ambiguity persists in some code paths.

**Fix:** Remove `enabled` entirely, enforce `bypassed` only:
```typescript
export interface ModuleState {
  bypassed: boolean; // Only source of truth
  // Remove: enabled?: boolean
}

export function isModuleBypassed(state: ModuleState): boolean {
  return state.bypassed;
}
```

**Impact:** Single source of truth for module bypass state.

---

### 14. Dispose Pattern Consistency
**Files:** Various Stage classes

**Issue:** Some dispose methods check `this.disposed` flag, others don't.

**Fix:** Enforce consistent dispose pattern:
```typescript
// src/audio/core/DisposableBase.ts
export abstract class DisposableBase implements Disposable {
  protected disposed = false;

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.onDispose();
  }

  protected abstract onDispose(): void;
}
```

**Impact:** Prevent double-dispose bugs.

---

### 15. Worklet Test Coverage
**Files:** `src/audio/worklets/*.worklet.ts`

**Issue:** 0/12 AudioWorklet processors have unit tests.

**Fix:** Create worklet test harness:
```typescript
// src/audio/worklets/__tests__/workletTestHarness.ts
export function createMockWorkletContext(sampleRate = 48000) {
  return {
    sampleRate,
    currentTime: 0,
    // ... mock AudioWorkletGlobalScope
  };
}
```

Priority test files:
1. `true-peak-limiter.worklet.test.ts`
2. `spectral-limiter.worklet.test.ts`
3. `realtime-meter.worklet.test.ts`

**Impact:** Regression protection for critical DSP code.

---

## Implementation Order

### Phase A: DSP Quality (P0)
1. True peak ceiling correction (10 min)
2. Equal-power crossfade (20 min)
3. Standardize smoothing constants (30 min)
4. K-weighting filter for LUFS (2 hrs)

### Phase B: Robustness (P1)
5. Worklet loading timeout (30 min)
6. Export rendering timeout (20 min)
7. AudioContext resume handling (15 min)
8. Worklet retry mechanism (45 min)

### Phase C: Performance (P2)
9. RAF sorted subscription cache (30 min)
10. True peak sinc interpolation (1 hr)
11. Frame time circular buffer (15 min)

### Phase D: Code Quality (P3)
12. Unified error event type (30 min)
13. Module state type refinement (20 min)
14. Dispose pattern base class (45 min)
15. Worklet test coverage (3 hrs)

---

## Verification Checklist

After implementation:

- [ ] All 12 worklets load without timeout
- [ ] Export completes with progress feedback
- [ ] AudioContext resume shows error toast on failure
- [ ] LUFS readings match reference meter (±0.3 LU)
- [ ] True peak never exceeds -0.1 dBTP
- [ ] Mix slider produces consistent loudness at 50%
- [ ] Parameter changes feel responsive and consistent
- [ ] RAF stats show 60fps with <16ms frame time
- [ ] TypeScript compiles with no errors
- [ ] All existing tests pass
