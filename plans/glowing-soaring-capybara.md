# Implementation Plan: PurchasePro Gap Remediation

Created: 2025-11-28
Status: PENDING APPROVAL

---

## Summary

This plan addresses 4 high-priority gaps identified in the MVP and Phase 2 audits:
1. **Self-Approval Prevention** (MVP High) - Prevent approvers from approving their own requests
2. **Fiscal Year Dashboard Default** (MVP Medium) - Change user dashboard from 30 days to fiscal year
3. **72-Hour Auto-Escalation** (Phase 2 High) - Auto-forward stale approvals to manager
4. **Edit/Resubmit Rejected Requests** (Phase 2 High) - Allow users to revise rejected requests

**Out of Scope** (per user direction):
- MS SQL migration (staying on MySQL/Prisma)
- Email notifications (pending IT decision on Azure approach)
- Azure Blob Storage (design for easy swap later)
- Pro card workflows (future phase)
- LDAP/AD integration (intentionally deferred)

---

## Implementation Phases

### Phase 1: Self-Approval Prevention
**Estimated Effort**: Small (1-2 hours)
**Risk**: Low
**Priority**: HIGH - Security fix

#### Files to Modify:
| File | Changes |
|------|---------|
| `backend/src/services/approval.service.ts` | Add self-approval check in `approve()` (~line 240) and `reject()` (~line 341) |
| `backend/src/services/purchaseRequest.service.ts` | Add self-approval check in `approve()` (~line 1549) and `reject()` (~line 1743) |
| `frontend/packages/ui-components/.../ApprovalWizard.tsx` | Add warning alert and disable buttons when user is requester |

#### Implementation Steps:
1. **Backend - approval.service.ts**
   - After authorization check in `approve()`, add:
   ```typescript
   if (approval.request.requesterId === approverId) {
     throw new AppError('You cannot approve your own purchase request', 403, 'SELF_APPROVAL_FORBIDDEN');
   }
   ```
   - Same check in `reject()` method
   - Same check in `delegate()` to prevent delegation to requester

2. **Backend - purchaseRequest.service.ts**
   - Add same validation in the approve/reject methods

3. **Frontend - ApprovalWizard.tsx**
   - Add alert when `request.requester?.id === currentUserId`
   - Disable decision radio buttons and submit button

#### Verification:
- [ ] Unit test: Attempt to approve own request → 403 error
- [ ] Unit test: Attempt to delegate to requester → 403 error
- [ ] Frontend: Warning displays when viewing own request approval

---

### Phase 2: Fiscal Year Dashboard Default
**Estimated Effort**: Small (1-2 hours)
**Risk**: Low
**Priority**: MEDIUM

#### Files to Modify:
| File | Changes |
|------|---------|
| `frontend/packages/data/src/lib/utils/fiscalYear.ts` | NEW FILE - Create fiscal year utility |
| `frontend/packages/data/src/hooks/services/useDashboard.ts` | Update to accept date range object |
| `frontend/apps/web/src/app/home/page.tsx` | Replace `dateRange = 30` with fiscal year calculation |
| `frontend/apps/web/src/app/home/Client.tsx` | Update prop type |
| `frontend/apps/web/src/app/home/HomeClient.tsx` | Update hook call and subtitle text |

#### Implementation Steps:
1. **Create fiscalYear.ts utility**
   ```typescript
   export function getFiscalYearDateRange(): { fromDate: string; toDate: string } {
     const now = new Date();
     // Fiscal year: Oct 1 - Sep 30
     const baseYear = now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1;
     const from = new Date(baseYear, 9, 1);  // October 1
     const to = new Date(baseYear + 1, 8, 30, 23, 59, 59, 999);  // September 30
     return { fromDate: from.toISOString(), toDate: to.toISOString() };
   }

   export function getFiscalYearLabel(): string {
     const now = new Date();
     const baseYear = now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1;
     return `FY ${baseYear + 1}`;
   }
   ```

