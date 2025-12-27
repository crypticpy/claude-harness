# Implementation Plan: Left Sidebar Navigation & KPI Styling

Created: 2025-12-05
Status: PENDING APPROVAL

## Summary
Refactor the diabetes dashboard from top navbar with dropdown menus to a collapsible left sidebar navigation, eliminating z-index layering conflicts. Additionally, enhance KPI value box styling with distinct color accents for visual hierarchy.

## Scope

### In Scope
- Convert `page_navbar()` to `page_sidebar()` with collapsible left navigation
- Transform `nav_menu()` dropdown groups into sidebar navigation sections
- Maintain all existing tab content and functionality
- Enhance value box color styling with consistent accent colors
- Ensure responsive behavior (sidebar collapses on mobile)
- Preserve theme toggle functionality in new layout
- Maintain dark/light mode support

### Out of Scope
- Changes to server logic or reactive expressions
- Modifications to chart/visualization code
- Changes to per-tab filter sidebars (Data Explorer, Fairness, Discovery Lab)
- Data loading or preprocessing changes

## Prerequisites
- Dashboard file: `/Users/aiml/Projects/Rdata/diabetes_dashboard.R`
- Understanding of current structure verified

## Current Architecture

```
page_navbar()
├── nav_panel("Executive Summary")
├── nav_menu("Explore")
│   ├── nav_panel("Data Explorer")
│   └── nav_panel("Data Summary")
├── nav_menu("Models")
│   ├── nav_panel("Model Performance")
│   └── nav_panel("Model Comparison")
├── nav_menu("Advanced")
│   ├── nav_panel("Causal Analysis")
│   ├── nav_panel("Fairness Audit")
│   └── nav_panel("Anomaly Discovery")
├── nav_spacer()
├── nav_item(theme toggle)
└── nav_item(footer)
```

## Target Architecture

```
page_sidebar()
├── sidebar (collapsible left navigation)
│   ├── Logo/Title
│   ├── navset_pill_list()
│   │   ├── nav_panel("Executive Summary")
│   │   ├── nav("Explore", icon) [header]
│   │   │   ├── nav_panel("Data Explorer")
│   │   │   └── nav_panel("Data Summary")
│   │   ├── nav("Models", icon) [header]
│   │   │   ├── nav_panel("Model Performance")
│   │   │   └── nav_panel("Model Comparison")
│   │   └── nav("Advanced", icon) [header]
│   │       ├── nav_panel("Causal Analysis")
│   │       ├── nav_panel("Fairness Audit")
│   │       └── nav_panel("Anomaly Discovery")
│   ├── Theme Toggle
│   └── Footer
└── Main content area (tab panels render here)
```

## Implementation Phases

### Phase 1: Backup and Z-Index Quick Fix
**Objective**: Create backup and implement immediate z-index fix as fallback

**Files to Modify**:
- `/Users/aiml/Projects/Rdata/diabetes_dashboard.R`

**Steps**:
1. Create git branch for changes: `git checkout -b feat/sidebar-navigation`
2. Quick z-index fix (lines 1074-1094): Add `position: relative` to navbar and ensure proper stacking
   ```css
   .navbar {
     position: relative;
     z-index: 1050;
   }
   .bslib-page-main {
     position: relative;
     z-index: 1;
   }
   ```
3. Test if dropdown now appears above value boxes

**Verification**:
- [ ] Git branch created
- [ ] Z-index fix tested (may or may not fully resolve issue)

---

### Phase 2: Create Sidebar Navigation Structure
**Objective**: Replace page_navbar with page_sidebar using navset_pill_list

**Files to Modify**:
- `/Users/aiml/Projects/Rdata/diabetes_dashboard.R` - Lines 246-906 (UI definition)

**Steps**:
1. Replace `page_navbar()` wrapper (line 246) with `page_sidebar()`:
   ```r
   ui <- page_sidebar(
     title = "Diabetes Risk Intelligence",
     theme = bs_theme(...),  # Keep existing theme
     fillable = TRUE,
     sidebar = sidebar(
       title = tags$div(
         class = "sidebar-brand",
         bs_icon("heart-pulse-fill", size = "1.5rem"),
         tags$span("Diabetes Risk", class = "brand-text")
       ),
       width = 280,
       open = "desktop",  # Collapsed on mobile, open on desktop
       id = "main_sidebar",

       navset_pill_list(
         id = "main_nav",
         well = FALSE,
         widths = c(12, 12),

         # Navigation items here (Phase 3)
       ),

       # Theme toggle at bottom
       tags$hr(class = "my-3"),
       tags$div(
         class = "sidebar-footer",
         input_dark_mode(id = "dark_mode", mode = "dark"),
         tags$small(class = "text-muted d-block mt-2",
                    "CDC BRFSS 2015 Data")
       )
     ),

     # Main content - all nav_panel contents go here
   )
   ```

