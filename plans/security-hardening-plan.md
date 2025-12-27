# Implementation Plan: Security Hardening for PurchasePro

Created: 2025-12-17
Status: PENDING APPROVAL

## Summary

This plan addresses 6 identified security vulnerabilities in the PurchasePro application, ranging from missing authentication on critical routes to spoofable user IDs and weak default credentials. The fixes will protect financial/PII data, prevent unauthorized workflow actions, and enforce proper secret management for production deployments.

## Scope

### In Scope
- Add authentication middleware to unprotected routes (purchase requests, comments, attachments)
- Remove spoofable userId fallbacks from controllers (eliminate `test-user-id` patterns)
- Gate demo credentials and test pages behind NODE_ENV checks
- Enforce strong secrets in Docker/production configurations
- Add documentation for required production environment variables

### Out of Scope
- Migration from localStorage to httpOnly cookies (Medium priority - requires significant frontend refactoring, recommend separate initiative)
- Full audit of all controllers (focused on identified high-severity patterns)
- Adding new security features (rate limiting, CSRF - already partially implemented)

## Prerequisites
- Backend development environment running
- Understanding of current auth middleware patterns
- Test suite available to verify no regressions

## Implementation Phases

### Phase 1: Add Authentication to Purchase Request Routes (HIGH)

**Objective**: Protect purchase request read/write routes that currently lack authentication

**Files to Modify**:
- `backend/src/routes/purchaseRequest.routes.ts` - Add authMiddleware to unprotected routes

**Current State (Verified)**:
```typescript
// Lines 118-122: GET / - NO authMiddleware (lists all purchase requests)
// Lines 168-171: GET /:id - NO authMiddleware (exposes single request details)
// Lines 179-182: GET /:id/history - NO authMiddleware (exposes history)
// Lines 189-193: POST / - NO authMiddleware (allows unauthenticated create)
// Lines 195-199: PUT /:id - NO authMiddleware (allows unauthenticated update)
// Lines 201-204: DELETE /:id - NO authMiddleware (allows unauthenticated delete)
```

**Steps**:
1. Add `authMiddleware` to `GET /` route (line 118)
2. Add `authMiddleware` to `GET /:id` route (line 168)
3. Add `authMiddleware` to `GET /:id/history` route (line 179)
4. Add `authMiddleware` to `POST /` route (line 189)
5. Add `authMiddleware` to `PUT /:id` route (line 195)
6. Add `authMiddleware` to `DELETE /:id` route (line 201)

**Verification**:
- [ ] Run `npm run typecheck` - should pass
- [ ] Run `npm test` - tests use x-test-user-id header which mock auth accepts
- [ ] Manual test: Call `GET /api/purchase-requests` without token → expect 401

---

### Phase 2: Remove Spoofable userId Fallbacks from Controllers (HIGH)

**Objective**: Eliminate `test-user-id` fallback patterns that allow unauthenticated users to impersonate any user

**Files to Modify**:
- `backend/src/controllers/purchaseRequest.controller.ts` - Fix submit, cancel, approve, reject, revertToDraft
- `backend/src/controllers/approval.controller.ts` - Fix decide, bulkApprove, setOutOfOffice

**Current Vulnerable Patterns (Verified)**:
```typescript
// purchaseRequest.controller.ts:188
const userId = req.userId || req.body?.userId || 'test-user-id';

// purchaseRequest.controller.ts:210
const userId = req.userId || req.body?.userId || 'test-user-id';

// purchaseRequest.controller.ts:233
const userId = (req as any).userId || 'test-user-id';

// purchaseRequest.controller.ts:255
const userId = (req as any).userId || 'test-user-id';

// purchaseRequest.controller.ts:277
const userId = (req as any).userId || req.userId;

// approval.controller.ts:322
const approverId = req.body.approverId || req.user?.userId;

// approval.controller.ts:391
const approverId = req.body.approverId || req.user?.userId;
```

**Steps**:
1. In `purchaseRequest.controller.ts:188` (submit):
   - Replace with: `const userId = req.userId;`
   - Add explicit 401 check: `if (!userId) { return res.status(401).json({...}) }`

2. In `purchaseRequest.controller.ts:210` (cancel):
   - Same pattern as submit

3. In `purchaseRequest.controller.ts:233` (approve):
   - Replace with: `const userId = req.userId;`
   - Add 401 check

4. In `purchaseRequest.controller.ts:255` (reject):
   - Same pattern as approve

5. In `purchaseRequest.controller.ts:277` (revertToDraft):
   - Replace with: `const userId = req.userId;`
   - Add 401 check

6. In `approval.controller.ts:322` (decide):
   - Replace with: `const approverId = req.userId;`
   - Remove `req.body.approverId` acceptance

7. In `approval.controller.ts:391` (bulkApprove):
   - Same pattern as decide

8. Search for any remaining `test-user-id` patterns and fix

**Verification**:
- [ ] Run `npm run typecheck` - should pass
- [ ] Run `npm test` - tests provide x-test-user-id which populates req.userId
- [ ] Grep for `test-user-id` - should return 0 matches in non-test files

---

### Phase 3: Add Authentication to Comment/Attachment Read Routes (HIGH)

**Objective**: Protect publicly accessible comment and attachment listing endpoints

**Files to Modify**:
- `backend/src/routes/comment.routes.ts` - Add authMiddleware to GET routes
- `backend/src/routes/attachment.routes.ts` - Add authMiddleware to GET routes

**Current Unprotected Routes (Verified)**:

