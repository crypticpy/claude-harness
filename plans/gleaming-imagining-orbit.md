# Add "Paid" Count to Dashboard Stats

## Overview
Wire up backend to track and return `paidRequests` count for the dashboard stats, then update frontend to display it.

## Current State
- `RequestStatus` enum already includes `paid` status
- `PurchaseRequest` model has `paidAt` and `paidById` fields
- Dashboard stats don't currently count/return paid requests
- Frontend has placeholder `paidCount = 0` on /requests page

---

## Backend Changes

### File: `backend/src/services/purchaseRequest.service.ts`
**Method:** `getDashboardStats()` (around line 1339-1475)

Add `paid` count to the `myRequests` object in the response.

The `groupBy` query already groups by status - just need to:
1. Ensure `paid` status is included in the response
2. Update TypeScript types if needed

### Response Shape Update
```typescript
myRequests: {
  pending_approval: number;
  approved: number;
  draft: number;
  rejected: number;
  paid: number;      // ← ADD THIS
  closed: number;    // ← ADD THIS if missing
}
```

---

## Frontend Changes

### File: `frontend/packages/data/src/hooks/services/useDashboard.ts`

Update `DashboardStats` interface and `fetchDashboardStats` to include `paidRequests`:

```typescript
interface DashboardStats {
  totalRequests: number;
  pendingApprovals: number;
  completedRequests: number;
  pendingInvoices: number;
  monthlySpend: number;
  paidRequests: number;  // ← ADD
}
```

Update calculation (around line 100-106):
```typescript
return {
  // ... existing
  paidRequests: requestStats?.myRequests?.paid || 0,
};
```

### File: `frontend/apps/web/src/app/requests/Client.tsx`

Replace placeholder with real data:
```typescript
// Before:
const paidCount = 0;

// After:
const paidCount = stats?.paidRequests ?? 0;
```

---

## Files to Modify

| File | Change |
|------|--------|
| `backend/src/services/purchaseRequest.service.ts` | Ensure `paid` is returned in myRequests stats |
| `frontend/packages/data/src/hooks/services/useDashboard.ts` | Add `paidRequests` to interface and return |
| `frontend/apps/web/src/app/requests/Client.tsx` | Use real `paidRequests` instead of 0 |

---

## Testing Checklist
- [ ] Backend returns `paid` count in dashboard stats response
- [ ] Frontend displays correct paid count on /requests page
- [ ] Count updates when requests are marked as paid
