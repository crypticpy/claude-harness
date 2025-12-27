# Implementation Plan: Pre-Computed Dashboard Visualizations

Created: 2025-12-10
Status: PENDING APPROVAL

## Summary

Shift the dashboard from real-time API computation to serving pre-computed visualization data that's calculated once during the nightly data sync. This leverages the existing `dashboard_cache` infrastructure while closing the gap where API endpoints bypass the pre-computed data in favor of on-the-fly computation. The result: instant dashboard loads and fine-grained control over visualization output.

## Current State Analysis (Verified 2025-12-10)

### What Already Exists (Good Foundation)
1. **PostgreSQL Cache Tables**: `dashboard_cache` (JSONB data) + `dashboard_cache_metadata` (TTL tracking) - VERIFIED PRESENT
2. **DashboardCacheJob**: Pre-calculates 9 cache types - VERIFIED WORKING (tested manually)
3. **Cache Types Currently Populating**: recent_activity (9 variants), bill_relationships (1), impact_summary (16 variants), status_breakdown (1), trending_topics (3) = 30 cached entries
4. **Cache Types NOT Populating**: municipal_stats, key_terms, activity_timeline, summary_stats - need investigation
5. **Trigger**: Cache job runs when `nightly_sync_job` completes with new/updated bills

### The Gap (What Needs Fixing)
- **Dashboard API endpoints compute data on-the-fly** instead of reading from `dashboard_cache` table
- Endpoints check Redis/in-memory cache first, but bypass the PostgreSQL pre-computed cache
- Cache job wasn't being triggered (cache table was empty until manual test run)
- Some cache types (municipal_stats, key_terms, etc.) may have errors preventing population
- Frontend makes 4+ parallel API calls, each potentially triggering expensive database queries

## Scope

### In Scope
- Modify dashboard API endpoints to read from `dashboard_cache` table as primary source
- Add a single unified dashboard endpoint that returns all pre-computed data in one response
- Update frontend to optionally use unified endpoint for faster initial load
- Ensure cache invalidation and refresh triggers work correctly
- Add cache status/freshness indicators for transparency

### Out of Scope
- Changing the nightly sync schedule or LegiScan integration
- Adding new visualization types (use existing 9 cache types)
- Frontend visualization component redesign
- Real-time websocket updates (not needed for batch-updated data)

## Prerequisites
- Existing `dashboard_cache` and `dashboard_cache_metadata` tables are present
- `DashboardCacheJob` is functioning correctly after syncs
- PostgreSQL database accessible from API

## Implementation Phases

### Phase 0: Fix Broken Cache Types and Verify Pipeline

**Objective**: Ensure all 9 cache types populate correctly and the cache job triggers properly after syncs.

**Files to Modify**:
- `app/scheduler/dashboard_cache_job.py` - Debug/fix `_cache_municipal_stats`, `_cache_key_terms`, `_cache_activity_timeline`, `_cache_summary_stats`
- `app/scheduler/jobs.py` - Verify cache job trigger logic

**Steps**:
1. Run cache job in Docker and capture full logs to identify why 4 cache types don't populate
2. Fix any errors in the `_cache_*` methods for missing types
3. Verify `should_update_cache()` logic isn't incorrectly skipping these types
4. Test that `nightly_sync_job` actually triggers `DashboardCacheJob().run()` when bills change
5. Add more detailed logging for cache job execution

**Verification**:
- [ ] All 9 cache types have entries in `dashboard_cache` table
- [ ] Cache job completes without errors
- [ ] Logs show successful cache population for each type

---

### Phase 1: Unified Dashboard Data Endpoint

**Objective**: Create a single API endpoint that returns all pre-computed dashboard data in one response, eliminating multiple round-trips.

**Files to Modify**:
- `app/api/routes/dashboard.py` - Add new unified endpoint
- `app/data/dashboard_cache.py` - Add method to retrieve all cache types

**New Files to Create**:
- None (using existing files)

**Steps**:
1. Add `get_all_dashboard_cache()` method to `DashboardCacheManager` that retrieves all 9 cache types in a single database query
2. Create new endpoint `GET /dashboard/unified` that:
   - Queries `dashboard_cache` table for all cache types
   - Returns combined response with all visualization data
   - Includes `cache_metadata` with last_updated timestamps for each type
   - Returns HTTP 200 even if some cache types are missing (graceful degradation)
