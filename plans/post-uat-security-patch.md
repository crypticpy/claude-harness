# Post-UAT Security Patch Document

**Created**: 2025-12-17
**Status**: PENDING (Apply after UAT completion)
**Priority**: MEDIUM

## Overview

These security hardening tasks should be applied AFTER User Acceptance Testing (UAT) is complete. They would break demo/testing workflows if applied now.

---

## 1. Remove Demo Credentials from Login UI

**File**: `frontend/apps/web/src/app/login/LoginClient.tsx`

**Current State**:
```typescript
// Lines 46-72: DEMO_ACCOUNTS array with hardcoded credentials visible to all users
const DEMO_ACCOUNTS: DemoAccount[] = [
  { email: 'admin@aph.com', password: 'ChangeMe123!', ... },
  { email: 'manager@aph.com', password: 'ChangeMe123!', ... },
  { email: 'user@aph.com', password: 'ChangeMe123!', ... },
];
```

**Action Required**:
- Option A: Delete DEMO_ACCOUNTS array and Quick Login UI entirely
- Option B: Gate behind `process.env.NODE_ENV !== 'production'`
- Option C: Gate behind feature flag `NEXT_PUBLIC_DEMO_MODE_ENABLED`

**Recommended**: Option C - allows controlled demo access for training environments

---

## 2. Remove/Gate Test Helper Pages

**Files to Address**:
- `frontend/apps/web/src/app/login/login-test.html` - DELETE (static file with hardcoded user IDs)
- `frontend/apps/web/src/app/test-auth/page.tsx` - Gate or DELETE
- `frontend/apps/web/src/app/api-test-simple/page.tsx` - Gate or DELETE
- `frontend/apps/web/src/app/test-api/page.tsx` - Gate or DELETE

**Action Required**:
```typescript
// Add to each test page component:
if (process.env.NODE_ENV === 'production') {
  redirect('/home');
}
```

Or delete the files entirely if no longer needed.

---

## 3. Strengthen Docker Default Secrets

**File**: `docker-compose.yml`

**Current State**:
```yaml
JWT_SECRET: ${JWT_SECRET:-dev-jwt-secret}  # 14 chars, weak default
MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD:-root_pass}
MYSQL_PASSWORD: ${MYSQL_PASSWORD:-aph_pass}
```

**Action Required**:
```yaml
# Option A: Remove defaults entirely (fail if not set)
JWT_SECRET: ${JWT_SECRET:?JWT_SECRET is required}

# Option B: Use obviously-invalid placeholder
JWT_SECRET: ${JWT_SECRET:-CHANGE_ME_IN_PRODUCTION_MIN_32_CHARS}
```

---

## 4. Change Default User Password

**File**: `backend/.env.example` and `backend/prisma/seed.ts`

**Current State**:
- DEFAULT_USER_PASSWORD=ChangeMe123!
- All seeded demo users use this password

**Action Required**:
- Generate unique passwords for production demo accounts (if needed)
- Or disable demo accounts in production entirely
- Update documentation to require password changes

---

## 5. Migrate Token Storage to httpOnly Cookies

**Files Affected**:
- `frontend/packages/state/src/stores/useAuthStore.ts`
- `frontend/packages/data/src/lib/api/index.ts`
- `backend/src/controllers/auth.controller.ts`
- `backend/src/middleware/auth.middleware.ts`

**Current State**:
- JWT stored in localStorage (XSS vulnerable)
- Also set as httpOnly cookie for SSR (good)

**Action Required**:
- Remove localStorage token storage
- Use httpOnly cookies exclusively
- Update API interceptor to not inject Authorization header (cookies sent automatically)
- This is a larger refactor - recommend separate initiative

---

## Implementation Checklist

When ready to apply post-UAT:

- [ ] Remove/gate demo credentials UI
- [ ] Delete login-test.html
- [ ] Gate or delete test-auth page
- [ ] Gate or delete api-test-simple page
- [ ] Gate or delete test-api page
- [ ] Update docker-compose.yml defaults
- [ ] Update seed password requirements
- [ ] (Optional) Plan localStorage → httpOnly migration

---

## Notes

- These changes are intentionally deferred to avoid breaking UAT workflows
- Demo logins will continue to work with proper JWT authentication
- All HIGH priority security fixes (route auth, userId spoofing) are applied immediately
