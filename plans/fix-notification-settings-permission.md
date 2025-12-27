# Implementation Plan: Fix Notification Settings Permission Check

Created: 2025-12-18
Status: PENDING APPROVAL

## Summary

The Notification Settings page shows "Access Denied" for the system administrator due to a race condition between Zustand store hydration and the `useCurrentUser()` TanStack Query hook. The fix will ensure the page waits for both hydration AND user data before rendering the permission check.

## Root Cause Analysis

The permission issue occurs due to the following sequence:

1. Component mounts, `hasMounted` becomes `true`
2. `isAuthenticated` is initially `false` (before Zustand hydration)
3. `useCurrentUser()` hook has `enabled: isAuthenticated` which is `false`
4. TanStack Query returns `{isLoading: false, isFetching: false, data: undefined}`
5. `isAuthLoading = !hasMounted || isLoading || (isAuthenticated && !user && isFetching)` = `false`
6. Since `isAuthLoading` is false, the component renders the permission check
7. `canManageNotifications = user?.isAdmin` = `undefined` (falsy)
8. "Access Denied" is shown even though the user IS an admin

The key issue is that the `useCurrentUser()` hook uses `isAuthenticated` from the auth store, but doesn't account for the hydration delay. When `isAuthenticated` is still `false` (pre-hydration), the query never enables, so `isLoading` is `false` and the page renders prematurely.

## Scope

### In Scope
- Fix the notification settings page permission check race condition
- Ensure the fix is robust and won't regress

### Out of Scope
- Fixing other admin pages (they don't have explicit permission checks)
- Changing the AuthGuard component
- Modifying the useCurrentUser hook globally

## Prerequisites
- Understanding of Zustand persist middleware hydration
- Understanding of TanStack Query enabled state

## Implementation Phases

### Phase 1: Fix the Notification Settings Page

**Objective**: Ensure the page waits for both Zustand hydration AND user data before showing permission denied.

**Files to Modify**:
- `frontend/apps/web/src/app/admin/notifications/Client.tsx` - Fix the loading/permission check logic

**Steps**:

1. Import `_hasHydrated` from `useAuthStore` to detect when hydration is complete
2. Update the `isAuthLoading` condition to include `!_hasHydrated`
3. Add a condition to show loading while the query is in its initial state (not yet enabled)

**Code Changes**:

```typescript
// Before (line 11-27):
const { isAuthenticated } = useAuthStore();
const { data: user, isLoading, isFetching } = useCurrentUser();
const canManageNotifications = user?.isAdmin;

const [hasMounted, setHasMounted] = useState(false);

useEffect(() => {
  setHasMounted(true);
}, []);

const isAuthLoading = !hasMounted || isLoading || (isAuthenticated && !user && isFetching);

// After:
const { isAuthenticated, _hasHydrated } = useAuthStore();
const { data: user, isLoading, isFetching, isPending } = useCurrentUser();
const canManageNotifications = user?.isAdmin;

const [hasMounted, setHasMounted] = useState(false);

useEffect(() => {
  setHasMounted(true);
}, []);

// Show loading while:
// 1. Not yet mounted (SSR/hydration)
// 2. Auth store not yet hydrated from localStorage
// 3. User query is loading
// 4. User query is in initial pending state (enabled but no data yet)
// 5. Authenticated but no user data yet
const isAuthLoading =
  !hasMounted ||
  !_hasHydrated ||
  isLoading ||
  (isAuthenticated && !user && (isFetching || isPending));
```

**Verification**:
- [ ] Login as admin@aph.com
- [ ] Navigate to Administration > Notification Settings
- [ ] Verify the page loads without showing "Access Denied"
- [ ] Verify non-admin users still see "Access Denied"

## Testing Strategy

**Manual Testing Steps**:
1. Login as admin@aph.com (password: ChangeMe123!)
2. Navigate directly to /admin/notifications
3. Verify the notification settings page loads correctly
4. Refresh the page multiple times to test consistency
5. Login as user@aph.com and verify "Access Denied" is shown

**Edge Cases to Test**:
- Hard refresh (Cmd+Shift+R) on the notifications page
- Opening the notifications page in a new tab while logged in
- Slow network conditions (can simulate in DevTools)

## Rollback Plan

If the fix causes issues:
1. Revert the changes to `Client.tsx`
2. The page will return to its previous behavior

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Loading state shows too long | Low | Low | The additional checks add minimal delay |
| Breaking non-admin access denial | Low | Medium | Verify non-admin users still see denied message |
| TanStack Query API change | Very Low | Low | isPending is a stable API in v5+ |

## Open Questions

None - the root cause is clear and the fix is straightforward.

---
**USER: Please review this plan. Edit any section directly in this file, then confirm to proceed.**
