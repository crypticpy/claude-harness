# Implementation Plan: Fix First Approver Not Loading in Purchase Request Approval Chain

Created: 2025-12-18
Status: PENDING APPROVAL

## Summary

When purchase requests are created and submitted, the selected approvers (Manager, Budget Manager, Contract Manager, Purchasing Manager) are not being saved to the database. This causes the approval chain to be empty or use fallback routing, resulting in no first approver being assigned, no notifications being sent, and nothing appearing in approval visualizations.

## Root Cause Analysis

### Data Flow Breakdown

1. **Frontend Step 1 (ContactInfoStep)** correctly collects approvers:
   ```typescript
   // ContactInfoStep.tsx:283-286
   onNext({
     requesterInfo: formData,
     requestType,
     selectedManagerId: selectedApprovers.managerId,
     selectedBudgetManagerId: selectedApprovers.budgetManagerId,
     selectedContractManagerId: selectedApprovers.contractManagerId,
     selectedPurchasingManagerId: selectedApprovers.purchasingManagerId,
   } as any);
   ```

2. **PurchaseRequestWizard** correctly merges data into `formData` and calls autosave:
   ```typescript
   // PurchaseRequestWizard.tsx:277-282
   const handleNext = (stepData) => {
     const newFormData = { ...formData, ...stepData };
     setFormData(newFormData);
     autosaveDraftLocal(newFormData);  // <-- Should save approvers
   }
   ```

3. **PROBLEM 1** - Frontend API `createDraft()` does NOT include approver fields:
   ```typescript
   // purchaseRequests.ts:354-369
   createDraft: async (data) => {
     const apiData = {
       requesterId: data.requesterInfo?.requesterId,
       divisionId: data.requesterInfo?.divisionId,
       title: data.requestDetails?.title,
       // ... other fields
       // MISSING: selectedManagerId, selectedBudgetManagerId, etc.
     };
   }
   ```

4. **PROBLEM 2** - Frontend API `autosaveDraft()` does NOT include approver fields:
   ```typescript
   // purchaseRequests.ts:409-440
   autosaveDraft: async (id, data) => {
     const apiData = {};
     if (data.requesterInfo) { /* ... */ }
     if (data.requestDetails) { /* ... */ }
     // MISSING: selectedManagerId, selectedBudgetManagerId, etc.
   }
   ```

5. **PROBLEM 3** - Backend `createDraft()` does NOT include approver fields in the `base` object:
   ```typescript
   // purchaseRequest.service.ts:386-402
   const base = {
     title: data.title || 'Untitled Request',
     // ... other fields
     // MISSING: selectedManagerId, selectedBudgetManagerId, etc.
   };
   ```

6. **Result**: When `submit()` is called, the routing service looks for `purchaseRequest.selectedManagerId` etc., finds them all null, and either:
   - Falls back to chain-based routing (if configured)
   - Falls back to manager hierarchy (if no chain configured)
   - Returns an empty chain (if no fallbacks work)

### Verification

The backend validation schemas DO accept these fields:
- `createPurchaseRequestSchema` (lines 95-98)
- `updatePurchaseRequestSchema` (lines 135-138)
- `createDraftSchema` (lines 236-239)
- `updateDraftSchema` (lines 268-271)

The Prisma schema HAS these fields:
- `selectedManagerId` (line 244)
- `selectedBudgetManagerId` (line 245)
- `selectedContractManagerId` (line 246)
- `selectedPurchasingManagerId` (line 247)

The backend `update()` method DOES pass through all fields to Prisma (line 596-601).

## Scope

### In Scope
1. Fix frontend `createDraft()` to include selected approver fields
2. Fix frontend `autosaveDraft()` to include selected approver fields
3. Fix backend `createDraft()` to include selected approver fields in the `base` object
4. Verify approval chain is correctly populated after fix
5. Verify notifications are sent to first approver
6. Verify approval visualization shows the chain

### Out of Scope
- Modifying the routing service logic
- Changing the approval chain calculation algorithm
- Adding new approver selection features
- Changing the frontend approver selection UI

## Prerequisites
- Backend server accessible for testing
- Test accounts with various roles (requester, manager, budget manager, etc.)
- Fresh purchase request data to test

## Implementation Phases

### Phase 1: Fix Frontend `createDraft()` API Method

**Objective**: Ensure selected approvers are sent when creating a draft

**Files to Modify**:
- `frontend/packages/data/src/lib/api/services/purchaseRequests.ts`

**Changes**:
```typescript
// In createDraft function (around line 365)
createDraft: async (data: Partial<PurchaseRequestFormData>): Promise<PurchaseRequest> => {
  const apiData: any = {
    requesterId: data.requesterInfo?.requesterId,
    divisionId: data.requesterInfo?.divisionId,
    title: data.requestDetails?.title,
    businessJustification: data.requestDetails?.businessJustification,
    fundingSource: data.financialInfo?.fundingSource,
    totalAmount: data.totalAmount,
    currency: data.currency || 'USD',
    // ADD: Selected approvers
    selectedManagerId: (data as any).selectedManagerId,
    selectedBudgetManagerId: (data as any).selectedBudgetManagerId,
    selectedContractManagerId: (data as any).selectedContractManagerId,
    selectedPurchasingManagerId: (data as any).selectedPurchasingManagerId,
  };
  // ... rest of function
}
```

**Verification**:
- [ ] Create a draft and verify in database that selected approver IDs are saved
- [ ] Check network request includes the approver fields

### Phase 2: Fix Frontend `autosaveDraft()` API Method

