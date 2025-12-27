# Enhanced Comprehensive Seed Script Plan

## Objective
Create an enhanced seed script that generates **100+ purchase requests** spanning **October 1, 2024 through November 30, 2025** (14 months) with rich data to fully exercise all analytics features.

## Current Issues Identified
Based on exploration of the analytics system:
1. **Spending velocity/trends** - Need more historical data distributed across months
2. **Burn rate** - Currently only shows Customer Service division (need data across ALL divisions)
3. **Approvals page blank** - Need approvals with proper `assignedAt`, `decidedAt`, `dueBy` timestamps
4. **Top delays blank** - Need pending approvals that are overdue (`dueBy < today`)
5. **Only 34 PRs** - Need 100+ for meaningful analytics

## Analytics Data Requirements

### Key Metrics That Need Data:
| Metric | Required Data |
|--------|---------------|
| Spending Trends | PRs with `status IN (approved, completed, paid, closed)` across 14 months |
| Spending Velocity | Month-over-month variance in spending |
| Burn Rate | Units with `budget_allocation` + approved PRs per division |
| Approval Performance | Approvals with `decidedAt` timestamps across multiple approvers |
| Bottlenecks/Top Delays | Pending approvals with `dueBy < today` (overdue) |
| Approver Workload | Pending approvals distributed across approvers |
| Processing Time | Approvals with varying `(decidedAt - assignedAt)` durations |
| Success Rate | Mix of approved vs rejected PRs per division |

## Implementation Plan

### 1. Create New Seed File: `seed-comprehensive-v2.ts`

**Structure:**
```typescript
// Date helpers for 14-month span
const startDate = new Date('2024-10-01');
const endDate = new Date('2025-11-30');

// Generate 100-150 purchase requests with:
// - Realistic temporal distribution (more in Dec/Q4, fewer in summer)
// - All statuses represented
// - All priorities represented
// - All request types (DO_PO, RQS, RQM)
// - All funding sources (budget, grant, special_fund)
// - Distributed across ALL divisions (not just Customer Service)
```

### 2. Request Distribution (120 PRs Target)

**By Month (weighted for realism):**
| Month | Count | Notes |
|-------|-------|-------|
| Oct 2024 | 6-8 | Startup/Q4 beginning |
| Nov 2024 | 8-10 | Pre-holiday prep |
| Dec 2024 | 12-15 | Year-end spending surge |
| Jan 2025 | 8-10 | Post-holiday |
| Feb 2025 | 8-10 | Normal |
| Mar 2025 | 10-12 | Q1 close |
| Apr 2025 | 8-10 | Q2 start |
| May 2025 | 8-10 | Normal |
| Jun 2025 | 10-12 | Mid-year |
| Jul 2025 | 6-8 | Summer slowdown |
| Aug 2025 | 6-8 | Summer slowdown |
| Sep 2025 | 10-12 | Q3 close |
| Oct 2025 | 8-10 | Q4 start |
| Nov 2025 | 8-10 | Current month |

**By Status:**
- 60% approved/paid/closed (historical)
- 15% pending_approval (current backlog)
- 10% rejected
- 10% draft
- 5% cancelled

**By Division (spread across all 10):**
- IT: 15%
- Finance: 12%
- HR: 10%
- Operations: 12%
- Facilities: 10%
- Marketing: 8%
- Sales: 8%
- R&D: 10%
- Customer Service: 8%
- Legal: 7%

**By Priority:**
- Normal: 60%
- High: 25%
- Urgent: 10%
- Low: 5%

**By Amount Ranges:**
- $1K-$10K: 40%
- $10K-$50K: 35%
- $50K-$150K: 20%
- $150K+: 5%

### 3. Approval Data (Critical for Analytics)

**For each PR with approvals:**
```typescript
{
  approvalLevel: 1-4 (based on amount thresholds),
  approverId: distributed across all approvers,
  assignedAt: PR.submittedAt + random(1-48 hours),
  dueBy: assignedAt + random(3-7 days),
  decidedAt: status === 'pending' ? null : assignedAt + random(1-14 days),
  status: 'pending' | 'approved' | 'rejected',
}
```

**Overdue Scenarios (for Top Delays):**
- 15-20 pending approvals with `dueBy < today`
- Varying overdue durations: 1 day to 2 weeks

**Late Completions (for Processing Time):**
- 10-15% of completed approvals where `decidedAt > dueBy`

### 4. Budget/Burn Rate Data

**Ensure each unit has budget_allocation:**
- IT units: $500K-$1M each
- Finance: $300K-$500K
- Other divisions: $200K-$400K each

**Approved spending per division should be 40-80% of budget** to show realistic burn rates

### 5. Supporting Data

**Comments:** 2-5 per PR with back-and-forth conversations
**Chat Messages:** Rich conversations on 20-30 PRs
**Invoices:** For 70% of approved/paid PRs
**Notifications:** 50+ notifications across users
**Audit Logs:** 100+ entries for amendments/rework analysis
**Delegations:** 8-10 active/scheduled/expired delegations

### 6. NPM Script

Add to `package.json`:
```json
"prisma:seed:comprehensive": "npm run prisma:seed && tsx prisma/seed-comprehensive-v2.ts"
```

### 7. Post-Seed Analytics Refresh

After seeding, run:
```bash
npm run analytics:refresh
```

To rebuild the summary tables:
- `analytics_monthly_spending_summary`
- `analytics_approval_performance_metrics`

## Key Files to Modify

1. **Create:** `/backend/prisma/seed-comprehensive-v2.ts` - New comprehensive seed
2. **Update:** `/backend/package.json` - Add seed script
3. **Verify:** Unit budget allocations exist in base seed

## Expected Outcomes After Seeding

| Analytics Feature | Expected Result |
|-------------------|-----------------|
| Spending Trends | 14 months of data, all divisions |
| Spending Velocity | Clear month-over-month trends |
| Burn Rate | All divisions with projections |
| Approval Performance | Metrics for all approvers |
| Top Delays | 15-20 overdue approvals |
| Approver Workload | Distribution across 8+ approvers |
| Processing Time | Varying times by level |
| Bottlenecks | Level 2-3 slower than level 1 |
| Success Rate | 85-90% overall, varies by division |

## Summary Statistics Target

```
Purchase Requests: 120+
Approvals: 200+
Comments: 300+
Chat Messages: 100+
Invoices: 80+
Notifications: 100+
Audit Logs: 150+
Delegations: 10+
Date Range: Oct 1, 2024 - Nov 30, 2025
```
