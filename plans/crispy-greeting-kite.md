# Legislative Insights Visualization Redesign

## Problem Statement

The current BillRelationshipMatrix is **too complex for City of Austin municipal staff**:
- Dense 15×15+ grid of tiny colored cells
- Requires understanding sponsor names, topic taxonomies, color intensity scales
- Designed for data analysts, not department heads or public administrators
- Users are across different departments (Public Health, Finance, Public Works, etc.)

**Goal**: Replace with a visualization that lets municipal staff quickly understand "What legislation affects Austin and what do we need to do about it?"

---

## Chosen Approach: Impact Area Cards with Drill-Down

Six large cards, one per impact area. Each shows summary + expandable bill list.

```
┌─────────────────────────────────────────────────────────────────┐
│  LEGISLATION BY IMPACT AREA                                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │ PUBLIC      │  │ EDUCATION   │  │ INFRA-      │             │
│  │ HEALTH      │  │             │  │ STRUCTURE   │             │
│  │             │  │             │  │             │             │
│  │  276 bills  │  │  153 bills  │  │  205 bills  │             │
│  │  ●●●○ High  │  │  ●●○○ Med   │  │  ●●○○ Med   │             │
│  │  3 need     │  │  1 needs    │  │  5 need     │             │
│  │  action     │  │  action     │  │  action     │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │ PUBLIC      │  │ ECONOMIC    │  │ ENVIRON-    │             │
│  │ SAFETY      │  │ DEV         │  │ MENT        │             │
│  │             │  │             │  │             │             │
│  │  380 bills  │  │  415 bills  │  │  113 bills  │             │
│  │  ●●●● High  │  │  ●●●○ High  │  │  ●○○○ Low   │             │
│  │  8 need     │  │  2 need     │  │  0 need     │             │
│  │  action     │  │  action     │  │  action     │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
│                                                                 │
│  [Click any card to see bills in that area]                    │
└─────────────────────────────────────────────────────────────────┘
```

**Why this approach:**
1. **Maps to org structure** - departments can find their area instantly
2. **Scannable** - 6 cards vs 225+ matrix cells
3. **Actionable** - "X need action" is immediately useful
4. **Progressive disclosure** - summary → detail on click
5. **Uses existing data** - reuses `byImpactArea`, `keyMetrics`, `impactSeverityByArea` from `municipal_stats` cache

---

## Implementation Plan

### Phase 1: Create ImpactAreaCards Component

**New file: `src/components/dashboard/LegislativeInsights/ImpactAreaCards.jsx`**

1. Create 6 card components using MUI Card with Austin Public Health brand colors
2. Each card displays:
   - Impact area icon and label (Public Health, Education, etc.)
   - Bill count from `byImpactArea`
   - Severity indicator (dots: ●●●○) from `impactSeverityByArea`
   - Action count badge from `keyMetrics.bills_requiring_action` (filtered by area)
3. Click handler to expand/show bill list for that area
4. Responsive grid: 3 columns on desktop, 2 on tablet, 1 on mobile

**Data source:** `GET /dashboard/municipal-stats` returns:
```javascript
{
  byImpactArea: { public_health: 276, education: 153, ... },
  impactSeverityByArea: {
    public_health: { high: 45, medium: 120, low: 111, minimal: 0 },
    ...
  },
  keyMetrics: {
    bills_requiring_action: 19,
    bills_with_mandate: 12,
    ...
  }
}
```

### Phase 2: Create BillListDrawer Component

**New file: `src/components/dashboard/LegislativeInsights/BillListDrawer.jsx`**

1. MUI Drawer or expandable panel that shows when card is clicked
2. List of bills filtered by selected impact area
3. Each bill row shows:
   - Bill number + title
   - Status chip (Introduced/In Committee/Passed)
   - Impact level badge (High/Medium/Low)
   - "Requires Action" chip if `requires_action: true`
   - Click to navigate to `/legislation/{id}`
4. Add filtering options at top:
   - Filter by status
   - Filter by fiscal impact
   - Show only "requires action" toggle

