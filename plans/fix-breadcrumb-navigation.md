# Implementation Plan: Fix Breadcrumb Navigation

Created: 2025-12-18
Status: PENDING APPROVAL

## Summary

The breadcrumb links in the application don't navigate when clicked because the `handleBreadcrumbClick` function in `PageHeader.tsx` calls `event.preventDefault()` but only logs the intended path instead of actually navigating. The fix requires importing `useRouter` from Next.js and calling `router.push(path)` to perform the navigation.

## Root Cause Analysis

**File:** `/Users/aiml/Documents/PurchasePro/frontend/packages/ui-components/src/components/base/PageHeader.tsx`

**Problem (lines 55-65):**
```typescript
const handleBreadcrumbClick = useCallback(
  (event: React.MouseEvent<HTMLAnchorElement>, path?: string) => {
    if (!path) {
      event.preventDefault();
      return;
    }
    event.preventDefault();       // <-- Prevents default browser navigation
    logger.info('Navigate to', { path });  // <-- Only logs, doesn't navigate!
  },
  []
);
```

**Why it fails:**
1. The component uses MUI's `Link` with an `href` attribute
2. The `onClick` handler calls `event.preventDefault()` which stops the browser from following the link
3. The handler only logs the navigation intent but never calls `router.push()` to actually navigate
4. The component doesn't import `useRouter` from `'next/navigation'`

**Working pattern (Sidebar.tsx line 295):**
```typescript
router.push(item.path);  // Correctly navigates using Next.js router
```

## Scope

### In Scope
- Fix the `handleBreadcrumbClick` function in `PageHeader.tsx` to actually navigate
- Add necessary `useRouter` import from `'next/navigation'`

### Out of Scope
- Changes to breadcrumb data structures passed by pages
- Changes to MUI Breadcrumbs styling
- Changes to other navigation components (they already work)

## Prerequisites
- None

## Implementation Phases

### Phase 1: Fix PageHeader Breadcrumb Navigation

**Objective:** Make breadcrumb links perform actual navigation when clicked

**Files to Modify:**
- `/Users/aiml/Documents/PurchasePro/frontend/packages/ui-components/src/components/base/PageHeader.tsx`

**Changes Required:**

1. **Add `useRouter` import (line 2):**
   ```typescript
   import { useRouter } from 'next/navigation';
   ```

2. **Initialize router in component (after line 53):**
   ```typescript
   const router = useRouter();
   ```

3. **Update `handleBreadcrumbClick` to navigate (lines 55-65):**
   ```typescript
   const handleBreadcrumbClick = useCallback(
     (event: React.MouseEvent<HTMLAnchorElement>, path?: string) => {
       if (!path) {
         event.preventDefault();
         return;
       }
       event.preventDefault();
       router.push(path);  // <-- Actually navigate
     },
     [router]
   );
   ```

**Verification:**
- [ ] Click on any non-last breadcrumb item and verify navigation occurs
- [ ] Verify the last breadcrumb item (current page) remains non-clickable
- [ ] Test breadcrumb navigation on multiple pages (requests, approvals, admin)
- [ ] Verify browser back button works correctly after breadcrumb navigation

## Testing Strategy

**Manual Testing:**
1. Navigate to a detail page (e.g., `/requests/[id]`)
2. Click on "Home" breadcrumb - should navigate to `/`
3. Click on "My Requests" breadcrumb - should navigate to `/requests`
4. Use browser back button - should return to previous page
5. Repeat on admin pages and approval pages

**Pages to Test:**
- `/requests/[id]/page.tsx` - Request detail
- `/approvals/[id]/Client.tsx` - Approval detail
- `/admin/requests/page.tsx` - Admin requests
- `/invoices/[id]/page.tsx` - Invoice detail
- `/profile/Client.tsx` - Profile page

## Rollback Plan

If issues occur, revert the three changes:
1. Remove the `useRouter` import
2. Remove the `router = useRouter()` initialization
3. Restore the original `handleBreadcrumbClick` that only logs

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Breaking existing breadcrumb styling | Low | Low | Only logic changes, no CSS/styling modifications |
| Router hook causing SSR issues | Low | Medium | Component already marked `'use client'` - router is safe |
| Infinite re-renders from router in dependency array | Low | Medium | `router` from `useRouter()` is stable, won't cause issues |

## Open Questions
- None - the fix is straightforward and follows existing patterns in the codebase

---
**USER: Please review this plan. Edit any section directly in this file, then confirm to proceed.**
