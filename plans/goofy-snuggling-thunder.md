# Invoice Management System - Comprehensive Implementation Plan

## Overview
Enable a fully functional Invoice Management System for PurchasePro with:
1. **User-facing**: Invoices menu visible to all logged-in users (existing UI - just enable navigation)
2. **Admin-facing**: New admin panel at `/admin/invoices` for managing all approved PRs, uploading PAID documents, and marking PRs as paid/closed/cancelled

## Requirements (Confirmed)
- **PR Statuses**: paid, closed, cancelled (three terminal statuses after approval)
- **Final Upload**: Add as new version (preserve originals, add final/paid versions alongside)
- **User Access**: Users see their invoices via menu + Admins get separate admin panel

---

## Phase 1: Backend Schema & API

### 1.1 Prisma Schema Changes
**File**: `/backend/prisma/schema.prisma`

**Extend RequestStatus enum:**
```prisma
enum RequestStatus {
  draft
  pending_approval
  approved
  rejected
  cancelled
  paid      // NEW
  closed    // NEW
}
```

**Extend AttachmentType enum:**
```prisma
enum AttachmentType {
  // ... existing types ...
  final_invoice      // NEW: PAID stamp documents
}
```

**Add admin tracking fields to PurchaseRequest:**
```prisma
model PurchaseRequest {
  // ... existing fields ...
  paidAt              DateTime?            @map("paid_at")
  paidById            String?              @map("paid_by_id")
  closedAt            DateTime?            @map("closed_at")
  closedById          String?              @map("closed_by_id")
  cancelledById       String?              @map("cancelled_by_id")
  statusChangeReason  String?              @map("status_change_reason")

  paidBy              User?                @relation("PaidByUser", fields: [paidById], references: [id])
  closedBy            User?                @relation("ClosedByUser", fields: [closedById], references: [id])
  cancelledBy         User?                @relation("CancelledByUser", fields: [cancelledById], references: [id])
}
```

### 1.2 New Admin API Endpoints
**File**: `/backend/src/routes/admin.routes.ts`

| Route | Method | Description |
|-------|--------|-------------|
| `/api/admin/purchase-requests` | GET | Admin view ALL PRs (with invoice status) |
| `/api/admin/purchase-requests/:id/mark-paid` | POST | Mark PR as paid |
| `/api/admin/purchase-requests/:id/mark-closed` | POST | Mark PR as closed |
| `/api/admin/purchase-requests/:id/admin-cancel` | POST | Admin cancel PR |

### 1.3 Service Layer
**File**: `/backend/src/services/admin.service.ts`

Add methods:
- `getAllPurchaseRequests(params)` - Admin view with invoice status aggregation
- `markPurchaseRequestPaid(prId, adminUserId, data)`
- `markPurchaseRequestClosed(prId, adminUserId, data)`
- `adminCancelPurchaseRequest(prId, adminUserId, data)`

### 1.4 Validation Schemas
**File**: `/backend/src/validations/admin.validation.ts`

Add:
- `adminPurchaseRequestsQuerySchema`
- `adminStatusChangeSchema`
- `adminCancelSchema` (reason required)

### 1.5 Status Transition Rules
| Current Status | Allowed Transitions |
|----------------|---------------------|
| approved | paid, closed, cancelled |
| paid | closed |
| closed | (terminal) |
| cancelled | (terminal) |

---

## Phase 2: Frontend Navigation

### 2.1 Enable Invoices Menu
**File**: `/frontend/packages/ui-components/src/components/layout/Sidebar.tsx`

1. **Uncomment Invoices menu item** (lines 109-116):
```typescript
{
  id: 'invoices',
  label: 'Invoices',
  icon: <ReceiptIcon />,
  path: '/invoices',
},
```

2. **Add admin invoices to Administration submenu** (after line 148):
```typescript
{
  id: 'admin-invoices',
  label: 'Invoice Management',
  icon: <ReceiptIcon />,
  path: '/admin/invoices',
},
```

3. **Add Receipt icon import** at top of file.

---

## Phase 3: Admin Invoice Panel

### 3.1 Page Structure
```
frontend/apps/web/src/app/admin/invoices/
├── page.tsx              # Server component
└── Client.tsx            # Client wrapper for AdminInvoicePanel
```

