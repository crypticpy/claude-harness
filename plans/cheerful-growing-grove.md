# Dashboard UI Redesign: Approvals, Admin Dashboard & Analytics

## Overview

Comprehensive UI fixes and redesign for three main dashboard areas:
1. **Approvals Dashboard** - Breakpoint issues, search layout
2. **Admin Dashboard** - Full visual overhaul with responsive charts
3. **Admin Analytics** - Responsive sections and improved data visualization

**Design Principles:**
- APH branding consistency (using existing palette)
- Mobile-first responsive design
- Clear visual hierarchy
- Consistent spacing (8px grid)

---

## Issues Identified

### Approvals Dashboard
| Issue | Location | Fix |
|-------|----------|-----|
| Search field no `sm` breakpoint | RequestListHeader.tsx:68 | Add sm: 320 maxWidth |
| PageHeader fixed 24px gap | PageHeader.tsx:78-85 | Responsive gap: xs:2, sm:3 |
| Pending count chip tight in corner | Client.tsx:68-84 | Center or better positioning |
| DataGrid columns hiding abruptly | RequestList.tsx:258-280 | Smoother responsive handling |

### Admin Dashboard
| Issue | Location | Fix |
|-------|----------|-----|
| Heatmap 14px hardcoded cells | HeatmapChart.tsx | Responsive cell sizing |
| Heatmap uses old blue color | HeatmapChart.tsx | Update to APH Logo Blue |
| Budget chart 160px label width | BudgetChart.tsx | Responsive labels |
| Spending chart 70px Y-axis | SpendingChart.tsx | Responsive axis width |
| Fixed 320px chart height | Multiple charts | Responsive height |
| SLA section centering wastes space | SLASection.tsx | Left-align on desktop |

### Admin Analytics
| Issue | Location | Fix |
|-------|----------|-----|
| Same chart sizing issues | Multiple sections | Inherit from base components |
| Tabs not styled consistently | AnalyticsNavigation.tsx | APH styling |
| Section headers lack hierarchy | Multiple sections | Typography improvements |

---

## Phase 1: Common Responsive Patterns

### 1.1 Create Responsive Chart Container
**File:** `packages/ui-components/src/components/base/charts/ResponsiveChartContainer.tsx`

```typescript
interface ResponsiveChartContainerProps {
  height?: { xs: number; sm: number; md: number };
  minHeight?: number;
  children: React.ReactNode;
}

// Default heights:
// xs: 240px (mobile)
// sm: 280px (tablet)
// md: 320px (desktop)
```

### 1.2 Update RequestListHeader Responsive Breakpoints
**File:** `packages/ui-components/src/components/features/request-list/components/RequestListHeader.tsx`

```typescript
// Line 68 - Add sm breakpoint
maxWidth: { xs: '100%', sm: 320, md: 480 }

// Add responsive gap
gap: { xs: 1, sm: 2 }
```

### 1.3 Update PageHeader with Responsive Gap
**File:** `packages/ui-components/src/components/base/PageHeader.tsx`

```typescript
// Line 78-85
gap: { xs: theme.spacing(2), sm: theme.spacing(3) }
```

---

## Phase 2: Approvals Dashboard Redesign

### 2.1 Client.tsx Layout Improvements
**File:** `apps/web/src/app/approvals/Client.tsx`

**New Layout:**
```
┌────────────────────────────────────────────────────┐
│ Pending Approvals                    [3 pending] │
│ Review and approve purchase requests              │
├────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────┐ ┌───────────┐ │
│ │ 🔍 Search...                    │ │ Export  📤│ │
│ └─────────────────────────────────┘ └───────────┘ │
│ ┌──────────┐ ┌──────────┐                         │
│ │Status  ▾ │ │ Type   ▾ │                         │
│ └──────────┘ └──────────┘                         │
├────────────────────────────────────────────────────┤
│ [Request List DataGrid]                           │
└────────────────────────────────────────────────────┘
```

Changes:
- Move pending count chip inline with PageHeader title (as badge)
- Ensure search spans appropriate width at all breakpoints
- Better vertical spacing between sections

### 2.2 Pending Count Integration
Move from separate Box to PageHeader badge:

```typescript
<PageHeader
  title="Pending Approvals"
  subtitle="Review and approve purchase requests"
  badge={pendingCount > 0 ? `${pendingCount} pending` : undefined}
/>
```

---

## Phase 3: Admin Dashboard Full Redesign

### 3.1 New Dashboard Layout
**File:** `packages/ui-components/src/components/features/admin/AdminDashboard.tsx`

