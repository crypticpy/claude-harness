# Implementation Plan: Notification Bell Navigation

Created: 2025-12-17
Status: APPROVED

## Summary

The notification bell icon in the masthead currently navigates all users to `/approvals/notifications` which is the admin-only "Notification Engine" (for managing notification templates/settings). This causes regular users and managers to see "Access Denied". The solution is to:
1. Create a new user-facing "My Notifications" page at `/notifications` for all users
2. Move the Notification Engine from `/approvals/notifications` to `/admin/notifications` (admin-only)
3. Update the bell icon to navigate to the user-facing `/notifications` page

## Scope

### In Scope
- Create new `/notifications` route for user-facing "My Notifications" page
- Move Notification Engine from `/approvals/notifications` to `/admin/notifications`
- Update Header.tsx bell icon to navigate to `/notifications` instead of `/approvals/notifications`
- Create frontend hook `useMyNotifications` for fetching current user's notifications
- Design and implement the My Notifications page UI with:
  - List of notifications (approval requests, reminders, status changes)
  - Mark as read / Mark all as read functionality
  - Filter by type (approval_required, status_changed, reminder, etc.)
  - Click notification to navigate to relevant page (purchase request, approval, etc.)
- Remove "Notifications" entry from Approvals sidebar section
- Add "Notification Settings" entry to Admin sidebar section (pointing to `/admin/notifications`)

### Out of Scope
- Push notifications / real-time WebSocket updates
- Email notification preferences (already exists at `/notifications/preferences`)
- Changes to the backend notification API (already has all needed endpoints)
- Notification Engine admin functionality changes

## Prerequisites
- Backend notification endpoints already exist and work correctly:
  - `GET /notifications` - fetch user notifications with filters
  - `PUT /notifications/:id/read` - mark as read
  - `PUT /notifications/mark-all-read` - mark all as read
  - `GET /notifications/unread-count` - get badge count
- Frontend API service `notificationsApi` already has methods for these endpoints

## Implementation Phases

### Phase 1: Create Frontend Hook for My Notifications

**Objective**: Add TanStack Query hook for fetching current user's notifications

**Files to Modify**:
- `frontend/packages/data/src/hooks/services/useNotifications.ts` - Add `useMyNotifications` and `useMarkNotificationAsRead` hooks

**Steps**:
1. Add `useMyNotifications(filters)` hook that calls `notificationsApi.getAll()`
2. Add `useMarkNotificationAsRead()` mutation hook
3. Add `useMarkAllNotificationsAsRead()` mutation hook
4. Export new hooks from package index

**Verification**:
- [ ] Hooks compile without TypeScript errors
- [ ] Can import hooks from `@aph/data`

### Phase 2: Create My Notifications Page

**Objective**: Build the user-facing notifications page at `/notifications`

**New Files to Create**:
- `frontend/apps/web/src/app/notifications/page.tsx` - Server component wrapper
- `frontend/apps/web/src/app/notifications/Client.tsx` - Client component with notification list

**Files to Modify**:
- None in this phase

**Steps**:
1. Create page.tsx with dynamic metadata and Client import
2. Create Client.tsx with:
   - DashboardLayout wrapper (activeNav="notifications")
   - PageHeader with title "My Notifications" and subtitle
   - Notification list with filtering tabs (All, Unread, By Type)
   - NotificationCard component for each notification item showing:
     - Icon based on notification type
     - Title and message
     - Timestamp (relative time like "2 hours ago")
     - Unread indicator (dot or background color)
     - Click to navigate to actionUrl if present
   - "Mark all as read" button
   - Empty state when no notifications
3. Style with MUI components consistent with existing pages

**Verification**:
- [ ] Page renders at `/notifications` without errors
- [ ] Notifications display correctly with proper styling
- [ ] Mark as read functionality works
- [ ] Click navigation to actionUrl works

### Phase 3: Update Header Bell Icon Navigation

**Objective**: Change bell icon to navigate to `/notifications` instead of `/approvals/notifications`

**Files to Modify**:
- `frontend/packages/ui-components/src/components/layout/Header.tsx` - Change handleNotifications route

**Steps**:
1. Update `handleNotifications()` function to navigate to `/notifications`
2. Update badge logic to show for all authenticated users (not just admin/approver)

**Verification**:
- [ ] Bell icon navigates to `/notifications`
- [ ] Badge shows notification count for all users