2. Move all tab content from nav_panel() blocks into the main content area

**Verification**:
- [ ] page_sidebar structure compiles without errors
- [ ] Sidebar renders on left side
- [ ] Sidebar collapses/expands properly

---

### Phase 3: Migrate Navigation Items
**Objective**: Convert nav_menu groups to sidebar pill navigation with headers

**Files to Modify**:
- `/Users/aiml/Projects/Rdata/diabetes_dashboard.R` - Lines 1560-2885 (all nav_panel content)

**Steps**:
1. Create navset_pill_list structure:
   ```r
   navset_pill_list(
     id = "main_nav",
     well = FALSE,

     # Executive Summary (direct)
     nav_panel(
       title = tags$span(bs_icon("speedometer2", class = "me-2"), "Executive Summary"),
       value = "executive",
       # Content moved here
     ),

     # Explore Section Header
     nav(tags$span(class = "nav-section-header",
         bs_icon("search", class = "me-2"), "EXPLORE")),

     nav_panel(
       title = tags$span(bs_icon("table", class = "me-2"), "Data Explorer"),
       value = "data_explorer",
       # Content here
     ),

     nav_panel(
       title = tags$span(bs_icon("bar-chart", class = "me-2"), "Data Summary"),
       value = "data_summary",
       # Content here
     ),

     # Models Section Header
     nav(tags$span(class = "nav-section-header",
         bs_icon("graph-up-arrow", class = "me-2"), "MODELS")),

     # ... remaining panels
   )
   ```

2. Move each nav_panel's content (keeping layout_columns, cards, etc. intact)

3. Remove old nav_menu wrappers and nav_spacer/nav_item for theme toggle

**Verification**:
- [ ] All 8 tabs accessible via sidebar
- [ ] Section headers display correctly
- [ ] Tab switching works properly
- [ ] Content renders in main area

---

### Phase 4: Add Sidebar CSS Styling
**Objective**: Style sidebar to match dashboard aesthetic

**Files to Modify**:
- `/Users/aiml/Projects/Rdata/diabetes_dashboard.R` - CSS section (lines 300-1200)

**Steps**:
1. Add sidebar brand styling:
   ```css
   .sidebar-brand {
     display: flex;
     align-items: center;
     gap: 0.75rem;
     padding: 0.5rem 0;
     margin-bottom: 1rem;
   }
   .sidebar-brand .brand-text {
     font-family: 'Fraunces', serif;
     font-size: 1.25rem;
     font-weight: 600;
     color: var(--cream);
   }
   ```

2. Add navigation section headers:
   ```css
   .nav-section-header {
     font-family: 'Outfit', sans-serif;
     font-size: 0.7rem;
     font-weight: 600;
     text-transform: uppercase;
     letter-spacing: 0.1em;
     color: var(--text-muted);
     padding: 1rem 0.5rem 0.5rem;
     display: flex;
     align-items: center;
     gap: 0.5rem;
   }
   ```

3. Style nav pills for dark mode:
   ```css
   .nav-pills .nav-link {
     color: var(--text-secondary);
     border-radius: 0.5rem;
     padding: 0.75rem 1rem;
     transition: all 0.2s ease;
   }
   .nav-pills .nav-link:hover {
     background: var(--midnight-lighter);
     color: var(--cream);
   }
   .nav-pills .nav-link.active {
     background: linear-gradient(135deg, var(--coral) 0%, #FF8585 100%);
     color: white;
   }
   ```

4. Add sidebar collapse button styling:
   ```css
   .bslib-sidebar-toggle {
     background: var(--midnight-lighter);
     border: 1px solid var(--glass-border);
     color: var(--cream);
   }
   ```

5. Add light mode overrides for sidebar

**Verification**:
- [ ] Sidebar visually matches dashboard theme
- [ ] Active state clearly visible
- [ ] Section headers styled properly
- [ ] Light mode works correctly

---

### Phase 5: Enhance Value Box Colors
**Objective**: Make KPI cards more visually distinct with stronger color coding

**Files to Modify**:
- `/Users/aiml/Projects/Rdata/diabetes_dashboard.R` - Value box CSS (lines 450-521)

