# DSP Technical Review: Spectral Limiter and True Peak Limiter Implementation

## Executive Summary

This review analyzes the spectral limiting and true peak limiting implementation in the spectral mastering web application. Overall, the implementation demonstrates solid foundational DSP concepts but has several issues that would impact professional audio quality, particularly in the true peak limiter's interpolation accuracy and the spectral limiter's overlap-add normalization.

---

## SPECTRAL LIMITER

### File: `/Users/aiml/Projects/spectral_master_bus/spectral-mastering-web/src/audio/worklets/spectral-limiter.worklet.ts`

### Algorithm Assessment: 6/10

**Rationale:**
- **Correct**: Uses Blackman-Harris window (good choice for spectral leakage rejection)
- **Correct**: Implements overlap-add synthesis with hop size of FFT_SIZE/8 (512 samples at 4096 FFT)
- **Correct**: In-place Cooley-Tukey FFT implementation with bit-reversal
- **Issue**: Normalization factor calculation may not be optimal for the chosen overlap factor

**Detailed Findings:**

1. **Overlap-Add Normalization Issue (Medium Severity)**
   - Current normalization: `FFT_SIZE / (sum of window^2)`
   - With hop size = FFT_SIZE/8, there are 8 overlapping windows contributing to each output sample
   - The Constant Overlap-Add (COLA) condition needs verification for Blackman-Harris at 87.5% overlap
   - Standard normalization for OLA is typically `1 / (sum of window[i] for overlapping frames)`

2. **Ring Buffer Read Timing (Low Severity)**
   - Line 291: `const index = (state.ringIndex + i) % FFT_SIZE;`
   - This reads the most recent FFT_SIZE samples starting from the current ring position
   - Correct, but creates FFT_SIZE - HOP_SIZE latency (3584 samples at 4096/512)

3. **Gain Application to Mirrored Bins (Correct)**
   - Lines 589-593 correctly apply gain to both positive and negative frequency bins
   - Maintains conjugate symmetry required for real-valued output

### Audio Quality: 5/10

**Rationale:**
- **Concerning**: MIN_GAIN = 0.5 is very aggressive - allows only 6dB of reduction maximum
- **Concerning**: MAX_DROP_DB_PER_HOP = -2dB per hop limits responsiveness to transients
- **Issue**: Blend parameter in worklet is redundant with dry/wet mixing in stage wrapper

**Detailed Findings:**

1. **Minimum Gain Too Conservative (High Severity)**
   ```typescript
   const MIN_GAIN = 0.5; // Increased minimum gain to prevent over-limiting
   nextGain = Math.max(MIN_GAIN, Math.min(1.02, nextGain));
   ```
   - This caps gain reduction at -6dB per bin
   - For a spectral limiter, this severely limits its ability to control problematic frequencies
   - Professional spectral limiters typically allow 12-24dB of per-bin reduction

2. **Transient Preservation Logic May Cause Pumping (Medium Severity)**
   - Lines 536-564: Complex multi-dimensional transient strength calculation
   - The protection blend formula can cause inconsistent frequency response during transients
   - May result in "underwater" or "pumping" artifacts on percussive material

3. **Double Blend/Mix Application (Bug)**
   - Worklet applies internal blend (line 270): `processedSample * blend + drySample * (1 - blend)`
   - Stage wrapper applies equal-power dry/wet crossfade (lines 148-152)
   - Results in non-linear mix behavior and potential phase issues

### Performance: 7/10

**Rationale:**
- **Good**: Pre-computed window function avoids per-sample trigonometric calls
- **Good**: O(N log N) FFT implementation
- **Good**: Telemetry throttling to ~30fps
- **Concern**: Many per-bin Float32Array allocations in processFrame

**Detailed Findings:**

1. **Allocation in Hot Path (Medium Severity)**
   ```typescript
   const isTransient = new Uint8Array(FFT_SIZE / 2); // Line 314
   ```
   - Allocates 2048 bytes every hop (512 samples / ~11.6ms at 44.1kHz)
   - Should be moved to ChannelState and reused

2. **Telemetry Array Cloning (Low Severity)**
   - Lines 620-627 clone 7 Float32Arrays per telemetry send
   - At 30fps, this is ~210 typed array allocations per second per channel
   - Consider using SharedArrayBuffer or double-buffering

3. **Good: Cached Magnitude Array (Optimization Present)**
   - Line 306-310: Pre-computes all magnitudes before main loop
   - Correctly documented as Issue 1.1 fix

### Issues Found

1. **CRITICAL: Double dry/wet mixing causes phase and level issues**
   - Internal blend in worklet + external mix in stage = unpredictable behavior

2. **HIGH: MIN_GAIN = 0.5 limits spectral control to 6dB**
   - Renders the limiter ineffective for significant peak control

3. **MEDIUM: Potential OLA normalization error**
   - May cause level fluctuations depending on signal content

4. **MEDIUM: Per-hop allocation of Uint8Array**
   - Memory pressure in real-time context

