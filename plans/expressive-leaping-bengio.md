# Plan: Add Version Number and Footer Across All Tabs

## Summary
Add a version number (v0.09) to the application with a footer that displays consistently across all pages/tabs.

## Current State
- **Footer component exists** at `components/layout/footer.tsx` but is NOT rendered anywhere
- **Version in package.json**: `0.1.0`
- **Hardcoded version in footer.tsx**: `1.0.0` (inconsistent)
- **Root layout** at `app/layout.tsx` has Header but no Footer

## Changes Required

### 1. Update `package.json` version
- Change `"version": "0.1.0"` to `"version": "0.09.0"` (semantic versioning format)

### 2. Update `components/layout/footer.tsx`
- Change hardcoded `appVersion = "1.0.0"` to `"0.09"`
- Keep the existing footer design (it's already well-structured with Mantine)

### 3. Update `app/layout.tsx`
- Import the Footer component
- Add Footer below the `<main>` element
- Adjust the `minHeight` calculation to account for footer height (approx 48-56px)

## Files to Modify
1. [package.json](package.json) - Update version field
2. [components/layout/footer.tsx](components/layout/footer.tsx) - Update appVersion constant
3. [app/layout.tsx](app/layout.tsx) - Import and render Footer component

## Implementation Notes
- Footer will automatically appear on all pages since it's in the root layout
- No changes needed to individual page components
- Existing footer styling (responsive, centered text, links) is already appropriate
