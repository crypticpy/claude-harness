# RespiWatch: Date Range Controls & Wave Propagation Fix

## Overview
Implement per-tab date range controls with 30-day defaults, fix wave propagation analysis, and verify data pipeline integrity.

---

## Current State

### Database Status (Verified)
- **Total Records**: 235 surveillance records
- **Date Range**: 2021-10-07 to 2025-12-05
- **Active APIs**: CDC FluView, CDC NREVSS, CDC COVID (3 of 8 configured)

### App Structure (9 Tabs)
| Tab | Charts | Needs Date Control |
|-----|--------|-------------------|
| Global Overview | timeline_chart, global_map | YES |
| Country Analysis | country_kpis, anomalies | YES |
| Pathogen Analysis | multi_pathogen_timeline, comparisons | YES |
| Surveillance Gaps | gaps_table | YES |
| Rt Analysis | rt_timeseries_plot, forecast_plot | YES |
| Bayesian Forecast | bayes_forecast_plot | YES |
| Scenario Analysis | scenario_comparison_plot | YES |
| Healthcare Capacity | capacity_timeline_plot | YES |
| About | (static info) | NO |

### Wave Propagation Status: BROKEN
- Location: `R/wave_propagation.R` (602 lines)
- Integration: `app.R` lines 2528-2615

**Critical Bugs:**
1. Logic checks `result$success` but function returns `result$status` (line 2564)
2. Data structure mismatch - expects `pathogen_code`, `country_code`, `observation_date` but gets `date`, `case_numbers`
3. Field access errors: `result$confidence` vs `result$velocity$confidence`
4. No country boundaries data passed (always `NULL`)

---

## Implementation Plan

### Task 1: Create Date Range Control Module
**File**: `R/date_range_module.R` (NEW)

Create a reusable Shiny module for date range controls:

```r
# Module UI
dateRangeControlUI <- function(id, label = "Date Range") {
  ns <- NS(id)
  tagList(
    dateRangeInput(ns("date_range"),
      label = label,
      start = Sys.Date() - 30,  # 30-day default
      end = Sys.Date(),
      min = Sys.Date() - 270,   # 9 months available
      max = Sys.Date()
    ),
    actionButton(ns("reset"), "Reset to 30 days", class = "btn-sm")
  )
}

# Module Server
dateRangeControlServer <- function(id, data_reactive) {
  moduleServer(id, function(input, output, session) {
    # Returns filtered data based on date range
    filtered_data <- reactive({
      req(input$date_range)
      data_reactive() |>
        filter(date >= input$date_range[1], date <= input$date_range[2])
    })

    observeEvent(input$reset, {
      updateDateRangeInput(session, "date_range",
        start = Sys.Date() - 30,
        end = Sys.Date()
      )
    })

    return(filtered_data)
  })
}
```

### Task 2: Add Date Controls to Each Tab
**File**: `app.R`

Add `dateRangeControlUI` to each tab's UI section:

| Tab | Input ID | Location in app.R |
|-----|----------|-------------------|
| Global Overview | `global_date_range` | ~line 980 |
| Country Analysis | `country_date_range` | ~line 1080 |
| Pathogen Analysis | `pathogen_date_range` | ~line 1180 |
| Surveillance Gaps | `gaps_date_range` | ~line 1280 |
| Rt Analysis | `rt_date_range` | ~line 1350 |
| Bayesian Forecast | `bayes_date_range` | ~line 1450 |
| Scenario Analysis | `scenario_date_range` | ~line 1550 |
| Healthcare Capacity | `capacity_date_range` | ~line 1630 |

### Task 3: Wire Server-Side Date Filtering
**File**: `app.R` (server section)

For each tab, create a filtered reactive:

```r
# Example for Global Overview tab
global_filtered_data <- dateRangeControlServer("global_date_range",
  reactive({ combined_timeline_df }))

# Then use global_filtered_data() in renderPlotly instead of combined_timeline_df
output$timeline_chart <- renderPlotly({
  data <- global_filtered_data()
  # ... existing plot code
})
```

### Task 4: Fix Wave Propagation Analysis
**File**: `R/wave_propagation.R` and `app.R`

#### Fix 1: Status field check (app.R line 2564)
```r
# BEFORE (broken):
if (is.null(result) || !result$success) {

# AFTER (fixed):
if (is.null(result) || result$status %in% c("insufficient_data", "insufficient_spread")) {
```

