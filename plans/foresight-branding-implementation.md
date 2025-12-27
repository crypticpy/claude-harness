# Implementation Plan: Austin Foresight Branding Overhaul

Created: 2025-12-22
Status: PENDING APPROVAL

## Summary

Apply the official City of Austin brand identity to the Foresight application, matching the established style from the meeting-transcriber project. This involves implementing brand colors where they make sense (primary actions, navigation, chrome), keeping semantic pillar colors, adding Geist typography, subtle hover effects (translateY, shadows), and glass-morphism header styling. Keep dark mode with dark-blue (#22254E) base.

## Reference Style (meeting-transcriber)
- Glass-morphism header with backdrop-blur
- Card hover: translateY(-4px) + elevated shadow + left border accent
- Brand blue (#44499C) for active nav, primary buttons, focus states
- Brand green (#009F4D) for success states
- Geist font (semibold for headings)
- Subtle 0.15-0.2s transitions
- Dark mode: #22254E background

## Scope

### In Scope
- Brand color tokens (blue #44499C, green #009F4D, supporting colors)
- Geist font family via Google Fonts
- Logo integration (header + favicon)
- Chrome styling (header, navigation, buttons, focus states)
- Card hover effects matching meeting-transcriber style
- Dark mode with brand dark-blue
- WCAG AA accessibility compliance

### Out of Scope
- Backend changes
- Database schema modifications
- New feature development
- Changing semantic pillar colors (keep CH=green, MC=amber, etc.)

## Prerequisites
- Geist font loaded from Google Fonts
- Logo files copied to `/public/` directory
- Brand color tokens defined in design system

---

## Implementation Phases

### Phase 1: Design Foundation & Asset Setup
**Objective**: Establish the design token system and load brand assets

**Files to Modify**:
- `tailwind.config.js` - Add brand color palette
- `src/index.css` - Add CSS custom properties and Geist font import

**New Files to Create**:
- `public/logo-horizontal.png` - Copy from branding folder
- `public/logo-icon.png` - Copy from branding folder
- `public/favicon.ico` - Create from icon (or use PNG)
- `src/styles/brand-tokens.ts` - TypeScript constants for brand values

**Steps**:
1. Copy logo assets from `/branding/` to `/public/`:
   - `COA-Logo-Horizontal-Official-RGB.png` → `public/logo-horizontal.png`
   - `COA-Icon-Official-RGB.png` → `public/logo-icon.png`
2. Update `tailwind.config.js` with brand color palette:
   ```js
   colors: {
     brand: {
       blue: '#44499C',        // Logo Blue (primary)
       green: '#009F4D',       // Logo Green (accent)
       'faded-white': '#f7f6f5', // Background
       'dark-blue': '#22254E',   // Supporting
       'dark-green': '#005027',  // Supporting
       'light-blue': '#dcf2fd',  // Supporting
       'light-green': '#dff0e3', // Supporting
       'complaint-green': '#008743', // Supporting
     },
     // Extended palette for data viz
     extended: {
       red: '#F83125',
       orange: '#FF8F00',
       yellow: '#FFC600',
       cyan: '#009CDE',
       purple: '#9F3CC9',
       brown: '#8F5201',
     }
   }
   ```
3. Add Geist font import to `index.css`:
   ```css
   @import url('https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap');
   ```
4. Update CSS custom properties for HSL-based theming
5. Create `brand-tokens.ts` with TypeScript constants

**Verification**:
- [ ] Fonts load correctly (check Network tab)
- [ ] Logo images display properly
- [ ] Tailwind classes `bg-brand-blue`, `text-brand-green` work

---

### Phase 2: Global Layout & Header Rebrand
**Objective**: Update header with official logo, glass-morphism effect, brand styling

**Files to Modify**:
- `src/components/Header.tsx` - Logo, glass-morphism, navigation colors
- `src/App.tsx` - Background color (faded-white)
- `src/pages/Login.tsx` - Login page rebrand
- `index.html` - Title and favicon

**Steps**:
1. Replace emoji logo with official horizontal logo image
2. Add glass-morphism header (matching meeting-transcriber):
   - `bg-white/80 dark:bg-dark-blue/95`
   - `backdrop-blur-md` (or `backdrop-blur-[12px]`)
   - `border-b border-gray-200/50`
3. Change navigation active states:
   - Active: `text-brand-blue` with subtle `bg-brand-blue/10`
   - Hover: `bg-gray-100 dark:bg-white/10`
4. Update mobile menu focus ring to brand-blue
5. Update Login page:
   - Replace emoji with official icon image
   - Button: `bg-brand-blue hover:bg-dark-blue`
   - Focus rings: brand-blue
   - Title: "Austin Foresight" / subtitle: "Strategic Research"
6. Update `<title>` in index.html to "Austin Foresight"
7. Copy logo-icon.png as favicon

**Verification**:
- [ ] Header has subtle glass blur effect
- [ ] Logo displays correctly at all breakpoints
- [ ] Navigation states use brand colors
- [ ] Login page matches brand identity

---

### Phase 3: Card & Badge Component Styling
**Objective**: Add meeting-transcriber style hover effects to cards, keep semantic badge colors

**Files to Modify**:
- `src/pages/Dashboard.tsx` - Card hover effects
- `src/pages/Discover.tsx` - Card grid hover effects
- `src/pages/Workstreams.tsx` - Card hover effects
- Badge components - Minor refinements only (keep existing colors)

**Steps**:
1. **Keep existing pillar/horizon/stage badge colors** - they serve semantic purpose
2. Add card hover effects matching meeting-transcriber:
   - `hover:translate-y-[-4px]` or `hover:-translate-y-1`
   - `hover:shadow-lg` (elevated shadow)
   - Left border accent: `border-l-4 border-transparent hover:border-brand-blue`
   - `transition-all duration-200`
3. Ensure all badge text passes WCAG AA contrast (4.5:1 minimum)
4. Add focus-visible states for keyboard users

**Verification**:
- [ ] Cards have smooth hover lift effect
- [ ] Left border accent appears on hover
- [ ] Semantic colors still meaningful and distinct

---

### Phase 4: Page-Level Styling Updates
**Objective**: Apply brand styling to all pages

**Files to Modify**:
- `src/pages/Dashboard.tsx` - Stat cards, greeting, activity feed
- `src/pages/Discover.tsx` - Filter panel, card grid
- `src/pages/CardDetail.tsx` - Tab styling, score displays
- `src/pages/Workstreams.tsx` - List styling, modals
- `src/pages/WorkstreamFeed.tsx` - Feed styling
- `src/pages/Settings.tsx` - Form styling

**Steps**:
1. Dashboard:
   - Update stat card icons to use brand-blue/brand-green
   - Refine greeting typography (Geist semibold)
   - Update section headers styling
2. Discover:
   - Filter panel background: faded-white (#f7f6f5)
   - Update filter toggle states to brand-blue
   - Sort dropdown styling
3. CardDetail:
   - Tab active indicator: brand-blue
   - Score color coding: green (good), brand-blue (medium), extended-red (poor)
   - Refine metric displays
4. Workstreams:
   - Modal styling with brand colors
   - Form focus states to brand-blue
   - Delete button: extended-red
5. Settings:
   - Section card styling
   - Button colors to brand palette

**Verification**:
- [ ] All pages visually consistent
- [ ] Interactive elements clearly identifiable
- [ ] Typography hierarchy clear (Geist weights)

---

### Phase 5: Form & Interactive Element Polish
**Objective**: Ensure all forms and interactive elements are polished and accessible

**Files to Modify**:
- `src/components/WorkstreamForm.tsx` - Form styling
- `src/components/ui/Tooltip.tsx` - Tooltip styling
- Various form inputs across pages

**Steps**:
1. Update focus ring colors to brand-blue across all inputs
2. Update button variants:
   - Primary: bg-brand-blue, hover:bg-dark-blue
   - Secondary: bg-light-blue, text-brand-blue
   - Destructive: bg-extended-red
   - Ghost: transparent with brand-blue text
3. Update tooltip styling:
   - Background: dark-blue (#22254E)
   - Text: white
   - Subtle shadow, no heavy animations
4. Form validation states:
   - Error: extended-red border and text
   - Success: brand-green border
5. Add transition-colors duration-150 for smooth state changes (GPU-light)

**Verification**:
- [ ] All focus states visible (keyboard navigation)
- [ ] Form errors clearly indicated
- [ ] Buttons have appropriate hover/active states

---

### Phase 6: Accessibility Audit & Fixes
**Objective**: Ensure WCAG AA compliance throughout

**Files to Modify**:
- Multiple component files as needed
- `src/index.css` - Global accessibility styles

**Steps**:
1. Run Lighthouse accessibility audit
2. Check all color contrast ratios (minimum 4.5:1 for text, 3:1 for UI)
3. Verify focus indicators are visible on all interactive elements
4. Add skip-to-main-content link
5. Ensure all images have appropriate alt text
6. Add aria-labels where needed for icon-only buttons
7. Verify form labels are properly associated
8. Check heading hierarchy (h1 → h2 → h3)
9. Add aria-current="page" to active navigation items
10. Test with keyboard navigation

**Verification**:
- [ ] Lighthouse accessibility score ≥ 90
- [ ] All interactive elements keyboard accessible
- [ ] Screen reader can navigate all content
- [ ] Color is not sole indicator of state

---

### Phase 7: Dark Mode Refinement
**Objective**: Update dark mode with brand dark-blue background

**Files to Modify**:
- `src/index.css` - Dark mode CSS variables
- `tailwind.config.js` - Dark mode color mappings
- Components with `dark:` classes

**Steps**:
1. Define dark mode colors in CSS/Tailwind:
   - Background: dark-blue (#22254E)
   - Surface (cards): slightly lighter (#2d3166 or similar)
   - Text: faded-white (#f7f6f5)
   - Accent: brand-green for success, brand-blue for primary
2. Update header dark mode: `dark:bg-dark-blue/95`
3. Update card backgrounds: `dark:bg-[#2d3166]`
4. Ensure form inputs have proper dark styling
5. Test all pages in dark mode for contrast

**Verification**:
- [ ] Dark mode uses brand dark-blue background
- [ ] Cards/surfaces have proper contrast
- [ ] All text readable (4.5:1+ contrast)

---

## Testing Strategy

- **Visual Testing**: Manual review of all pages at desktop (1280px) and mobile (375px) breakpoints
- **Accessibility Testing**:
  - Lighthouse audit (target ≥90)
  - axe DevTools browser extension
  - Manual keyboard navigation test
- **Cross-Browser**: Chrome, Firefox, Safari
- **Performance**: Ensure no performance regression from font loading or new styles

## Rollback Plan

- Git branch for all changes (`feature/branding-update`)
- Can revert to previous commit if issues arise
- CSS custom properties allow quick color adjustments

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Font loading delay causes FOUT | Medium | Low | Use `font-display: swap`, preload font |
| Color contrast failures | Medium | High | Test all combinations with contrast checker |
| Pillar badge colors conflict with brand | Low | Medium | Keep semantic colors for pillars, use brand for chrome |
| Dark mode inconsistencies | Medium | Medium | Comprehensive dark mode testing |

## Decisions Made

1. **Dark Mode**: ✅ Keep dark mode with dark-blue (#22254E) background
2. **Pillar Colors**: ✅ Keep semantic colors (CH=green, MC=amber, etc.) - only update chrome/UI elements
3. **Patterns**: ✅ Keep UI flat/minimal - no patterns
4. **Reference**: Match meeting-transcriber project style

---

**USER: Please review this plan. Edit any section directly in this file, then confirm to proceed.**
