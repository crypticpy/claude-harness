# Plan: Rename "Approval Dashboard" to "Approvals Overview"

## Objective
Rename the approvals section page title from "Approval Dashboard" to "Approvals Overview" to avoid confusion with the Admin Dashboard components and improve naming consistency.

## Files to Modify

### 1. Main Page Title
**File:** `frontend/apps/web/src/app/approvals/Client.tsx`
- Line 61: Change `title="Approval Dashboard"` to `title="Approvals Overview"`

### 2. Demo/Tour System
**File:** `frontend/packages/ui-components/src/components/features/demo/tours.ts`
- Line 158: Change `title: 'Approval Dashboard'` to `title: 'Approvals Overview'`

### 3. Test Files
**File:** `frontend/apps/web/src/app/approvals/__tests__/approvals.list.neutral.test.tsx`
- Line 28: Update mock to return `<div>Approvals Overview</div>`
- Line 48: Update assertion to check for `/Approvals Overview/i`

**File:** `frontend/apps/web/src/app/requests/__tests__/requests.list.neutral.test.tsx`
- Line 22: Update mock to return `<div>Approvals Overview</div>`

### 4. Documentation
**File:** `frontend/apps/web/src/stories/Introduction.stories.mdx`
- Line 43: Update description from "ApprovalDashboard" to clarify it's the "Approvals Overview" interface

**File:** `frontend/apps/web/src/stories/base/LoadingComponents.stories.tsx`
- Line 490: Update label from "Approval Dashboard Loading" to "Approvals Overview Loading"

## Notes
- The `ApprovalDashboard` component name in `ui-components` does NOT need to change - it's a reusable component that is currently not even being used in the main approvals page (per test comments)
- The Storybook story path `Features/Approvals/ApprovalDashboard` can remain as-is since it describes the component, not the page
- Only user-facing text and test assertions need updating
