# Fix Impact Level Population in AI Analysis Pipeline

## Status: READY FOR IMPLEMENTATION

## Problem Statement

Impact levels (`impact` and `impact_category` columns) are not being populated in the database during AI analysis. The dashboard shows most bills as "unknown" because these fields are NULL.

**Current state:** 438 analyzed bills, only ~27 have non-NULL `impact` field (93% missing impact data)

---

## Root Cause Analysis

### Issue 1: Missing `impact_summary` Validation in Storage

**File:** `app/ai_analysis/db_operations.py` (lines 420-445)

The `store_legislation_analysis()` function extracts `impact_summary` from the analysis dict:

```python
# Current code (lines 420-422):
impact_summary = analysis_dict.get("impact_summary", {})  # Returns {} if missing
impact_category_str = impact_summary.get("primary_category")  # Returns None from {}
impact_level_str = impact_summary.get("impact_level")  # Returns None from {}
```

**Problem:** When AI doesn't return `impact_summary` (or it's empty), the enum conversion silently fails and sets NULL values:
- Lines 432-442: Try/except catches ValueError and logs warning but doesn't fill defaults
- Lines 686-687: `impact_category=None` and `impact=None` get stored

### Issue 2: `validate_and_fill_response()` Not Used Consistently

**File:** `app/ai_analysis/fallback_defaults.py` (line 103)

This function exists to fill missing `impact_summary` with defaults:
```python
"impact_summary": {
    "primary_category": "public_health",
    "impact_level": "low",
    "relevance_to_texas": "low",
}
```

**Problem:** Only called in `enhanced_analysis.py:86`, NOT in the main storage path.

---

## Expected Data Structure

From `fallback_defaults.py` (lines 47-51):

```python
"impact_summary": {
    "primary_category": "public_health",  # ImpactCategoryEnum values
    "impact_level": "low",                 # ImpactLevelEnum values
    "relevance_to_texas": "low",
}
```

Valid enum values:
- **ImpactCategoryEnum:** public_health, local_gov, economic, environmental, education, infrastructure, healthcare, social_services, justice
- **ImpactLevelEnum:** low, moderate, high, critical

---

## Implementation Plan

### Step 1: Add Default Validation in `store_legislation_analysis()`

**File:** `app/ai_analysis/db_operations.py`

**Add validation after line 412 (after `_normalize_analysis_dict()`):**

```python
# Normalize keys from model output into our canonical schema
analysis_dict = _normalize_analysis_dict(analysis_dict)

# NEW: Ensure impact_summary has valid defaults
from .fallback_defaults import get_default_analysis_response
defaults = get_default_analysis_response()
if "impact_summary" not in analysis_dict or not isinstance(analysis_dict.get("impact_summary"), dict):
    analysis_dict["impact_summary"] = defaults["impact_summary"]
else:
    # Fill any missing fields in impact_summary
    impact_summary = analysis_dict["impact_summary"]
    for key in ["primary_category", "impact_level", "relevance_to_texas"]:
        if not impact_summary.get(key):
            impact_summary[key] = defaults["impact_summary"][key]
```

### Step 2: Add Fallback When Enum Conversion Fails

**File:** `app/ai_analysis/db_operations.py` (lines 427-445)

**Modify enum conversion to use defaults on failure:**

```python
# Replace lines 427-445 with:
try:
    impact_enums = _get_impact_enum_models()
    impact_category_enum_cls, impact_level_enum_cls = impact_enums

    if impact_category_str is not None:
        try:
            impact_category_enum = impact_category_enum_cls(impact_category_str)
        except (ValueError, TypeError) as e:
            logger.warning("Invalid impact_category value: %s: %s. Using default.", impact_category_str, e)
            impact_category_enum = impact_category_enum_cls("public_health")  # Default

    if impact_level_str is not None:
        try:
            impact_level_enum = impact_level_enum_cls(impact_level_str)
        except (ValueError, TypeError) as e:
            logger.warning("Invalid impact_level value: %s: %s. Using default.", impact_level_str, e)
            impact_level_enum = impact_level_enum_cls("low")  # Default

    # Ensure we always have valid values
    if impact_category_enum is None:
        impact_category_enum = impact_category_enum_cls("public_health")
    if impact_level_enum is None:
        impact_level_enum = impact_level_enum_cls("low")

except (ImportError, AttributeError) as e:
    logger.warning("Could not access enum models for impact categorization: %s", e)
    # Still try to set defaults
    try:
        impact_category_enum = ImpactCategoryEnum("public_health")
        impact_level_enum = ImpactLevelEnum("low")
    except Exception:
        pass
```

---

## Files to Modify

| File | Change |
|------|--------|
| `app/ai_analysis/db_operations.py` | Add `impact_summary` validation after line 412 |
| `app/ai_analysis/db_operations.py` | Add fallback defaults in enum conversion (lines 427-445) |

---

## Post-Fix: Database Reset and Re-analysis

After the fix is implemented:

1. **Reset database:**
```bash
python scripts/reset_db.py
```

2. **Seed bills:**
```bash
python scripts/legislation_pipeline.py seed -j TX -l 50 --analyze
python scripts/legislation_pipeline.py seed -j US -l 50 --analyze
```

3. **Verify impact levels:**
```sql
SELECT impact, impact_category, COUNT(*)
FROM legislation_analysis
GROUP BY impact, impact_category;
```

---

## Validation Steps

### 1. Verify Impact Columns Are Populated
```bash
psql -d policypulse -c "SELECT COUNT(*) as total, COUNT(impact) as has_impact FROM legislation_analysis;"
```

**Expected:** `has_impact` should match `total` (100% populated)

### 2. Test API Response
```bash
curl -s http://localhost:8000/dashboard/impact-distribution | python -m json.tool
```

**Expected:** Non-zero counts for high/medium/low levels (no "unknown")

### 3. Verify Enum Distribution
```bash
psql -d policypulse -c "SELECT impact, COUNT(*) FROM legislation_analysis GROUP BY impact;"
```

**Expected:** Mix of low/moderate/high/critical values

---

## Success Criteria

1. All new analyses have non-NULL `impact` and `impact_category` columns
2. Invalid enum values are converted to safe defaults (not NULL)
3. Dashboard impact distribution shows proper counts (no "unknown")
4. No regression in analysis pipeline functionality
