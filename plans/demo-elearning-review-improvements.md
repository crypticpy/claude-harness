# Implementation Plan: Demo/E-Learning System Review & Improvements

Created: 2025-11-28
Status: PENDING APPROVAL

## Summary

This plan reviews the existing "Demo" / "Auto Demos" learning content system and proposes renaming it to "E-Learning" or similar, along with improvements to make the guided tours more dependable, elegant, and effective at teaching users about the application. The system has solid architecture but needs refinements for 100% reliability.

## Current System Overview

The demo system consists of:
- **8 Demo Scenarios** (scenario cards on /demo page)
- **9 Guided Tours** (step-by-step walkthroughs)
- **State Management** (Zustand store with localStorage persistence)
- **Global Tour Component** (mounted in root layout)

### What Works Well
- Clean architecture with centralized tour definitions
- Role-based auto-login for scenarios requiring specific permissions
- Step skipping with debounced notifications when elements aren't found
- Progress tracking with visual progress bar
- localStorage persistence for tour state across page refreshes

### Issues Identified

| Issue | Severity | Description |
|-------|----------|-------------|
| **Naming Inconsistency** | Medium | "Demo" label is generic; should be "E-Learning" or "Training" |
| **TourId Type Mismatch** | High | `useDemoStore.ts` TourId missing newer tours (`my-requests`, `invoice-list`, `admin-requests`, `admin-approvers`) |
| **Hardcoded Step Count** | Medium | Header's `handleStartOverview` uses magic number `6` instead of reading from tours |
| **E2E Test Step Count Mismatch** | Medium | `submit-invoice` test expects 2 steps but `tours.ts` defines 5 steps |
| **Missing data-tour Attributes** | High | Some tour targets may not exist (e.g., `[data-tour="invoice-pr-select"]`, `[data-tour="invoice-details"]`, etc.) |
| **Approve Tour Hardcoded Route** | High | `approve-request` tour has hardcoded `/approvals/PR-2025-001` which may not exist |
| **No Tour Completion Tracking** | Low | Users can't see which tours they've completed |
| **Limited Interactivity** | Medium | Tours are informational only; could benefit from interactive validation |

## Scope

### In Scope
- Rename "Demo" to "E-Learning" throughout the UI
- Fix TourId type to include all tour IDs
- Fix hardcoded step counts and route issues
- Add missing `data-tour` attributes on target elements
- Improve tour reliability (element finding, dynamic routing)
- Update E2E tests to match actual configurations
- Add completion tracking

### Out of Scope
- Adding new tour scenarios
- Backend changes
- Major UI redesign of the tour tooltip
- Unit test creation (separate effort)

## Prerequisites
- Ability to run frontend locally (`npm run dev`)
- Access to all demo user accounts for testing
- Understanding of where `data-tour` attributes need to be placed

## Implementation Phases

### Phase 1: Fix Critical Type and Data Issues
**Objective**: Ensure all tour IDs are properly typed and step counts are accurate

**Files to Modify**:
- `frontend/packages/state/src/stores/useDemoStore.ts` - Add missing TourIds to type
- `frontend/packages/ui-components/src/components/layout/Header.tsx` - Fix hardcoded step count
- `frontend/e2e/demo-scenarios.spec.ts` - Fix step count assertions

**Steps**:
1. Update `TourId` type in `useDemoStore.ts` (line 5-11) to include: `'my-requests' | 'invoice-list' | 'admin-requests' | 'admin-approvers'`
2. In `Header.tsx` line 96, replace `startTour('site-overview', 6)` with dynamic count from `tours['site-overview'].steps.length`
3. Update E2E test line 324 from `'of 2'` to `'of 5'` (submit-invoice tour has 5 steps)

**Verification**:
- [ ] TypeScript compiles without errors
- [ ] Header tour starts with correct step count
- [ ] E2E tests pass

### Phase 2: Rename "Demo" to "E-Learning"
**Objective**: Update naming across the UI for consistency and clarity

**Files to Modify**:
- `frontend/packages/ui-components/src/components/layout/Sidebar.tsx` - Nav item label
- `frontend/apps/web/src/app/demo/page.tsx` - Page title and subtitle
- `frontend/packages/ui-components/src/components/features/demo/DemoScenarios.tsx` - Section heading
- `frontend/packages/ui-components/src/components/layout/Header.tsx` - Menu subheader

**Steps**:
1. In `Sidebar.tsx` line 155: Change `label: 'Demo'` to `label: 'E-Learning'`
2. In `demo/page.tsx` line 12-13: Change `title="Demo & Training"` to `title="E-Learning"` and update subtitle to `"Interactive tutorials to help you learn the Purchase Request System"`
3. In `DemoScenarios.tsx` line 267-270: Change "Demo Scenarios" heading to "Training Modules" and update body text
4. In `Header.tsx` line 128: Change `<ListSubheader>Demo</ListSubheader>` to `<ListSubheader>E-Learning</ListSubheader>`

**New Files to Create**: None

**Verification**:
- [ ] Navigation shows "E-Learning" instead of "Demo"
- [ ] Page header reflects new naming
- [ ] Menu section renamed appropriately

### Phase 3: Fix Dynamic Route Issues in Tours
**Objective**: Make approve-request tour work with actual data instead of hardcoded routes

**Files to Modify**:
- `frontend/packages/ui-components/src/components/features/demo/tours.ts` - Fix hardcoded route
- `frontend/packages/ui-components/src/components/features/demo/GuidedTour.tsx` - Add dynamic route resolution

