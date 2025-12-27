# Implementation Plan: Unified Seed Script Consolidation

Created: 2025-12-17
Status: PENDING APPROVAL

## Summary

Consolidate all seed scripts into a single comprehensive seed script that establishes the complete APH organizational structure, test users, financial data, and realistic purchase request data. The unified script will replace the current fragmented approach (seed.ts + seed-backfill + seed-comprehensive-v2.ts) with one idempotent, well-organized script.

## Scope

### In Scope
- Create unified `seed-unified.ts` that combines all seeding functionality
- Proper seeding order respecting all foreign key constraints
- APH divisions and units (9 divisions, 44+ units)
- APH object codes from CSV (152 codes)
- Test users with proper division/unit assignments
- Vendors, FDUs, cost centres
- Approval chains per division
- 375+ purchase requests with realistic distribution
- Approvals, comments, notifications, delegations, invoices
- Single npm script: `prisma:seed` (replaces all variants)
- Database clearing script that preserves schema

### Out of Scope
- Schema changes (no migrations needed - all recent changes are business logic only)
- Modifying the Prisma schema
- Production data migration
- Azure AD integration

## Prerequisites
- Backend server stopped (to avoid connection conflicts)
- MySQL database accessible
- Node.js and tsx available

## Implementation Phases

### Phase 1: Database Clearing Utility

**Objective**: Create a utility to safely clear all data while preserving schema

**Files to Create**:
- `backend/prisma/clear-database.ts` - Utility to truncate all tables in correct order

**Steps**:
1. Create clear-database.ts with proper deletion order (reverse of seeding order)
2. Handle foreign key constraints by disabling/enabling checks
3. Preserve Prisma migration history table (`_prisma_migrations`)
4. Add npm script: `prisma:clear`

**Verification**:
- [ ] Running `npm run prisma:clear` empties all tables
- [ ] Schema and migration history preserved
- [ ] No foreign key violations during clearing

### Phase 2: Unified Seed Script Structure

**Objective**: Create the unified seed script with modular phases

**Files to Create**:
- `backend/prisma/seed-unified.ts` - Main comprehensive seed script

**New File Structure**:
```typescript
// seed-unified.ts
// Phase 1: Foundation data (no dependencies)
// Phase 2: Organizational structure (depends on Phase 1)
// Phase 3: Approval workflows (depends on Phase 1-2)
// Phase 4: Purchase requests (depends on Phase 1-3)
// Phase 5: Transactional data (depends on Phase 4)
// Phase 6: Analytics refresh
```

**Steps**:
1. Create seed-unified.ts with clear phase separation
2. Import and consolidate logic from:
   - seed-aph-divisions.ts (APH structure)
   - seed-aph-object-codes.ts (object codes from CSV)
   - seed.ts (foundation data, users, vendors)
   - seed-comprehensive-v2.ts (purchase requests, analytics)
3. Ensure each phase is clearly documented and can report progress
4. Add proper error handling and transaction support where appropriate

**Verification**:
- [ ] Script runs without errors
- [ ] All phases complete in order
- [ ] Progress logging shows each phase

### Phase 3: Foundation Data Seeding

**Objective**: Seed all reference data with no dependencies

**Implementation in seed-unified.ts**:

**Phase 1 Functions**:
- `seedRoles()` - Basic roles (if needed)
- `seedObjectCodes()` - Load from /resources/Object Codes.csv (152 codes)
- `seedAPHDivisions()` - 9 APH divisions
- `seedAPHUnits()` - 44+ units across divisions

**Steps**:
1. Implement seedObjectCodes() using CSV parser from resources/Object Codes.csv
2. Implement seedAPHDivisions() with upsert pattern
3. Implement seedAPHUnits() with proper divisionId references
4. Deactivate any non-APH divisions/units (isActive = false)

**Verification**:
- [ ] 9 active APH divisions created
- [ ] 44+ active APH units created with correct division relationships
- [ ] 152 object codes loaded from CSV
- [ ] Non-APH divisions/units deactivated

### Phase 4: Users and Financial Data

**Objective**: Create test users and financial reference data

**Phase 2 Functions**:
- `seedTestUsers()` - Admin, managers, requesters with proper divisions
- `seedVendors()` - Test vendor records
- `seedFDUs()` - Fund Department Units per division
- `seedCostCentres()` - Cost centres per division

**Steps**:
1. Create test users with known credentials:
   - admin@aph.com (System Admin, APH-ADMIN)
   - manager@aph.com (Manager/Approver, APH-ADMIN)
   - user@aph.com (Regular User, APH-CSD)
   - Additional users per division for realistic testing
2. Assign users to correct APH divisions and units
3. Set proper role flags (isAdmin, isApprover, canApproveHighValue, maxApprovalAmount)
4. Create vendors with realistic data
5. Create FDUs and Cost Centres linked to divisions

**Verification**:
- [ ] 3 core test users with known passwords (ChangeMe123!)
- [ ] Users properly assigned to APH divisions/units
- [ ] At least 1 approver per division
- [ ] Vendors, FDUs, Cost Centres created

### Phase 5: Approval Chains

**Objective**: Set up approval workflows per division

**Phase 3 Functions**:
- `seedApprovalChains()` - Create chains for each division/request type
- `seedApprovalChainLevels()` - Define approval levels with approvers
- `seedDelegations()` - Active, scheduled, and expired delegations