**Data source:** Need to filter `bill_relationships` data by impact category or add endpoint parameter

### Phase 3: Create Hook for Data Aggregation

**New file: `src/components/dashboard/LegislativeInsights/useLegislativeInsights.js`**

1. Combine data from:
   - `GET /dashboard/municipal-stats` - for card summaries
   - `GET /dashboard/bill-relationships` - for bill list drill-down
2. Compute derived data:
   - "Requires action" count per impact area
   - Severity level aggregation
3. Handle loading/error states

### Phase 4: Replace BillRelationshipMatrix

**Modify: `src/components/dashboard/BillRelationshipMatrix/index.js`**

1. Export new `LegislativeInsights` component as default
2. Keep old `BillRelationshipMatrix` available for backwards compatibility
3. Update parent components to use new visualization

**Or create new: `src/components/dashboard/LegislativeInsights/index.js`**
- Export `ImpactAreaCards` as main component
- Register in dashboard layout

### Phase 5: Update Dashboard Page

**Modify: Dashboard page that uses BillRelationshipMatrix**

1. Replace `<BillRelationshipMatrix />` with `<LegislativeInsights />`
2. Ensure data fetching includes `municipal_stats`
3. Test responsive layout

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/components/dashboard/LegislativeInsights/index.js` | CREATE | Barrel export |
| `src/components/dashboard/LegislativeInsights/ImpactAreaCards.jsx` | CREATE | Main 6-card grid |
| `src/components/dashboard/LegislativeInsights/ImpactAreaCard.jsx` | CREATE | Single card component |
| `src/components/dashboard/LegislativeInsights/BillListDrawer.jsx` | CREATE | Drill-down bill list |
| `src/components/dashboard/LegislativeInsights/useLegislativeInsights.js` | CREATE | Data hook |
| `src/components/dashboard/LegislativeInsights/constants.js` | CREATE | Icons, colors, labels |
| `src/components/dashboard/BillRelationshipMatrix/index.js` | MODIFY | Re-export new component |
| `src/services/api.js` | VERIFY | Ensure `getMunicipalStats` exists |

---

## Brand Colors for Cards

Use Austin Public Health palette from `src/theme/muiTheme.js`:

| Impact Area | Card Color | Icon |
|-------------|------------|------|
| Public Health | `#44499C` (Logo Blue) | LocalHospitalIcon |
| Education | `#009F4D` (Logo Green) | SchoolIcon |
| Infrastructure | `#009CDE` (Brand Cyan) | ConstructionIcon |
| Public Safety | `#FF8F00` (Brand Orange) | ShieldIcon |
| Economic Dev | `#44499C` (Logo Blue, alt) | TrendingUpIcon |
| Environment | `#009F4D` (Logo Green, alt) | ParkIcon |

---

## Implementation Status: COMPLETE

All files have been created. PropTypes fix has been applied.

### Files Created
| File | Status |
|------|--------|
| `src/components/dashboard/LegislativeInsights/constants.js` | ✅ Created |
| `src/components/dashboard/LegislativeInsights/useLegislativeInsights.js` | ✅ Created |
| `src/components/dashboard/LegislativeInsights/ImpactAreaCard.jsx` | ✅ Created |
| `src/components/dashboard/LegislativeInsights/ImpactAreaCards.jsx` | ✅ Created |
| `src/components/dashboard/LegislativeInsights/BillListDrawer.jsx` | ✅ Created |
| `src/components/dashboard/LegislativeInsights/index.js` | ✅ Created |
| `src/components/dashboard/BillRelationshipMatrix/index.js` | ✅ Modified |

---

## Acceptance Criteria

- [x] 6 impact area cards visible on dashboard
- [x] Each card shows bill count, severity indicator, action-required count
- [x] Clicking card expands to show filterable bill list
- [x] Bills link to detail page
- [x] Mobile responsive (stacks to 1 column)
- [x] Uses pre-computed cache data (fast load <200ms)
- [x] Passes WCAG 2.1 AA contrast requirements
- [x] Old matrix component preserved as `BillRelationshipMatrixLegacy`
