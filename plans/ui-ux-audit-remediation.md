# Implementation Plan: Comprehensive UI/UX Audit & Remediation

Created: 2025-12-05
Status: PENDING APPROVAL

## Summary
Conduct a comprehensive UI/UX audit and remediation pass on the diabetes risk intelligence dashboard to fix critical visual bugs (z-index, contrast, broken icon, theme toggle visibility), improve typography readability, add visual hierarchy to metrics, and optimize performance on Data Explorer pages.

## Scope

### In Scope
- Fix menu z-index layering issues (menus behind charts/metrics)
- Repair broken navbar icon (SVGrepo external URL)
- Make theme toggle visible/accessible in navbar
- Fix contrast ratios throughout (WCAG AAA compliance: 7:1 normal, 4.5:1 large text)
- Increase detail font sizes on metric cards
- Remove/reduce glow effects impacting readability
- Standardize typography across components
- Add color accents to top tiles for visual hierarchy
- Fix black-on-dark text in Data Explorer
- Optimize Data Explorer performance (253,680 records issue)

### Out of Scope
- Major architectural changes to data loading strategy
- Adding new features beyond fixes
- Modifying underlying statistical models
- Changes to data files

## Prerequisites
- Access to `/Users/aiml/Projects/Rdata/diabetes_dashboard.R`
- Dashboard currently running on port 8888

## Implementation Phases

### Phase 1: Critical Blocking Issues (Z-Index & Icon)
**Objective**: Fix menu accessibility and broken icon display

**Files to Modify**:
- `/Users/aiml/Projects/Rdata/diabetes_dashboard.R` - Lines 248-250 (icon), Lines 1036-1056 (z-index)

**Steps**:
1. **Fix navbar icon** (Line 248):
   - Replace external SVGrepo URL with Bootstrap Icon `bs_icon("heart-pulse-fill")`
   - Or use inline SVG data URI for reliability
   - Current: `https://www.svgrepo.com/show/530440/health.svg` (unreliable external dependency)

2. **Verify z-index hierarchy** (Lines 1036-1056):
   - Confirm dropdown z-index: 10000 for `.dropdown-menu`
   - Confirm nav dropdown z-index: 10001 for `.nav-item .dropdown-menu`
   - Add z-index to selectize dropdowns if missing
   - Ensure value boxes don't create stacking context issues

3. **Add explicit stacking context for charts** (~Line 543):
   - Add `position: relative; z-index: 1;` to `.plotly` container
   - Ensure Plotly charts don't block dropdowns

**Verification**:
- [ ] Navbar icon displays correctly (not broken image placeholder)
- [ ] All dropdown menus appear above charts and metrics
- [ ] Menus accessible via click on all navigation items

---

### Phase 2: Theme Toggle Visibility
**Objective**: Make light/dark mode toggle visible and functional

**Files to Modify**:
- `/Users/aiml/Projects/Rdata/diabetes_dashboard.R` - Lines 1257-1284 (toggle CSS), Lines 2772-2782 (toggle UI)

**Steps**:
1. **Enhance toggle visibility** (Lines 1257-1284):
   ```css
   .theme-toggle-wrapper {
     margin-right: 1.5rem;
     padding: 0.5rem 1rem;
     background: var(--glass);
     border: 1px solid var(--glass-border);
     border-radius: 2rem;
   }
   ```

2. **Add visual indicator** (after Line 1280):
   - Add sun/moon icon indicators
   - Make toggle switch larger (width: 3.5rem, height: 1.75rem)
   - Add label text "Dark" / "Light"

3. **Ensure toggle appears in navbar** (Lines 2772-2782):
   - Verify `input_dark_mode()` is rendering
   - Add fallback toggle if bslib version doesn't support it

**Verification**:
- [ ] Toggle switch visible in navbar header
- [ ] Toggle switches between dark and light modes
- [ ] All components adapt to theme change

---

### Phase 3: Typography & Contrast Remediation
**Objective**: Fix all contrast issues and improve font legibility

**Files to Modify**:
- `/Users/aiml/Projects/Rdata/diabetes_dashboard.R` - Multiple CSS sections

**Steps**:
1. **Fix value box subtitle contrast** (Lines 465-472):
   - Change `color: var(--text-muted)` to `color: var(--text-secondary)`
   - `--text-muted` is #64748B (4.3:1 ratio - FAILS)
   - `--text-secondary` is #94A3B8 (5.8:1 ratio - better)
   - Or use `#CBD5E1` for 7.5:1 ratio (WCAG AAA)

