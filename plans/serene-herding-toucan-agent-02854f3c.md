# DSP Technical Review: EQ and Multiband Dynamics Implementation

## Review Scope
- `eq-mastering.worklet.ts` - Advanced mastering EQ with oversampling, phase modes, dynamics
- `eq-enhance.worklet.ts` - Enhancement EQ worklet
- `multiband-expander.worklet.ts` - Multiband upward expander
- `EQTameStage.ts` - EQ tame stage module
- `EQEnhanceStage.ts` - EQ enhance stage module
- `MultiBandExpanderStage.ts` - Expander stage module

---

## EQ MODULES (TAME + ENHANCE)

### Filter Algorithm: 7/10

**Strengths:**
- Correct RBJ cookbook biquad coefficient formulas for bell, shelf, and notch filters
- Proper `A = 10^(gainDb/40)` calculation for parametric EQ
- Frequency clamping to avoid instability near Nyquist (`freq < sampleRate * 0.48`)
- Q clamping between 0.1-50 prevents unstable filters
- Cascaded tilt filter implementation using two opposing shelf filters is mathematically sound

**Issues Found:**
1. **Direct Form I biquad implementation** - While functional, this form is less numerically stable than Transposed Direct Form II, especially for narrow Q filters at low frequencies. The repeated division by `a0` on every sample is inefficient.

2. **Linear phase FIR kernel design has issues** (lines 633-662):
   - The sinc windowing approach is overly simplified
   - The kernel normalization logic at line 650-658 can produce incorrect results when `sum === 0`
   - For a proper linear phase EQ, you need FFT-based convolution or significantly longer FIR taps (256-512 minimum for precision)

3. **Shelf filter transition frequency** (line 94, 577): Using `freq < 1000` as low/high shelf cutoff is arbitrary and creates discontinuity at exactly 1000Hz. Should use a more graceful transition or make this configurable.

4. **Missing filter stability check**: No verification that poles lie within unit circle after coefficient calculation.

### Audio Quality: 6/10

**Strengths:**
- Oversampling implementation (2x, 4x) with half-band FIR anti-aliasing filters
- Support for M/S stereo processing preserves proper phase relationships
- Envelope follower with attack/release/hold/hysteresis is comprehensive

**Issues Found:**
1. **Half-band filter coefficients** (lines 86-102): The 15-tap FIR is extremely short for proper anti-aliasing. This will allow significant aliasing at 2x oversampling. Professional implementations use 63+ taps for half-band filters.

2. **Linear phase kernel** (lines 633-662): Only 129-193 taps is insufficient for accurate frequency response. At 48kHz with 129 taps, frequency resolution is ~375Hz - too coarse for mastering EQ.

3. **Gain compensation after filtering** in `eq-enhance.worklet.ts` (lines 359-370): The post-processing gain match using RMS ratio can introduce pumping artifacts on dynamic material. The 0.4-2.5 clamp range is also too wide.

4. **Saturation aliasing**: The `applySaturation()` function (lines 141-159) applies nonlinear waveshaping but is NOT inside the oversampling path when used at band level. The tanh/polynomial saturation generates harmonics that will alias back into the audio band.

5. **Missing DC blocking**: No highpass filter to remove DC offset that can accumulate through filtering chains.

### Performance: 8/10

**Strengths:**
- TypedArray usage throughout (Float32Array)
- Bypass path uses efficient `TypedArray.set()` for bulk copy
- Scratch buffers are reused, not reallocated per block
- Telemetry is properly decimated to avoid main thread flooding
- Pre-computed time constants avoid repeated exponential calculations

**Issues Found:**
1. **Division by a0 on every sample** (lines 337-340): Should pre-normalize coefficients once during setup: `b0/=a0; b1/=a0; b2/=a0; a1/=a0; a2/=a0` then remove all divisions from `processSample()`.

2. **FIR convolution is naive O(N)** per sample (lines 180-192, 364-376): For the FIR filter and oversampling, FFT-based convolution would be more efficient for kernels >64 taps.

3. **Per-sample envelope follower calls** with multiple conditionals in the inner loop could be optimized with branch prediction hints or restructured code.

### Critical Issues for EQ Modules:

1. **PHASE COHERENCE RISK**: The `eq-enhance.worklet.ts` processes channels independently with per-channel envelope detectors (lines 254-257). For stereo material, this can cause left/right to have different dynamic gain, destroying stereo image. The mastering worklet correctly uses linked detection.

2. **Missing coefficient interpolation**: When filter parameters change, coefficients update instantly which can cause clicks/pops. Need zipper-noise prevention via coefficient smoothing.

3. **Oversampling latency calculation** is approximate (lines 219-232 in stages). The actual latency depends on FIR group delay which should be reported from worklet, not estimated.

---

## MULTIBAND EXPANDER

### Crossover Design: 3/10

**Critical Issues:**

1. **FUNDAMENTAL ARCHITECTURE FLAW**: This is NOT a proper multiband processor. It uses bandpass filters to isolate bands, then SUMS them together (line 306: `outL[i] += processed`). This approach:
   - Does NOT reconstruct the original signal when bands are summed
   - Creates massive phase cancellation at crossover frequencies
   - Will introduce comb filtering artifacts

2. **Single biquad bandpass per band** (lines 94-105): A single 2nd-order bandpass has only 12dB/octave slopes, creating severe overlap between bands. Professional multiband uses Linkwitz-Riley crossovers (24dB/octave or steeper) with complementary lowpass/highpass pairs.

3. **Q calculation** (lines 107-114): `Q = center / bandwidth` is correct for constant-Q, but for multiband splitting you need different approach - the bands should be complementary filters that sum flat.

4. **No phase alignment**: The bandpass filters have different group delays at different frequencies. Without all-pass phase compensation, bands will be temporally misaligned.