### Phase 4: Move Notification Engine to Admin Section

**Objective**: Relocate Notification Engine from `/approvals/notifications` to `/admin/notifications`

**Files to Move/Create**:
- Move `frontend/apps/web/src/app/approvals/notifications/page.tsx` → `frontend/apps/web/src/app/admin/notifications/page.tsx`
- Move `frontend/apps/web/src/app/approvals/notifications/Client.tsx` → `frontend/apps/web/src/app/admin/notifications/Client.tsx`

**Files to Modify**:
- `frontend/apps/web/src/app/admin/notifications/Client.tsx` - Update breadcrumbs and access control to admin-only

**Steps**:
1. Create `/admin/notifications/` directory
2. Create new page.tsx with admin metadata
3. Create new Client.tsx based on existing, but:
   - Change access control from `isAdmin || isApprover` to `isAdmin` only
   - Update breadcrumbs to show Admin > Notification Settings
   - Update page title to "Notification Settings" or "Notification Engine"
4. Delete old `/approvals/notifications/` directory

**Verification**:
- [ ] Page renders at `/admin/notifications` for admins
- [ ] Non-admins get Access Denied at `/admin/notifications`
- [ ] Old `/approvals/notifications` route returns 404

### Phase 5: Update Sidebar Navigation

**Objective**: Remove "Notifications" from Approvals and add "Notification Settings" to Admin

**Files to Modify**:
- `frontend/packages/ui-components/src/components/layout/Sidebar.tsx` - Update navigation structure

**Steps**:
1. Remove the "approvals-notifications" child item from the Approvals section
2. Add new "admin-notifications" child item to the Admin section with:
   - id: 'admin-notifications'
   - label: 'Notification Settings'
   - icon: NotificationsIcon (import from @mui/icons-material)
   - path: '/admin/notifications'

**Verification**:
- [ ] "Notifications" no longer appears under Approvals
- [ ] "Notification Settings" appears under Administration for admins
- [ ] Clicking "Notification Settings" navigates to `/admin/notifications`

### Phase 6: Update DashboardLayout Badge Logic

**Objective**: Show notification badge for all users, not just admins/approvers

**Files to Modify**:
- `frontend/packages/ui-components/src/components/layout/DashboardLayout.tsx` - Update badge visibility logic

**Steps**:
1. Change `showNotificationBadge` from `user?.isAdmin || user?.isApprover` to `true` (all authenticated users)
2. The count already uses `usePendingApprovalCount()` which may need adjustment for regular users
3. Consider whether to use unread notification count instead of pending approval count for regular users

**Note**: This phase may need discussion - should the badge show:
- Pending approvals count (current) - only relevant for approvers
- Unread notifications count - relevant for all users
- Both combined - more comprehensive

**Verification**:
- [ ] All users see notification badge when they have notifications
- [ ] Badge count accurately reflects user's actionable items

## Testing Strategy

**Manual Testing**:
1. Log in as regular user (`user@aph.com`) - should see bell, click navigates to My Notifications
2. Log in as manager (`manager@aph.com`) - should see bell with approval count
3. Log in as admin (`admin@aph.com`) - should see bell, can also access Notification Engine via sidebar
4. Create a notification for a user, verify it appears in their notifications
5. Mark notification as read, verify UI updates
6. Click notification with actionUrl, verify navigation works

**Unit Tests** (optional, time permitting):
- Test `useMyNotifications` hook returns correct data
- Test notification filtering logic

## Rollback Plan

1. Revert Header.tsx to navigate to `/approvals/notifications`
2. Revert DashboardLayout badge logic
3. Revert Sidebar to include original "Notifications" item
4. Delete `/notifications` route if created

Changes are isolated to frontend navigation - no backend or database changes.

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Users confused by new page location | Low | Low | Clear page title and breadcrumbs |
| Badge count inconsistent across user types | Medium | Medium | Phase 5 addresses this with discussion |
| Notification Engine access lost | Low | Medium | Keep admin direct URL access, optionally add to admin menu |

## Open Questions (Resolved)

1. **Badge count source**: Will use unread notification count for all users (more universal)

2. **Sidebar "Notifications" item**: ✅ RESOLVED - Move to Admin section as "Notification Settings"

3. **Empty state for regular users**: Show friendly message like "You're all caught up! No new notifications."

---
**Status: APPROVED - Ready for implementation**
