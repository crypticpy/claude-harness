# Security Bug Audit - Remaining Issues Fix Plan

## Scope
Fix all remaining ~55 issues from SECURITY_BUG_AUDIT.md, excluding:
- SEC-FE-001 (JWT in localStorage) - deferred
- SEC-FE-002 (Hardcoded demo credentials) - deferred

## Implementation Order

### Phase 1: High Priority Issues (4 issues)

#### SEC-BE-013: SQL Injection in Analytics
- **File:** `/backend/src/services/analytics.service.ts`
- **Fix:** Replace `$queryRawUnsafe` with parameterized queries using `$queryRaw` with Prisma.sql template

#### API-003: Large Export Without Streaming
- **File:** `/backend/src/services/admin.service.ts:843`
- **Fix:** Add pagination or streaming for large exports

#### DB-002: User Deletion Creates Orphans
- **File:** `/backend/prisma/schema.prisma`
- **Fix:** Add cascade deletes or SET NULL for User references

#### DB-003: Inconsistent Soft Delete
- **File:** `/backend/prisma/schema.prisma`
- **Fix:** Document decision - soft delete is intentionally selective

---

### Phase 2: Backend Security - Medium (5 issues)

#### SEC-BE-014: Weak File Type Validation
- **File:** `/backend/src/routes/invoice.routes.ts:145-153`
- **Fix:** Add magic bytes validation using file-type library

#### SEC-BE-015: Rate Limiting Disabled in Dev
- **File:** `/backend/src/app.ts:139`
- **Fix:** Remove `skip: () => config.isDevelopment` or add warning

#### SEC-BE-016: Database Credentials in .env
- **Fix:** Document as expected behavior (gitignored) - add to .env.example

#### SEC-BE-017: Logout Token Invalidation
- **File:** `/backend/src/controllers/auth.controller.ts:62-74`
- **Fix:** Add token blacklist or reduce token expiry

---

### Phase 3: Backend Security - Low (4 issues)

#### SEC-BE-019: Debug Info in Error Responses
- **File:** `/backend/src/middleware/error.middleware.ts:204-206`
- **Fix:** Only send stack traces in development

#### SEC-BE-020: Weak Login Password Validation
- **File:** `/backend/src/validations/auth.validation.ts:5`
- **Fix:** Add minimum password length validation

#### SEC-BE-021: Hardcoded Attachment Directory
- **File:** `/backend/src/config/features.ts:162-164`
- **Fix:** Use environment variable with fallback

#### SEC-BE-022: No Authorization on getUserById
- **File:** `/backend/src/routes/user.routes.ts:208`
- **Fix:** Add authorization check (user can view own profile or admin access)

---

### Phase 4: Backend Bugs - Medium (7 issues)

#### BUG-BE-005: Business Hours Calculation Performance
- **File:** `/backend/src/services/autoEscalation.service.ts:59-74`
- **Fix:** Use date arithmetic instead of hour iteration

#### BUG-BE-011: Stats Calendar vs Business Hours
- **File:** `/backend/src/services/autoEscalation.service.ts:358-369`
- **Fix:** Align stats query with business hours calculation

#### BUG-BE-012: Optional Auth Swallows Errors
- **File:** `/backend/src/middleware/auth.middleware.ts:131-135`
- **Fix:** Log errors before swallowing

#### BUG-BE-013: Decimal Precision Issues
- **File:** `/backend/src/services/purchaseRequest.service.ts:155-170`
- **Fix:** Use Decimal.toNumber() consistently

#### BUG-BE-014: Memory Leak in PDF Generation
- **File:** `/backend/src/services/purchaseRequest.service.ts:1923-2245`
- **Fix:** Use streaming for PDF generation

#### BUG-BE-015: Event Bus Not Cleaned Up
- **File:** `/backend/src/services/notification.service.ts:1293-1310`
- **Fix:** Add disconnect on process exit

#### BUG-BE-016: Hardcoded Division Manager Threshold
- **File:** `/backend/src/services/routing.service.ts:365-367`
- **Fix:** Move to configuration

---

### Phase 5: Backend Bugs - Low (6 issues)

#### BUG-BE-017: Unsafe Type Casts
- **File:** `/backend/src/controllers/approval.controller.ts:256-283`
- **Fix:** Use proper AuthRequest type

#### BUG-BE-018: Invoice Delete Without Transaction
- **File:** `/backend/src/services/invoice.service.ts:397-424`
- **Fix:** Wrap in $transaction

#### BUG-BE-019: Empty Event Handlers
- **File:** `/backend/src/events/eventBus.ts:181-187`
- **Fix:** Remove empty handlers or add implementation

---

### Phase 6: Frontend Security - Medium (5 issues)

#### SEC-FE-004: Missing CSRF Protection
- **Fix:** Add CSRF tokens for mutations (or document that JWT provides protection)

#### SEC-FE-005: innerHTML in Test Files
- **Files:** `/frontend/test-auth.html`, login-test.html
- **Fix:** Replace innerHTML with textContent

#### SEC-FE-006: dangerouslySetInnerHTML for CSS
- **File:** `/frontend/apps/web/src/lib/EmotionRegistry.tsx:36`
- **Fix:** Document as required for Emotion CSS - acceptable use

