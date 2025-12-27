# Implementation Plan: Fix Module Headers and Bypass Button

Created: 2025-11-29
Status: PENDING APPROVAL

## Summary

Fix two UI issues:
1. **Sprinkling module header issue** - User reported "Sprinkling module says Sifting in its header" (needs verification - current code shows correct "SPRINKLING")
2. **Proofing module bypass button** - InteractiveExpanderView shows "Enable upward expander module to visualize" message instead of having a proper bypass button like other BISCUIT modules

## Scope

### In Scope
- Add bypass button to InteractiveExpanderView header (matching BISCUIT module pattern)
- Add enable/disable toggle to InteractiveExpanderView header
- Verify and fix any header naming issues
- Update ModulePanelContainer to pass bypass props to expander view

### Out of Scope
- Creating a full ProofingPanel (culinary-themed) component
- Changing the expander's multiband visualization logic
- Other module UI changes

## Prerequisites
- Dev server running at localhost:5174

## Implementation Phases

### Phase 1: Add Bypass/Enable Props to InteractiveExpanderView Interface

**Objective**: Extend InteractiveExpanderView to accept bypass and enable props

**Files to Modify**:
- `spectral-mastering-web/src/components/InteractiveExpanderView.tsx` - Add interface props

**Steps**:
1. Add new props to InteractiveExpanderViewProps interface:
   - `enabled?: boolean` (default to `expanderEnabled` from parameters)
   - `isBypassed?: boolean`
   - `onToggle?: () => void`
   - `onBypass?: (bypassed: boolean) => void`
2. Accept these props in the component

**Verification**:
- [ ] TypeScript compiles without errors
- [ ] Props are optional for backwards compatibility

### Phase 2: Add Bypass Button to InteractiveExpanderView Header

**Objective**: Add standard BISCUIT bypass button pattern to the expander header

**Files to Modify**:
- `spectral-mastering-web/src/components/InteractiveExpanderView.tsx` - Add header buttons

**Steps**:
1. Update CardHeader to include bypass and enable toggle buttons (following SprinklingPanel pattern)
2. Rename header from "Interactive Dynamics" to "PROOFING (Upward Expander)" for BISCUIT consistency
3. Add emoji icon (🫗 or similar) to match BISCUIT branding
4. Use orange/amber color scheme for Proofing module
5. Remove the "Enable upward expander module to visualize" overlay message
6. Use bypass state to control visualization instead of enabled state

**Verification**:
- [ ] Bypass button appears in header
- [ ] Enable/disable toggle appears in header
- [ ] Buttons follow BISCUIT styling pattern

### Phase 3: Update ModulePanelContainer to Pass Bypass Props

**Objective**: Wire ModulePanelContainer to pass enable/bypass props to InteractiveExpanderView

**Files to Modify**:
- `spectral-mastering-web/src/components/panels/ModulePanelContainer.tsx` - Pass props to expander

**Steps**:
1. Add `enabled`, `isBypassed`, `onToggle`, `onBypass` props to InteractiveExpanderView call
2. Map from global AudioParameters to expander-specific enabled/bypassed state
3. Implement toggle and bypass handlers

**Verification**:
- [ ] Clicking bypass button updates module state
- [ ] Clicking enable/disable button updates module state
- [ ] Console shows parameter changes when buttons clicked

## Testing Strategy

### Manual Testing Steps
1. Load the application at localhost:5174
2. Navigate to the Proofing/Expander module
3. Verify header shows "PROOFING (Upward Expander)" with emoji
4. Verify bypass button shows "● ACTIVE" or "○ BYPASSED"
5. Verify enable button shows "Proofing 🫗" or "Off"
6. Click bypass button - verify state changes
7. Click enable button - verify state changes
8. Verify visualization responds to bypass/enable state

## Rollback Plan

1. Revert InteractiveExpanderView.tsx changes
2. Revert ModulePanelContainer.tsx changes (expander section only)

Git commits will be made after implementation for easy rollback.

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Breaking existing expander functionality | Low | High | Keep props optional, test thoroughly |
| Styling inconsistency with other modules | Low | Medium | Copy exact button JSX from SprinklingPanel |
| Parameter mapping issues | Medium | Medium | Follow same pattern as other modules |

## Open Questions

1. The user mentioned "Sprinkling module says Sifting" - Current code shows SprinklingPanel correctly displays "SPRINKLING". Was this perhaps referring to a different view or navigation element?

---
**STATUS: PENDING APPROVAL**

**USER: Please review this plan. Edit any section directly in this file, then confirm to proceed.**