2. **Update home/page.tsx**
   - Replace `const dateRange = 30` with `const fiscalYear = getFiscalYearDateRange()`
   - Pass fiscal year dates to client component

3. **Update subtitle displays**
   - Change `"Last 30 days"` to `"Current Fiscal Year"` or `getFiscalYearLabel()`

#### Verification:
- [ ] Dashboard loads with fiscal year data (Oct 1 - Sep 30)
- [ ] Subtitle displays "FY 2025" or "Current Fiscal Year"
- [ ] SSR prefetch uses correct date range

---

### Phase 3: 72-Hour Auto-Escalation
**Estimated Effort**: Medium (4-6 hours)
**Risk**: Medium (new background job)
**Priority**: HIGH

#### New Files to Create:
| File | Purpose |
|------|---------|
| `backend/src/services/autoEscalation.service.ts` | Core escalation logic |

#### Files to Modify:
| File | Changes |
|------|---------|
| `backend/src/config/features.ts` | Add `AUTO_ESCALATION_ENABLED` flag |
| `backend/src/config/index.ts` | Add `autoEscalation` config block |
| `backend/prisma/schema.prisma` | Add `escalatedAt`, `escalatedFromId`, `escalationReason` to Approval |
| `backend/src/services/cron.service.ts` | Integrate auto-escalation job |
| `backend/src/events/eventBus.ts` | Add `ApprovalAutoEscalated` event |

#### Implementation Steps:
1. **Database Migration**
   ```prisma
   model Approval {
     // ... existing
     escalatedAt      DateTime? @map("escalated_at")
     escalatedFromId  String?   @map("escalated_from_id")
     escalationReason String?   @map("escalation_reason")
   }
   ```

2. **Feature Flag**
   ```typescript
   // features.ts
   export function isAutoEscalationEnabled(): boolean {
     return (process.env.AUTO_ESCALATION_ENABLED ?? 'false').toLowerCase() === 'true';
   }
   ```

3. **Config**
   ```typescript
   autoEscalation: {
     enabled: FEATURES.autoEscalationEnabled,
     timeoutHours: parseInt(process.env.AUTO_ESCALATION_HOURS || '72', 10),
     checkIntervalMinutes: parseInt(process.env.AUTO_ESCALATION_CHECK_INTERVAL || '15', 10),
   }
   ```

4. **AutoEscalationService**
   - `findStaleApprovals()` - Query pending approvals > 72 hours old
   - `escalateApproval()` - Reassign to manager, create audit log
   - `sendEscalationNotifications()` - Notify both original approver and manager
   - `processAutoEscalations()` - Main job method called by cron

5. **Cron Integration**
   - Add to `CronService.initializeCronJobs()`
   - Run every 15 minutes (configurable)

#### Verification:
- [ ] Feature flag OFF → no processing
- [ ] Stale approval (>72h) gets escalated to manager
- [ ] Original approver receives notification
- [ ] Manager receives "Escalated Approval" notification
- [ ] Audit log entry created
- [ ] Approval already escalated is skipped

---

### Phase 4: Edit/Resubmit Rejected Requests
**Estimated Effort**: Medium (4-6 hours)
**Risk**: Medium (new workflow)
**Priority**: HIGH

#### New Files to Create:
None (all changes in existing files)

#### Files to Modify:
| File | Changes |
|------|---------|
| `backend/src/services/purchaseRequest.service.ts` | Add `revertToDraft()` method |
| `backend/src/routes/purchaseRequest.routes.ts` | Add POST `/:id/revert-to-draft` route |
| `backend/src/validations/purchaseRequest.validation.ts` | Add `revertToDraftSchema` |
| `backend/src/events/eventBus.ts` | Add `RequestRevertedToDraft` event |
| `frontend/packages/data/.../purchaseRequests.ts` | Add `revertToDraft()` API method |
| `frontend/packages/ui-components/.../RequestDetails.tsx` | Add "Edit & Resubmit" button |

