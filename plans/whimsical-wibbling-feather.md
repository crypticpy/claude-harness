# Test Suite Overhaul Plan

## Overview
Complete overhaul of the PurchasePro test suite to align with current architecture (MySQL/Prisma), remove legacy tests, and update CI to enforce test success.

## Current State Analysis

### Database
- **Current**: MySQL via Prisma ORM
- **Legacy References**: MSSQL scripts still exist in backend but not used for testing

### Test Inventory

**Backend (32 test files)**
- Location: `backend/src/__tests__/`, `backend/src/tests/`, `backend/src/controllers/__tests__/`
- Most tests use real Prisma client against actual database
- Root causes of failures:
  - Logger mock issues (not spy-compatible)
  - Missing JWT auth headers in some tests
  - FK constraint violations from improper cleanup order
  - Duplicate test files between `__tests__` and `tests` directories

**Frontend (31 test files, excluding node_modules)**
- Location: Scattered across `frontend/apps/web/src/`, `frontend/packages/ui-components/src/`, `frontend/src/`
- Complex Jest config with React instance normalization for monorepo
- Uses babel-jest with jsdom environment

### CI Configuration
- Tests marked `continue-on-error: true` (non-blocking)
- E2E tests (Playwright) not in CI pipeline
- Separate commitlint, backend, and frontend jobs

---

## Implementation Plan

### Phase 1: Backend Test Cleanup

#### 1.1 Remove Duplicate/Legacy Test Files
Delete these duplicate or obsolete files:
```
backend/src/tests/invoice.test.ts          # Duplicate
backend/src/tests/request-type-integration.test.ts  # Duplicate
backend/src/tests/routing.service.test.ts  # Duplicate
backend/src/tests/vendor.test.ts           # Likely outdated
backend/src/controllers/user.controller.test.ts  # Duplicate of __tests__ version
```

#### 1.2 Create Centralized Test Utilities
Create `backend/src/__tests__/utils/`:

**test-helpers.ts**
- `createTestUser(overrides)` - Create user with proper cleanup
- `createTestPurchaseRequest(userId, overrides)` - Create PR with cleanup
- `makeAuthToken(user)` - Generate valid JWT for test user
- `cleanupTestData(ids)` - Proper FK-aware cleanup order

**prisma-mock.ts**
- Singleton test Prisma client
- Transaction-based test isolation
- Automatic cleanup after each test

**logger-mock.ts**
- Properly spyable Winston logger mock

#### 1.3 Consolidate Test Directory Structure
Final backend structure:
```
backend/src/__tests__/
├── utils/
│   ├── test-helpers.ts
│   ├── prisma-mock.ts
│   └── logger-mock.ts
├── services/
│   ├── auth.service.test.ts
│   ├── purchaseRequest.service.test.ts
│   ├── approval.service.test.ts
│   └── user.service.test.ts
├── controllers/
│   ├── auth.controller.test.ts
│   ├── purchaseRequest.controller.test.ts
│   ├── approval.controller.test.ts
│   └── user.controller.test.ts
└── integration/
    ├── purchase-request-lifecycle.test.ts
    └── approval-workflow.test.ts
```

### Phase 2: Backend Test Implementation

#### 2.1 Auth Service Tests (Priority: Critical)
```typescript
// backend/src/__tests__/services/auth.service.test.ts
- login() success with valid credentials
- login() failure with invalid password
- login() failure with disabled account
- refreshToken() success with valid token
- refreshToken() failure with expired token
- generateTokens() includes correct claims
```

#### 2.2 Purchase Request Service Tests (Priority: Critical)
```typescript
// backend/src/__tests__/services/purchaseRequest.service.test.ts
- create() with valid data creates draft
- create() with funding sources
- getById() returns correct data with relations
- update() only for draft status
- submit() transitions draft -> pending_approval
- approve() transitions to approved
- reject() transitions to rejected
```

#### 2.3 Approval Service Tests (Priority: Critical)
```typescript
// backend/src/__tests__/services/approval.service.test.ts
- createApprovalChain() builds correct chain
- processApproval() advances chain correctly
- delegateApproval() transfers approval rights
- getPendingApprovals() returns correct list
```

#### 2.4 User Service Tests (Priority: High)
```typescript
// backend/src/__tests__/services/user.service.test.ts
- create() with hashed password
- update() without password exposure
- resetPassword() sets default hash
- deactivate() sets isActive false
- getById() excludes password field
```

### Phase 3: Frontend Test Cleanup