**Steps**:
1. Create approval chain for each (division, requestType) combination
2. Set up 2-3 approval levels per chain with actual approvers
3. Create delegation patterns (active, scheduled, expired)

**Verification**:
- [ ] Each division has approval chains for DO_PO, RQS, RQM
- [ ] Chains have appropriate approvers assigned
- [ ] Delegation patterns created for testing

### Phase 6: Purchase Requests and Transactions

**Objective**: Generate realistic purchase request data

**Phase 4-5 Functions**:
- `seedPurchaseRequests()` - 375+ requests across divisions
- `seedPurchaseRequestFundings()` - Multi-source funding records
- `seedApprovals()` - Approval records with proper workflow state
- `seedComments()` - Discussion on 80%+ of PRs
- `seedNotifications()` - Full notification coverage
- `seedInvoices()` - Invoices for approved/paid PRs

**Steps**:
1. Generate PRs with realistic distribution:
   - Status distribution: draft (5%), pending (20%), approved (40%), rejected (10%), paid/closed (25%)
   - Amount distribution: small (<$1K), medium ($1K-$10K), large (>$10K)
   - Date range: Oct 2024 - Nov 2025
2. Create proper approval chains for non-draft PRs
3. Add comments with realistic discussion patterns
4. Create notifications for all relevant events
5. Generate invoices for approved/paid requests

**Verification**:
- [ ] 375+ purchase requests created
- [ ] Realistic status and amount distribution
- [ ] Proper approval workflow state
- [ ] Comments, notifications, invoices present

### Phase 7: Cleanup and Package.json Update

**Objective**: Remove orphaned files and update npm scripts

**Files to Modify**:
- `backend/package.json` - Update seed scripts

**Files to Delete** (orphaned/superseded):
- `backend/prisma/seed.ts` (superseded by seed-unified.ts)
- `backend/prisma/seed-comprehensive-v2.ts` (merged into seed-unified.ts)
- `backend/prisma/seed-backfill-purchase-request-fundings.ts` (merged)
- `backend/prisma/seed-pending-approvals.ts` (orphaned, never used)
- `backend/prisma/seed-purchases.dev.ts` (orphaned, never used)

**Files to Keep** (can be imported by seed-unified.ts):
- `backend/prisma/seed-aph-divisions.ts` - Exportable function, keep for standalone use
- `backend/prisma/seed-aph-object-codes.ts` - Exportable function, keep for standalone use

**Package.json Updates**:
```json
{
  "scripts": {
    "prisma:seed": "tsx prisma/seed-unified.ts",
    "prisma:clear": "tsx prisma/clear-database.ts",
    "prisma:reseed": "npm run prisma:clear && npm run prisma:seed",
    "prisma:seed:aph-divisions": "tsx prisma/seed-aph-divisions.ts",
    "prisma:seed:aph-object-codes": "tsx prisma/seed-aph-object-codes.ts"
  }
}
```

**Steps**:
1. Update package.json with new scripts
2. Delete orphaned seed files
3. Update CLAUDE.md to reflect new seeding approach

**Verification**:
- [ ] `npm run prisma:seed` runs unified script
- [ ] `npm run prisma:clear` clears database
- [ ] `npm run prisma:reseed` does full clear + reseed
- [ ] Orphaned files removed
- [ ] Documentation updated

## Testing Strategy

### Manual Testing Steps
1. Stop backend server
2. Run `npm run prisma:clear` - verify all tables empty
3. Run `npm run prisma:seed` - verify complete without errors
4. Start backend server
5. Login with test accounts (admin@aph.com, manager@aph.com, user@aph.com)
6. Verify divisions/units appear in dropdowns
7. Verify purchase requests appear in list views
8. Verify approval workflows function
9. Run `npm run prisma:reseed` to test full cycle

### Data Verification Queries
```sql
-- Verify counts
SELECT 'divisions' as entity, COUNT(*) FROM divisions WHERE is_active = 1
UNION SELECT 'units', COUNT(*) FROM units WHERE is_active = 1
UNION SELECT 'users', COUNT(*) FROM users WHERE is_active = 1
UNION SELECT 'purchase_requests', COUNT(*) FROM purchase_requests
UNION SELECT 'approvals', COUNT(*) FROM approvals
UNION SELECT 'notifications', COUNT(*) FROM notifications;
```

## Rollback Plan

1. If seed-unified.ts fails, the original files are still available in git history
2. `git checkout HEAD~1 -- backend/prisma/seed*.ts` to restore original files
3. Restore original package.json scripts if needed

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Foreign key constraint violations during clear | Medium | High | Use SET FOREIGN_KEY_CHECKS=0 temporarily |
| Missing data references in unified script | Low | Medium | Verify against current seed scripts line by line |
| Breaking existing development environments | Medium | Medium | Document clear migration path, test thoroughly |
| Performance issues with large data volume | Low | Low | Use batch inserts, transactions where appropriate |

## Open Questions

1. **Should we keep seed-aph-divisions.ts and seed-aph-object-codes.ts as separate files for standalone use?** (Recommended: Yes, they're already exported as functions and useful for updating just org structure)

2. **How many purchase requests should we seed?** (Current comprehensive seed creates 375+, recommend keeping this)

3. **Should the unified script support a "minimal" mode for faster testing?** (Could add flag for 50 PRs vs 375)

---
**USER: Please review this plan. Edit any section directly in this file, then confirm to proceed.**
