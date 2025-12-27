# Implementation Plan: Clinical Premium Styling on Full-Featured Dashboard

Created: 2025-12-05
Updated: 2025-12-06
Status: PENDING APPROVAL

## Summary

Apply **Clinical Premium styling** to the original full-featured `diabetes_dashboard.R` (4,909 lines, 8 tabs) - NOT the stripped-down v2. The goal is to transform the dark "Midnight Luxe Editorial" theme into a light Clinical Premium aesthetic while **preserving ALL content and features**:

- 8 full tabs with rich content
- Editorial callouts ("The Bottom Line", Causal Insight, Fairness Alert, Discovery Insight)
- 4 Insight cards on Executive Summary
- Confusion matrices, distribution charts, residual analysis
- Discovery Lab with hypothesis generation
- Sidebar navigation structure
- All server-side logic and reactivity

---

## Target File

**`/Users/aiml/Projects/Rdata/diabetes_dashboard.R`** (4,909 lines)

## What We're Changing (Styling Only)

| Section | Lines | Change |
|---------|-------|--------|
| Color palette | ~22-65 | Replace dark palette with Clinical Premium coral/teal |
| bs_theme() | ~260-280 | Update fonts to DM Sans + Playfair Display |
| CSS block | ~300-1200 | Replace ~900 lines of dark CSS with ~500 lines Clinical Premium |
| Plotly theme | ~68-90 | Update for light backgrounds |
| ggplot2 theme | ~44-66 | Update for light theme |

## What We're Preserving (ALL Features)

- **8 Tabs**: Executive Summary, Data Explorer, Feature Analysis, Model Performance, Risk Predictor, Causal Analysis, Fairness Audit, Discovery Lab
- **4 Editorial Callouts**: Bottom Line, Causal Insight, Fairness Alert, Discovery Insight
- **4 Insight Cards**: Causal, Discovery, Fairness, Variance metrics
- **Key Findings** bulleted list
- **Model Performance Summary** card
- **Confusion Matrices** (both LR and RF)
- **Distribution Charts** (BMI, Health, Age)
- **Residual Distribution** histogram
- **Hypothesis Generation** in Discovery Lab
- **Counterfactual Scenarios** in Causal Analysis
- **Intersectional Heatmap** in Fairness Audit
- **Sidebar navigation** structure
- **All server-side logic** (~1500 lines)

---

## Clinical Premium Color Palette

```css
/* Primary Brand */
--coral: #E85D4C;           /* Primary action, alerts */
--coral-light: #FFF0EE;     /* Hover backgrounds */
--teal: #0D9488;            /* Success, secondary */
--teal-light: #ECFDF5;      /* Success backgrounds */

/* Neutrals */
--white: #FFFFFF;           /* Primary background */
--off-white: #FAFAFA;       /* Card backgrounds */
--cream: #F7F5F3;           /* Subtle warmth */
--charcoal: #1A1A2E;        /* Primary text */
--slate: #64748B;           /* Secondary text */
--border: #E8E8E8;          /* Subtle borders */
```

## Typography

- **Headlines**: Playfair Display (serif, gravitas)
- **Body**: DM Sans (clean, modern)
- **Numbers/Code**: IBM Plex Mono (tabular)

---

## Implementation Steps

### Step 1: Update Color Palette (~lines 22-65)
Replace dark "Midnight Luxe" colors with Clinical Premium palette.

### Step 2: Update ggplot2 Theme (~lines 44-66)
Change base_family to "DM Sans", update colors for light backgrounds.

### Step 3: Update Plotly Theme (~lines 68-90)
Update gridcolor, font colors for light mode, set colorway to coral/teal.

### Step 4: Update bs_theme() (~lines 260-280)
```r
bs_theme(
  version = 5,
  bg = "#FFFFFF",
  fg = "#1A1A2E",
  primary = "#E85D4C",
  secondary = "#64748B",
  success = "#0D9488",
  warning = "#F59E0B",
  danger = "#DC2626",
  info = "#0891B2",
  base_font = font_google("DM Sans"),
  heading_font = font_google("Playfair Display"),
  code_font = font_google("IBM Plex Mono")
)
```

### Step 5: Replace CSS Block (~lines 300-1200)
Replace ~900 lines of dark mode CSS with ~500 lines of Clinical Premium CSS covering:
- Navigation/sidebar (white bg, coral accents)
- Value boxes (white bg, colored left borders)
- Cards (white bg, subtle shadows, coral header icons)
- Editorial callouts (light backgrounds with coral/teal accents)
- Insight cards (colored backgrounds maintained)
- Tables (cream headers, coral hover)
- Forms (coral focus states)
- Custom components (interpretation boxes, subgroup definitions, etc.)

### Step 6: Remove Dark Mode Toggle
Remove `input_dark_mode()` and all dark/light mode switching CSS.

### Step 7: Update Spinner Colors
Change all `withSpinner(color = "#...")` from dark colors to `#E85D4C` (coral).

### Step 8: Test All 8 Tabs
Verify all features work and look correct in light theme.

---

## Key CSS Sections to Adapt

### Editorial Callouts
Keep structure, change from dark bg to light bg with coral/teal accents:
```css
.editorial-callout {
  background: var(--off-white);
  border-left: 4px solid var(--coral);
  color: var(--charcoal);
}
```

### Insight Cards
Keep colored backgrounds but brighten for light theme:
```css
.insight-card-causal { background: rgba(232, 93, 76, 0.1); }
.insight-card-discovery { background: rgba(13, 148, 136, 0.1); }
```

### Sidebar Navigation
Keep navset_pill_list structure, style for light theme:
```css
.nav-pills .nav-link.active {
  background: var(--coral);
  color: white;
}
```

### Interpretation Boxes (Risk Predictor)
Keep 3 risk level boxes, update colors for light theme.

### Subgroup Definition Badges (Discovery Lab)
Keep badge system, style for light backgrounds.

---

## Risk Mitigation

1. **Backup first**: Create copy before editing
2. **Incremental changes**: Test after each major section
3. **Preserve structure**: Only modify styling, not UI/server logic
4. **Keep classes**: Maintain all CSS class names, just restyle them

---

## Quality Checklist

- [ ] All 8 tabs render correctly
- [ ] Editorial callouts visible and styled
- [ ] Insight cards show with correct colors
- [ ] Charts have light backgrounds
- [ ] Tables readable with proper contrast
- [ ] Forms have coral focus states
- [ ] Sidebar navigation works
- [ ] All server outputs display correctly
- [ ] No console errors

---

**READY FOR APPROVAL**