### 3.2 Component Structure
```
frontend/packages/ui-components/src/components/features/admin/invoices/
├── AdminInvoicePanel.tsx           # Main panel with DataGrid/filters
├── components/
│   ├── InvoiceStatusActions.tsx    # Status change dropdown + upload button
│   ├── PaidDocumentUpload.tsx      # Upload PAID document dialog
│   ├── InvoiceDetailDrawer.tsx     # Side drawer for PR/invoice details
│   ├── InvoiceStatusChip.tsx       # Status badge component
│   └── AdminInvoiceCardList.tsx    # Mobile card view
├── hooks/
│   └── useAdminInvoices.ts         # Admin-specific queries
└── index.ts
```

### 3.3 AdminInvoicePanel Features
- Filter bar (status, search, date range)
- DataGrid view (desktop) with columns: PR Number, Title, Vendor, Amount, Invoice Status, Invoices Count, Actions
- Card view (mobile)
- Row click opens detail drawer
- Actions: Mark Paid, Mark Closed, Cancel, Upload PAID Document

### 3.4 Status Chips
| Status | Color |
|--------|-------|
| no_invoice | gray |
| pending | yellow |
| paid | green |
| closed | blue |
| cancelled | red |

---

## Phase 4: API Hooks & Types

### 4.1 New Hooks
**File**: `/frontend/packages/data/src/hooks/services/useAdminInvoices.ts`

- `useAdminApprovedRequests(filters)` - Fetch PRs with invoice status
- `useUpdatePRInvoiceStatus()` - Mutation for status changes
- `useUploadPaidDocument()` - Mutation for PAID document upload

### 4.2 Type Updates
**File**: `/frontend/packages/types/src/attachments.ts`

Add `'final_invoice'` to `AttachmentType` enum and labels.

---

## Implementation Sequence

### Backend First (Dependency for Frontend)
1. Update Prisma schema with new enums and fields
2. Generate and run migration
3. Add admin service methods
4. Add validation schemas
5. Add admin routes and controller
6. Test endpoints with Postman/curl

### Frontend Second
7. Enable navigation in Sidebar.tsx
8. Create `/admin/invoices/` page files
9. Create AdminInvoicePanel component
10. Create supporting components (StatusChip, StatusActions, Upload dialog, Drawer)
11. Create useAdminInvoices hooks
12. Update type definitions
13. Add exports to index files
14. Test responsive views

---

## Critical Files

### Backend
| File | Action |
|------|--------|
| `/backend/prisma/schema.prisma` | MODIFY - Add statuses, attachment type, tracking fields |
| `/backend/src/routes/admin.routes.ts` | MODIFY - Add new endpoints |
| `/backend/src/services/admin.service.ts` | MODIFY - Add admin methods |
| `/backend/src/validations/admin.validation.ts` | MODIFY - Add schemas |
| `/backend/src/controllers/admin.controller.ts` | MODIFY - Add handlers |

### Frontend
| File | Action |
|------|--------|
| `/frontend/packages/ui-components/src/components/layout/Sidebar.tsx` | MODIFY - Enable invoices, add admin link |
| `/frontend/apps/web/src/app/admin/invoices/page.tsx` | CREATE |
| `/frontend/apps/web/src/app/admin/invoices/Client.tsx` | CREATE |
| `/frontend/packages/ui-components/src/components/features/admin/invoices/` | CREATE folder + components |
| `/frontend/packages/data/src/hooks/services/useAdminInvoices.ts` | CREATE |
| `/frontend/packages/types/src/attachments.ts` | MODIFY - Add final_invoice type |

---

## Reference Files (Read Before Implementation)
- `/frontend/packages/ui-components/src/components/features/request-list/RequestList.tsx` - Pattern for DataGrid/Card dual view
- `/frontend/packages/ui-components/src/components/features/admin/AdminApprovalChainsPanel.tsx` - Admin panel pattern
- `/frontend/packages/data/src/hooks/services/useInvoices.ts` - TanStack Query hook patterns
- `/backend/src/services/invoice.service.ts` - Existing invoice service
- `/backend/src/routes/admin.routes.ts` - Existing admin routes

---

## Success Criteria
- [ ] Invoices menu visible to all logged-in users
- [ ] Invoice Management visible in admin submenu
- [ ] Admin can view ALL approved PRs with invoice status
- [ ] Admin can mark PRs as paid/closed/cancelled
- [ ] Admin can upload PAID stamp documents (as new version, not replacing)
- [ ] Audit trail records all admin actions
- [ ] Responsive design (DataGrid desktop, Cards mobile)
- [ ] Follows M3 design language
- [ ] TypeScript compiles without errors
- [ ] All existing tests pass
