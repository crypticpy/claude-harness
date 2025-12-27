# Implementation Plan: Button Design Standardization

Created: 2025-11-28
Status: PENDING APPROVAL

## Summary

Audit and standardize all buttons and interactive elements across the PurchasePro application to ensure consistent design language, WCAG 2.1 AA accessibility compliance, and alignment with UX best practices from ARIA, Don Norman, and Nielsen Norman Group principles. This includes updating Storybook documentation to reflect the established standards.

## Scope

### In Scope
- Audit all button variants (`StyledButton`, raw MUI `Button`, `IconButton`)
- Define and document the button design standard based on accessibility best practices
- Convert all raw MUI `Button` usage to `StyledButton` across pages and feature components
- Add missing `aria-label` attributes to all `IconButton` components
- Update `StyledButton.stories.tsx` with comprehensive documentation
- Create new stories for missing components (`ThemeToggle`, `FilterSelect`)
- Ensure all buttons meet WCAG 2.1 AA contrast requirements

### Out of Scope
- Test pages (`test-auth`, `test-api`, `api-test-simple`) - these can remain as-is for developer testing
- Third-party component libraries' internal buttons
- Backend changes

## Prerequisites
- Development server running for visual verification
- Access to current brand colors (APH primary blue: #44499C)

## Design Standard Documentation

### Button Design Principles (Based on Nielsen Norman Group & Don Norman)

**1. Visibility and Affordance**
- Buttons must look clickable (raised appearance, clear boundaries)
- Primary actions must be visually prominent (filled/contained style)
- Secondary actions must be visually distinct but subordinate (outlined style)

**2. Hierarchy (Nielsen Norman Group)**
- **Primary buttons**: One per view for the main action (filled with brand color)
- **Secondary buttons**: Supporting actions (outlined, transparent background)
- **Tertiary/Ghost buttons**: Low-emphasis actions (text-only, minimal styling)
- **Danger buttons**: Destructive actions (error color)

**3. WCAG 2.1 AA Requirements**
- Minimum contrast ratio of 4.5:1 for text
- Minimum touch target size of 44x44px (already enforced in theme)
- Focus indicators must be visible (3px solid outline, already in theme)
- All buttons must be keyboard accessible (Tab, Enter, Space)
- Icon-only buttons MUST have `aria-label` for screen readers

**4. Consistent Variant Naming**
- `primary` - Main call-to-action (APH blue #44499C, white text)
- `secondary` - Secondary actions (outlined, primary blue border)
- `danger` - Destructive actions (error red, white text)
- `ghost` - Tertiary/low-emphasis (transparent, primary text)
- `outlined` - Neutral outlined style (divider border)

**5. State Management**
- `loading` - Shows spinner, disables button
- `disabled` - 60% opacity, no interaction
- Hover, focus, active states with clear visual feedback

## Implementation Phases

### Phase 1: Update StyledButton Component & Storybook
**Objective**: Ensure the StyledButton component is fully documented with all variants

**Files to Modify**:
- `frontend/apps/web/src/stories/base/StyledButton.stories.tsx` - Add comprehensive stories

**Steps**:
1. Add story for `variant="danger"` (currently missing)
2. Add story for `loading={true}` prop showing actual spinner behavior
3. Add story for `endIcon` prop
4. Add story for `fullWidth` prop
5. Add combined variant showcase showing all 5 variants side by side
6. Add accessibility documentation section in story metadata
7. Fix argTypes to use correct custom variants (`primary`, `secondary`, `danger`, `ghost`, `outlined`) instead of MUI variants

**Verification**:
- [ ] Run Storybook and verify all new stories render correctly
- [ ] All 5 variants visible in combined showcase
- [ ] Loading state shows spinner

### Phase 2: Standardize Login Page Buttons
**Objective**: Convert login page from raw MUI Button to StyledButton

**Files to Modify**:
- `frontend/apps/web/src/app/login/LoginClient.tsx` - Replace MUI Button imports/usage

**Steps**:
1. Replace `import { Button } from '@mui/material'` with `import { StyledButton } from '@aph/ui'`
2. Convert demo account buttons: `variant="outlined"` -> `variant="secondary"`
3. Convert "Manual Login" toggle: keep as ghost/text style -> `variant="ghost"`
4. Convert "Sign In" submit button: `variant="contained"` -> `variant="primary"`
5. Update loading state to use `loading` prop instead of manual CircularProgress

**Verification**:
- [ ] Login page renders correctly with new buttons
- [ ] Demo account buttons have proper hover states
- [ ] Loading spinner appears during login

### Phase 3: Standardize Help Pages Buttons
**Objective**: Convert help pages from raw MUI Button to StyledButton

**Files to Modify**:
- `frontend/apps/web/src/app/help/page.tsx` - Dialog buttons
- `frontend/apps/web/src/app/help/faqs/page.tsx` - Any buttons
- `frontend/apps/web/src/app/help/docs/page.tsx` - Any buttons

**Steps**:
1. In `help/page.tsx`: Replace dialog action buttons
   - Cancel button: `variant="secondary"`
   - Submit button: `variant="primary"`
2. Import `StyledButton` from `@aph/ui`
3. Check and update FAQs and Docs pages similarly

**Verification**:
- [ ] Contact support modal has consistent button styling
- [ ] All help page buttons match design system

### Phase 4: Standardize Feature Component Buttons
**Objective**: Convert feature components from raw MUI Button to StyledButton

**Files to Modify**:
- `frontend/packages/ui-components/src/components/features/demo/DemoScenarios.tsx`
- `frontend/packages/ui-components/src/components/features/demo/GuidedTour.tsx`
- `frontend/packages/ui-components/src/components/features/admin/overview/AdminOpsDashboard.tsx`
- `frontend/packages/ui-components/src/components/features/admin/invoices/AdminInvoicePanel.tsx`
- `frontend/packages/ui-components/src/components/features/admin/invoices/components/InvoiceStatusActions.tsx`
- `frontend/packages/ui-components/src/components/features/purchase-request/FundingSourcesGrid.tsx`
- `frontend/packages/ui-components/src/components/features/admin/overview/ExportColumnsPicker.tsx`
- `frontend/packages/ui-components/src/components/features/reports/ReportScheduler.tsx`
- `frontend/packages/ui-components/src/components/features/reports/ReportBuilder.tsx`
- `frontend/packages/ui-components/src/components/features/reports/ExecutiveSummaryReport.tsx`
- `frontend/packages/ui-components/src/components/features/admin/dashboard/sections/ActionsSection/SavedViewsControls.tsx`

**Steps**:
1. For each file:
   - Replace `Button` import from `@mui/material` with `StyledButton` from base components
   - Map MUI variants to custom variants:
     - `variant="contained"` -> `variant="primary"`
     - `variant="outlined"` -> `variant="secondary"`
     - `variant="text"` -> `variant="ghost"`
   - Map `color="error"` -> `variant="danger"`

**Verification**:
- [ ] Each component renders correctly with styled buttons
- [ ] No visual regressions in button appearance

### Phase 5: Standardize Base Component Buttons
**Objective**: Convert base components from raw MUI Button to StyledButton

**Files to Modify**:
- `frontend/packages/ui-components/src/components/base/loading/ErrorState.tsx`
- `frontend/packages/ui-components/src/components/base/loading/EmptyState.tsx`
- `frontend/packages/ui-components/src/components/base/FilterBar.tsx`
- `frontend/packages/ui-components/src/components/providers/ErrorBoundary.tsx`
- `frontend/packages/ui-components/src/components/providers/NotificationProvider.tsx`

**Steps**:
1. For each file:
   - Replace MUI Button imports with StyledButton
   - Map variants appropriately
2. Special attention to ErrorState and EmptyState as they're reused widely

**Verification**:
- [ ] Error states display correctly with styled buttons
- [ ] Empty states display correctly with styled buttons

### Phase 6: Add aria-labels to IconButtons
**Objective**: Add accessibility labels to all icon-only buttons

**Files to Modify** (prioritized list):
- `frontend/packages/ui-components/src/components/layout/Header.tsx` - Notifications, Profile IconButtons
- `frontend/packages/ui-components/src/components/features/invoices/InvoiceList.tsx` - More menu IconButton
- `frontend/packages/ui-components/src/components/features/approvals/ApprovalChat.tsx` - Multiple IconButtons
- `frontend/packages/ui-components/src/components/features/admin/components/DashboardHeader.tsx` - Refresh IconButton
- `frontend/packages/ui-components/src/components/features/demo/GuidedTour.tsx` - Close IconButton
- `frontend/packages/ui-components/src/components/features/admin/components/ApprovalChainCard/ApprovalChainCard.tsx` - Edit, Delete IconButtons
- `frontend/packages/ui-components/src/components/features/approvals/components/DelegationCard/DelegationCard.tsx` - Edit, Delete IconButtons
- `frontend/apps/web/src/app/invoices/[id]/page.tsx` - Back IconButton
- `frontend/apps/web/src/app/requests/[id]/page.tsx` - Back IconButton
- `frontend/apps/web/src/app/approvals/[id]/Client.tsx` - Back IconButton

**Steps**:
1. For each IconButton without aria-label:
   - Add descriptive `aria-label` that explains the action
   - Format: `aria-label="Action description"` (e.g., `aria-label="Open notifications"`)

**Verification**:
- [ ] Run accessibility audit to verify all IconButtons have labels
- [ ] Screen reader testing confirms labels are announced

### Phase 7: Create Missing Storybook Stories
**Objective**: Add stories for undocumented interactive components

**New Files to Create**:
- `frontend/apps/web/src/stories/base/ThemeToggle.stories.tsx`
- `frontend/apps/web/src/stories/base/FilterSelect.stories.tsx`

**Steps**:
1. Create ThemeToggle story with:
   - Default state
   - Dark mode state
   - Interactive toggle demo
2. Create FilterSelect story with:
   - Single selection
   - Multiple selection
   - With clear button

**Verification**:
- [ ] Both new stories appear in Storybook
- [ ] Interactive controls work correctly

### Phase 8: Final Verification & Cleanup
**Objective**: Ensure all changes are complete and consistent

**Steps**:
1. Run TypeScript check: `npm run typecheck`
2. Run lint: `npm run lint`
3. Run Storybook build: `npm run build-storybook`
4. Visual review of key pages:
   - Login page
   - Home page
   - Approvals page
   - Admin pages
   - Help pages

**Verification**:
- [ ] No TypeScript errors
- [ ] No lint errors
- [ ] Storybook builds successfully
- [ ] Visual consistency across all pages

## Testing Strategy

- **Unit tests**: Not required for style-only changes
- **Visual regression**: Manual review of each updated page
- **Accessibility testing**:
  - Use browser dev tools (Lighthouse accessibility audit)
  - Keyboard navigation testing (Tab through buttons)
  - Screen reader testing (VoiceOver on macOS)
- **Cross-browser**: Verify in Chrome, Firefox, Safari

## Rollback Plan

- All changes are in separate files with no database migrations
- Git revert can be used to undo any phase independently
- StyledButton component changes are backward compatible

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Breaking existing button styling | Low | Medium | Test each change visually before committing |
| Missing button instances | Medium | Low | Use grep to find all Button imports |
| Accessibility regression | Low | High | Run accessibility audit after each phase |
| Storybook build failure | Low | Low | Run build after adding new stories |

## Open Questions

1. Should the login page demo account buttons maintain their custom styling (color-coded by role), or should they be converted to standard secondary buttons?
   - **Recommendation**: Keep the custom role-based coloring but ensure they use StyledButton internally

2. For the GuidedTour component, should tour navigation buttons (Next, Back) use primary/secondary variants, or maintain their current styling for visual distinction?
   - **Recommendation**: Use primary for "Next" and ghost for "Back" to emphasize forward progression

---
**USER: Please review this plan. Edit any section directly in this file, then confirm to proceed.**
