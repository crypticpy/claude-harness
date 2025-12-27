# BillDetail Page Styling Standardization Plan

## Problem Summary
The BillDetail page and related components have inconsistent styling:
- White text on white/light backgrounds (accessibility failure)
- Generic Tailwind blue/purple classes instead of Austin Public Health brand colors
- Mixed styling approaches (Tailwind vs MUI theme colors)
- Blue buttons/badges that don't match the site's purple/green theme

## Brand Color Reference
From `src/theme/muiTheme.js`:
- **Purple (Primary)**: `#44499C` / Light: `#dcf2fd` / Dark: `#22254E`
- **Green (Secondary)**: `#009F4D` / Light: `#dff0e3` / Dark: `#005027`
- **Orange (Warning)**: `#FF8F00`
- **Cyan (Info)**: `#009CDE`
- **Red (Error)**: `#F83125`

## Files to Update

### 1. CRITICAL - MunicipalStatsCard.jsx (lines 236-239)
**Issue**: White text on light blue background
**Fix**: Change `textColor: "white"` to `textColor: brandColors.purple.dark` for the "Municipal Signals" metric

### 2. HIGH - BillDetail.jsx (lines 499, 506, 512, 658)
**Issue**: Generic Tailwind colors for badges
**Fix**: Replace with brand-aligned Tailwind utilities or inline styles:
- Jurisdiction badge: `bg-blue-100 text-blue-800` → brand cyan tint
- Status badge: `bg-green-100 text-green-800` → brand green (`#dff0e3` + `#005027`)
- Sponsor badge: `bg-purple-100 text-purple-800` → brand purple (`#dcf2fd` + `#22254E`)
- Interactive badge: `bg-blue-100 text-blue-800` → brand cyan or purple

### 3. HIGH - BillTextViewer.jsx (lines 69, 186, 228, 267, 304)
**Issue**: All buttons use `bg-blue-600 hover:bg-blue-700`
**Fix**: Replace with brand purple `#44499C` (hover: `#22254E`)

### 4. HIGH - AnalysisImpactGrid.jsx (line 132)
**Issue**: Hardcoded `bg-indigo-100 text-indigo-800`
**Fix**: Use brand purple light/dark

### 5. MEDIUM - AnalysisSummaryDisplay.jsx (line 30)
**Issue**: Default case uses generic blue
**Fix**: Use brand purple or appropriate brand color

### 6. MEDIUM - ImpactIndicators.jsx (lines 165, 183)
**Issue**: Generic gray fallback colors
**Fix**: Use brand-consistent neutral or purple tints

## Implementation Approach

**Brand colors already exist in Tailwind config!** (`tailwind.config.js` lines 9-33)

Available classes:
- `bg-brand-purple` / `bg-brand-purple-light` / `bg-brand-purple-dark`
- `bg-brand-green` / `bg-brand-green-light` / `bg-brand-green-dark`
- `bg-brand-cyan`, `bg-brand-orange`, `bg-brand-red`
- `text-brand-purple-dark`, `text-brand-green-dark`, etc.

**Strategy:**
1. For MUI components: Use `brandColors` import with `sx` prop (already the pattern)
2. For Tailwind components: Replace generic classes with existing brand classes

## Execution Order

1. Fix critical accessibility issue in MunicipalStatsCard (immediate)
2. Fix BillDetail.jsx badges - replace generic Tailwind with brand classes
3. Fix BillTextViewer.jsx buttons - replace blue with brand purple
4. Fix analysis components (AnalysisImpactGrid, AnalysisSummaryDisplay)
5. Fix ImpactIndicators fallbacks

## Specific Changes

### BillDetail.jsx badge replacements:

| Current | Replace With |
|---------|--------------|
| `bg-blue-100 text-blue-800` | `bg-brand-purple-light text-brand-purple-dark` |
| `bg-green-100 text-green-800` | `bg-brand-green-light text-brand-green-dark` |
| `bg-purple-100 text-purple-800` | `bg-brand-purple-light text-brand-purple-dark` |

### BillTextViewer.jsx button replacements:

| Current | Replace With |
|---------|--------------|
| `bg-blue-600 hover:bg-blue-700` | `bg-brand-purple hover:bg-brand-purple-dark` |

## Expected Outcome

- All text meets WCAG 2.1 AA contrast (4.5:1 minimum)
- Consistent Austin Public Health brand colors across all pages
- BillDetail page matches Dashboard styling patterns
- No more generic Tailwind blue where brand purple should be used