**Steps**:
1. Update value box CSS for stronger accent colors:
   ```css
   /* Make accent bars more prominent */
   .value-box::before {
     height: 5px;
     opacity: 1;
   }

   /* Add subtle background tint per theme */
   .value-box.bg-primary {
     background: linear-gradient(145deg,
       rgba(56, 189, 248, 0.15) 0%,
       rgba(21, 29, 46, 0.95) 100%) !important;
   }
   .value-box.bg-danger {
     background: linear-gradient(145deg,
       rgba(251, 113, 133, 0.15) 0%,
       rgba(21, 29, 46, 0.95) 100%) !important;
   }
   .value-box.bg-success {
     background: linear-gradient(145deg,
       rgba(74, 222, 128, 0.15) 0%,
       rgba(21, 29, 46, 0.95) 100%) !important;
   }
   .value-box.bg-warning {
     background: linear-gradient(145deg,
       rgba(251, 191, 36, 0.15) 0%,
       rgba(21, 29, 46, 0.95) 100%) !important;
   }
   ```

2. Increase icon prominence:
   ```css
   .value-box .value-box-showcase .bi {
     font-size: 3.5rem !important;
     opacity: 1;
     filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
   }
   ```

3. Add light mode value box tints

**Verification**:
- [ ] Each KPI card has distinct color tint
- [ ] Colors visible but not overwhelming
- [ ] Icons prominently colored
- [ ] Works in both dark and light modes

---

### Phase 6: Remove Old Navigation CSS
**Objective**: Clean up unused navbar CSS

**Files to Modify**:
- `/Users/aiml/Projects/Rdata/diabetes_dashboard.R` - CSS section

**Steps**:
1. Review and comment out (don't delete yet) navbar-specific CSS rules that are no longer needed
2. Keep dropdown CSS in case any other dropdowns exist (select inputs)
3. Update any responsive breakpoints for sidebar layout

**Verification**:
- [ ] No visual regressions
- [ ] CSS file size reduced
- [ ] No console errors

---

### Phase 7: Testing and Polish
**Objective**: Comprehensive testing across scenarios

**Steps**:
1. Test all 8 tabs navigate correctly
2. Test sidebar collapse/expand on desktop
3. Test mobile responsive behavior (< 768px)
4. Test theme toggle works
5. Test per-tab filter sidebars still work (Data Explorer, Fairness, Discovery)
6. Test all interactive elements accessible
7. Check console for any errors

**Verification**:
- [ ] All tabs functional
- [ ] Sidebar responsive
- [ ] Theme toggle works
- [ ] No z-index conflicts
- [ ] No console errors
- [ ] Performance acceptable

---

## Testing Strategy

### Manual Testing
1. Navigate to each tab via sidebar
2. Toggle sidebar open/closed
3. Test on mobile viewport (< 768px)
4. Toggle dark/light mode
5. Use Data Explorer filters
6. Use Fairness Audit filters
7. Check all value boxes visible and styled

### Browser Testing
- Chrome (primary)
- Safari (Mac)
- Firefox (optional)

## Rollback Plan
1. All changes on feature branch `feat/sidebar-navigation`
2. If issues arise: `git checkout main`
3. Incremental commits allow partial rollback if needed

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| navset_pill_list doesn't support section headers | Medium | High | Use custom nav() items with CSS styling |
| Per-tab sidebars conflict with main sidebar | Low | Medium | They're nested in content area, should be independent |
| Theme toggle placement awkward | Low | Low | Can move to header or keep in sidebar footer |
| Responsive behavior differs | Medium | Medium | Extensive testing at breakpoints |
| Light mode sidebar colors off | Medium | Low | Add specific light mode CSS rules |

## Open Questions
1. Should the sidebar have a toggle button or collapse automatically based on screen size only?
2. Should section headers ("EXPLORE", "MODELS", "ADVANCED") be collapsible accordion-style or always expanded?
3. Is 280px the right sidebar width, or should it be narrower (250px)?

---

## Alternative: Quick Z-Index Fix Only

If the sidebar refactor is too large a change, an alternative is to just fix z-index:

**Add to CSS (around line 1080):**
```css
/* Fix navbar dropdown stacking context */
.navbar.navbar-default,
.navbar.navbar-dark {
  position: relative;
  z-index: 1050 !important;
}

/* Ensure dropdown escapes to overlay content */
.navbar .dropdown-menu {
  position: absolute;
  z-index: 10001 !important;
}

/* Lower the main content stacking context */
.bslib-page-fill,
.tab-content {
  position: relative;
  z-index: 1;
}
```

This is a smaller change but doesn't provide the improved UX of sidebar navigation.

---

**USER: Please review this plan. You may:**
1. **Approve as-is** to proceed with full sidebar refactor
2. **Choose "Quick Fix Only"** to just fix z-index without sidebar changes
3. **Edit any section** directly in this file, then confirm

Which approach would you prefer?
