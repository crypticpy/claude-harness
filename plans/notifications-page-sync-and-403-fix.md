# Implementation Plan: Fix Notifications Page Issues (Badge Sync, Tab Counts, 403 Errors, Mark All as Read)

Created: 2025-12-18
Status: PENDING APPROVAL

## Summary

The notifications page has multiple interconnected issues:
1. **Unread badge out of sync**: The header bell icon count doesn't match the notifications page
2. **Tab-switching badge changes**: The unread count changes incorrectly when switching tabs
3. **403 Forbidden errors**: Delete and mark-as-read operations fail with 403 errors
4. **Mark All as Read not working**: Shows success toast but doesn't actually update notifications

## Root Cause Analysis

### Issue 1 & 2: Badge Sync and Tab Switching

**Current Behavior:**
- The `GET /notifications` endpoint (used by `useMyNotifications`) does **not** filter by the current user's ID automatically
- Looking at `notification.controller.ts:246-263`, the `getAll` method uses `req.query` directly without injecting `userId` from the JWT
- This means the frontend query may be returning notifications for ALL users (or none if no userId filter is passed)
- The backend `query()` method in `notification.service.ts:367-444` checks for `filters.userId` but doesn't require it

**Root Cause:**
The `GET /notifications` endpoint should automatically scope to the authenticated user (like `getUnreadCount` does), but instead it just passes through query params. When no `userId` is passed, the query doesn't filter by user.

### Issue 3: 403 Forbidden Errors

**Current Behavior:**
- `markAsRead` and `delete` operations use JWT `req.userId` correctly (SEC-BE-012 FIX)
- The service layer checks `notification.userId !== userId` and throws 403

**Root Cause:**
The 403 errors occur because:
1. The notifications being displayed may not belong to the current user (due to Issue 1)
2. When the user tries to mark-as-read or delete, the ownership check correctly fails
3. The frontend is showing notifications that don't belong to the current user, so actions fail

### Issue 4: Mark All as Read Not Working

**Current Behavior:**
- Frontend calls `PUT /notifications/mark-all-read`
- Controller gets `userId` from JWT (`req.userId`)
- Service calls `updateMany` with `where: { userId, isRead: false }`
- Frontend shows success toast and invalidates queries
- BUT the list doesn't update