5. **LOW: Transient strength uses 10ms smoothing constant**
   - May be too slow for fast transients (snare, hi-hat)

### Recommendations (Priority Order)

1. **Remove internal blend from worklet** - let stage wrapper handle all dry/wet mixing
2. **Reduce MIN_GAIN to 0.1** (-20dB) for proper spectral limiting capability
3. **Pre-allocate isTransient array** in ChannelState
4. **Verify COLA condition** for Blackman-Harris at 87.5% overlap and adjust normalization
5. **Consider reducing FFT_SIZE to 2048** - 4096 may be overkill and adds 40ms latency

---

## TRUE PEAK LIMITER

### File: `/Users/aiml/Projects/spectral_master_bus/spectral-mastering-web/src/audio/worklets/true-peak-limiter.worklet.ts`

### Algorithm Assessment: 4/10

**Rationale:**
- **Fundamentally Flawed**: Uses linear interpolation, not proper true peak detection
- **Issue**: ITU-R BS.1770-4 requires 4x oversampling with specific FIR filter coefficients
- **Issue**: "Parabolic interpolation" on line 44-46 is mathematically incorrect

**Detailed Findings:**

1. **CRITICAL: Not True Peak Compliant (ITU-R BS.1770-4)**
   ```typescript
   function computeTruePeak(prevSample: number, currentSample: number, oversample: number): number {
     // Uses linear interpolation - INCORRECT for true peak
     const interpolated = prevSample + (currentSample - prevSample) * t;
   ```
   - True peak detection requires upsampling with a proper low-pass filter
   - Linear interpolation underestimates inter-sample peaks by up to 3dB
   - ITU-R BS.1770-4 specifies a specific 48-tap FIR filter for 4x oversampling

2. **Incorrect Parabolic Peak Estimation (Bug)**
   ```typescript
   const midSample = (prevSample + currentSample) * 0.5;
   const parabolicPeak = Math.abs(midSample + (currentSample - prevSample) * 0.125);
   ```
   - This formula has no mathematical basis for peak detection
   - Parabolic interpolation requires three points: prev, current, and next
   - Even with three points, the formula would be: `peak = current - (next-prev)^2 / (8*(next - 2*current + prev))`

3. **Two-Sample Window Insufficient (High Severity)**
   - Only considers prevSample and currentSample
   - True inter-sample peaks can occur between any samples in a sinusoidal waveform
   - Should use at least 4 samples for accurate peak detection

### Audio Quality: 5/10

**Rationale:**
- **Good**: Dual-envelope approach (fast + slow) helps prevent pumping
- **Good**: Lookahead implementation is structurally correct
- **Issue**: Hard clipping at the end defeats the purpose of soft limiting
- **Issue**: Gain interpolation coefficient (0.12) may be too aggressive for mastering

**Detailed Findings:**

1. **Hard Clip After Soft Limit (Design Flaw)**
   ```typescript
   const TRUE_PEAK_CEILING = 0.9886;
   const output = outputSample * state.gain;
   outChannel[i] = Math.max(-TRUE_PEAK_CEILING, Math.min(TRUE_PEAK_CEILING, output));
   ```
   - After carefully computing gain reduction, hard clips the output
   - This can introduce aliasing and harsh clipping artifacts
   - The limiter should ensure peaks never exceed ceiling through gain, not clipping

2. **Gain Smoothing May Cause Distortion (Medium Severity)**
   ```typescript
   state.gain += (combinedTarget - state.gain) * 0.12;
   ```
   - Fixed coefficient doesn't account for sample rate
   - At 96kHz, this will behave differently than at 44.1kHz
   - Should use time-constant-based smoothing: `exp(-1 / (attackMs/1000 * sampleRate))`

3. **Buffer Resize Loses State (Bug)**
   ```typescript
   if (delayLength !== this.bufferSize) {
     this.bufferSize = delayLength;
     this.channels.forEach((channel, idx) => {
       this.channels[idx] = createChannelState(delayLength);
     });
   }
   ```
   - When lookahead changes, entire channel state is recreated
   - Loses gain history, causing clicks and pops
   - Should preserve gain state and crossfade buffer content

### Performance: 8/10

**Rationale:**
- **Good**: Simple per-sample processing, O(1) complexity
- **Good**: Fast path for bypass mode (bulk copy)
- **Good**: Minimal allocations in process loop
- **Minor**: Could use typed array operations for bypass

**Detailed Findings:**

1. **Good: Bypass Optimization**
   ```typescript
   if (bypass) {
     outChannel.set(inChannel);
     continue;
   }
   ```
   - Uses efficient bulk copy for bypass mode

2. **Minor: Per-Sample Branching**
   - Attack/release logic uses branching per sample
   - Could be optimized with branchless min/max, but impact is minimal

### Issues Found

1. **CRITICAL: Not ITU-R BS.1770-4 compliant true peak detection**
   - Linear interpolation is fundamentally wrong for true peak
   - Will miss inter-sample peaks, allowing true peaks above ceiling

