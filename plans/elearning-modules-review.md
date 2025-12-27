# Implementation Plan: E-Learning Modules Review and Update

Created: 2025-12-17
Status: PENDING APPROVAL

## Summary

Review and update all e-learning training modules to ensure they accurately reflect the current state of the PurchasePro application after recent significant changes. Identify gaps where new modules should be created to cover features not currently in the training content suite.

## Analysis Summary

### Current E-Learning Content Suite

**Interactive Training Modules (8 scenarios in `tours.ts` + `DemoScenarios.tsx`):**
1. Site Overview - Basic navigation tour
2. Create a Purchase Request - 6 steps through PR wizard
3. Approve a Purchase Request - 8 steps through approval workflow
4. Submit an Invoice - 5 steps through invoice submission
5. Explore Admin Dashboard - 4 steps for admin analytics
6. Track Your Requests - 3 steps for request list
7. Manage Invoices - 3 steps for invoice list
8. Admin: All Requests - 3 steps for admin request management
9. Admin: Approver Management - 2 steps for user management

**Help Documentation:**
- FAQs: 27 questions across 8 categories
- Documentation: 6 guide sections with 53 topics

### Recent Application Changes (Last 20 Commits)

| Feature | Change Type | Affects E-Learning? |
|---------|-------------|---------------------|
| Object Codes with Reference Guide Modal | New Feature | YES - Not covered |
| APH Organizational Structure (Divisions/Units) | New Feature | YES - Not covered |
| Notifications Restructure (User + Admin views) | Major Change | YES - Not covered |
| Delegations "to-me" view with tabs | Major Change | YES - Partially covered |
| Budget Controls for Finance Team | New Feature | YES - Not covered |
| Approver Selection in PR Wizard | New Feature | YES - Not covered |
| Request Account Modal | New Feature | YES - Not covered |
| Approval Notification Events | Enhancement | NO - Backend only |
| request_revision Decision Type | New Feature | YES - Not covered |

## Issues Found

### Module Accuracy Issues

1. **Create a Purchase Request Tour (`create-request`)**
   - **Issue**: Step 2 description mentions "funding sources with amounts and object codes" but doesn't mention the new Object Code Reference Guide modal
   - **Issue**: Step 3 title is "Purchase Notes" but the actual step is now "Item Details" with title/notes fields
   - **Missing**: No mention of approver selection functionality added in recent update

2. **Approve a Purchase Request Tour (`approve-request`)**
   - **Issue**: Missing coverage of "request_revision" decision option (added in recent commits)
   - Step descriptions don't mention the revision request workflow

3. **Site Overview Tour (`site-overview`)**
   - **Issue**: Step for "sidebar-notifications" is missing - Notifications is now a separate nav item
   - **Issue**: Doesn't cover the new notifications page structure

### Missing Tour Markers (data-tour attributes not implemented)

Checking tours.ts against actual implementations:
- `[data-tour="home"]` - EXISTS in HomeClient.tsx
- `[data-tour="new-request"]` - EXISTS in HomeClient.tsx
- `[data-tour="sidebar-requests"]` - EXISTS in Sidebar.tsx
- `[data-tour="sidebar-approvals"]` - EXISTS in Sidebar.tsx
- `[data-tour="sidebar-invoices"]` - EXISTS in Sidebar.tsx
- `[data-tour="sidebar-admin"]` - EXISTS in Sidebar.tsx
- `[data-tour="prw-*"]` - All exist in PurchaseRequestWizard steps
- `[data-tour="approval-*"]` - All exist in ApprovalWizard
- `[data-tour="invoice-*"]` - All exist in InvoiceForm/InvoiceList
- `[data-tour="admin-*"]` - All exist in AdminDashboard and admin pages
- `[data-tour="requests-*"]` - All exist in RequestList
- `[data-tour="invoices-*"]` - All exist in InvoiceList

### Missing E-Learning Coverage (Gaps)