2. **Increase metric card detail font sizes** (Lines 654-662):
   - Change `.metric-card-title` from `0.7rem` to `0.85rem`
   - Change `.value-box .value-box-title` from `0.75rem` to `0.875rem`

3. **Fix editorial callout contrast** (Lines 688-763):
   - Review `.editorial-lead` text color
   - Ensure strong/em tags have sufficient contrast

4. **Remove excessive glow effects** impacting readability:
   - Line 722: Reduce `.editorial-icon` filter drop-shadow
   - Lines 814-857: Reduce insight card text-shadow glow
   - Lines 621-651: Reduce risk badge glow intensity

5. **Fix Data Explorer black text** (Lines 487-541):
   - Ensure all DT table text uses `var(--cream)` or lighter colors
   - Check filter input text color
   - Verify search box text contrast

6. **Standardize number fonts** across components:
   - Ensure all numeric values use `'Fraunces', serif`
   - Apply consistent `letter-spacing: -0.03em` to numbers

**Contrast Reference Table**:
| Element | Current | Target | Ratio |
|---------|---------|--------|-------|
| Muted text (#64748B) on #0C1222 | 4.3:1 | #94A3B8 | 5.8:1 |
| Secondary text (#94A3B8) on #0C1222 | 5.8:1 | #CBD5E1 | 7.5:1 |
| Cream (#F5F0E8) on #0C1222 | 13.5:1 | Keep | OK |

**Verification**:
- [ ] All text passes WCAG AA minimum (4.5:1 normal, 3:1 large)
- [ ] Key metrics pass WCAG AAA (7:1)
- [ ] No black text on dark backgrounds
- [ ] Font sizes legible at default browser zoom

---

### Phase 4: Visual Hierarchy - Top Tiles Color Accents
**Objective**: Add color coding to differentiate metric tiles

**Files to Modify**:
- `/Users/aiml/Projects/Rdata/diabetes_dashboard.R` - Lines 437-485 (value boxes), Lines 1444-1495 (UI)

**Steps**:
1. **Add per-tile accent colors** (Lines 1453-1484):
   - Total Records: Sky blue accent (#38BDF8)
   - Diabetes Prevalence: Rose/danger accent (#FB7185)
   - Best Model AUC: Mint/success accent (#4ADE80)
   - Top Risk Factor: Amber/warning accent (#FBBF24)

2. **Implement accent via theme parameter or CSS class**:
   ```r
   value_box(
     title = "Total Records",
     theme = value_box_theme(bg = "transparent", fg = "#F5F0E8"),
     class = "accent-info",
     ...
   )
   ```

3. **Add CSS for accent classes** (after Line 485):
   ```css
   .value-box.accent-info .bi { color: var(--sky) !important; }
   .value-box.accent-danger .bi { color: var(--rose) !important; }
   .value-box.accent-success .bi { color: var(--mint) !important; }
   .value-box.accent-warning .bi { color: var(--amber) !important; }

   .value-box.accent-info::before {
     background: linear-gradient(90deg, var(--sky), transparent) !important;
   }
   ```

4. **Update value box gradient top border** (Lines 447-456):
   - Make the rainbow gradient accent respond to tile type

**Verification**:
- [ ] Each top metric has distinct color accent
- [ ] Icons colored to match accent theme
- [ ] Visual hierarchy immediately apparent
- [ ] Colors consistent with semantic meaning (success=green, danger=red, etc.)

---

### Phase 5: Performance Optimization - Data Explorer
**Objective**: Reduce lag on Data Explorer and Explore sub-pages

**Files to Modify**:
- `/Users/aiml/Projects/Rdata/diabetes_dashboard.R` - Lines 2800-2830 (filtering), Lines 3035-3076 (distribution charts)

**Steps**:
1. **Add sampling to Feature Analysis distributions** (Lines 3035-3076):
   - BMI distribution: Sample to 10,000 records max
   - Health distribution: Use pre-aggregated counts
   - Age distribution: Use pre-aggregated counts

2. **Optimize DT table rendering** (Lines 2928-2966):
   - Confirm `server = TRUE` is active
   - Add `deferRender = TRUE` to options
   - Add `scroller = TRUE` extension for virtual scrolling

3. **Add loading indicators** for heavy operations:
   - Wrap distribution charts in `withSpinner()`
   - Show progress during filter application

4. **Reduce initial data load** if possible:
   - Consider lazy loading fairness_results (439MB file)
   - Defer Advanced tab data until visited

5. **Add WebGL to remaining Plotly charts**:
   - Feature Analysis distribution charts
   - Any chart rendering >5000 points

**Verification**:
- [ ] Data Explorer loads within 3 seconds
- [ ] Window resizing doesn't cause lag
- [ ] Filter application completes within 1 second
- [ ] Feature Analysis tab renders smoothly

---

### Phase 6: Page-by-Page Quality Audit
**Objective**: Systematic verification of all fixes across routes

**Files to Modify**:
- `/Users/aiml/Projects/Rdata/diabetes_dashboard.R` - Various sections as needed

**Audit Checklist per Tab**:

1. **Executive Summary** (Lines 1444-1676):
   - [ ] Value boxes have color accents
   - [ ] Editorial callout readable
   - [ ] Key findings text contrast OK
   - [ ] Charts have transparent backgrounds

2. **Data Explorer** (Lines 1683-1810):
   - [ ] Filters visible and functional
   - [ ] Table text contrast OK
   - [ ] Scatter plot renders without lag
   - [ ] Histogram colors distinguishable

3. **Feature Analysis** (Lines 1813-1901):
   - [ ] Correlation heatmap readable
   - [ ] Feature importance bars visible
   - [ ] Distribution charts load quickly

4. **Model Performance** (Lines 1909-2033):
   - [ ] ROC curves smooth
   - [ ] Confusion matrix text readable
   - [ ] Metrics table contrast OK

5. **Risk Calculator** (Lines 2035-2213):
   - [ ] Input controls accessible
   - [ ] Prediction output visible
   - [ ] Risk badges color-coded correctly

6. **Advanced Tabs** (Lines 2216-2770):
   - [ ] Causal DAG image loads
   - [ ] Fairness metrics readable
   - [ ] Discovery cards visible

**Verification**:
- [ ] All pages pass manual accessibility check
- [ ] No console errors during navigation
- [ ] Consistent styling across all tabs

---

## Testing Strategy

### Manual Testing
1. Load dashboard and verify navbar icon displays
2. Click all dropdown menus - confirm they appear above content
3. Toggle theme switch - verify light/dark modes work
4. Navigate to each tab - check for contrast issues
5. Test Data Explorer with all filter combinations
6. Resize browser window - check for lag
7. Run accessibility audit in browser DevTools

### Automated Checks
- Chrome DevTools Lighthouse accessibility score
- Contrast ratio checker on key color combinations
- Performance profiling on Data Explorer tab

## Rollback Plan
1. All changes are in single file: `/Users/aiml/Projects/Rdata/diabetes_dashboard.R`
2. Git commit before changes enables easy revert: `git checkout HEAD~1 -- diabetes_dashboard.R`
3. Incremental changes per phase allow selective rollback

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| External icon URL still fails | Medium | Low | Use Bootstrap Icon instead |
| Theme toggle conflicts with bslib | Low | Medium | Test with latest bslib version |
| Performance changes break reactivity | Medium | High | Test each filter combination |
| Color changes impact brand consistency | Low | Medium | Document color rationale |
| Font size changes break layout | Low | Medium | Test at multiple viewport sizes |

## Open Questions
1. Should the navbar icon use a local asset instead of external URL?
2. What is the target contrast ratio - WCAG AA (4.5:1) or AAA (7:1)?
3. Should Data Explorer default sample size be reduced from 5,000 to 1,000?
4. Are there specific console errors to address? (User mentioned will provide)

---

## Implementation Order Summary

| Phase | Priority | Est. Lines Changed | Risk |
|-------|----------|-------------------|------|
| 1. Z-Index & Icon | CRITICAL | ~20 | Low |
| 2. Theme Toggle | HIGH | ~30 | Low |
| 3. Typography/Contrast | HIGH | ~80 | Medium |
| 4. Color Accents | MEDIUM | ~50 | Low |
| 5. Performance | MEDIUM | ~40 | Medium |
| 6. Full Audit | LOW | Variable | Low |

---

**USER: Please review this plan. Edit any section directly in this file, then confirm to proceed.**