**Proposed Layout:**
```
┌─────────────────────────────────────────────────────────────┐
│ Admin Dashboard                                              │
│ System overview and analytics                                │
├─────────────────────────────────────────────────────────────┤
│ [ALERTS - Full width, sticky, only when alerts exist]       │
├─────────────────────────────────────────────────────────────┤
│ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐            │
│ │ Total   │ │ Pending │ │ Total   │ │ Avg     │            │
│ │ Requests│ │ Approval│ │ Spend   │ │ Time    │            │
│ │   142   │ │    12   │ │ $1.2M   │ │ 3.2d    │            │
│ └─────────┘ └─────────┘ └─────────┘ └─────────┘            │
├─────────────────────────────────────────────────────────────┤
│ SLA Risk Overview                                            │
│ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐            │
│ │ 🔴 Breached │ │ 🟡 At Risk  │ │ 📊 Total    │            │
│ │     3       │ │     7       │ │     12      │            │
│ └─────────────┘ └─────────────┘ └─────────────┘            │
├─────────────────────────────────────────────────────────────┤
│ Charts                                   [Filter] [Export]  │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ [Spending] [Approvals] [Performance] [Vendors] [Budget] │ │
│ ├─────────────────────────────────────────────────────────┤ │
│ │                                                          │ │
│ │              [Active Chart Content]                      │ │
│ │                                                          │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 SLA Section Redesign
**File:** `packages/ui-components/src/components/features/admin/dashboard/sections/SLASection.tsx`

Changes:
- Left-align cards on desktop (remove center justify)
- Add section header "SLA Risk Overview"
- Responsive card widths: xs=100%, sm=calc(33% - 8px)
- Color-coded icons: 🔴 Red for breached, 🟡 Orange for at-risk

```typescript
<Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, justifyContent: 'flex-start' }}>
  <StatCard
    title="Breached"
    value={breached}
    icon={<WarningIcon sx={{ color: '#F83125' }} />}
    sx={{
      flex: { xs: '1 1 100%', sm: '1 1 calc(33.333% - 16px)' },
      maxWidth: { sm: 300 }
    }}
  />
  // ... similar for other cards
</Box>
```

### 3.3 Chart Section Redesign
**File:** `packages/ui-components/src/components/features/admin/dashboard/sections/ChartSection.tsx`

Changes:
- Add section header with filter/export controls
- Responsive tab styling with APH colors
- Responsive chart heights

```typescript
// Tab styling
<Tabs
  value={activeTab}
  onChange={handleTabChange}
  variant={isMobile ? 'scrollable' : 'standard'}
  scrollButtons="auto"
  sx={{
    borderBottom: 1,
    borderColor: 'divider',
    '& .MuiTab-root': {
      textTransform: 'none',
      fontWeight: 500,
      minWidth: { xs: 80, sm: 120 },
    },
    '& .Mui-selected': {
      color: '#44499C', // APH Logo Blue
    },
    '& .MuiTabs-indicator': {
      backgroundColor: '#44499C',
    },
  }}
>
```

### 3.4 Individual Chart Fixes

#### SpendingChart.tsx
```typescript
// Responsive Y-axis width
<YAxis width={isMobile ? 50 : 70} />

// Responsive height via container
<ResponsiveChartContainer height={{ xs: 240, sm: 280, md: 320 }}>
```

#### BudgetChart.tsx
```typescript
// Responsive label width
<Box sx={{ minWidth: { xs: 100, sm: 140, md: 160 } }}>
  {division}
</Box>
```

#### HeatmapChart.tsx
```typescript
// Update to APH colors
const getOpacityColor = (value: number, max: number) => {
  const opacity = max > 0 ? value / max : 0;
  return `rgba(68, 73, 156, ${opacity})`; // APH Logo Blue
};

// Responsive cell sizing
<Box
  sx={{
    display: 'grid',
    gridTemplateColumns: `repeat(${columns}, 1fr)`,
    gap: { xs: 0.25, sm: 0.5 },
    '& > div': {
      aspectRatio: '1',
      minWidth: { xs: 10, sm: 12, md: 14 },
      minHeight: { xs: 10, sm: 12, md: 14 },
    },
  }}
>
```

---

## Phase 4: Admin Analytics Redesign

### 4.1 AnalyticsPage Layout
**File:** `packages/ui-components/src/components/features/admin/analytics/AnalyticsPage.tsx`

Changes:
- Consistent section spacing
- Better tab styling matching dashboard
- Responsive filter panel

### 4.2 Analytics Navigation Styling
**File:** `packages/ui-components/src/components/features/admin/analytics/components/AnalyticsNavigation.tsx`

```typescript
<Tabs
  sx={{
    '& .MuiTab-root': {
      textTransform: 'none',
      fontWeight: 500,
      fontSize: { xs: '0.8rem', sm: '0.875rem' },
      minWidth: { xs: 70, sm: 100 },
      px: { xs: 1, sm: 2 },
    },
    '& .Mui-selected': {
      color: '#44499C',
    },
    '& .MuiTabs-indicator': {
      backgroundColor: '#44499C',
      height: 3,
    },
  }}
/>
```

### 4.3 Section Header Component
Create consistent section headers:

```typescript
interface SectionHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

<Box sx={{
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  flexWrap: 'wrap',
  gap: 2,
  mb: 2
}}>
  <Box>
    <Typography variant="h6" fontWeight={600}>{title}</Typography>
    {description && (
      <Typography variant="body2" color="text.secondary">{description}</Typography>
    )}
  </Box>
  {actions && <Box>{actions}</Box>}