**Root Cause:**
This is a **combination** of the above issues:
1. `markAllAsRead` works correctly on the backend (updates the current user's notifications)
2. BUT the notifications list query (`GET /notifications`) isn't scoped to the current user
3. So after marking all as read, the refetch still returns other users' notifications (or unfiltered data)
4. The toast shows success because the mutation succeeded, but the list doesn't reflect the change

### Verification

Looking at the code flow:
1. `useMyNotifications(filters)` → `notificationsApi.getAll(filters)` → `GET /notifications?{filters}`
2. Backend `getAll` → `notificationService.query(req.query as any)` - **NO userId injection from JWT**
3. `query()` method: `if (filters.userId) { where.userId = filters.userId }` - userId is OPTIONAL

The fix is clear: The `GET /notifications` endpoint must inject `req.userId` into the query filters to scope results to the authenticated user.

## Scope

### In Scope
1. Fix backend `GET /notifications` to always scope to authenticated user
2. Ensure all notification queries return only the current user's notifications
3. Verify 403 errors are resolved after fix
4. Verify Mark All as Read works after fix
5. Verify badge sync between header and page

### Out of Scope
- Admin functionality to view all notifications (can be a separate endpoint)
- Email notification issues
- Push notification issues

## Prerequisites
- Backend server accessible for testing
- Test accounts with notifications

## Implementation Phases

### Phase 1: Fix Backend GET /notifications to Scope by User

**Objective**: Ensure the main notifications query endpoint always returns only the current user's notifications

**Files to Modify**:
- `backend/src/controllers/notification.controller.ts`

**Changes**:
```typescript
// In getAll method (lines 246-263)
async getAll(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // CRITICAL FIX: Always scope to authenticated user
    // This prevents returning other users' notifications and fixes 403 errors
    // when users try to interact with notifications that don't belong to them
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const { data, total } = await this.notificationService.query({
      ...(req.query as any),
      userId, // Always inject authenticated user's ID
    });

    res.json({
      success: true,
      data,
      meta: {
        total,
        page: Number(req.query.page) || 1,
        limit: Number(req.query.limit) || 10,
      },
    });
  } catch (error) {
    next(error);
  }
}
```

**Verification**:
- [ ] Backend returns only current user's notifications
- [ ] Query params (type, isRead, page, limit) still work correctly
- [ ] 403 errors on delete/mark-as-read are resolved
- [ ] Mark All as Read properly updates the displayed list

### Phase 2: Verify Frontend Type Filter Handling

**Objective**: Ensure tab filtering works correctly with the fixed backend

**Files to Review** (no changes expected):
- `frontend/apps/web/src/app/notifications/Client.tsx`
- `frontend/packages/data/src/lib/api/services/notifications.ts`

**Current Frontend Logic** (should work correctly after backend fix):
```typescript
// Client.tsx - filters based on active tab
const filters = React.useMemo(() => {
  switch (activeTab) {
    case 'unread':
      return { isRead: false };
    case 'approval_required':
    case 'status_changed':
    case 'reminder':
      return { type: [activeTab] as NotificationType[] };
    default:
      return {};
  }
}, [activeTab]);
```

The frontend already passes correct filters. The issue was that the backend wasn't scoping to the user.

**Verification**:
- [ ] "All" tab shows all user's notifications
- [ ] "Unread" tab shows only unread notifications
- [ ] "Approvals" tab shows only approval_required type
- [ ] "Status Updates" tab shows only status_changed type
- [ ] "Reminders" tab shows only reminder type
- [ ] Badge count is consistent across all tabs

### Phase 3: Verify Cache Invalidation Works Correctly

**Objective**: Ensure React Query properly refreshes data after mutations

**Files to Review** (no changes expected):
- `frontend/packages/data/src/hooks/services/useNotifications.ts`

**Current Implementation** (should work after backend fix):
```typescript
// useMarkAllNotificationsAsRead already invalidates correctly
onSuccess: () => {
  queryClient.invalidateQueries({ queryKey: ['myNotifications'] });
  queryClient.invalidateQueries({ queryKey: ['unreadNotificationCount'] });
  addNotification({
    type: 'success',
    title: 'Success',
    message: 'All notifications marked as read.',
  });
},
```

**Verification**:
- [ ] After marking notification as read, list updates immediately
- [ ] After marking all as read, list updates immediately
- [ ] After deleting notification, list updates immediately
- [ ] Header badge updates after any mutation

## Testing Strategy

### Manual Testing Steps
1. Login as user with notifications
2. Navigate to /notifications
3. Verify header bell badge matches "Unread" tab count
4. Click on tabs and verify:
   - Badge count remains consistent for unread count
   - List filters correctly by type
5. Try to delete a notification - should succeed
6. Try to mark a notification as read - should succeed
7. Click "Mark All as Read" - should:
   - Show success toast
   - Update all visible unread notifications to read state
   - Update header badge to 0 (or reduced count)
8. Switch tabs and verify counts are still correct

### Edge Cases to Test
- [ ] User with 0 notifications
- [ ] User with only read notifications
- [ ] User with only unread notifications
- [ ] Multiple rapid clicks on "Mark All as Read"
- [ ] Tab switching during mutation

## Rollback Plan

Revert changes to:
- `backend/src/controllers/notification.controller.ts`

Single file change, easily reversible.

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Breaking admin notification views | Low | Medium | Admin can use separate `/user/:userId` endpoint |
| Performance regression from forcing userId filter | Very Low | Low | userId is indexed, query should be faster with filter |
| Other consumers of GET /notifications affected | Low | Medium | This endpoint should always be user-scoped |

## Open Questions

1. Should there be a separate admin endpoint for viewing all notifications?
   - Currently `/notifications/user/:userId` exists but requires knowing the userId
   - Could add `/notifications/admin` endpoint for admin use cases

---
**USER: Please review this plan. Edit any section directly in this file, then confirm to proceed.**
