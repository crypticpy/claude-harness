# Implementation Plan: Simplify Module Toggle Buttons (Remove Bypass State)

Created: 2025-11-29
Status: PENDING APPROVAL

## Summary

Remove the duplicative "Active/Bypassed" toggle from all audio processing modules, leaving only a single "ON/OFF" button. Currently, each module has TWO toggle buttons (ON/OFF + ACTIVE/BYPASSED), which is confusing and redundant. After this change, modules will have only the ON/OFF button, simplifying the state model.

## Scope

### In Scope
- Remove bypass toggle button from all 7 module panels:
  1. Treatment (SiftingPanel.tsx in treatment module)
  2. EQ (SiftingPanel.tsx in eq module)
  3. Compressor (PressingPanel.tsx)
  4. Expander (MultibandExpanderPanel.tsx)
  5. Stereo Imaging (SprinklingPanel.tsx)
  6. Saturation (BiscuitSaturationPanel.tsx)
  7. Limiter (GlazingPanel.tsx)
- Remove `isBypassed` and `onBypass` props from panel interfaces
- Update wrapper components to stop passing bypass-related props
- Update Navigation bar badge to only show ON/OFF (no BYPASS state)

### Out of Scope
- Changing the underlying audio processing architecture
- Removing bypass functionality from AudioWorklet/DSP level (that can stay for future A/B testing if needed)
- Modifying state stores or hooks beyond removing UI-facing bypass handling
- Per-band enable/solo/mute buttons in multiband modules (those stay)

## Prerequisites
- Dev server should be running to test changes
- Ensure TypeScript compilation passes after each module change

## Implementation Phases

### Phase 1: Update Treatment Panel
**Objective**: Remove bypass toggle from Spectral Treatment panel

**Files to Modify**:
- `/Users/aiml/Projects/spectral_master_bus/spectral-mastering-web/src/modules/treatment/ui/SiftingPanel.tsx`
  - Remove `isBypassed` and `onBypass` from props interface
  - Remove the bypass toggle button JSX block (lines ~212-221)
  - Remove default value for `isBypassed` in function signature

**Steps**:
1. Open SiftingPanel.tsx in treatment module
2. Remove `isBypassed?: boolean` from SiftingPanelProps interface
3. Remove `onBypass?: (bypassed: boolean) => void` from SiftingPanelProps interface
4. Remove `isBypassed = false` from function parameters
5. Remove `onBypass` from function parameters
6. Delete the entire bypass toggle button block `{onBypass && (...)}` in CardHeader

**Verification**:
- [ ] No bypass button visible in Treatment panel
- [ ] ON/OFF button still works correctly
- [ ] No TypeScript errors

### Phase 2: Update EQ Panel
**Objective**: Remove bypass toggle from EQ panel

**Files to Modify**:
- `/Users/aiml/Projects/spectral_master_bus/spectral-mastering-web/src/modules/eq/ui/SiftingPanel.tsx`
  - Remove `isBypassed` and `onBypass` from props interface (lines 32-33)
  - Remove the bypass toggle button JSX block (lines 78-89)

**Steps**:
1. Open SiftingPanel.tsx in eq module
2. Remove bypass-related props from interface
3. Remove bypass default value and onBypass from function signature
4. Delete the bypass toggle button block

**Verification**:
- [ ] No bypass button visible in EQ panel
- [ ] ON/OFF button still works correctly

### Phase 3: Update Compressor Panel
**Objective**: Remove bypass toggle from Compressor (Pressing) panel

**Files to Modify**:
- `/Users/aiml/Projects/spectral_master_bus/spectral-mastering-web/src/modules/compressor/ui/PressingPanel.tsx`
  - Remove `isBypassed` and `onBypass` from props interface (lines 69-76)
  - Remove the bypass toggle button JSX block (lines 194-211)

**Steps**:
1. Open PressingPanel.tsx
2. Remove bypass-related props from PressingPanelProps interface
3. Remove bypass parameters from function signature
4. Delete the bypass toggle button block

**Verification**:
- [ ] No bypass button visible in Compressor panel
- [ ] Enable/disable button still works (shows "Pressing" or "Off")

### Phase 4: Update Expander Panel
**Objective**: Remove bypass toggle from Multiband Expander panel

**Files to Modify**:
- `/Users/aiml/Projects/spectral_master_bus/spectral-mastering-web/src/components/MultibandExpanderPanel.tsx`
  - Remove `isBypassed` and `onBypass` from props interface (lines 31-33)
  - Remove the bypass toggle button JSX block (lines 685-696)

**Steps**:
1. Open MultibandExpanderPanel.tsx
2. Remove bypass-related props from MultibandExpanderPanelProps interface
3. Remove bypass parameter from component destructuring
4. Delete the bypass toggle button block

**Verification**:
- [ ] No bypass button visible in Expander panel
- [ ] ON/OFF button still works correctly

### Phase 5: Update Stereo Imaging Panel
**Objective**: Remove bypass toggle from Stereo Imaging panel

**Files to Modify**:
- `/Users/aiml/Projects/spectral_master_bus/spectral-mastering-web/src/modules/stereo-imaging/ui/SprinklingPanel.tsx`
  - Remove `isBypassed` and `onBypass` from props interface (lines 45-49)
  - Remove the bypass toggle button JSX block (lines 137-153)