</Box>
```

---

## Phase 5: Files to Modify

### Priority 1: Common Components
| File | Changes |
|------|---------|
| `base/PageHeader.tsx` | Add badge prop, responsive gap |
| `request-list/components/RequestListHeader.tsx` | Add sm breakpoint to search |

### Priority 2: Approvals Dashboard
| File | Changes |
|------|---------|
| `apps/web/src/app/approvals/Client.tsx` | Integrate badge, clean layout |

### Priority 3: Admin Dashboard
| File | Changes |
|------|---------|
| `admin/dashboard/sections/SLASection.tsx` | Left-align, responsive cards |
| `admin/dashboard/sections/ChartSection.tsx` | Tab styling, section header |
| `admin/dashboard/sections/KPISection.tsx` | Verify responsive grid |
| `admin/dashboard/charts/SpendingChart.tsx` | Responsive axis width |
| `admin/dashboard/charts/BudgetChart.tsx` | Responsive label width |
| `admin/dashboard/charts/HeatmapChart.tsx` | APH colors, responsive cells |

### Priority 4: Admin Analytics
| File | Changes |
|------|---------|
| `admin/analytics/AnalyticsPage.tsx` | Consistent spacing |
| `admin/analytics/components/AnalyticsNavigation.tsx` | APH tab styling |
| `admin/analytics/sections/*.tsx` | Consistent section headers |

---

## Visual Mockups

### Admin Dashboard - Desktop
```
┌──────────────────────────────────────────────────────────────────┐
│ Admin Dashboard                                                   │
│ System overview and analytics                                     │
├──────────────────────────────────────────────────────────────────┤
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐             │
│ │  Total   │ │ Pending  │ │  Total   │ │   Avg    │             │
│ │ Requests │ │ Approvals│ │  Spend   │ │   Time   │             │
│ │   142    │ │    12    │ │  $1.2M   │ │  3.2 d   │             │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘             │
├──────────────────────────────────────────────────────────────────┤
│ SLA Risk Overview                                                 │
│ ┌────────────┐ ┌────────────┐ ┌────────────┐                     │
│ │ 🔴 Breached│ │ 🟡 At Risk │ │ 📊 Pending │                     │
│ │      3     │ │      7     │ │     12     │                     │
│ └────────────┘ └────────────┘ └────────────┘                     │
├──────────────────────────────────────────────────────────────────┤
│ [Spending] [Approvals] [Performance] [Vendors] [Budget] [Heat]   │
│ ━━━━━━━━━━                                                        │
│ ┌──────────────────────────────────────────────────────────────┐ │
│ │                      Monthly Spend Trend                      │ │
│ │  $2M ┤                                    ╭─────╮              │ │
│ │      │                              ╭─────╯     │              │ │
│ │  $1M ┤                        ╭─────╯           ╰─────╮       │ │
│ │      │                  ╭─────╯                       ╰───    │ │
│ │    0 ┼────┬────┬────┬────┬────┬────┬────┬────┬────┬────┬───  │ │
│ │      Jan  Feb  Mar  Apr  May  Jun  Jul  Aug  Sep  Oct  Nov    │ │
│ └──────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### Admin Dashboard - Mobile
```
┌────────────────────────┐
│ Admin Dashboard        │
│ System overview        │
├────────────────────────┤
│ ┌────────────────────┐ │
│ │ Total Requests     │ │
│ │       142          │ │
│ └────────────────────┘ │
│ ┌────────────────────┐ │
│ │ Pending Approvals  │ │
│ │        12          │ │
│ └────────────────────┘ │
│ ┌────────────────────┐ │
│ │ Total Spend        │ │
│ │      $1.2M         │ │
│ └────────────────────┘ │
├────────────────────────┤
│ SLA Risk Overview      │
│ ┌────────────────────┐ │
│ │ 🔴 Breached: 3     │ │
│ └────────────────────┘ │
│ ┌────────────────────┐ │
│ │ 🟡 At Risk: 7      │ │
│ └────────────────────┘ │
├────────────────────────┤
│ ◀ [Spending] [App...] ▶│
│ ━━━━━━━━                │
│ [Compact Line Chart]   │
│                        │
└────────────────────────┘
```

---

## Execution Order

1. **PageHeader badge prop** - Enable inline badges
2. **RequestListHeader sm breakpoint** - Fix search width
3. **Approvals Client.tsx** - Apply layout fixes
4. **SLASection** - Responsive left-align
5. **ChartSection** - Tab styling + section header
6. **Individual charts** - Responsive sizing, APH colors
7. **AnalyticsNavigation** - Consistent tab styling
8. **Analytics sections** - Consistent headers

---

## Success Criteria

1. ✅ Search field properly sized at all breakpoints (xs, sm, md)
2. ✅ No UI elements disappearing unexpectedly at breakpoints
3. ✅ Admin dashboard charts use APH color palette
4. ✅ Heatmap uses responsive cell sizing
5. ✅ SLA cards left-aligned on desktop, stacked on mobile
6. ✅ Tab styling consistent across dashboard and analytics
7. ✅ Chart heights responsive (240px mobile, 320px desktop)
8. ✅ Professional, clean appearance matching APH brand