3. Add response model with clear structure:
   ```python
   {
     "data": {
       "recent_activity": {...},
       "bill_relationships": {...},
       "impact_summary": {...},
       "status_breakdown": {...},
       "trending_topics": {...},
       "municipal_stats": {...},
       "key_terms": {...},
       "activity_timeline": {...},
       "summary_stats": {...}
     },
     "metadata": {
       "cache_updated_at": "2025-12-10T22:00:00Z",
       "cache_types_available": ["recent_activity", ...],
       "cache_types_stale": []
     }
   }
   ```

**Verification**:
- [ ] `GET /dashboard/unified` returns all 9 cache types
- [ ] Response includes metadata with timestamps
- [ ] Endpoint responds in <100ms (reading from cache table)
- [ ] Graceful handling when cache is empty/stale

### Phase 2: Update Existing Endpoints to Prefer Cache

**Objective**: Modify individual dashboard endpoints to read from `dashboard_cache` table first, only computing on-the-fly as fallback.

**Files to Modify**:
- `app/api/routes/dashboard.py` - Update all 9 dashboard endpoints
- `app/data/dashboard_cache.py` - Add type-specific cache retrieval with freshness check

**Steps**:
1. Create helper function `get_cached_dashboard_data(cache_type, cache_key)` that:
   - Queries `dashboard_cache` table by type and key
   - Checks `expires_at` for freshness
   - Returns cached data or `None` if stale/missing
2. Update each endpoint to follow pattern:
   ```python
   # 1. Try PostgreSQL dashboard_cache first (pre-computed)
   cached = cache_manager.get_cache(cache_key, cache_type)
   if cached:
       return ResponseBuilder.success(data=cached, message="From pre-computed cache")

   # 2. Fallback: Try Redis/in-memory (short-lived)
   # ... existing code ...

   # 3. Final fallback: Compute on-the-fly (expensive)
   # ... existing computation code ...
   ```
3. Endpoints to update:
   - `/dashboard/impact-summary` → cache_type: "impact_summary"
   - `/dashboard/recent-activity` → cache_type: "recent_activity"
   - `/dashboard/status-breakdown` → cache_type: "status_breakdown"
   - `/dashboard/trending-topics` → cache_type: "trending_topics"
   - `/dashboard/key-terms` → cache_type: "key_terms"
   - `/dashboard/activity-timeline` → cache_type: "activity_timeline"
   - `/dashboard/summary-stats` → cache_type: "summary_stats"
   - `/dashboard/bill-relationships` → cache_type: "bill_relationships"
   - `/dashboard/municipal-stats` → cache_type: "municipal_stats"

**Verification**:
- [ ] Each endpoint reads from `dashboard_cache` table first
- [ ] Endpoints still work when cache is empty (fallback computation)
- [ ] Response times improve significantly (<200ms vs previous 500ms+)
- [ ] Logs show "From pre-computed cache" messages

### Phase 3: Frontend Integration for Unified Endpoint

**Objective**: Update frontend to use the unified endpoint for initial dashboard load, reducing from 4+ API calls to 1.

**Files to Modify**:
- `src/services/api.js` - Add `getDashboardUnified()` function
- `src/hooks/useDashboardData.js` - Option to use unified endpoint
- `src/pages/Dashboard.jsx` - Optional: use unified data source

**Steps**:
1. Add `getDashboardUnified()` to api.js:
   ```javascript
   export const getDashboardUnified = async ({ signal } = {}) => {
     const response = await api.get("/dashboard/unified", { signal });
     return response.data?.data || response.data;
   };
   ```
2. Create new hook `useDashboardUnified.js` that:
   - Fetches all data in single call
   - Splits response into individual state pieces for component compatibility
   - Provides cache freshness metadata
3. Update `useDashboardData.js` to optionally use unified endpoint:
   - Add feature flag check `USE_UNIFIED_DASHBOARD`
   - If enabled: single fetch, split response
   - If disabled: existing parallel fetch behavior (backwards compatible)
4. Update Dashboard.jsx to show cache freshness indicator (optional):
   - Small badge showing "Data as of: 10:00 PM"
   - Indicates when next refresh expected

**Verification**:
- [ ] Dashboard loads with single API call when unified endpoint enabled
- [ ] All dashboard cards receive correct data
- [ ] Loading states work correctly
- [ ] Backwards compatible when feature disabled
- [ ] Network tab shows 1 request instead of 4+

