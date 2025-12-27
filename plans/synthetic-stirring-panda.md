# Demo & Help System Audit + Implementation Plan

## Task Overview
Full audit and implementation: fix broken demos, add missing demos for all roles, update FAQ content, and create demo data setup functionality.

## User Requirements
- **Deliverable**: Full implementation (report + fixes + new demos + FAQ updates)
- **Demo Data Strategy**: Create demo mode data setup functions
- **Role Priority**: Equal coverage for requesters, approvers, and admins

---

## Phase 1: Write Audit Report
Create `DEMO_HELP_AUDIT_REPORT.md` documenting:
- Current demo system architecture
- Tour-by-tour analysis with issues
- Data-tour attribute verification
- Missing demos by role
- FAQ gaps and recommendations

---

## Phase 2: Fix Existing Demo Issues

### Issue 1: approve-request tour hardcodes PR-2025-001
**Fix**: Create demo data setup in DemoScenarios.tsx that:
- Checks if pending requests exist for approver
- Creates mock demo request if needed OR
- Dynamically routes to first pending request

**Files**:
- `frontend/packages/ui-components/src/components/features/demo/DemoScenarios.tsx`
- `frontend/packages/ui-components/src/components/features/demo/tours.ts`

### Issue 2: site-overview references sidebar-admin (role visibility)
**Fix**: Make tour role-aware - skip admin sidebar step for non-admin users OR split into role-specific overview tours

**Files**:
- `frontend/packages/ui-components/src/components/features/demo/tours.ts`

### Issue 3: create-request uses same prw-next target 3x
**Analysis**: This actually works because wizard advances between uses. No fix needed, but should verify timing.

### Issue 4: submit-invoice tour only 2 steps
**Fix**: Expand tour to cover:
- Invoice header intro
- Select associated purchase request
- Enter invoice details (number, amount, date)
- Upload document
- Submit button

**Files**:
- `frontend/packages/ui-components/src/components/features/demo/tours.ts`
- `frontend/packages/ui-components/src/components/features/invoices/InvoiceSubmission.tsx` (add data-tour attrs)

### Issue 5: Auto-skip behavior with no feedback
**Fix**: Add notification when element not found, giving user feedback rather than silent skip

**Files**:
- `frontend/packages/ui-components/src/components/features/demo/GuidedTour.tsx`

---

## Phase 3: Add New Demos

### For All Roles (Requester base)
1. **my-requests** - View and filter your requests
   - Navigate to /requests
   - Show filter bar
   - Show search functionality
   - Show request card/list
   - Open request details

2. **invoice-list** - View your invoices
   - Navigate to /invoices
   - Show invoice list
   - Filter by status

### For Approvers
3. **approval-notifications** - Manage approval notifications
   - Navigate to /approvals/notifications
   - Show notification settings

### For Admins
4. **admin-requests** - Manage all requests
   - Navigate to /admin/requests
   - Show filters
   - Bulk actions

5. **admin-approvers** - Manage approvers
   - Navigate to /admin/approvers
   - Show approver list
   - Add/edit capabilities

6. **admin-invoices** - Invoice management
   - Navigate to /admin/invoices
   - Show all invoices
   - Status management

### Required data-tour Attributes to Add:
| Component | Attribute | Purpose |
|-----------|-----------|---------|
| RequestList.tsx | `requests-header` | Requests page header |
| RequestList.tsx | `requests-filter-bar` | Filter controls |
| RequestList.tsx | `requests-list` | Request cards/table |
| InvoiceList.tsx | `invoices-header` | Invoices page header |
| InvoiceList.tsx | `invoices-list` | Invoice list |
| AdminDashboard sections | Various | Admin feature areas |
| ApprovalDashboard | `approvals-notifications-link` | Notifications nav |

---

## Phase 4: Update FAQ Content

### New FAQs to Add:

**Demo System (new category)**
- How do I use the interactive demos?
- Can I restart a demo if I get lost?
- Which demos are available for my role?

**Notifications (new category)**
- How do notification settings work?
- What types of notifications will I receive?
- How do I customize my notification preferences?

**Dashboard & Reports**
- What do the dashboard statistics mean?
- How do I export data from the system?
- How can I view the audit trail for a request?

**Attachments (expand existing)**
- What file size limits apply to uploads?
- What happens if my upload fails?

**Files**:
- `frontend/apps/web/src/app/help/faqs/page.tsx`

---

## Phase 5: Demo Data Setup

Create `setupDemoData()` functions in DemoScenarios.tsx:

```typescript
// For approve-request demo
const setupApprovalDemo = async () => {
  // 1. Check for existing pending requests
  // 2. If none, create mock request via API or store
  // 3. Return the request ID to navigate to
};

// For submit-invoice demo
const setupInvoiceDemo = async () => {
  // Ensure approved request exists for invoice linking
};
```

**Files**:
- `frontend/packages/ui-components/src/components/features/demo/DemoScenarios.tsx`
- Potentially new: `frontend/packages/ui-components/src/components/features/demo/demoDataSetup.ts`

---

## Implementation Order

1. **Write audit report** (`DEMO_HELP_AUDIT_REPORT.md`)
2. **Fix GuidedTour.tsx** - Add element-not-found feedback
3. **Fix tours.ts** - Update existing tours (approve-request, submit-invoice, site-overview)
4. **Add data-tour attributes** - To components needing them for new tours
5. **Create new tours** - In tours.ts for missing workflows
6. **Update DemoScenarios.tsx** - Add new scenario cards + demo data setup
7. **Update FAQs** - Add new questions and categories
8. **Test all demos** - Verify each tour works for its target role

---

## Critical Files

### Core Demo System
- `frontend/packages/ui-components/src/components/features/demo/tours.ts`
- `frontend/packages/ui-components/src/components/features/demo/GuidedTour.tsx`
- `frontend/packages/ui-components/src/components/features/demo/DemoScenarios.tsx`
- `frontend/packages/state/src/stores/useDemoStore.ts`

### Components Needing data-tour Attributes
- `frontend/packages/ui-components/src/components/features/request-list/RequestList.tsx`
- `frontend/packages/ui-components/src/components/features/request-list/components/RequestListHeader.tsx`
- `frontend/packages/ui-components/src/components/features/invoices/InvoiceList.tsx`
- `frontend/packages/ui-components/src/components/features/invoices/InvoiceSubmission.tsx`
- `frontend/packages/ui-components/src/components/features/admin/AdminDashboard.tsx`

### FAQ
- `frontend/apps/web/src/app/help/faqs/page.tsx`

---

## Output Files
1. `DEMO_HELP_AUDIT_REPORT.md` - Comprehensive audit findings
2. Updated demo system files (listed above)
3. Updated FAQ page
