# Data Loading Issues Investigation & Fix Plan

## Problem Summary

The frontend is not displaying data:
- **Bills Page**: Blank (no bills listed)
- **Dashboard**: Total bill count shows, but visualizations are empty

## Root Causes Identified

### Issue 1: Database Transaction Stuck in Failed State (CRITICAL)

**Location**: `app/api/dependencies.py` and `app/data/base_store.py`

**Problem**: The `get_data_store()` dependency returns a **global singleton** `DATA_STORE` with a persistent database session. When a database error occurs (e.g., query failure), the transaction enters a failed state but is **never rolled back**. All subsequent queries fail with:

```
psycopg2.errors.InFailedSqlTransaction: current transaction is aborted,
commands ignored until end of transaction block
```

**Evidence**:
- `/legislation/search` returns 500 with `InFailedSqlTransaction` even after container restart
- The error persists because the global session isn't recreated until full process restart

**Root Cause in Code**:
- `app/api/dependencies.py:33-52`: `get_data_store()` returns global `DATA_STORE` singleton
- `app/data/base_store.py:136-141`: `_get_session()` returns `self.db_session` without checking transaction state
- No rollback mechanism when queries fail

### Issue 2: Recent Activity Query Returns 0 Items

**Location**: `app/data/analytics/queries.py:110-127`

**Problem**: The query filters by `bill_introduced_date >= cutoff_date`, but **all 234 legislation records have NULL `bill_introduced_date`**:

```sql
SELECT bill_introduced_date FROM legislation LIMIT 5;
-- All NULL
```

The updated legislation query also fails because data is **2+ months old** (last `updated_at` is 2025-09-29), and the default 30-day filter excludes everything.

### Issue 3: Frontend Silent Failures

**Location**: `src/hooks/useDashboardData.js` and `src/context/SearchContext.jsx`

**Problem**: The frontend uses `Promise.allSettled()` which catches errors gracefully, but when API calls fail:
- Dashboard shows empty visualizations with "No data" placeholders
- Bills page shows "No Bills Found" without indicating API failure
- Errors are logged but not shown to users

---

## Recommended Fixes

### Fix 1: Add Session Rollback on Failed Transaction (PRIORITY)

**Files to modify**:
- `app/data/base_store.py`

**Change**: Add transaction state checking and auto-rollback in `_get_session()`:

```python
def _get_session(self) -> Session:
    """Return the current session, rolling back if in failed transaction state."""
    if not self.db_session:
        raise DatabaseOperationError("No database session available")

    # Check if transaction is in a failed state and rollback
    if self.db_session.get_transaction() and not self.db_session.is_active:
        logger.warning("Session in failed transaction state, rolling back")
        self.db_session.rollback()

    return self.db_session
```

### Fix 2: Update Recent Activity Query to Handle NULL Dates

**Files to modify**:
- `app/data/analytics/queries.py`

**Change**: Modify `query_recent_new_legislation` to use `updated_at` as fallback when `bill_introduced_date` is NULL:

```python
WHERE (l.bill_introduced_date >= :cutoff_date
       OR (l.bill_introduced_date IS NULL AND l.created_at >= :cutoff_date))
```

Or for testing with stale data, extend the default lookback period from 30 to 365 days:

```python
def get_recent_activity(self, days: int = 365, limit: int = 50, offset: int = 0):
```

### Fix 3: Improve Error Visibility in Frontend

**Files to modify**:
- `src/hooks/useDashboardData.js`
- `src/context/SearchContext.jsx`

**Change**: Surface API errors to users instead of silently showing "No data":
- Show error alerts when API calls fail
- Add retry buttons
- Display specific error messages from backend

---

## Immediate Workaround (For Testing)

To immediately unblock testing without code changes:

1. **Restart the API container** to get a fresh session:
   ```bash
   docker restart policypulse-api
   ```

2. **Test the `/legislation/` list endpoint** (which doesn't use the search path):
   ```bash
   curl http://localhost:8000/legislation/?limit=10
   ```

3. **Update test data dates** to be recent:
   ```sql
   UPDATE legislation SET updated_at = NOW() WHERE updated_at < NOW() - INTERVAL '30 days';
   ```

---

## Files to Modify

| File | Change Type | Priority |
|------|------------|----------|
| `app/data/base_store.py` | Add rollback on failed transaction | HIGH |
| `app/data/analytics/queries.py` | Handle NULL dates in recent activity query | HIGH |
| `src/hooks/useDashboardData.js` | Improve error visibility | MEDIUM |
| `src/context/SearchContext.jsx` | Surface search errors to user | MEDIUM |

---

## Verification Steps

After fixes:
1. Dashboard visualizations should show data
2. Bills page should list all 234 bills
3. Search functionality should work
4. Recent activity should show bills even with NULL introduced dates
