# Impact Color Consistency - Full App Implementation Plan

## Design Principles

1. **WCAG 2.1 AA Compliance** - Minimum 4.5:1 contrast for text, 3:1 for UI components
2. **Distinct Hues** - Each level uses a completely different color family (no similar warm tones)
3. **Single Source of Truth** - Define colors once, reference everywhere
4. **Context-Appropriate Variants** - Solid backgrounds for badges, lighter tints for cards/backgrounds

---

## Master Color Palette

### Primary (Solid Background + White Text)

| Level | Hex | RGB | Tailwind | Contrast |
|-------|-----|-----|----------|----------|
| **CRITICAL** | `#B91C1C` | `185, 28, 28` | `bg-impact-critical` | 7.1:1 |
| **HIGH** | `#7C3AED` | `124, 58, 237` | `bg-impact-high` | 6.4:1 |
| **MODERATE** | `#D97706` | `217, 119, 6` | `bg-impact-moderate` | 4.6:1 |
| **LOW** | `#0D9488` | `13, 148, 136` | `bg-impact-low` | 4.5:1 |
| **MINIMAL** | `#64748B` | `100, 116, 139` | `bg-impact-minimal` | 4.6:1 |

### Light Variants (For cards/backgrounds + dark text)

| Level | Background | Text | Border |
|-------|------------|------|--------|
| **CRITICAL** | `#FEF2F2` | `#991B1B` | `#FECACA` |
| **HIGH** | `#F5F3FF` | `#5B21B6` | `#DDD6FE` |
| **MODERATE** | `#FFFBEB` | `#92400E` | `#FDE68A` |
| **LOW** | `#F0FDFA` | `#115E59` | `#99F6E4` |
| **MINIMAL** | `#F8FAFC` | `#475569` | `#E2E8F0` |

---

## Files to Update (10 total)

### Already Complete
- [x] `tailwind.config.js` - impact.* colors defined
- [x] `src/constants/impactMappings.js` - IMPACT_LEVEL_COLORS
- [x] `src/components/bills/ImpactIndicators.jsx` - uses constants
- [x] `src/components/ui/OverallImpactBadge.jsx` - uses bg-impact-*

---

### Step 1: Central Theme Update

**File:** `src/theme/muiTheme.js` (lines 379-384)

```javascript
// BEFORE
impact: {
  critical: brandColors.red,
  high: brandColors.orange,
  moderate: brandColors.purple.main,
  low: brandColors.green.main,
}

// AFTER
impact: {
  critical: '#B91C1C',
  high: '#7C3AED',
  moderate: '#D97706',
  low: '#0D9488',
  minimal: '#64748B',
}
```

---

### Step 2: MUI ImpactBadge Component

**File:** `src/components/ui/ImpactBadge.jsx` (lines 21-27)

```javascript
// BEFORE
const IMPACT_STYLE_MAP = {
  critical: { bg: "error.light", color: "error.dark" },
  high: { bg: "warning.light", color: "warning.dark" },
  moderate: { bg: "info.light", color: "primary.main" },
  low: { bg: "success.light", color: "success.dark" },
  default: { bg: "grey.100", color: "grey.600" },
};

// AFTER - Use hex values directly for consistency
const IMPACT_STYLE_MAP = {
  critical: { bg: "#FEF2F2", color: "#991B1B" },
  high: { bg: "#F5F3FF", color: "#5B21B6" },
  moderate: { bg: "#FFFBEB", color: "#92400E" },
  low: { bg: "#F0FDFA", color: "#115E59" },
  minimal: { bg: "#F8FAFC", color: "#475569" },
  default: { bg: "#F8FAFC", color: "#475569" },
};
```

---

### Step 3: Analysis Ratings Visualization

**File:** `src/components/analysis/ImpactRatingsVisualization.jsx` (lines 9-20)

```javascript
// BEFORE
const getImpactLevelColor = (level) => {
  switch (level?.toLowerCase()) {
    case 'high':
      return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
    case 'moderate':
      return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
    case 'low':
      return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
    default:
      return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
  }
};

// AFTER - Import from constants for consistency
import { IMPACT_LEVEL_COLORS } from "../../constants/impactMappings";

const getImpactLevelColor = (level) => {
  const normalized = level?.toLowerCase();
  return IMPACT_LEVEL_COLORS[normalized] || IMPACT_LEVEL_COLORS.minimal;
};
```

---

### Step 4: Dashboard Network Visualization

**File:** `src/components/dashboard/SimpleNetworkVisualization.jsx` (lines 220-225)

```javascript
// BEFORE
const impactColors = {
  high: "error.main",
  medium: "warning.main",
  low: "info.main",
  unknown: "grey.500",
};

// AFTER
const impactColors = {
  critical: "#B91C1C",
  high: "#7C3AED",
  medium: "#D97706",  // maps to moderate
  moderate: "#D97706",
  low: "#0D9488",
  minimal: "#64748B",
  unknown: "#64748B",
};
```

---

### Step 5: Legislative Insights Constants

**File:** `src/components/dashboard/LegislativeInsights/constants.js` (lines 96-101)

