# Performance Audit & Optimization Plan

Created: 2025-11-29
Status: PENDING APPROVAL

## Summary

Comprehensive audit of the WebAudio engine and React interface identified **15 critical performance issues** that could cause resource consumption, audio glitches, UI lag, and hangs. The issues cluster into 5 categories: render loop proliferation, high-frequency React state updates, worklet message overhead, missing memoization, and console logging in hot paths.

## Scope

### In Scope
- RAF loop consolidation (20+ independent loops → 1 coordinator)
- setInterval polling optimization (4 competing intervals)
- React state update throttling (60Hz → appropriate rates)
- Worklet telemetry optimization (7 array copies per frame)
- Console logging removal from hot paths (500+ calls across 87 files)
- Missing React.memo/useMemo/useCallback additions

### Out of Scope
- DSP algorithm changes (already in worklets)
- Major architectural refactoring
- New feature development

## Prerequisites
- TypeScript compilation passing
- Existing tests passing

---

## Critical Issues Identified

### CRITICAL (Immediate Performance Impact)

| Issue | Location | Impact |
|-------|----------|--------|
| 20+ independent RAF loops | Multiple visualizers | 20x RAF scheduling overhead |
| 4 competing setInterval loops | MultibandProcessor, AudioEngineAdapter | Timer contention, React thrash |
| 60Hz state updates to React | use-audio-engine.ts:216-253 | Constant re-renders |
| 7 Float32Array copies per telemetry | spectral-limiter.worklet.ts:620-627 | Memory churn in hot path |
| console.debug in 20fps loop | MultibandProcessor.tsx:237-241 | I/O blocking |

### HIGH (Noticeable Performance Impact)

| Issue | Location | Impact |
|-------|----------|--------|
| Spectrum history array spread | use-audio-engine.ts:218-221 | O(n) copy every frame |
| Missing React.memo on visualizers | LaserViewSimple, MultibandProcessor | Unnecessary re-renders |
| Zustand Map identity churn | AudioEngineState.ts | Wide subscriber re-renders |
| Unthrottled mouse handlers | LaserView.tsx:81-98 | CPU spike on drag |

### MEDIUM (Cumulative Impact)

| Issue | Location | Impact |
|-------|----------|--------|
| Linear search on 34 frequencies | LaserView snapFrequency | O(n) per mousemove |
| Blob URL never revoked | PerformanceOptimizer.ts:264 | Memory leak |
| AnalyserNodes with 0 smoothing | ProcessingGraph.ts:111-114 | Higher CPU |

---

## Implementation Phases

### Phase 1: Kill Console Logging in Hot Paths
**Objective**: Eliminate I/O blocking from performance-critical code

**Files to Modify**:
- `src/modules/multiband-compressor/ui/MultibandProcessor.tsx` - Remove console.debug at line 241
- Multiple files with console.* in loops (see grep results)

**Steps**:
1. Search for console.debug/log in setInterval callbacks and RAF loops
2. Remove or gate behind `process.env.NODE_ENV === 'development'`
3. Use logger utility which already has production guards

**Verification**:
- [ ] No console.* calls in setInterval or RAF callbacks
- [ ] Logger utility used instead where needed

---

### Phase 2: Consolidate setInterval Loops
**Objective**: Reduce 4 competing intervals to coordinated updates

**Files to Modify**:
- `src/modules/multiband-compressor/adapters/AudioEngineAdapter.ts:46` - 30fps gain reduction
- `src/modules/multiband-compressor/ui/MultibandProcessor.tsx:231` - 20fps spectrum
- `src/modules/multiband-compressor/ui/MultibandProcessor.tsx:580` - 10fps metering

**Steps**:
1. Create shared update coordinator using existing telemetryThrottle pattern
2. Consolidate spectrum + gain reduction + metering into single interval
3. Use RAF callback for visual updates instead of setInterval
4. Batch React state updates using unstable_batchedUpdates or flushSync

**New File to Create**:
- `src/modules/multiband-compressor/core/UpdateCoordinator.ts` - Unified update timing

**Verification**:
- [ ] Only 1 setInterval for multiband module updates
- [ ] React DevTools shows reduced render count

---

### Phase 3: Migrate Visualizers to RAF Coordinator
**Objective**: Consolidate 20+ independent RAF loops into central coordinator

**Files to Modify**:
- `src/components/LUFSMeter.tsx` - Replace direct RAF with useRAFCallback
- `src/components/LaserView.tsx` - Replace direct RAF with useRAFCallback
- `src/components/ProfessionalSpectrumAnalyzer.tsx` - Replace direct RAF
- `src/modules/saturation/ui/FillingJarMeter.tsx` - Replace direct RAF
- `src/modules/stereo-imaging/visualization/2d/StereoVectorscope.tsx` - Replace direct RAF
- `src/modules/stereo-imaging/visualization/2d/CorrelationMeter.tsx` - Replace direct RAF
- `src/modules/multiband-compressor/ui/SpectrumDisplay.tsx` - Replace direct RAF
- `src/modules/multiband-compressor/ui/components/MultibandBarsView.tsx` - Replace direct RAF
- `src/modules/saturation/ui/components/HarmonicSpectrum.tsx` - Replace direct RAF
- `src/modules/limiter/ui/components/LimiterVisualizerV2.tsx` - Replace direct RAF

**Pattern to Apply**:
```typescript
// Before
const animationRef = useRef<number>(0);
useEffect(() => {
  const loop = () => {
    draw();
    animationRef.current = requestAnimationFrame(loop);
  };
  animationRef.current = requestAnimationFrame(loop);
  return () => cancelAnimationFrame(animationRef.current);
}, []);

// After
import { useRAFCallback } from '@/utils/rafCoordinator';
useRAFCallback((timestamp, deltaTime) => {
  draw();
}, 50, 'ComponentName'); // priority 50
```