**Steps**:
1. Open SprinklingPanel.tsx
2. Remove bypass-related props from SprinklingPanelProps interface
3. Remove bypass parameters from function signature
4. Delete the bypass toggle button block

**Verification**:
- [ ] No bypass button visible in Stereo panel
- [ ] ON/OFF button still works correctly

### Phase 6: Update Saturation Panel
**Objective**: Remove bypass toggle from Saturation panel

**Files to Modify**:
- `/Users/aiml/Projects/spectral_master_bus/spectral-mastering-web/src/modules/saturation/ui/BiscuitSaturationPanel.tsx`
  - Remove `isBypassed` and `onBypass` from props interface (lines 23-27)
  - Remove the bypass toggle button JSX block (lines 114-131)

**Steps**:
1. Open BiscuitSaturationPanel.tsx
2. Remove bypass-related props from BiscuitSaturationPanelProps interface
3. Remove bypass parameters from function signature
4. Delete the bypass toggle button block

**Verification**:
- [ ] No bypass button visible in Saturation panel
- [ ] ON/OFF button still works correctly

### Phase 7: Update Limiter Panel
**Objective**: Remove bypass toggle from Limiter panel

**Files to Modify**:
- `/Users/aiml/Projects/spectral_master_bus/spectral-mastering-web/src/modules/limiter/ui/GlazingPanel.tsx`
  - Remove `isBypassed` and `onBypass` from props interface (lines 69-76)
  - Remove the bypass toggle button JSX block (lines 189-206)

**Steps**:
1. Open GlazingPanel.tsx
2. Remove bypass-related props from GlazingPanelProps interface
3. Remove bypass parameters from function signature
4. Delete the bypass toggle button block

**Verification**:
- [ ] No bypass button visible in Limiter panel
- [ ] ON/OFF button still works correctly

### Phase 8: Update Panel Wrappers
**Objective**: Remove bypass-related props from wrapper components

**Files to Modify**:
- `/Users/aiml/Projects/spectral_master_bus/spectral-mastering-web/src/components/panels/wrappers/EQPanelWrapper.tsx`
- `/Users/aiml/Projects/spectral_master_bus/spectral-mastering-web/src/components/panels/wrappers/SaturationPanelWrapper.tsx`
- `/Users/aiml/Projects/spectral_master_bus/spectral-mastering-web/src/components/panels/wrappers/LimiterPanelWrapper.tsx`
- `/Users/aiml/Projects/spectral_master_bus/spectral-mastering-web/src/components/panels/wrappers/StereoPanelWrapper.tsx`

**Steps**:
1. In each wrapper, remove any `isBypassed` prop passed to the panel
2. Remove any `onBypass` prop passed to the panel
3. Remove any hook calls related to bypass state (`isBypassed`, `bypass()`)

**Verification**:
- [ ] All wrapper components compile without errors
- [ ] Panels render correctly when accessed through wrappers

### Phase 9: Update Navigation Badge State (Already Done)
**Objective**: Verify navigation badges only show ON/OFF

**Files to Check**:
- `/Users/aiml/Projects/spectral_master_bus/spectral-mastering-web/src/components/navigation/ModuleCard.tsx`
- `/Users/aiml/Projects/spectral_master_bus/spectral-mastering-web/src/components/navigation/KitchenCounterBar.tsx`

**Steps**:
1. Verify `ModuleDisplayState` type is `'OFF' | 'ON' | 'BYPASS'`
2. Remove `'BYPASS'` from the type if it exists
3. Update `getModuleEnabledState()` to only return `'ON'` or `'OFF'`
4. Remove bypass color styling from ModuleCard

**Verification**:
- [ ] Navigation badges only show ON or OFF
- [ ] No yellow BYPASS state visible

### Phase 10: Final Verification & Cleanup
**Objective**: Ensure all changes work together

**Steps**:
1. Run TypeScript compilation: `pnpm run type-check`
2. Start dev server and test each module:
   - Open each module panel
   - Verify only ON/OFF button exists
   - Verify toggle works correctly
   - Check navigation badge updates
3. Clean up any `@ts-nocheck` comments if they're no longer needed

**Verification**:
- [ ] All 7 modules have only ON/OFF button
- [ ] No TypeScript errors
- [ ] Navigation badges update correctly
- [ ] All modules function properly

## Testing Strategy
- Manual testing: Open each module panel and verify UI
- TypeScript validation: Run `pnpm run type-check` after each phase
- Integration testing: Ensure navigation badges reflect module state
- Audio testing: Verify modules still process audio when ON

## Rollback Plan
- All changes are in UI layer only
- Revert commits if issues arise
- DSP layer bypass functionality remains intact for future use

## Risks and Mitigations
| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Missed bypass reference | Low | Low | TypeScript will catch unused props |
| Navigation badge breaks | Low | Medium | Test navigation after panel changes |
| Wrapper component breaks | Medium | Medium | Update wrappers in dedicated phase |

## Open Questions
- Should we keep the `onBypass` prop in the interface for potential future A/B testing feature? (Recommendation: Remove it completely for now, can add back later if needed)

---
**USER: Please review this plan. Edit any section directly in this file, then confirm to proceed.**
