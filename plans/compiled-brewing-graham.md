# Clean Structured Output Schema Refactor

## Problem Statement

1. **JSON Truncation**: GPT-4.1 returns truncated JSON (156K chars!) because schema requires too much output
2. **Legacy Format Bloat**: Validation expects legacy `*_impacts` dict fields but schema returns `impact_categories` array
3. **Schema Complexity**: `subsections` uses `additionalProperties` pattern with 8 required fields per subsection

## Solution Overview

Simplify the schema to ensure responses stay well under 16K output tokens:
- Remove bloated `subsections` (8 required fields each!)
- Use concise `impact_categories` array as the single source of truth
- Remove all legacy `*_impacts` dict handling from backend
- Set `max_output_tokens: 16000` explicitly
- Check response `status` for truncation

---

## Implementation Plan

### Phase 1: Simplify Schema

**File**: `app/ai_analysis/utils.py`

Replace the bloated `impact_categories` schema with a lean version:

```python
"impact_categories": {
    "type": "array",
    "description": "Impact analysis for 6 categories",
    "items": {
        "type": "object",
        "properties": {
            "category": {
                "type": "string",
                "enum": ["public_health", "local_government", "economic", "environmental", "education", "infrastructure"]
            },
            "rating": {
                "type": "string",
                "enum": ["low", "moderate", "high", "critical"]
            },
            "confidence": {
                "type": "number",
                "description": "0-1 confidence score"
            },
            "narrative": {
                "type": "array",
                "items": {"type": "string"},
                "description": "2-4 bullet points describing impact"
            }
        },
        "required": ["category", "rating", "confidence", "narrative"],
        "additionalProperties": False
    }
}
```

**Key Change**: REMOVE the `subsections` object entirely - it was the source of the 156K char responses.

### Phase 2: Add max_output_tokens and Truncation Detection

**File**: `app/ai_analysis/structured_analysis.py`

1. Add `max_output_tokens: 16000` to API params (line ~100):
```python
params = {
    "model": self.model_name,
    "input": input_msgs,
    "max_output_tokens": 16000,  # GPT-4.1 max
    ...
}
```

2. Check response status for truncation (in `_run_with_retries_async`):
```python
# After getting response
status = getattr(response, "status", "completed")
incomplete_details = getattr(response, "incomplete_details", None)
if status != "completed" or incomplete_details:
    logger.warning("Response truncated: status=%s, details=%s", status, incomplete_details)
    # Retry or handle gracefully
```

### Phase 3: Remove Legacy Format Code

**File**: `app/ai_analysis/fallback_defaults.py`

1. Delete `convert_impact_categories_to_legacy()` function (just added!)
2. Update `get_default_analysis_response()` - remove legacy fields:
   - Remove `public_health_impacts`, `local_government_impacts`, `economic_impacts`
   - Keep only `impact_categories` array
3. Update `check_analysis_completeness()` - check for `impact_categories` not legacy fields
4. Update `validate_and_fill_response()` - use array format

**File**: `app/ai_analysis/db_operations.py`

1. Stop populating legacy columns in `_create_legislation_analysis_object()` (lines 721-726)
2. Store `impact_categories` directly in `raw_analysis` JSON field

### Phase 4: Database Schema Update

**File**: `db/policypulse_schema.sql`

The legacy columns can stay (no migration needed) - we just stop using them:
- `public_health_impacts` (JSONB)
- `local_gov_impacts` (JSONB)
- `economic_impacts` (JSONB)
- `environmental_impacts` (JSONB)
- `education_impacts` (JSONB)
- `infrastructure_impacts` (JSONB)

All analysis data goes to `raw_analysis` JSONB field which stores full `impact_categories` array.

---

## Files to Modify

| File | Changes |
|------|---------|
| `app/ai_analysis/utils.py` | Simplify schema - remove `subsections` |
| `app/ai_analysis/structured_analysis.py` | Add `max_output_tokens: 16000`, check truncation |
| `app/ai_analysis/fallback_defaults.py` | Remove legacy format handling |
| `app/ai_analysis/db_operations.py` | Stop populating legacy columns |

---

## New Simplified Schema

```python
{
    "name": "bill_analysis_schema",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "summary": {"type": "string"},
            "key_points": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "point": {"type": "string"},
                        "impact_type": {"type": "string", "enum": ["positive", "negative", "neutral"]}
                    },
                    "required": ["point", "impact_type"],
                    "additionalProperties": False
                }
            },
            "impact_categories": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "category": {"type": "string", "enum": ["public_health", "local_government", "economic", "environmental", "education", "infrastructure"]},
                        "rating": {"type": "string", "enum": ["low", "moderate", "high", "critical"]},
                        "confidence": {"type": "number"},
                        "narrative": {"type": "array", "items": {"type": "string"}}
                    },
                    "required": ["category", "rating", "confidence", "narrative"],
                    "additionalProperties": False
                }
            },
            "recommended_actions": {"type": "array", "items": {"type": "string"}},
            "immediate_actions": {"type": "array", "items": {"type": "string"}},
            "resource_needs": {"type": "array", "items": {"type": "string"}},
            "keywords": {"type": "array", "items": {"type": "string"}},
            "impact_summary": {
                "type": "object",
                "properties": {
                    "primary_category": {"type": "string", "enum": ["public_health", "local_gov", "economic", "environmental", "education", "infrastructure"]},
                    "impact_level": {"type": "string", "enum": ["low", "moderate", "high", "critical"]},
                    "relevance_to_texas": {"type": "string", "enum": ["low", "moderate", "high"]}
                },
                "required": ["primary_category", "impact_level", "relevance_to_texas"],
                "additionalProperties": False
            }
        },
        "required": ["summary", "key_points", "impact_categories", "recommended_actions", "immediate_actions", "resource_needs", "keywords", "impact_summary"],
        "additionalProperties": False
    }
}
```

**Estimated token usage**: ~2-4K tokens per response (vs 40K+ with subsections)

---

## Testing Plan

```bash
# Test with 5 bills
python scripts/analyze_parallel.py --pending --full-pipeline -c 1 -l 5 2>&1 | tee schema_v2_test.log

# Check for:
# 1. No truncation (response.status == "completed")
# 2. All 6 impact categories present
# 3. Responses complete in < 30s
# 4. No "Incomplete analysis" warnings
```

**Success Criteria**:
- ✅ 100% first-attempt success rate
- ✅ Response size < 10K chars (vs 156K)
- ✅ Analysis time < 30s per bill
- ✅ All 6 impact categories populated

---

## Sources

- [Azure OpenAI Structured Outputs](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/structured-outputs)
- [OpenAI Structured Outputs Guide](https://platform.openai.com/docs/guides/structured-outputs)
- [GPT-4.1 Azure Availability](https://futurework.blog/2025/04/15/gpt-4-1-aoai/)