**High Priority - Core Feature Gaps:**

1. **Delegation Management Module** - Only covered at high level in approval tour
   - New "Delegations to Me" tabbed interface not covered
   - Creating/managing delegations not taught
   - Delegation card interactions not covered

2. **Notifications Module** - No dedicated training
   - User notifications page
   - Admin notification settings
   - Notification preferences

3. **Object Code Reference Guide** - No coverage
   - How to use the reference modal
   - Searching/filtering object codes
   - Exporting object code list

4. **Budget Controls Module** (Admin) - No coverage
   - Setting budget limits
   - Editing budget allocations
   - Budget management for finance team

5. **Profile/Settings Module** - No coverage
   - User profile management
   - Notification preferences in settings

**Medium Priority - Enhancement Gaps:**

6. **Request Revision Workflow** - Not covered
   - How approvers request revision
   - How requesters handle revision requests
   - Resubmission process

7. **Approver Selection in PR Wizard** - Not covered
   - Selecting approvers when creating request
   - Understanding approval chain display

8. **Account Request Flow** - Not covered
   - Login page "Request Account" feature
   - Account request form

### FAQ Content Gaps

Missing FAQ topics:
1. How to use the Object Code Reference Guide
2. How to request a revision (for approvers)
3. How to resubmit after revision request
4. How to manage delegations (both directions)
5. How do budget controls work (for admins)
6. How to request a new account

### Documentation Content Gaps

Missing documentation topics:
1. Object Codes guide (reference, search, export)
2. Delegation management guide
3. Budget controls (admin)
4. Account request process
5. Notification configuration

## Scope

### In Scope
- Update existing tour step descriptions for accuracy
- Add missing tour steps for new features
- Create new training modules for uncovered features
- Add missing data-tour attributes where needed
- Update FAQs with new questions
- Update Documentation sections with new topics

### Out of Scope
- Backend changes
- Test coverage changes
- UI/UX redesign of e-learning components
- Video tutorials or multimedia content

## Prerequisites
- Access to all frontend files
- Understanding of current application workflows

## Implementation Phases

### Phase 1: Fix Existing Tour Accuracy Issues
**Objective**: Ensure existing tours accurately describe current UI/UX

**Files to Modify**:
- `frontend/packages/ui-components/src/components/features/demo/tours.ts`
  - Update `create-request` step 2 to mention Object Code Reference
  - Update `create-request` step 3 title from "Purchase Notes" to "Item Details"
  - Add mention of approver selection in `create-request` tour
  - Update `approve-request` tour to include request_revision decision
  - Add step to `site-overview` for notifications navigation

**Steps**:
1. Update `create-request` tour step 2 content to include object code reference
2. Update `create-request` tour step 3 title to match actual UI
3. Add new step for approver selection to `create-request` tour
4. Update `approve-request` tour step 6 to mention all three decision types
5. Add notifications sidebar step to `site-overview` tour

**Verification**:
- [ ] Run each updated tour and verify steps match actual UI
- [ ] Verify all data-tour selectors still exist in components

### Phase 2: Add New Training Modules for Missing Features
**Objective**: Create training coverage for features added recently

**Files to Modify**:
- `frontend/packages/ui-components/src/components/features/demo/tours.ts`
  - Add new `TourId` types for new modules
  - Add new tour definitions
- `frontend/packages/ui-components/src/components/features/demo/DemoScenarios.tsx`
  - Add new scenario entries

**New Modules to Create**:
1. `manage-delegations` - Delegation management tour (approvers)
2. `user-notifications` - User notifications tour (all users)
3. `admin-budget-controls` - Budget controls tour (admins)
4. `profile-settings` - Profile and settings tour (all users)

**Files to Add data-tour Attributes**:
- `frontend/apps/web/src/app/approvals/delegations/Client.tsx` - Add more specific markers
- `frontend/apps/web/src/app/notifications/Client.tsx` - Add tour markers
- `frontend/apps/web/src/app/admin/budget-controls/Client.tsx` - Add tour markers
- `frontend/apps/web/src/app/profile/Client.tsx` - Add tour markers
- `frontend/apps/web/src/app/settings/ServerToClient.tsx` - Add tour markers

