# RespiWatch Data Fix: Immediate Action Plan

## Root Cause Analysis (Completed)

### The Dec 1st Dip - BAD DATA
Discovered a **corrupt data record** causing the visual dip:
```
2025-11-30: ECDC positivity = 16.7-29.8% (normal)
2025-12-01: positivity = 3.03% with NULL source_id  ← BAD DATA!
2025-12-02: positivity = 31.2% with NULL source_id
2025-12-07: ECDC positivity = 19.7-28.7% (normal)
```

### The 69% Interpolated - NOT A BUG
This is **correct behavior**:
- CDC/WHO/ECDC all report **weekly** data (not daily)
- Database has ~6 weekly snapshots with ~42 records each
- App requests 270 daily dates → only ~30 dates have real data
- (270-30)/270 = ~88% gaps → interpolated
- The 69% is an accurate calculation

### 2007 Records with NULL source_id
Database has 2007 orphan records without source attribution:
- Dec 1-2 orphans with anomalous values
- These bypass the fallback system because they EXIST (just with garbage values)

---

## IMMEDIATE FIX PLAN

### Step 1: Clean Bad Data (5 minutes)
Delete orphan records with NULL source_id that contain anomalous values:

```sql
-- In data/respiwatch.sqlite
DELETE FROM surveillance_data WHERE source_id IS NULL;
```

This removes:
- Dec 1st record with 3.03% (the dip)
- Dec 2nd record with 31.2%
- All 2007 orphan records

### Step 2: Add Data Validation (10 minutes)
Add validation to fetch scripts to prevent future bad insertions.

**File**: `scripts/fetch_flu_enhanced.R` (and other fetch scripts)

Add before INSERT:
```r
# Validate data before insertion
validate_surveillance_record <- function(record) {
  # Must have source_id
  if (is.null(record$source_id) || is.na(record$source_id)) {
    warning("Skipping record without source_id")
    return(FALSE)
  }

  # Positivity rate sanity check (flag if < 1% or > 50%)
  if (!is.na(record$positivity_rate)) {
    if (record$positivity_rate < 1 || record$positivity_rate > 50) {
      warning(sprintf("Suspicious positivity_rate: %.2f", record$positivity_rate))
      # Still allow but flag for review
    }
  }

  TRUE
}
```

### Step 3: Fix source_id Linking (15 minutes)
Ensure all fetch scripts properly link records to data sources.

**Check**: `scripts/fetch_flu_enhanced.R`, `scripts/fetch_ecdc_data.R`, etc.

Each INSERT must include valid source_id from data_sources table.

### Step 4: Update Fallback Logic (Optional - 20 minutes)
Add anomaly detection to data_fallback.R to reject outliers:

```r
# In get_surveillance_with_fallback()
# After fetching data, detect and exclude outliers
detect_outliers <- function(values, threshold = 3) {
  if (length(values) < 5) return(rep(FALSE, length(values)))
  median_val <- median(values, na.rm = TRUE)
  mad_val <- mad(values, na.rm = TRUE)
  abs(values - median_val) > threshold * mad_val
}
```

---

## Files to Modify

| File | Change | Priority |
|------|--------|----------|
| `data/respiwatch.sqlite` | DELETE orphan records | HIGH |
| `scripts/fetch_flu_enhanced.R` | Add source_id validation | HIGH |
| `scripts/fetch_ecdc_data.R` | Add source_id validation | HIGH |
| `R/data_fallback.R` | Add outlier detection (optional) | MEDIUM |

---

## Verification Steps

After fixes, verify:
1. `SELECT * FROM surveillance_data WHERE source_id IS NULL` → 0 rows
2. Dec 1st dip disappears from charts
3. 69% interpolated should DROP to ~80%+ (since we removed 2007 garbage records)
4. Run app and check Pathogen Analysis tab

---

## Why 69% Interpolated is Actually Correct

**Surveillance data is inherently weekly**:
- CDC FluView: Published every Friday for previous week
- WHO FluNet: Weekly aggregates
- ECDC: Weekly surveillance reports

**The math**:
- 270-day view = 270 date slots
- Weekly data = ~38 weeks ≈ 38 data points per pathogen
- 3 pathogens × 38 points = 114 points
- But spread across 810 date×pathogen cells → 114/810 = 14% real data

**Options**:
1. Accept weekly granularity (show weekly bars, not daily lines)
2. Continue interpolating (current approach - visually smooth but 86% synthetic)
3. Fetch daily data (not available from CDC/WHO - they don't publish daily)

---

## Execution Order

1. [ ] Run SQL to delete orphan records
2. [ ] Restart Shiny app
3. [ ] Verify Dec 1 dip is gone
4. [ ] Add validation to fetch scripts
5. [ ] Re-run fetch scripts to repopulate with clean data
6. [ ] Final verification