#### SEC-FE-007: Sensitive Data in Error Logs
- **File:** `/frontend/packages/data/src/lib/utils/logger.ts:116-138`
- **Fix:** Sanitize sensitive data before logging

#### SEC-FE-008: No Server-Side Route Protection
- **File:** `/frontend/apps/web/`
- **Fix:** Add Next.js middleware.ts for auth routes

---

### Phase 7: Frontend Security - Low (4 issues)

#### SEC-FE-009: Client-Side Role Checks Only
- **Fix:** Document - backend enforces, frontend hides UI only

#### SEC-FE-010: Console Logging in Production
- **Files:** help/page.tsx, test pages
- **Fix:** Remove console.log or wrap in isDev check

#### SEC-FE-011: External Links Missing rel
- **File:** `/frontend/apps/web/src/stories/Configure.mdx`
- **Fix:** Add rel="noopener noreferrer"

#### SEC-FE-012: Test HTML Files Should Not Deploy
- **Fix:** Add to .gitignore or move to /test directory

---

### Phase 8: Frontend Bugs - Medium (3 issues)

#### BUG-FE-009: Notification Timeout Race Conditions
- **File:** `/frontend/packages/state/src/stores/useNotificationStore.ts:25-41`
- **Fix:** Use Map to track timeouts by notification ID

#### BUG-FE-010: No Loading State in DemoScenarios
- **File:** `/frontend/packages/ui-components/.../DemoScenarios.tsx:199-256`
- **Fix:** Add loading state during navigation

#### BUG-FE-011: Inefficient Re-renders in RequestList
- **File:** `/frontend/packages/ui-components/.../RequestList.tsx:253-345`
- **Fix:** Memoize column definitions with useMemo

---

### Phase 9: Frontend Bugs - Low (6 issues)

#### BUG-FE-014: Empty Error Handlers
- **Fix:** Add logging to catch blocks

#### BUG-FE-015: Missing Code Splitting
- **Fix:** Add dynamic imports for large components

#### BUG-FE-016: Sidebar Auto-Expand Loop Risk
- **File:** `/frontend/packages/ui-components/.../Sidebar.tsx:228-242`
- **Fix:** Add dependency guard

#### BUG-FE-017: Console Debug in Production
- **File:** `/frontend/apps/web/src/app/requests/new/page.tsx:57-101`
- **Fix:** Remove or wrap in isDev

---

### Phase 10: API Issues (11 issues)

#### API-004/005: Unbounded Queries
- **Files:** vendor.service.ts, financial.service.ts
- **Fix:** Add default limits (MAX_RESULTS = 1000)

#### API-006: Over-Fetching in findById
- **File:** purchaseRequest.service.ts:259-289
- **Fix:** Accept includeRelations parameter

#### API-007/008/009/010: Dashboard optimization issues
- **Fix:** Document as optimization opportunities for future

#### API-011: Inconsistent Error Handling
- **Fix:** Standardize on next(error) pattern

#### API-012: Default 10s Timeout
- **Fix:** Increase timeout for export endpoints

---

### Phase 11: Database Issues (9 issues)

#### DB-006: N+1 in Funding Source Creation
- **File:** purchaseRequest.service.ts:160-162
- **Fix:** Use createMany instead of loop

#### DB-007: N+1 in Reminder Processing
- **File:** notification.service.ts:767-837
- **Fix:** Batch query for existing reminders

#### DB-008/009: JSON and Text Field Limits
- **Fix:** Add application-level validation

#### DB-010: Sequential Approval Route Queries
- **Fix:** Batch into single query where possible

#### DB-011: Report Deletion Missing Cascade
- **File:** report.service.ts:96-98
- **Fix:** Add cascade delete for reportRun

#### DB-012: markMessagesAsRead Race Condition
- **File:** chat.service.ts:362-400
- **Fix:** Wrap in transaction

---

## Execution Strategy

1. **Batch by file** - Group changes to same file together
2. **Commit frequently** - Small focused commits per phase
3. **Test after each phase** - Run affected tests
4. **Update audit file** - Mark each issue as fixed

## Critical Files to Modify

### Backend
- `/backend/src/services/analytics.service.ts`
- `/backend/src/services/admin.service.ts`
- `/backend/prisma/schema.prisma`
- `/backend/src/middleware/auth.middleware.ts`
- `/backend/src/middleware/error.middleware.ts`
- `/backend/src/services/purchaseRequest.service.ts`
- `/backend/src/services/notification.service.ts`
- `/backend/src/services/routing.service.ts`
- `/backend/src/services/invoice.service.ts`
- `/backend/src/services/vendor.service.ts`
- `/backend/src/services/financial.service.ts`

### Frontend
- `/frontend/packages/state/src/stores/useNotificationStore.ts`
- `/frontend/packages/ui-components/src/components/features/request-list/RequestList.tsx`
- `/frontend/packages/data/src/lib/utils/logger.ts`
- `/frontend/apps/web/src/lib/EmotionRegistry.tsx`
- `/frontend/apps/web/middleware.ts` (new file)