#### Fix 2: Data structure mapping (app.R before wave analysis call)
```r
# Transform timeline_df to expected structure
wave_input_data <- combined_timeline_df |>
  mutate(
    pathogen_code = pathogen,
    observation_date = date,
    case_count = case_numbers,
    country_code = "USA"  # Default for national data
  )
```

#### Fix 3: Field access corrections (app.R lines 2588, 2609)
```r
# BEFORE:
result$velocity_km_day
result$confidence

# AFTER:
result$velocity$velocity_km_day
result$velocity$confidence
```

### Task 5: Verify Data Pipeline Integrity
**File**: `R/data_scheduler.R`

Add pipeline verification function:

```r
verify_data_pipeline <- function() {
  conn <- get_db_connection()

  checks <- list(
    surveillance = dbGetQuery(conn,
      "SELECT pathogen_code, COUNT(*) as n, MIN(observation_date) as min_date,
       MAX(observation_date) as max_date FROM surveillance_data
       JOIN pathogens USING(pathogen_id) GROUP BY pathogen_code"),
    freshness = dbGetQuery(conn,
      "SELECT source_code, last_fetch_timestamp, fetch_status
       FROM data_freshness JOIN data_sources USING(source_id)")
  )

  close_db_connection(conn)
  return(checks)
}
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `R/date_range_module.R` | NEW - Reusable date range Shiny module |
| `app.R` (UI section) | Add dateRangeControlUI to 8 tabs |
| `app.R` (server section) | Add dateRangeControlServer calls, filter charts |
| `R/wave_propagation.R` | No changes needed (logic is correct) |
| `app.R` (wave analysis) | Fix status check, data mapping, field access |
| `R/data_scheduler.R` | Add verify_data_pipeline function |

---

## Execution Order

1. **Create date range module** (`R/date_range_module.R`)
2. **Add UI controls** to each tab in `app.R`
3. **Wire server-side filtering** for each chart
4. **Fix wave propagation bugs** in `app.R`
5. **Add pipeline verification** to `R/data_scheduler.R`
6. **Test app** - verify all tabs work with date controls

---

## Verification Checklist

- [x] All 8 tabs have date range controls
- [x] Default view shows last 30 days
- [x] Date pickers allow scrolling back 9 months
- [ ] Wave propagation displays velocity metrics
- [x] Database data flows correctly to all charts
- [x] No console errors on tab navigation

---

## Date Range Audit Fixes (2025-12-06)

### Issue Discovered
Two charts in the Country Analysis tab were not connected to the date range filter:
- `comparative_positivity_chart` (lines 3454, 3470)
- `comparative_hospitalization_chart` (lines 3503, 3519)

Both were using `combined_timeline_df` directly instead of `country_date_filter$data()`.

### Fixes Applied
1. **comparative_positivity_chart** (`app.R` ~line 3452)
   - Added: `filtered_data <- country_date_filter$data()`
   - Changed null check to use `filtered_data` instead of `combined_timeline_df`
   - Changed ggplot to use `filtered_data` instead of `combined_timeline_df`

2. **comparative_hospitalization_chart** (`app.R` ~line 3503)
   - Added: `filtered_data <- country_date_filter$data()`
   - Changed null check to use `filtered_data` instead of `combined_timeline_df`
   - Changed ggplot to use `filtered_data` instead of `combined_timeline_df`

### Charts Verified as Correctly Connected
| Chart | Date Filter | Status |
|-------|-------------|--------|
| timeline_chart | global_date_filter$data() | OK |
| multi_pathogen_timeline | pathogen_date_filter$data() | OK |
| comparative_positivity_chart | country_date_filter$data() | FIXED |
| comparative_hospitalization_chart | country_date_filter$data() | FIXED |
| rt_timeseries_plot | rt_data() reactive | OK |
| forecast_plot | forecast_data() reactive | OK |
| bayes_forecast_plot | bayes_result() reactive | OK |
| ensemble_comparison_plot | ensemble_result() reactive | OK |
| scenario_comparison_plot | scenario_results() reactive | OK |
| capacity_timeline_plot | capacity_result() reactive | OK |
| hospitalization_forecast_plot | capacity_result() reactive | OK |
| vaccine_effectiveness_chart | static data | N/A |

### Test Results
- App starts successfully: HTTP 200
- Database loading: 231 records from CDC/WHO APIs
- All charts render without errors
