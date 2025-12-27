# Plan: Dashboard Metrics Audit & Consistency Fix

## Problem Summary

Dashboard components display inconsistent numbers because:
1. Different components call different API endpoints
2. Same endpoints called with different parameters (limits, time periods)
3. Some use pre-computed cache, others compute on-demand with limits
4. Frontend calculations vary between components

## Identified Inconsistencies

### Issue 1: Total Bills Count Mismatch
| Component | Data Source | Value Shown |
|-----------|-------------|-------------|
| WelcomeSection | `getSummaryStats()` → `total_bills` | Database count |
| ImpactAreaCards | `sum(byImpactArea[*].billCount)` | Sum of categorized bills |
| SimpleNetworkVisualization | `getBillRelationships()` → `stats.total_bills` | Pre-computed graph total |

**Root Cause:** A bill can affect multiple impact areas, OR some bills may not have analysis data, causing sums to differ from database count.

### Issue 2: Municipal Stats Parameter Inconsistency
| Component | API Call | Limit |
|-----------|----------|-------|
| MunicipalStatsCard | `getMunicipalStats()` | Default (250) |
| useLegislativeInsights | `getMunicipalStats({ limit: 500 })` | 500 |
| Pre-computed cache | `municipal_stats_all` | ALL bills |

**Root Cause:** Different limits mean different subsets of bills are analyzed.

### Issue 3: Impact Area Counting Logic
- `MunicipalStatsCard` shows all 4 severity levels (high, medium, low, minimal)
- `ImpactAreaCard` calculates `highImpactCount = high + medium` combined

**Root Cause:** Inconsistent presentation logic.

### Issue 4: Bills Requiring Action Discrepancy
- `MunicipalStatsCard`: Uses `keyMetrics.bills_requiring_action` from API
- `ImpactAreaCards`: Sums `requiresActionCount` per area
- A bill can require action in multiple areas, causing double-counting

---

## Implementation Plan

### Phase 1: Audit Current State (Read-Only)

**Task 1.1: Document actual API responses**
- Call `/dashboard/summary-stats` and log `total_bills`
- Call `/dashboard/municipal-stats` (no params) and log all counts
- Call `/dashboard/bill-relationships?use_cache=true` and log `stats.total_bills`
- Compare these three "total bills" values

**Task 1.2: Verify cache consistency**
- Check if `municipal_stats_all` cache exists and its contents
- Verify `bill_relationships_full` cache contents match
- Ensure both caches reflect same underlying data

### Phase 2: Backend Fixes

**Task 2.1: Ensure municipal-stats always uses full cache**
File: `app/api/routes/dashboard.py` - `/dashboard/municipal-stats` endpoint

Changes:
- Add `use_cache: bool = Query(True)` parameter (like bill-relationships)
- When `use_cache=True`, always serve `municipal_stats_all` pre-computed cache
- Remove limit-based fallback when using cache

**Task 2.2: Add cache metadata to responses**
Add `_cache_info` to municipal-stats response:
```python
{
  "data": {...},
  "_cache_info": {
    "source": "precomputed" | "computed",
    "total_bills_in_cache": int,
    "cache_updated_at": timestamp
  }
}
```

### Phase 3: Frontend Fixes

**Task 3.1: Update useLegislativeInsights hook**
File: `src/components/dashboard/LegislativeInsights/useLegislativeInsights.js`

Changes:
- Remove `limit: 500` parameter - let API serve full cache
- Add `useCache: true` parameter to `getMunicipalStats()` call
- Use `keyMetrics.totalBills` from API response instead of summing

**Task 3.2: Update MunicipalStatsCard**
File: `src/components/dashboard/MunicipalStatsCard.jsx`

Changes:
- Add `useCache: true` to API call
- Ensure it uses same data source as ImpactAreaCards

**Task 3.3: Unify total bills display**
All components showing "total bills" should use the same source:
- **Source of truth:** `getSummaryStats()` → `total_bills` (database count)
- Components needing analyzed bill count should use `municipal_stats.keyMetrics` or `bill_relationships.stats`

**Task 3.4: Fix ImpactAreaCard severity display**
File: `src/components/dashboard/LegislativeInsights/ImpactAreaCard.jsx`

Options:
- A) Show all 4 severity levels like MunicipalStatsCard
- B) Clarify label: "High/Medium Impact" instead of just count
- **Recommend B** - keep compact UI but clarify meaning

**Task 3.5: Fix action count double-counting**
File: `src/components/dashboard/LegislativeInsights/ImpactAreaCards.jsx`

- Don't sum `requiresActionCount` across areas (causes double-counting)
- Use `keyMetrics.bills_requiring_action` from API (deduplicated count)

### Phase 4: API Service Updates

**Task 4.1: Add useCache to getMunicipalStats**
File: `src/services/api.js`

```javascript
const getMunicipalStats = async ({ limit, offset, useCache = true } = {}) => {
  const params = { use_cache: useCache };
  if (!useCache) {
    params.limit = limit;
    params.offset = offset;
  }
  // ...
};
```

### Phase 5: Verification

**Task 5.1: Create consistency check**
- Load dashboard
- Verify all "total bills" displays show same number
- Verify "bills requiring action" matches across components
- Verify impact area counts sum correctly (or document why they don't)

---

## Key Files to Modify

| File | Changes |
|------|---------|
| `app/api/routes/dashboard.py` | Add `use_cache` param to municipal-stats |
| `src/services/api.js` | Add `useCache` param to getMunicipalStats |
| `src/components/dashboard/LegislativeInsights/useLegislativeInsights.js` | Remove limit, add useCache, fix totals |
| `src/components/dashboard/LegislativeInsights/ImpactAreaCard.jsx` | Clarify severity label |
| `src/components/dashboard/LegislativeInsights/ImpactAreaCards.jsx` | Fix action count source |
| `src/components/dashboard/MunicipalStatsCard.jsx` | Add useCache to API call |

---

## Design Decisions (User Confirmed)

1. **Total Bills:** Show database count (all tracked bills, ~1,153) not just analyzed (~928)
2. **Multi-Area Overlap:** Bills CAN appear in multiple impact areas - this is expected behavior
3. **Approach:** Start with audit phase to verify actual API values before implementing fixes

## Expected Outcomes

After implementation:
1. All "Total Bills" displays show same number (database count from `getSummaryStats`)
2. All "Bills Requiring Action" displays show same number (deduplicated from `keyMetrics`)
3. Impact area breakdowns use full pre-computed cache (no artificial limits)
4. Cache metadata visible for debugging/verification
5. Impact area sums may exceed total bills (expected - bills can affect multiple areas)

---

## Notes

- Bills CAN appear in multiple impact areas - this is expected and correct
- Sum of `byImpactArea` counts may exceed `total_bills` - this is intentional
- The key is ensuring the same data source is used consistently within each metric type