Comment routes:
```typescript
// Line 53-57: GET / - NO authMiddleware
// Line 73-77: GET /request/:requestId - NO authMiddleware
// Line 79: GET /:id - NO authMiddleware
```

Attachment routes:
```typescript
// Line 51-55: GET / - NO authMiddleware
// Line 57-61: GET /size - NO authMiddleware
// Line 63-66: GET /file-types - NO authMiddleware
// Line 75-78: GET /entity/:entityType/:entityId - NO authMiddleware
// Line 81-84: GET /by-entity/:entityType/:entityId - NO authMiddleware
// Line 86: GET /:id - NO authMiddleware
```

**Steps**:
1. Add `authMiddleware` to all GET routes in `comment.routes.ts`
2. Add `authMiddleware` to all GET routes in `attachment.routes.ts`

**Verification**:
- [ ] Run `npm run typecheck`
- [ ] Run `npm test`
- [ ] Manual test: Call `GET /api/comments` without token → expect 401

---

### Phase 4: Gate Demo Credentials Behind Environment Check (MEDIUM)

**Objective**: Prevent demo credentials from being displayed in production builds

**Files to Modify**:
- `frontend/apps/web/src/app/login/LoginClient.tsx` - Conditionally render demo accounts

**Current State (Verified)**:
```typescript
// Lines 46-72: DEMO_ACCOUNTS array with hardcoded credentials
// Lines 113-129: handleDemoLogin function always available
```

**Steps**:
1. Wrap DEMO_ACCOUNTS rendering with `process.env.NODE_ENV !== 'production'` check
2. Hide "Quick Login" section in production
3. Only show manual login form in production

**Verification**:
- [ ] Run `npm run build:web` - should succeed
- [ ] In production build, demo accounts should not be visible
- [ ] In development, demo accounts should remain functional

---

### Phase 5: Remove/Gate Test Helper Pages (MEDIUM)

**Objective**: Remove or gate test pages that expose authentication state

**Files to Review**:
- `frontend/apps/web/src/app/login/login-test.html` - Static HTML test file
- `frontend/apps/web/src/app/test-auth/` - Auth state inspector
- `frontend/apps/web/src/app/api-test-simple/` - API test page
- `frontend/apps/web/src/app/test-api/` - API test page

**Steps**:
1. Delete `login-test.html` (static file with hardcoded IDs)
2. Add NODE_ENV check to test-auth page to redirect in production
3. Add NODE_ENV check to api-test-simple page to redirect in production
4. Add NODE_ENV check to test-api page to redirect in production

**Verification**:
- [ ] Files deleted/gated appropriately
- [ ] Production build excludes test pages
- [ ] Development retains test functionality

---

### Phase 6: Enforce Strong Secrets in Docker Configuration (MEDIUM)

**Objective**: Remove weak default secrets and require explicit configuration for production

**Files to Modify**:
- `docker-compose.yml` - Update JWT_SECRET default, add documentation
- `backend/src/config/index.ts` - Already has production validation (verify)

**Current State (Verified)**:
```yaml
# docker-compose.yml:73
JWT_SECRET: ${JWT_SECRET:-dev-jwt-secret}  # Weak 14-char default

# backend/src/config/index.ts already enforces:
# - Production: JWT_SECRET must be 32+ chars (throws error if not)
# - Development: Warns but allows insecure defaults
```

**Steps**:
1. Update `docker-compose.yml` JWT_SECRET to remove default or use placeholder that clearly fails
2. Add comment requiring explicit JWT_SECRET for production
3. Update MYSQL password defaults with comments warning about production use
4. Create/update `.env.production.example` with all required variables documented

**Verification**:
- [ ] Docker compose with no env vars should fail to start backend in prod mode
- [ ] Clear documentation exists for all required secrets

---

## Testing Strategy

### Unit Tests
- Existing tests use mock auth middleware with `x-test-user-id` header
- Tests should continue to pass as mock sets `req.userId` from header
- Run full test suite: `cd backend && npm test`

### Integration Tests
- Manual testing with curl/Postman without auth token → expect 401
- Manual testing with valid JWT → expect success

### Manual Testing Steps
1. Start backend without auth: `curl http://localhost:5001/api/purchase-requests` → should return 401
2. Start backend with auth: Login, use token, same call → should return data
3. Verify demo credentials hidden in production build

## Rollback Plan

1. All changes are additive (adding middleware) - rollback by removing authMiddleware
2. Git revert can undo all changes: `git revert <commit-hash>`
3. No database migrations involved - no schema changes needed

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Breaking existing functionality | Medium | High | Run full test suite, manual testing before merge |
| Frontend expects unauthenticated access | Low | Medium | Frontend already sends auth tokens; verify no public pages break |
| Test suite failures | Low | Medium | Mock auth middleware already supports x-test-user-id pattern |
| Production deployment issues | Low | High | Document required env vars clearly; fail fast with clear errors |

## Open Questions

1. **Should GET endpoints require authentication?** The current proposal adds auth to all routes. An alternative is to keep listing endpoints public but filter results by user permissions. What's your preference?

2. **What should happen to test pages?** Options:
   - A) Delete completely
   - B) Gate behind development environment
   - C) Gate behind admin role + development environment

3. **localStorage token storage**: This is identified as medium risk (XSS vulnerability). Should we include a migration to httpOnly cookies in this plan, or defer to a separate initiative?

---
**USER: Please review this plan. Edit any section directly in this file, then confirm to proceed.**