2. **CRITICAL: Mathematically incorrect "parabolic interpolation"**
   - The formula on lines 44-46 has no mathematical validity

3. **HIGH: Hard clipping after gain reduction**
   - Introduces aliasing and defeats the purpose of the limiter

4. **HIGH: Buffer resize destroys gain state**
   - Causes audible clicks when lookahead parameter changes

5. **MEDIUM: Sample-rate-independent gain smoothing**
   - Attack coefficient 0.12 behaves differently at different sample rates

### Recommendations (Priority Order)

1. **Implement proper 4x oversampling with FIR filter**
   - Use ITU-R BS.1770-4 specified filter coefficients
   - Or use a properly designed half-band filter for interpolation

2. **Remove hard clipping** - ensure the gain reduction algorithm is robust enough

3. **Use time-constant-based smoothing for all coefficients**
   ```typescript
   const attackCoeff = Math.exp(-1 / (attackMs / 1000 * sampleRate));
   ```

4. **Preserve gain state during buffer resize**
   - Copy gain/targetGain/slowGain to new state object

5. **Consider using sinc interpolation** for even more accurate true peak detection

---

## STAGE WRAPPERS

### SpectralLimiterStage.ts

**Assessment: 7/10**

**Good:**
- Equal-power crossfade for perceptually correct dry/wet mixing
- Proper latency compensation on dry path
- Telemetry callback pattern for visualization
- Robust fallback handling

**Issues:**
1. **Latency Mismatch (Bug)**
   ```typescript
   const FFT_SIZE = 2048;  // Stage uses 2048
   // Worklet uses FFT_SIZE = 4096
   ```
   - Stage declares FFT_SIZE = 2048 but worklet uses 4096
   - Latency compensation will be incorrect

2. **Mix Applied Twice**
   - Stage applies equal-power mix
   - Worklet also applies linear blend
   - Results in double mixing

### TruePeakLimiterStage.ts

**Assessment: 8/10**

**Good:**
- Clean parallel routing for dry/wet paths
- DynamicsCompressorNode fallback is reasonable
- Proper latency tracking based on lookahead

**Issues:**
1. **Fallback Limiter Not True Peak Compliant**
   - DynamicsCompressorNode is not true peak limiting
   - Should warn user that fallback mode doesn't provide true peak guarantee

2. **Latency Set to 0 When Disabled**
   ```typescript
   this.latencySamples = enabled ? Math.max(1, ...) : 0;
   ```
   - Changing latency when enabling/disabling causes timing discontinuities
   - Should maintain consistent latency regardless of enabled state

---

## OVERALL LIMITER CHAIN

### Signal Flow Assessment

**Path:** Input -> SpectralLimiter -> TruePeakLimiter -> Output

**Issues:**
1. **Spectral limiter's internal blend redundant with stage dry/wet**
2. **True peak limiter hard clips after spectral processing**
   - Any peaks introduced by spectral limiter's phase modifications are hard clipped
   - Should be soft-limited

### Gain Staging

1. **Spectral Limiter Output Level**
   - With MIN_GAIN = 0.5, maximum attenuation is -6dB
   - Spectral limiting can also boost (nextGain up to 1.02)
   - Net effect: output can be up to +0.17dB above input

2. **True Peak Ceiling**
   - Set to -0.1dBTP (0.9886 linear)
   - But detection is flawed, so true peaks may exceed this

3. **Inter-stage Level**
   - No makeup gain between stages
   - Spectral limiter's transient preservation may pass peaks to true peak stage
   - True peak stage should handle, but detection flaws compromise this

### Critical Bugs (Production Impact)

1. **True peak detection is not compliant with broadcast standards**
   - Content mastered with this limiter may be rejected by streaming platforms (Spotify, Apple Music, etc.)
   - True peak overages of 1-3dB are possible

2. **Double dry/wet mixing in spectral limiter causes level inconsistency**
   - Mix control behavior is non-linear and unpredictable

3. **FFT_SIZE mismatch between stage and worklet causes incorrect latency compensation**
   - Results in dry/wet phase cancellation at certain mix positions

4. **Hard clipping in true peak limiter introduces aliasing**
   - Mastering-grade processors should never hard clip

### Summary Recommendations

**Immediate Fixes (Before Production Use):**
1. Implement proper ITU-R BS.1770-4 true peak detection with 4x oversampling FIR filter
2. Remove internal blend from spectral limiter worklet
3. Fix FFT_SIZE constant mismatch (stage uses 2048, worklet uses 4096)
4. Remove hard clipping from true peak limiter output

**Short-term Improvements:**
5. Reduce spectral limiter MIN_GAIN to 0.1 for proper limiting headroom
6. Use sample-rate-independent time constants throughout
7. Pre-allocate arrays in hot path
8. Verify and document COLA normalization for chosen window/overlap

**Long-term Enhancements:**
9. Consider WASM implementation for true peak FIR filter (performance)
10. Add proper lookahead for spectral limiter (currently uses ring buffer as implicit lookahead)
11. Implement inter-sample peak visualization