### Dynamics Algorithm: 5/10

**Strengths:**
- Feed-forward envelope detection is appropriate for upward expansion
- Attack/release time constant calculation is correct
- Per-band gain computation with threshold and ratio is mathematically sound

**Issues Found:**
1. **Expansion gain calculation** (lines 234-240): The formula `-Math.min(gainReduction, rangeDb)` produces negative gain (attenuation) which is backwards for upward expansion. Upward expansion should BOOST signals below threshold, not attenuate them further. This appears to be a downward expander/gate, not upward expander.

2. **Single detector for both channels** (line 132, 281-295, 311-329): Using the same detector state for L and R processing causes the second channel to see already-modified envelope state, creating subtle stereo artifacts.

3. **No lookahead**: Unlike the EQ dynamics which has lookahead buffer, the expander has none, which can cause artifacts on transients.

4. **No knee implementation**: Hard threshold transition will cause pumping on material hovering near threshold.

### Stereo Handling: 4/10

**Issues Found:**
1. **Shared detector state between channels**: As mentioned, L and R share `st.detector` which is processed sequentially, corrupting the envelope for the second channel.

2. **Telemetry counts both channels into same accumulators** (lines 300-303, 324-328): This doubles the sample count and energy values, making RMS calculations incorrect.

3. **No M/S option**: For mastering, M/S expansion is often more appropriate than L/R.

---

## CRITICAL ASSESSMENT

### Phase Coherence: FAIL

**EQ Modules:**
- The mastering EQ worklet properly maintains phase coherence with linked stereo processing
- The enhance EQ worklet breaks phase coherence with independent per-channel dynamics
- Linear phase mode attempts to preserve phase but FIR kernel is too short for accuracy

**Multiband Expander:**
- **CRITICAL FAILURE**: Bandpass-sum architecture fundamentally cannot maintain phase coherence
- Bands will have different group delays causing temporal smearing
- Sum of bandpass outputs will NOT equal the input signal

### Crossover Flatness: FAIL (Expander)

**Expected behavior**: Sum of all bands should equal input signal (unity gain, flat response)

**Actual behavior in expander**:
- Bandpass filters extract overlapping frequency ranges
- Sum of bandpasses creates peaks at band centers and notches at crossover points
- With typical 3-5 bands, expect +/-6dB ripple across spectrum

**EQ Modules**: Not applicable (parametric EQ, not crossover-based)

### Critical Bugs That Would Cause Audio Artifacts:

1. **CRITICAL - Multiband Expander Architecture**: The bandpass-sum approach is fundamentally broken for multiband dynamics. Must be redesigned with proper crossover network (Linkwitz-Riley) that sums to unity.

2. **CRITICAL - Expander Gain Direction**: The `computeGainDb()` function (line 234-240) computes negative gain for signals below threshold. This makes it a downward expander/gate, not upward expander as documented.

3. **HIGH - Enhance EQ Stereo**: Per-channel dynamic EQ will destroy stereo image on asymmetric material.

4. **HIGH - Saturation Aliasing**: Band saturation in EQ is applied outside oversampling path, causing aliasing.

5. **MEDIUM - Short Anti-aliasing Filter**: 15-tap half-band filter allows aliasing through oversampling.

6. **MEDIUM - Shared Detector State**: Expander processes L then R through same detector, corrupting envelope.

7. **LOW - Zipper Noise**: No coefficient smoothing when EQ parameters change in real-time.

---

## RECOMMENDATIONS (Priority Order)

### P0 - Critical (Must Fix)

1. **Redesign Multiband Expander** with proper Linkwitz-Riley crossovers:
   ```
   LP + HP at each crossover frequency
   Cascade 2x 2nd-order Butterworth = 4th-order LR (24dB/oct)
   Ensure HP + LP = unity at all frequencies
   ```

2. **Fix Expansion Direction**: Change line 239 to return positive gain for upward expansion:
   ```typescript
   const gainDb = Math.min(gainReduction, rangeDb); // Positive = boost
   ```

3. **Separate Detector State Per Channel** in expander or use linked detection (max of L/R).

### P1 - High Priority

4. **Move saturation inside oversampling path** in EQ worklet to prevent aliasing.

5. **Use linked detection for enhance EQ** dynamics to preserve stereo image.

6. **Increase half-band filter length** to 63+ taps for proper anti-aliasing.

### P2 - Medium Priority

7. **Pre-normalize biquad coefficients** to eliminate per-sample division.

8. **Add coefficient interpolation** to prevent zipper noise on parameter changes.

9. **Add DC blocking** highpass filter at end of processing chain.

10. **Implement proper linear phase FIR** with FFT convolution and 512+ taps.

### P3 - Low Priority

11. **Add soft knee to expander** to reduce pumping.

12. **Switch to Transposed Direct Form II** for improved numerical stability.

13. **Report actual latency from worklet** instead of estimating in stage modules.

---

## Summary Scores

| Module | Filter/Crossover | Audio Quality | Performance | Overall |
|--------|------------------|---------------|-------------|---------|
| EQ Mastering Worklet | 7/10 | 6/10 | 8/10 | 7/10 |
| EQ Enhance Worklet | 6/10 | 5/10 | 7/10 | 6/10 |
| Multiband Expander | 3/10 | 4/10 | 6/10 | 4/10 |
| EQTameStage | N/A | 7/10 | 8/10 | 7.5/10 |
| EQEnhanceStage | N/A | 7/10 | 8/10 | 7.5/10 |
| MultiBandExpanderStage | N/A | 5/10 | 7/10 | 6/10 |

**Overall Assessment**: The EQ modules are functional with some quality issues that should be addressed. The multiband expander has fundamental architectural problems that will cause audible artifacts and must be redesigned before production use.