#### Implementation Steps:
1. **Backend - revertToDraft() method**
   ```typescript
   async revertToDraft(requestId: string, userId: string): Promise<PurchaseRequest> {
     // 1. Validate status === 'rejected'
     // 2. Validate userId === requesterId
     // 3. Update status to 'draft'
     // 4. Clear currentApproverId
     // 5. Mark existing approvals as superseded
     // 6. Add system comment
     // 7. Create audit log
     // 8. Emit RequestRevertedToDraft event
     // 9. Return updated request
   }
   ```

2. **API Route**
   ```typescript
   router.post('/:id/revert-to-draft', authMiddleware, validateRequest({ body: revertToDraftSchema }), controller.revertToDraft);
   ```

3. **Frontend API**
   ```typescript
   revertToDraft: async (id: string, reason?: string): Promise<PurchaseRequest> => {
     return apiService.post(`/purchase-requests/${id}/revert-to-draft`, { reason });
   }
   ```

4. **RequestDetails UI**
   - Add condition: `canResubmit = status === 'rejected' && currentUser.id === requesterId`
   - Add button with handler that calls `revertToDraft()` then navigates to edit page
   - Show rejection reason in an alert box

5. **Notification**
   - Subscribe to `RequestRevertedToDraft` event
   - Notify original rejector that request was resubmitted

#### Verification:
- [ ] "Edit & Resubmit" button visible only on rejected requests owned by user
- [ ] Clicking button reverts status to draft
- [ ] User can edit and resubmit
- [ ] New approval chain is generated
- [ ] Original rejector receives notification
- [ ] Audit log shows reversion

---

## Environment Variables (New)

```bash
# Phase 3: Auto-Escalation
AUTO_ESCALATION_ENABLED=false          # Enable/disable (default: false)
AUTO_ESCALATION_HOURS=72               # Hours before escalation (default: 72)
AUTO_ESCALATION_CHECK_INTERVAL=15      # Minutes between checks (default: 15)
```

---

## Database Migrations Required

1. **Phase 3**: Add escalation tracking fields to Approval model
   - `escalatedAt`, `escalatedFromId`, `escalationReason`
   - Add index on `(status, assignedAt)` for efficient queries

---

## Testing Strategy

### Unit Tests
- Self-approval prevention: 5 test cases
- Fiscal year utility: 2 test cases (before/after October)
- Auto-escalation service: 4 test cases
- Revert to draft: 4 test cases

### Integration Tests
- Full approval flow with self-approval blocked
- Dashboard with fiscal year data
- Auto-escalation with manager notification
- Resubmission workflow end-to-end

---

## Rollback Plan

| Phase | Rollback Strategy |
|-------|-------------------|
| 1. Self-Approval | Revert code changes (no DB changes) |
| 2. Fiscal Year | Revert code changes (no DB changes) |
| 3. Auto-Escalation | Set `AUTO_ESCALATION_ENABLED=false` immediately stops processing |
| 4. Edit/Resubmit | Revert code changes; no status corruption possible |

---

## Implementation Order (Recommended)

1. **Self-Approval Prevention** - Quick security fix, no dependencies
2. **Fiscal Year Dashboard** - Quick UI fix, no dependencies
3. **Edit/Resubmit Rejected** - Medium effort, standalone feature
4. **72-Hour Auto-Escalation** - Medium effort, requires migration

---

## Open Questions

1. **Auto-Escalation**: Should there be a maximum number of escalation levels? (e.g., stop after 3 escalations)
2. **Resubmission**: Should we track revision numbers (Revision 1, 2, 3...) or just allow unlimited resubmissions?
3. **Notifications**: When email is enabled later, should auto-escalation send emails or just in-app notifications?

---

**USER: Please review this plan. Edit any section directly in this file, then confirm to proceed.**