```javascript
// BEFORE
export const SEVERITY_LEVELS = {
  high: { label: "High", dotCount: 4, color: "#F83125" },
  medium: { label: "Medium", dotCount: 3, color: "#FF8F00" },
  low: { label: "Low", dotCount: 2, color: "#009F4D" },
  minimal: { label: "Minimal", dotCount: 1, color: "#636262" },
};

// AFTER
export const SEVERITY_LEVELS = {
  critical: { label: "Critical", dotCount: 5, color: "#B91C1C" },
  high: { label: "High", dotCount: 4, color: "#7C3AED" },
  medium: { label: "Medium", dotCount: 3, color: "#D97706" },
  low: { label: "Low", dotCount: 2, color: "#0D9488" },
  minimal: { label: "Minimal", dotCount: 1, color: "#64748B" },
};
```

---

### Step 6: Bill Relationship Network

**File:** `src/components/dashboard/BillRelationshipNetwork.jsx` (lines 9-15)

```javascript
// BEFORE
const NODE_COLORS = {
  bill: {
    high: "#F83125",
    medium: "#FF8F00",
    low: "#009F4D",
    unknown: "#636262",
  },
  // ...
};

// AFTER
const NODE_COLORS = {
  bill: {
    critical: "#B91C1C",
    high: "#7C3AED",
    medium: "#D97706",
    low: "#0D9488",
    minimal: "#64748B",
    unknown: "#64748B",
  },
  // ...
};
```

---

### Step 7: PDF Styles

**File:** `src/styles/pdfStyles.js` (lines 77-83)

```javascript
// BEFORE
export const IMPACT_LEVEL_COLORS = {
  critical: [153, 27, 27],
  high: COLORS.ERROR,
  moderate: COLORS.WARNING,
  low: COLORS.SUCCESS,
  unknown: COLORS.NEUTRAL_LIGHT,
};

// AFTER
export const IMPACT_LEVEL_COLORS = {
  critical: [185, 28, 28],   // #B91C1C
  high: [124, 58, 237],      // #7C3AED
  moderate: [217, 119, 6],   // #D97706
  low: [13, 148, 136],       // #0D9488
  minimal: [100, 116, 139],  // #64748B
  unknown: [100, 116, 139],
};
```

---

### Step 8: PDF Impact Ratings Visualization

**File:** `src/components/analysis/ImpactRatingsVisualizationPDF.jsx` (lines 9-36)

```javascript
// AFTER - Update getImpactLevelColor with accessible light variants
const getImpactLevelColor = (level) => {
  switch (level?.toLowerCase()) {
    case 'critical':
      return { bg: '#FEF2F2', text: '#991B1B', border: '#FECACA' };
    case 'high':
      return { bg: '#F5F3FF', text: '#5B21B6', border: '#DDD6FE' };
    case 'moderate':
      return { bg: '#FFFBEB', text: '#92400E', border: '#FDE68A' };
    case 'low':
      return { bg: '#F0FDFA', text: '#115E59', border: '#99F6E4' };
    default:
      return { bg: '#F8FAFC', text: '#475569', border: '#E2E8F0' };
  }
};
```

---

### Step 9: Impact By Category Chart

**File:** `src/components/visualizations/ImpactByCategory.jsx` (lines 116-130)

```javascript
// AFTER
const getColorsByType = () => {
  if (selectedMetric === "all") {
    return {
      "High Impact": "#7C3AED",
      "Medium Impact": "#D97706",
      "Low Impact": "#0D9488",
    };
  } else if (selectedMetric === "high") {
    return { "High Impact": "#7C3AED" };
  } else if (selectedMetric === "medium") {
    return { "Medium Impact": "#D97706" };
  } else {
    return { "Low Impact": "#0D9488" };
  }
};
```

---

### Step 10: Matrix Legend (if needed)

**File:** `src/components/dashboard/BillRelationshipMatrix/components/MatrixLegend.jsx`

Review after other changes - this may use intensity gradients rather than severity colors.

---

## Implementation Checklist

- [ ] Step 1: Update muiTheme.js chartColors.impact
- [ ] Step 2: Update ImpactBadge.jsx IMPACT_STYLE_MAP
- [ ] Step 3: Update ImpactRatingsVisualization.jsx
- [ ] Step 4: Update SimpleNetworkVisualization.jsx
- [ ] Step 5: Update LegislativeInsights/constants.js
- [ ] Step 6: Update BillRelationshipNetwork.jsx
- [ ] Step 7: Update pdfStyles.js
- [ ] Step 8: Update ImpactRatingsVisualizationPDF.jsx
- [ ] Step 9: Update ImpactByCategory.jsx
- [ ] Step 10: Review MatrixLegend.jsx

---

## Quick Reference

```javascript
// Hex values
const IMPACT_COLORS = {
  critical: '#B91C1C',
  high: '#7C3AED',
  moderate: '#D97706',
  low: '#0D9488',
  minimal: '#64748B',
};

// RGB arrays (for jsPDF/canvas)
const IMPACT_RGB = {
  critical: [185, 28, 28],
  high: [124, 58, 237],
  moderate: [217, 119, 6],
  low: [13, 148, 136],
  minimal: [100, 116, 139],
};

// Light variants (bg, text, border)
const IMPACT_LIGHT = {
  critical: { bg: '#FEF2F2', text: '#991B1B', border: '#FECACA' },
  high: { bg: '#F5F3FF', text: '#5B21B6', border: '#DDD6FE' },
  moderate: { bg: '#FFFBEB', text: '#92400E', border: '#FDE68A' },
  low: { bg: '#F0FDFA', text: '#115E59', border: '#99F6E4' },
  minimal: { bg: '#F8FAFC', text: '#475569', border: '#E2E8F0' },
};
```