**Steps**:
1. Add new TourId types to tours.ts
2. Create `manage-delegations` tour definition with appropriate steps
3. Create `user-notifications` tour definition
4. Create `admin-budget-controls` tour definition
5. Create `profile-settings` tour definition
6. Add corresponding scenario entries to DemoScenarios.tsx
7. Add data-tour attributes to target components

**Verification**:
- [ ] Each new tour runs without errors
- [ ] All new scenarios appear in E-Learning page
- [ ] Role filtering works correctly for new scenarios

### Phase 3: Update FAQ Content
**Objective**: Add FAQ entries for new features and workflows

**Files to Modify**:
- `frontend/apps/web/src/app/help/faqs/page.tsx`

**New FAQs to Add**:
1. "How do I use the Object Code Reference Guide?" (Funding Sources category)
2. "What is a revision request and how does it work?" (Approval Workflow category)
3. "How do I delegate my approval authority?" (Approval Workflow category)
4. "How do I see delegations assigned to me?" (Approval Workflow category)
5. "How do budget controls work?" (Admin & Analytics category)
6. "How do I request a new account?" (General category)

**Steps**:
1. Add 6 new FAQ entries to the faqs array
2. Ensure proper categorization
3. Write clear, helpful answers based on actual functionality

**Verification**:
- [ ] All new FAQs appear on the page
- [ ] Category grouping is correct
- [ ] Answers are accurate and helpful

### Phase 4: Update Documentation Content
**Objective**: Add documentation topics for new features

**Files to Modify**:
- `frontend/apps/web/src/app/help/docs/page.tsx`

**Updates to Documentation Sections**:
1. **Purchase Request Workflow** section:
   - Add "Using the Object Code Reference Guide"
   - Add "Selecting approvers for your request"

2. **Approval Process** section:
   - Add "Requesting revisions from requesters"
   - Add "Managing your delegations"
   - Add "Handling delegations assigned to you"

3. **Administrator Features** section:
   - Add "Budget controls and limit management"

4. **Getting Started** section:
   - Add "Requesting a new account"

**Steps**:
1. Add new topics to relevant sections in documentationSections array
2. Ensure consistent formatting with existing topics

**Verification**:
- [ ] All new topics appear in correct sections
- [ ] Documentation page renders correctly

## Testing Strategy

1. **Manual Tour Testing**:
   - Run each tour from start to finish
   - Verify each step highlights correct element
   - Verify navigation works between steps
   - Test skipping logic when elements not found

2. **Role-Based Testing**:
   - Test admin-only tours with admin account
   - Test approver-only tours with approver account
   - Verify regular users can't access restricted tours

3. **Cross-Browser Testing**:
   - Test tours in Chrome, Firefox, Safari
   - Verify highlighting overlay works correctly

4. **Mobile Responsiveness**:
   - Test FAQs and Docs pages on mobile viewport
   - Verify accordion interactions work on touch devices

## Rollback Plan

All changes are additive content updates to existing files. If issues arise:
1. Revert specific file changes via git
2. No database migrations involved
3. No API changes required

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Tour selectors break if components change | Medium | High | Use stable data-tour attributes, test after component changes |
| New tours cause navigation issues | Low | Medium | Test dynamic routes thoroughly |
| Content becomes stale again | High | Medium | Document update process, add to PR checklist |
| Missing role restrictions on new tours | Low | Medium | Test with all user role types |

## Open Questions

1. Should we add a "What's New" or "Recent Updates" section to help users discover new features?
2. Should tour completion tracking be reset when new tours are added?
3. Are there any other features in development that should be considered now?

---
**USER: Please review this plan. Edit any section directly in this file, then confirm to proceed.**
