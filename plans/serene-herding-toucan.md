# EQ Panel UI Fix Plan

Created: 2025-11-30
Updated: 2025-11-30
Status: READY FOR IMPLEMENTATION

## Executive Summary

**Current Issues**:
1. EQ sliders are not clickable/interactive
2. A/B button incorrectly added to EQ module (should only be in Live Spectrum Overview)

**Root Causes**:
1. The "Bottom Action Bar" section with A/B button was incorrectly added to SiftingPanel.tsx
2. The `isABComparing` state variable was added unnecessarily

---

## IMPLEMENTATION PLAN

### Fix 1: Remove A/B Button from EQ Module

**File**: `src/modules/eq/ui/SiftingPanel.tsx`

Remove the entire "Bottom Action Bar" section (lines 212-235) and the `isABComparing` state variable (line 50).

The A/B button should NOT be in individual modules - it only exists in the Live Spectrum Overview.

**Changes**:
1. Remove line 50: `const [isABComparing, setIsABComparing] = useState(false);`
2. Remove lines 212-235: The entire "Bottom Action Bar" div

### Fix 2: Verify Slider Interactivity

The sliders should work now that `fineness.isKeyParameter: true`. If they still don't work, check:
- The `disabled` prop on line 207 - should be `false` now
- Any CSS in `animations.css` that might block pointer events

---

## FILES TO MODIFY

| File | Changes |
|------|---------|
| `SiftingPanel.tsx` | Remove `isABComparing` state and "Bottom Action Bar" section |

---

## VERIFICATION CHECKLIST

- [ ] No A/B button visible in EQ module
- [ ] All three sliders (Low, Tilt, High) are clickable and draggable
- [ ] ON/OFF button in header still works
- [ ] Character selector buttons still work

---

**STATUS: READY FOR IMPLEMENTATION**
