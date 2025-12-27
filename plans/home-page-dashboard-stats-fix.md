# Implementation Plan: Fix Home Page Dashboard Stats Showing Same Numbers for All Users

Created: 2025-12-18
Status: PENDING APPROVAL

## Summary

The home page dashboard shows identical numbers (stats) for all users (admin, manager, regular user) when each user should see their own personalized data. The root cause is that the backend `getDashboardStats` service calculates `totalRequests` and `spendingByStatus/spendingByDivision` **system-wide** without filtering by user, while only `myRequests` and `pendingApprovals` are correctly filtered by `userId`.

## Root Cause Analysis

### Backend Issue (purchaseRequest.service.ts:1021-1157)

The `getDashboardStats` method has **MIXED filtering**:

| Stat | Current Behavior | Expected |
|------|------------------|----------|
| `totalRequests` | System-wide count (no userId filter) | Should be user's own requests count |
| `pendingApprovals` | User-filtered (currentApproverId = userId) | Correct |
| `myRequests` | User-filtered (requesterId = userId) | Correct |
| `recentActivity` | User-filtered (requesterId OR currentApproverId = userId) | Correct |
| `spendingByStatus` | System-wide (no userId filter) | Should be user's own spending |
| `spendingByDivision` | System-wide (no userId filter) | Should be user's own divisions |

### Frontend Issue (useDashboard.ts:97-103)

The frontend correctly calculates `totalRequests` from `myRequests` breakdown:
```typescript
const totalRequests =
  (requestStats?.myRequests?.pending_approval || 0) +
  (requestStats?.myRequests?.approved || 0) +
  (requestStats?.myRequests?.draft || 0) +
  ...
```

But `monthlySpend` uses the system-wide `spendingByStatus`:
```typescript
const monthlySpend = (requestStats?.spendingByStatus || []).reduce(...)
```

### Why All Users See Same Numbers

1. **"My Total Requests"** card: Frontend calculates from `myRequests` which IS user-filtered - should work
2. **"Pending Approval"** card: Uses `pendingApprovals` which IS user-filtered - should work
3. **"Completed"** card: Uses `myRequests.approved` which IS user-filtered - should work
4. **"Pending Invoices"** card: Uses `invoiceStats.pending` - likely system-wide
5. **"Total Spend"** card: Uses `spendingByStatus` which is NOT user-filtered - **BUG**

Wait - if frontend calculates from `myRequests`, why do they see same numbers?

Let me verify: The issue might be that all demo users are seeing the **same myRequests data** because they might be:
1. Somehow all resolving to same userId
2. The API is returning cached/shared data
3. The demo users created the same requests

Actually, reviewing more carefully - if `myRequests` is correctly filtered by `requesterId = userId`, and each user has different `requesterId`, they SHOULD see different numbers. Unless the demo users don't have distinct purchase requests.

### Most Likely Actual Issue

The demo users (admin, manager, user) likely:
1. All have no purchase requests of their own - showing zeros
2. OR all share the same purchase requests (somehow)
3. OR there's a frontend caching issue where TanStack Query doesn't invalidate per-user

## Scope

### In Scope
- Verify if demo users have distinct purchase requests in database
- Fix backend `spendingByStatus` and `spendingByDivision` to filter by user
- Verify frontend TanStack Query isn't caching cross-user
- Ensure stats are user-scoped

### Out of Scope
- Admin dashboard at `/admin` (uses separate system-wide stats)
- Analytics endpoints

## Prerequisites
- Access to database to check demo user data
- Ability to login as different users to test

## Implementation Phases

### Phase 1: Verify Demo Data

**Objective**: Determine if the issue is missing demo data vs code bug

**Steps**:
1. Query database to see purchase requests for each demo user
2. Check if admin, manager, and user accounts have different `requesterId` values
3. Verify test data distribution

**Verification**:
- [ ] Document how many PRs each demo user owns
- [ ] Confirm if data issue or code issue