**Verification**:
- [ ] rafCoordinator.getSubscriberCount() shows consolidated loops
- [ ] No direct requestAnimationFrame calls in visualization components

---

### Phase 4: Throttle React State Updates
**Objective**: Reduce 60Hz state updates to appropriate UI refresh rates

**Files to Modify**:
- `src/hooks/use-audio-engine.ts:216-224` - Throttle spectrum updates

**Steps**:
1. Add throttling to handleSpectrumData callback (30Hz is enough for visualizers)
2. Use ref for high-frequency data, state only for display updates
3. Implement circular buffer for spectrum history instead of array spread

**Pattern to Apply**:
```typescript
// Before
const handleSpectrumData = useCallback((data: SpectralData) => {
  setSpectrumData(data);  // 60Hz to React!
  setSpectrumHistory((prev) => {
    const next = [...prev, data];  // O(n) spread
    return next.length > 180 ? next.slice(next.length - 180) : next;
  });
}, []);

// After
const spectrumDataRef = useRef<SpectralData | null>(null);
const spectrumHistoryRef = useRef<SpectralData[]>([]);
const throttle = useRef(new TelemetryThrottle(30)); // 30Hz for UI

const handleSpectrumData = useCallback((data: SpectralData) => {
  spectrumDataRef.current = data;
  // Circular buffer update
  const history = spectrumHistoryRef.current;
  if (history.length >= 180) history.shift();
  history.push(data);

  // Only update React state at throttled rate
  if (throttle.current.shouldEmit()) {
    setSpectrumData(data);
  }
}, []);
```

**Verification**:
- [ ] React DevTools shows <30 state updates per second for spectrum

---

### Phase 5: Optimize Worklet Telemetry
**Objective**: Reduce 7 array copies per telemetry message

**Files to Modify**:
- `src/audio/worklets/spectral-limiter.worklet.ts:619-643`

**Steps**:
1. Use Transferable objects for Float32Arrays (zero-copy transfer)
2. Send only changed data (delta compression)
3. Reduce telemetry frequency if needed

**Pattern to Apply**:
```typescript
// Before (7 copies)
const transientCopy = new Float32Array(state.transientDetection);
// ... 6 more copies
this.port.postMessage(telemetry);

// After (zero-copy transfer)
const telemetry = {
  type: 'spectral-telemetry',
  transientIntensity: state.transientDetection,
  // ... (reuse arrays, don't copy)
  timestamp: now,
};
this.port.postMessage(telemetry, [
  state.transientDetection.buffer,
  state.resonanceDetection.buffer,
  // ... transfer all buffers
]);
// Then reallocate on worklet side for next frame
```

**Verification**:
- [ ] Memory profiler shows reduced allocation rate in worklet
- [ ] No audio glitches after change

---

### Phase 6: Add Missing Memoization
**Objective**: Prevent unnecessary re-renders in high-frequency components

**Files to Modify**:
- `src/components/LaserViewSimple.tsx` - Wrap with React.memo
- `src/modules/multiband-compressor/ui/MultibandProcessor.tsx` - Memoize child components
- `src/components/MultiBandPanel.tsx` - Memoize band item components

**Steps**:
1. Add React.memo to visualization components that receive frequently-changing props
2. Add useMemo for derived data (filtered presets, computed values)
3. Add useCallback for event handlers passed to children

**Verification**:
- [ ] React DevTools Profiler shows reduced render counts

---

### Phase 7: Fix Mouse Handler Throttling
**Objective**: Prevent CPU spikes during drag operations

**Files to Modify**:
- `src/components/LaserView.tsx:81-98` - Throttle snapFrequency calls

**Steps**:
1. Throttle mousemove handler to 60fps max
2. Cache frequency snap calculations
3. Use requestAnimationFrame for drag updates

**Pattern to Apply**:
```typescript
// Throttle mousemove to 60fps
const lastMoveTime = useRef(0);
const handleMouseMove = useCallback((e: MouseEvent) => {
  const now = performance.now();
  if (now - lastMoveTime.current < 16) return; // 60fps max
  lastMoveTime.current = now;
  // ... existing logic
}, []);
```

**Verification**:
- [ ] CPU usage stable during LaserView drag operations

---

## Testing Strategy

### Performance Tests
1. **Before/After Metrics**:
   - Measure RAF callback count (should be 1 vs 20+)
   - Measure React render count per second
   - Measure memory allocation rate in worklets
   - Profile CPU usage during playback

2. **Manual Testing**:
   - Play audio for 5 minutes, verify no memory growth
   - Drag on LaserView, verify smooth 60fps
   - Open multiband compressor, verify UI responsiveness

3. **Existing Tests**:
   - Run `pnpm test` to verify no regressions

## Rollback Plan
- Each phase is independent and can be reverted individually
- Git commits should be atomic per phase
- Keep original code in comments if needed for quick revert

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Transferable buffers cause audio glitch | Medium | High | Test thoroughly, keep copy fallback |
| RAF coordinator timing differences | Low | Medium | Test all visualizers after migration |
| Throttled updates feel laggy | Low | Medium | Tune throttle rates per component |
| State desync with refs | Medium | Medium | Careful sync points, clear documentation |

## Open Questions
- Should spectrum history be moved entirely to refs (no React state)?
- Is 30Hz throttle rate acceptable for all visualizers?
- Should we consider Web Workers for heavy visualization calculations?

---
**USER: Please review this plan. Edit any section directly in this file, then confirm to proceed.**
