# Implementation Plan: Fix Profile Page Display Issues (Race Condition + Cache Pollution)

Created: 2025-12-18
Status: PENDING APPROVAL

## Summary

The profile page has TWO related issues:

1. **Intermittent display failure**: Race condition between auth hydration and React Query causing data to not load
2. **Cross-user cache pollution**: When rapidly switching users, profile shows previous user's data because `['currentUser']` query key doesn't include user ID

Both issues stem from the `useCurrentUser` hook not properly handling auth state and user identity.

## Root Cause Analysis

### The Race Condition

1. **Page Load Sequence**:
   - Next.js renders the profile page
   - `useAuthStore()` returns initial state with `isAuthenticated: false` (before hydration)
   - `useCurrentUser()` hook has `enabled: isAuthenticated` which evaluates to `false`
   - React Query marks the query as **disabled** and never fetches
   - Zustand hydration completes, `isAuthenticated` becomes `true`
   - BUT React Query doesn't automatically re-evaluate `enabled` for disabled queries in all scenarios

2. **Why It's Intermittent**:
   - Depends on timing of localStorage read vs component render
   - Faster machines/cached localStorage may hydrate before first render
   - Slower machines or browser throttling causes the race condition

3. **Current Profile Page Issues** (`Client.tsx`):
   - Uses `hasMounted` state but doesn't wait for `_hasHydrated`
   - Checks `isAuthenticated` from auth store but not hydration status
   - Loading condition doesn't account for hydration timing:
     ```typescript
     if (!hasMounted || isLoading || (isAuthenticated && !user && isFetching))
     ```
   - When `isAuthenticated` is initially `false`, this condition passes and renders empty content

4. **useCurrentUser Hook Issue** (`useUser.ts`):
   - `enabled: isAuthenticated` - doesn't wait for hydration
   - Query may be permanently disabled if `isAuthenticated` is `false` at mount time

### The Cache Pollution Issue

1. **Query Key Problem**:
   - Current: `queryKey: ['currentUser']` - no user identifier
   - All users share the same cache entry
   - `staleTime: 10 minutes` means cached data is served without refetch

2. **Rapid User Switching Sequence**:
   - Admin logs in → profile fetched, cached as `['currentUser']`
   - Admin logs out → cache NOT cleared
   - Manager logs in quickly → React Query sees "fresh" cache
   - Profile displays Admin's data (wrong user!)

3. **Why Logout Doesn't Clear Cache**:
   - `useAuthStore.logout()` clears localStorage and axios headers
   - BUT it doesn't call `queryClient.clear()` or invalidate queries
   - React Query cache persists across auth state changes

## Scope

### In Scope
- Fix profile page to wait for auth hydration before rendering
- Fix `useCurrentUser` hook to properly wait for hydration
- Ensure consistent behavior across all page loads

### Out of Scope
- AuthGuard component (already handles `_hasHydrated` correctly)
- Other pages that use AuthGuard wrapper
- Backend changes

## Prerequisites
- Understanding of Zustand persist middleware hydration
- Understanding of React Query enabled conditions

## Implementation Phases

### Phase 1: Fix useCurrentUser Hook

**Objective**: Ensure the query doesn't permanently disable itself before hydration completes

**Files to Modify**:
- `frontend/packages/data/src/hooks/services/useUser.ts`

**Changes**:
```typescript
export const useCurrentUser = () => {
  const { isAuthenticated, _hasHydrated } = useAuthStore();
  return useQuery({
    queryKey: ['currentUser'],
    queryFn: () => usersApi.getProfile(),
    // Only enable query after hydration AND when authenticated
    enabled: _hasHydrated && isAuthenticated,
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 30,
    retry: (failureCount, error: any) => {
      if (isAuthError(error)) return false;
      return failureCount < 2;
    },
  });
};
```

**Verification**:
- [ ] Query waits for `_hasHydrated` before evaluating `enabled`
- [ ] Query runs correctly after hydration when authenticated

### Phase 2: Fix Profile Page Client Component

**Objective**: Ensure profile page waits for auth hydration and handles all states correctly

**Files to Modify**:
- `frontend/apps/web/src/app/profile/Client.tsx`

**Changes**:
1. Import `_hasHydrated` from auth store
2. Add hydration check to loading condition
3. Make loading state more robust

```typescript
export default function Client() {
  const router = useRouter();
  const { isAuthenticated, _hasHydrated } = useAuthStore();
  const { data: user, isLoading, error, isFetching } = useCurrentUser();
  // ... rest of component

  // Loading state - wait for hydration first
  if (!_hasHydrated || !hasMounted || isLoading || (isAuthenticated && !user && isFetching)) {
    return (
      <DashboardLayout activeNav="dashboard">
        <Container maxWidth="lg">
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
            <CircularProgress />
          </Box>
        </Container>
      </DashboardLayout>
    );
  }
```

**Verification**:
- [ ] Loading spinner shows until hydration completes
- [ ] User data displays correctly after hydration
- [ ] No flash of empty content

### Phase 3: Add Refetch Trigger After Hydration (Optional Enhancement)

**Objective**: Ensure query refetches if it was disabled during initial render

**Files to Modify**:
- `frontend/packages/data/src/hooks/services/useUser.ts`

**Changes** (if Phase 1 alone doesn't fix):
Add a refetch effect that triggers when hydration completes:

```typescript
export const useCurrentUser = () => {
  const { isAuthenticated, _hasHydrated } = useAuthStore();
  const query = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => usersApi.getProfile(),
    enabled: _hasHydrated && isAuthenticated,
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 30,
    retry: (failureCount, error: any) => {
      if (isAuthError(error)) return false;
      return failureCount < 2;
    },
  });

  // Force refetch when hydration completes and we're authenticated
  // This handles edge case where query was disabled at mount
  React.useEffect(() => {
    if (_hasHydrated && isAuthenticated && !query.data && !query.isFetching) {
      query.refetch();
    }
  }, [_hasHydrated, isAuthenticated, query.data, query.isFetching, query.refetch]);

  return query;
};
```

**Verification**:
- [ ] Query refetches if initially disabled
- [ ] No infinite refetch loops
- [ ] Data displays correctly

## Testing Strategy

### Manual Testing Steps
1. Clear browser localStorage and cookies
2. Login as any user
3. Navigate to /profile
4. Verify user information displays
5. Refresh the page multiple times (test timing variations)
6. Open in incognito mode and repeat
7. Use browser dev tools to throttle CPU and test slow scenarios

### Edge Cases to Test
- [ ] Fresh login → profile page
- [ ] Direct navigation to /profile URL
- [ ] Page refresh while on profile
- [ ] Fast network vs slow network
- [ ] Multiple rapid refreshes

## Rollback Plan

Revert changes to:
- `frontend/packages/data/src/hooks/services/useUser.ts`
- `frontend/apps/web/src/app/profile/Client.tsx`

Both are simple, isolated changes that can be reverted independently.

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Breaking other useCurrentUser consumers | Low | Medium | `_hasHydrated` is already available in auth store |
| Longer loading spinner display | Low | Low | Hydration is fast (<100ms typically) |
| Infinite refetch loop | Low | High | Add proper dependency guards in useEffect |

## Open Questions

1. Should we apply the same `_hasHydrated` check to other data hooks that depend on auth?
2. Should we create a custom hook wrapper that handles hydration waiting automatically?

---
**USER: Please review this plan. Edit any section directly in this file, then confirm to proceed.**