#### 3.1 Remove Scattered Test Files
Consolidate tests from:
- `frontend/src/__tests__/` → Move to appropriate package locations
- Keep tests co-located with components in packages

#### 3.2 Simplify Jest Configuration
Current config has excessive complexity. Simplify:
- Keep React instance normalization (required for monorepo)
- Remove unnecessary d3 mocks if not testing charts
- Use jest-next instead of complex babel setup where possible

#### 3.3 Frontend Test Structure
```
frontend/packages/ui-components/src/components/
├── features/
│   ├── approvals/__tests__/
│   ├── purchase-request/__tests__/
│   └── request-list/__tests__/
├── base/__tests__/
└── layout/__tests__/

frontend/packages/data/src/
├── hooks/__tests__/
└── lib/api/services/__tests__/
```

### Phase 4: Frontend Test Implementation

#### 4.1 Hook Tests (Priority: High)
```typescript
// frontend/packages/data/src/hooks/__tests__/
- useAuth() login/logout flow
- usePurchaseRequests() fetching and mutations
- useApprovals() pending count and actions
```

#### 4.2 Component Tests (Priority: Medium)
```typescript
// frontend/packages/ui-components/.../__tests__/
- PurchaseRequestWizard step navigation
- ApprovalDashboard displays pending correctly
- RequestList filtering and sorting
```

### Phase 5: CI/CD Updates

#### 5.1 Update `.github/workflows/ci.yml`

```yaml
backend:
  steps:
    # ... existing setup ...
    - name: Tests
      run: npm test
      # REMOVE: continue-on-error: true
    - name: Upload Coverage
      uses: codecov/codecov-action@v4
      with:
        files: ./coverage/lcov.info
        flags: backend

frontend:
  steps:
    # ... existing setup ...
    - name: Tests (web)
      run: npm run test:web
      # REMOVE: continue-on-error: true
    - name: Upload Coverage
      uses: codecov/codecov-action@v4
      with:
        files: ./coverage/lcov.info
        flags: frontend

# NEW JOB: E2E Tests (optional, on main branch only)
e2e:
  name: E2E Tests
  runs-on: ubuntu-latest
  if: github.ref == 'refs/heads/main'
  needs: [backend, frontend]
  steps:
    - uses: actions/checkout@v6
    - name: Setup Node
      uses: actions/setup-node@v6
      with:
        node-version: 20
    - name: Install Playwright
      run: cd frontend && npx playwright install --with-deps
    - name: Run E2E
      run: cd frontend && npm run test:e2e
      continue-on-error: true  # E2E can be flaky, keep non-blocking initially
```

#### 5.2 Add Test Coverage Requirements
Create `jest.config.js` coverage thresholds:
```javascript
coverageThreshold: {
  global: {
    branches: 50,
    functions: 50,
    lines: 50,
    statements: 50,
  },
},
```

---

## Files to Delete

### Backend
```
backend/src/tests/                        # Entire directory (duplicates)
backend/src/controllers/user.controller.test.ts  # Duplicate
```

### Frontend
```
frontend/src/__tests__/                   # Move contents to packages, then delete
```

## Files to Create

### Backend
```
backend/src/__tests__/utils/test-helpers.ts
backend/src/__tests__/utils/prisma-mock.ts
backend/src/__tests__/utils/logger-mock.ts
backend/src/__tests__/services/auth.service.test.ts (new)
backend/src/__tests__/services/purchaseRequest.service.test.ts (new)
backend/src/__tests__/services/approval.service.test.ts (consolidate)
backend/src/__tests__/services/user.service.test.ts (new)
backend/src/__tests__/integration/purchase-request-lifecycle.test.ts
backend/src/__tests__/integration/approval-workflow.test.ts
```

## Files to Modify

```
.github/workflows/ci.yml                  # Remove continue-on-error, add coverage
backend/jest.config.js                    # Add coverage thresholds
frontend/apps/web/jest.config.cjs         # Simplify where possible
```

---

## Execution Order

1. **Backend cleanup** - Delete duplicates, create utils
2. **Backend tests** - Implement core service tests
3. **Frontend cleanup** - Consolidate scattered tests
4. **Frontend tests** - Implement hook and component tests
5. **CI update** - Remove continue-on-error, add coverage
6. **Verify** - Run full test suite, ensure CI passes

## Success Criteria

- [ ] All backend tests pass (`npm test` in backend/)
- [ ] All frontend tests pass (`npm run test:web` in frontend/)
- [ ] CI runs tests as blocking (no continue-on-error)
- [ ] Coverage reports generated
- [ ] No duplicate test files
- [ ] Tests use proper mocks and cleanup
