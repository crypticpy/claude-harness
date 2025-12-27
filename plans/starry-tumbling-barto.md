# Fix Approval Count Discrepancy - Show Both Counts

## Problem
When logged in as admin, the pending approval badge shows "3" but the list displays 10 requests. The count only reflects direct assignments while the list shows all pending requests visible to the user.

## Solution
Display both counts: "X assigned to you" and "Y total pending" for admins (and potentially all users with visibility to more than their direct assignments).

---

## Implementation Plan

### 1. Backend: Extend Pending Count API

**File**: `backend/src/services/approval.service.ts` (lines 656-672)

Update `getPendingCount()` to return an object with both counts:

```typescript
async getPendingCounts(userId: string, isAdmin: boolean): Promise<{
  assignedToUser: number;
  totalPending: number;
}> {
  // Count directly assigned to user
  const assignedToUser = await this.prisma.approval.count({
    where: {
      status: 'pending',
      OR: [
        { approverId: userId },
        { delegateApproverId: userId }
      ]
    }
  });

  // Count total pending (for admins: all, for others: same as assigned)
  const totalPending = isAdmin
    ? await this.prisma.purchaseRequest.count({
        where: { status: 'pending_approval', deletedAt: null }
      })
    : assignedToUser;

  return { assignedToUser, totalPending };
}
```

**File**: `backend/src/controllers/approval.controller.ts` (lines 280-305)

Update `getPendingCount()` to:
1. Get `isAdmin` from the authenticated user
2. Call the new service method
3. Return both counts in response

### 2. Frontend: Update Hook

**File**: `frontend/packages/data/src/hooks/services/useApprovals.ts` (lines 171-198)

Update `usePendingApprovalCount()` to return both counts:

```typescript
interface PendingApprovalCounts {
  assignedToUser: number;
  totalPending: number;
}

export function usePendingApprovalCount() {
  return useQuery<PendingApprovalCounts>({
    queryKey: ['pendingApprovalCount'],
    queryFn: async () => {
      const response = await approvalsApi.getPendingCount();
      return {
        assignedToUser: response.assignedToUser ?? response.pending ?? 0,
        totalPending: response.totalPending ?? response.pending ?? 0,
      };
    },
    // ... existing options
  });
}
```

**File**: `frontend/packages/data/src/lib/api/services/approvals.ts` (lines 107-119)

Update response type to handle both counts.

### 3. Frontend: Update Sidebar Badge

**File**: `frontend/packages/ui-components/src/components/layout/Sidebar.tsx`

The sidebar currently receives `approvalsBadgeCount` prop. Options:
- Keep showing `assignedToUser` in badge (the actionable count)
- Or show `totalPending` for admins

**Recommendation**: Show `assignedToUser` in sidebar badge (items requiring YOUR action).

### 4. Frontend: Update Approvals Page Header

**File**: `frontend/apps/web/src/app/approvals/Client.tsx`

Add a summary header showing both counts:

```tsx
<Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
  <Chip label={`${counts.assignedToUser} assigned to you`} color="primary" />
  {counts.totalPending > counts.assignedToUser && (
    <Chip label={`${counts.totalPending} total pending`} variant="outlined" />
  )}
</Box>
```

---

## Files to Modify

| File | Change |
|------|--------|
| `backend/src/services/approval.service.ts` | Add `getPendingCounts()` method returning both counts |
| `backend/src/controllers/approval.controller.ts` | Update controller to use new method, pass isAdmin |
| `frontend/packages/data/src/lib/api/services/approvals.ts` | Update return type |
| `frontend/packages/data/src/hooks/services/useApprovals.ts` | Return both counts from hook |
| `frontend/apps/web/src/app/approvals/Client.tsx` | Display both counts in header |
| `frontend/packages/ui-components/src/components/layout/DashboardLayout.tsx` | Pass correct count to sidebar |

---

## Testing Checklist

- [ ] Admin sees "X assigned to you" and "Y total pending" on approvals page
- [ ] Non-admin only sees their assigned count (or both if they have delegations)
- [ ] Sidebar badge shows actionable count (assigned to user)
- [ ] Counts update correctly after approval/rejection actions
- [ ] TypeScript compiles without errors