### Phase 4: Cache Warming and Refresh Optimization

**Objective**: Ensure cache is always fresh and warm after nightly sync, with manual refresh capability.

**Files to Modify**:
- `app/scheduler/dashboard_cache_job.py` - Ensure all parameter combinations cached
- `app/api/routes/dashboard.py` - Add manual cache refresh endpoint
- `app/scheduler/jobs.py` - Verify cache job trigger

**Steps**:
1. Audit `DashboardCacheJob._cache_*` methods to ensure they cache the most common query variations:
   - recent_activity: 7d, 30d, 90d with limits 10, 25, 50
   - bill_relationships: limits 100, 200, 300; days 90, 180
   - impact_summary: all impact_type values
   - Ensure default frontend queries always hit pre-computed data
2. Add admin endpoint `POST /dashboard/refresh-cache`:
   - Protected by admin auth
   - Manually triggers `DashboardCacheJob().run()`
   - Returns status of cache refresh
3. Add endpoint `GET /dashboard/cache-status`:
   - Returns cache freshness for all types
   - Shows last_updated, expires_at, is_stale for each cache type
   - Useful for monitoring/debugging

**Verification**:
- [ ] Default frontend queries always hit cached data (no computation)
- [ ] Manual refresh endpoint works for admin users
- [ ] Cache status endpoint shows accurate freshness info
- [ ] Nightly sync triggers cache refresh correctly

### Phase 5: Performance Monitoring and Logging

**Objective**: Add observability to verify pre-computed cache is being used effectively.

**Files to Modify**:
- `app/api/routes/dashboard.py` - Add timing and source logging
- `app/api/middleware/` - Optional: Add cache-hit header to responses

**Steps**:
1. Add response header `X-Cache-Source: precomputed|redis|computed` to indicate data source
2. Add timing logs for each cache lookup path:
   - "Dashboard data served from precomputed cache in Xms"
   - "Dashboard data computed on-the-fly in Xms (cache miss)"
3. Add metrics counters (if Prometheus/StatsD available):
   - `dashboard_cache_hits_total{cache_type}`
   - `dashboard_cache_misses_total{cache_type}`
   - `dashboard_response_time_seconds{source}`

**Verification**:
- [ ] Response headers indicate cache source
- [ ] Logs show clear distinction between cached vs computed responses
- [ ] Can identify if cache is being bypassed unexpectedly

## Testing Strategy

### Unit Tests
- Test `DashboardCacheManager.get_all_dashboard_cache()` returns all types
- Test individual endpoint cache-first logic
- Test graceful fallback when cache empty

### Integration Tests
- Test unified endpoint returns complete response
- Test cache refresh endpoint triggers job correctly
- Test frontend unified hook splits data correctly

### Manual Testing Steps
1. Clear `dashboard_cache` table, verify endpoints still work (fallback)
2. Run `DashboardCacheJob().run()`, verify cache populated
3. Load dashboard, verify <500ms total load time
4. Check network tab shows single unified request (if enabled)
5. Verify cache freshness indicator shows correct timestamp

## Rollback Plan

1. **Frontend**: Disable `USE_UNIFIED_DASHBOARD` flag to revert to parallel fetches
2. **Backend**: Remove cache-first logic from endpoints (revert to existing behavior)
3. **Database**: Cache tables can remain; they don't affect fallback computation
4. Each phase is independently reversible without affecting others

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Cache becomes stale if sync job fails | Low | Medium | Keep fallback computation; add monitoring for cache freshness |
| Unified endpoint response too large | Low | Low | Response is ~50-100KB JSON, well within limits; can paginate if needed |
| Cache key mismatch between job and endpoints | Medium | High | Standardize cache key format; add tests for key consistency |
| Frontend breaks with new response shape | Low | Medium | Use feature flag; test thoroughly before enabling |

## Open Questions

1. **Cache Warm-up on Deploy**: Should we trigger cache refresh after deployments? (Currently only triggers after sync with changes)
2. **Cache TTL Strategy**: Current TTLs range 6-24 hours. Since data updates only nightly, should all be 24 hours?
3. **Unified vs Individual**: Should we deprecate individual endpoints eventually, or keep both permanently for flexibility?

---
**USER: Please review this plan. Edit any section directly in this file, then confirm to proceed.**
