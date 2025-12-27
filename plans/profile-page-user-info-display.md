# Implementation Plan: Fix Profile Page User Information Display

Created: 2025-12-18
Status: PENDING APPROVAL

## Summary

The `/profile` page doesn't display user information while the admin user manager at `/admin/approvers` does. The root cause is that the backend `getCurrentUserProfile` service method returns data but the `preferences` field is stored as a Prisma JSON type. When the database has no preferences stored (or `null`), it returns `null` which causes the frontend to display no data. Additionally, the `division` field is returned as an incomplete object without optional `code` field.

## Root Cause Analysis

After reviewing the code:

1. **Backend `getCurrentUserProfile` (user.service.ts:153-179)** returns:
   - Basic user fields (name, email, jobTitle, phone, officeLocation)
   - Role flags (isAdmin, isManager, isBudgetManager, etc.)
   - `preferences: true` - which means "include this field"
   - `division: { select: { id: true, name: true } }` - partial division object

2. **Frontend Profile Client.tsx** displays:
   - `user?.name` at line 277
   - `user?.email` at line 285
   - `user?.jobTitle` at line 302
   - `user?.division?.name` at line 330
   - `user?.phone` at line 366
   - `user?.officeLocation` at line 384
   - `user?.preferences?.theme` at line 438
   - `user?.preferences?.emailNotifications` at line 442

3. **Likely Issue**: The `preferences` field in the database may be:
   - `null` (never set)
   - An empty JSON object `{}`
   - A JSON object missing expected keys (`theme`, `emailNotifications`)

   When Prisma returns `null` for preferences, the frontend shows defaults but if the entire user object is somehow not being returned properly, nothing displays.

4. **Verification Needed**: The most likely cause is that the API is returning data but either:
   - The `useCurrentUser` hook isn't receiving data properly
   - There's a conditional rendering issue where `user` is undefined/null
   - The `isAuthenticated` flag isn't being set properly after login

## Scope

### In Scope
- Fix backend `getCurrentUserProfile` to ensure complete data return with proper defaults
- Ensure `preferences` field returns with default values if null in database
- Verify frontend `useCurrentUser` hook receives and passes data correctly
- Add defensive fallbacks for optional fields

### Out of Scope
- Admin user manager functionality (already working)
- User update/edit functionality
- Role management changes

## Prerequisites
- Access to backend and frontend codebases
- Ability to test with a logged-in user

## Implementation Phases

### Phase 1: Backend - Ensure Complete User Profile Data

**Objective**: Make `getCurrentUserProfile` return complete data with defaults for null fields

**Files to Modify**:
- `backend/src/services/user.service.ts` - Enhance getCurrentUserProfile method to provide defaults

**Steps**:
1. Modify `getCurrentUserProfile` to provide default preferences if null
2. Ensure division object is always returned (even if null, explicitly)
3. Add proper type casting for the return

**Verification**:
- [ ] API returns complete user object with preferences defaults
- [ ] Test with user that has null preferences in database

### Phase 2: Frontend - Add Defensive Handling

**Objective**: Ensure frontend gracefully handles missing/null data

**Files to Modify**:
- `frontend/apps/web/src/app/profile/Client.tsx` - Add better null handling

**Steps**:
1. Add default values for preferences when destructuring user data
2. Ensure loading states don't prematurely render empty content
3. Add debug logging to identify if data is missing

**Verification**:
- [ ] Profile page displays data when user is logged in
- [ ] Page handles missing preferences gracefully

### Phase 3: Debug and Test

**Objective**: Verify the fix works end-to-end

**Steps**:
1. Test login flow
2. Navigate to /profile
3. Verify all sections display data:
   - Account Information (Name, Email, Job Title, Division)
   - Contact Information (Phone, Office Location)
   - Assigned Roles
   - Preferences (Theme, Email Notifications)

**Verification**:
- [ ] All profile sections show data
- [ ] Edit mode works correctly
- [ ] Save changes persists properly

## Testing Strategy
- Manual testing with different user accounts (admin, regular user)
- Test users with null preferences vs existing preferences
- Test users with and without divisions assigned

## Rollback Plan
- Revert changes to `user.service.ts`
- Revert changes to `Client.tsx`
- Both files have simple modifications that can be easily reverted

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Preferences default structure doesn't match expected | Medium | Medium | Verify UserPreferences interface and provide matching defaults |
| Breaking other components using getCurrentUserProfile | Low | High | Only adding defaults, not changing existing data structure |

## Open Questions
- Are users expected to have preferences populated by default on account creation?
- Should we add a database migration to ensure all users have default preferences?

---
**USER: Please review this plan. Edit any section directly in this file, then confirm to proceed.**