**Steps**:
1. For `approve-request` tour (lines 152-208), change route from `/approvals/PR-2025-001` to just `/approvals` or implement dynamic lookup
2. Add a mechanism to find an actual pending approval request and navigate to it
3. Consider adding a `resolveRoute` function that can fetch available data before navigating

**Alternative Approach** (simpler):
1. Make approve tour steps 3-8 route to `/approvals` and show elements that exist on that page
2. Or create a dedicated demo approval request that always exists

**Verification**:
- [ ] Approve tour doesn't fail on step 3 due to missing route
- [ ] Tour completes successfully for approver users

### Phase 4: Add Missing data-tour Attributes
**Objective**: Ensure all tour targets have corresponding elements in the UI

**Files to Modify** (based on missing selectors in tours.ts):
- `frontend/apps/web/src/app/invoices/new/Client.tsx` - Add invoice tour targets
- `frontend/packages/ui-components/src/components/features/invoices/components/InvoiceForm.tsx` - Add form section targets
- `frontend/apps/web/src/app/requests/Client.tsx` - Add filter bar target
- `frontend/apps/web/src/app/invoices/Client.tsx` - Add filter bar target
- `frontend/apps/web/src/app/admin/requests/page.tsx` - Add admin requests targets

**Steps**:
1. Audit all `target` selectors in `tours.ts`
2. Search codebase for each `data-tour="..."` attribute
3. Add missing attributes to the appropriate elements:
   - `data-tour="invoice-pr-select"` - Invoice PR dropdown
   - `data-tour="invoice-details"` - Invoice form fields section
   - `data-tour="invoice-upload"` - File upload component
   - `data-tour="invoice-submit"` - Submit button
   - `data-tour="requests-filter-bar"` - Requests list filter section
   - `data-tour="invoices-filter-bar"` - Invoices list filter section
   - `data-tour="admin-requests-list"` - Admin requests table

**Verification**:
- [ ] All tours can find their target elements
- [ ] No "Step Skipped" warnings during tours

### Phase 5: Add Tour Completion Tracking
**Objective**: Let users see which tours they've completed

**Files to Modify**:
- `frontend/packages/state/src/stores/useDemoStore.ts` - Add completedTours state
- `frontend/packages/ui-components/src/components/features/demo/DemoScenarios.tsx` - Show completion badges
- `frontend/packages/ui-components/src/components/features/demo/GuidedTour.tsx` - Mark tour complete on finish

**Steps**:
1. Add `completedTours: TourId[]` to DemoState interface
2. Add `markTourComplete(id: TourId)` and `resetCompletedTours()` actions
3. Persist completedTours to localStorage
4. In `GuidedTour.handleComplete()`, call `markTourComplete(activeTour)`
5. In `DemoScenarios`, show a checkmark badge on cards for completed tours
6. Add "Clear Progress" button to reset completion state

**Verification**:
- [ ] Completing a tour marks it as done
- [ ] Completion persists across page refreshes
- [ ] Users can see which tours they've completed
- [ ] Reset clears all completion state

### Phase 6: Polish and UX Improvements
**Objective**: Make the tours feel more polished and professional

**Files to Modify**:
- `frontend/packages/ui-components/src/components/features/demo/GuidedTour.tsx` - UX tweaks
- `frontend/packages/ui-components/src/components/features/demo/DemoScenarios.tsx` - Card improvements

**Steps**:
1. Add keyboard navigation (Escape to close, Arrow keys for prev/next)
2. Improve tooltip animation (smoother transitions when moving between elements)
3. Add a "Skip to End" option for users who want to jump ahead
4. Show estimated remaining time based on steps left
5. Add a brief "Tour Complete!" celebration animation/message
6. Consider adding video thumbnails or preview images to scenario cards

**Verification**:
- [ ] Keyboard navigation works
- [ ] Transitions are smooth
- [ ] Skip to End works correctly
- [ ] Completion message displays

## Testing Strategy

### Manual Testing Checklist
For each of the 8 demo scenarios:
- [ ] Card displays correctly
- [ ] Dialog opens with correct information
- [ ] Start Scenario navigates to correct page
- [ ] Tour finds all target elements
- [ ] Progress bar advances correctly
- [ ] Next/Back buttons work
- [ ] Finish completes the tour
- [ ] Skip (X button) exits properly
- [ ] Auto-login works for role-restricted tours

### E2E Test Updates
- Update `demo-scenarios.spec.ts` with correct step counts
- Add test for completion tracking
- Add test for keyboard navigation

## Rollback Plan
All changes are frontend-only. To rollback:
1. Revert commits on the feature branch
2. No database migrations or backend changes to undo

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Missing data-tour elements cause tours to skip many steps | Medium | High | Thorough audit and add all missing attributes before release |
| Hardcoded approval route breaks tour | High | High | Implement dynamic route resolution or ensure demo data exists |
| localStorage size limits for completion tracking | Low | Low | Only store tour IDs (small data) |
| Regression in existing E2E tests | Medium | Medium | Run full test suite before merge |

## Open Questions

1. **Rename to "E-Learning" or "Training"?** - Which term better fits the APH organization's terminology?
2. **Should completion tracking be per-user or browser-based?** - Current plan uses localStorage (browser-based). Would per-user require backend changes?
3. **Approve tour route handling** - Should we create a dedicated demo approval request, or implement dynamic lookup?

---
**USER: Please review this plan. Edit any section directly in this file, then confirm to proceed.**