**Objective**: Ensure selected approvers are sent when autosaving a draft

**Files to Modify**:
- `frontend/packages/data/src/lib/api/services/purchaseRequests.ts`

**Changes**:
```typescript
// In autosaveDraft function (around line 438)
autosaveDraft: async (id: string, data: Partial<PurchaseRequestFormData>): Promise<PurchaseRequest> => {
  const apiData: any = {};
  // ... existing field mappings ...

  // ADD: Selected approvers (after the requestType check)
  if ((data as any).selectedManagerId !== undefined) {
    apiData.selectedManagerId = (data as any).selectedManagerId;
  }
  if ((data as any).selectedBudgetManagerId !== undefined) {
    apiData.selectedBudgetManagerId = (data as any).selectedBudgetManagerId;
  }
  if ((data as any).selectedContractManagerId !== undefined) {
    apiData.selectedContractManagerId = (data as any).selectedContractManagerId;
  }
  if ((data as any).selectedPurchasingManagerId !== undefined) {
    apiData.selectedPurchasingManagerId = (data as any).selectedPurchasingManagerId;
  }

  // ... rest of function
}
```

**Verification**:
- [ ] Navigate through wizard steps and verify autosave PATCH includes approver fields
- [ ] Check database is updated with approver IDs during autosave

### Phase 3: Fix Backend `createDraft()` Service Method

**Objective**: Ensure selected approvers are included when creating a draft in the backend

**Files to Modify**:
- `backend/src/services/purchaseRequest.service.ts`

**Changes**:
```typescript
// In createDraft function (around lines 386-402)
const base: Prisma.PurchaseRequestCreateInput = {
  title: (data as any).title || 'Untitled Request',
  businessJustification: (data as any).businessJustification || '',
  currency: (data as any).currency || 'USD',
  fundingSource: (data as any).fundingSource || 'budget',
  requesterId,
  divisionId: resolvedDivisionId!,
  priority: (data as any).priority || 'normal',
  totalAmount: (data as any).totalAmount || 0,
  vendorId: (data as any).vendorId || undefined,
  fduId: (data as any).fduId || undefined,
  costCentreId: (data as any).costCentreId || undefined,
  objectCodeId: (data as any).objectCodeId || undefined,
  unitId: (data as any).unitId || undefined,
  dueDate: (data as any).dueDate || undefined,
  requestType: (data as any).requestType || 'DO_PO',
  // ADD: Selected approvers
  selectedManagerId: (data as any).selectedManagerId || undefined,
  selectedBudgetManagerId: (data as any).selectedBudgetManagerId || undefined,
  selectedContractManagerId: (data as any).selectedContractManagerId || undefined,
  selectedPurchasingManagerId: (data as any).selectedPurchasingManagerId || undefined,
} as any;
```

**Verification**:
- [ ] Backend correctly stores approver IDs on draft creation
- [ ] No validation errors when approver IDs are passed

### Phase 4: End-to-End Verification

**Objective**: Verify the complete flow works

**Testing Steps**:
1. Create a new purchase request as a regular user
2. Select request type (DO_PO, RQS, or RQM)
3. Select approvers for each required role
4. Complete all wizard steps and submit
5. Verify:
   - [ ] Request status changes to "pending_approval"
   - [ ] currentApproverId is set to the first approver
   - [ ] Approval records are created for each selected approver
   - [ ] First approver receives notification
   - [ ] Approval chain is visible in the request details
6. As the first approver:
   - [ ] See the request in their pending approvals
   - [ ] Can approve/reject the request
   - [ ] Next approver is notified after approval

## Testing Strategy

### Manual Testing Steps
1. Create a fresh purchase request with all approvers selected
2. Check database directly:
   ```sql
   SELECT id, selectedManagerId, selectedBudgetManagerId,
          selectedContractManagerId, selectedPurchasingManagerId
   FROM PurchaseRequest WHERE id = '<new-request-id>';
   ```
3. Submit the request
4. Check Approval table:
   ```sql
   SELECT * FROM Approval WHERE requestId = '<request-id>' ORDER BY approvalLevel;
   ```
5. Check Notification table:
   ```sql
   SELECT * FROM Notification WHERE data LIKE '%<request-id>%';
   ```

### Edge Cases to Test
- [ ] Request with only Manager selected (minimum for DO_PO)
- [ ] Request with all 4 approvers selected (RQS flow)
- [ ] Editing a draft and changing approvers
- [ ] Autosave during step 1 before moving to step 2

## Rollback Plan

Revert changes to:
- `frontend/packages/data/src/lib/api/services/purchaseRequests.ts`
- `backend/src/services/purchaseRequest.service.ts`

Both are additive changes (adding fields to existing objects), low risk of breaking existing functionality.

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Breaking existing draft creation | Low | Medium | Fields are optional; undefined values are already handled |
| Type errors in frontend | Low | Low | Using `as any` casts consistently |
| Database constraint violations | Very Low | Medium | Approver UUIDs are validated by Zod schemas |
| Autosave performance impact | Very Low | Low | Only 4 additional optional fields |

## Open Questions

1. Should we update the `PurchaseRequestFormData` TypeScript interface to include the selected approver fields properly?
   - Currently using `as any` casts
   - Would improve type safety but is not strictly required for the fix

2. Should we include the selected approver relations in `findById` for display purposes?
   - Currently the relations are not loaded
   - Would allow showing "Selected by: [user name]" in the UI

---
**USER: Please review this plan. Edit any section directly in this file, then confirm to proceed.**