### Phase 2: Backend - Fix User-Scoped Stats

**Objective**: Ensure all stats are correctly scoped to the requesting user

**Files to Modify**:
- `backend/src/services/purchaseRequest.service.ts` (lines 1021-1157)

**Changes**:
1. Modify `spendingByStatus` query to filter by `requesterId: userId`
2. Modify `spendingByDivision` query to filter by `requesterId: userId`
3. Consider removing the `totalRequests` system-wide count (or rename to `systemTotalRequests`)

**Code Changes**:
```typescript
// Line 1086-1096: Change spendingByStatus to user-scoped
this.prisma.purchaseRequest.groupBy({
  by: ['status'],
  where: {
    requesterId: userId,  // ADD THIS LINE
    deletedAt: null,
    ...(Object.keys(dateFilter).length && { submittedAt: dateFilter }),
  },
  _sum: {
    totalAmount: true,
  },
}),

// Line 1098-1110: Change spendingByDivision to user-scoped
this.prisma.purchaseRequest.groupBy({
  by: ['divisionId'],
  where: {
    requesterId: userId,  // ADD THIS LINE
    deletedAt: null,
    status: 'approved',
    ...(Object.keys(dateFilter).length && { submittedAt: dateFilter }),
  },
  _sum: {
    totalAmount: true,
  },
  _count: true,
}),
```

**Verification**:
- [ ] Backend typecheck passes
- [ ] Manual API test returns different data per user

### Phase 3: Frontend - Verify Query Isolation

**Objective**: Ensure TanStack Query doesn't share cached data across users

**Files to Review**:
- `frontend/packages/data/src/hooks/services/useDashboard.ts`

**Analysis**:
The current query key is:
```typescript
['dashboardStats', 'fiscalYear', options.fromDate, options.toDate]
```

This does NOT include `userId`, meaning if two users have same fiscal year params, they'd share cache. However, the auth store should invalidate on logout/login.

**Steps**:
1. Verify that TanStack Query invalidates on logout
2. Consider adding userId to query key for explicit isolation (optional)

**Verification**:
- [ ] Login as user A, note stats
- [ ] Logout, login as user B, verify different stats
- [ ] No cross-user cache pollution

### Phase 4: Database Seed - Ensure Distinct Test Data

**Objective**: Ensure demo users have distinct purchase requests

**Files to Modify** (if needed):
- `backend/prisma/seed-comprehensive.ts` or related seed file

**Steps**:
1. Review seed script to see PR distribution
2. Ensure admin, manager, and user each create different PRs
3. Re-seed if necessary

**Verification**:
- [ ] Each demo user has unique requests as requester
- [ ] Numbers differ when logged in as different users

## Testing Strategy

1. **Manual Testing**:
   - Login as admin@aph.com → note all 5 stat card values
   - Logout, login as manager@aph.com → compare values (should differ)
   - Logout, login as user@aph.com → compare values (should differ)

2. **API Testing**:
   - Call `GET /api/purchase-requests/dashboard-stats` with each user's token
   - Compare `myRequests` object in response

3. **Database Verification**:
   ```sql
   SELECT requesterId, COUNT(*) as count
   FROM purchase_requests
   GROUP BY requesterId;
   ```

## Rollback Plan

- Revert changes to `purchaseRequest.service.ts`
- If seed data was modified, re-run original seed

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Demo users have no distinct data | High | High | Check database first before code changes |
| Breaking admin analytics | Low | Medium | Admin uses different `/admin/stats` endpoint |
| Cache pollution after fix | Low | Low | Add cache invalidation on user change |

## Open Questions

1. Should we add `userId` to the TanStack Query key for explicit per-user caching?
2. Should the seed script create more diverse test data per user?
3. Is the `totalRequests` (system-wide) value intentional for some dashboard use case?

---
**USER: Please review this plan. Edit any section directly in this file, then confirm to proceed.**
