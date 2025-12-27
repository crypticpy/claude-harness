# CreateDelegationModal Styling Refinements

## Overview

Tighten up the modal styling for the delegation creation form to match the more compact styling patterns used elsewhere (e.g., CreateUserModal).

## Current Issues

Comparing CreateDelegationModal with CreateUserModal:

| Aspect | CreateDelegationModal | CreateUserModal | Fix |
|--------|----------------------|-----------------|-----|
| Form gap | `gap: 2.5` | `gap: 2` | Reduce to `gap: 2` |
| Date row gap | `gap: 2` | - | Reduce to `gap: 1.5` |
| Actions margin | `mt: 3, pt: 2` | `mt: 2` | Reduce to `mt: 2` |
| Actions border | Has `borderTop` | No border | Remove border |
| Helper text | Verbose on every field | Minimal | Simplify/remove |
| Top padding | `pt: 1` | None | Remove |

## Changes to Make

### File: `/apps/web/src/app/approvals/delegations/CreateDelegationModal.tsx`

**1. Tighten form container (line ~181):**
```tsx
// Before
<Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: 1 }}>

// After
<Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
```

**2. Tighten date picker row (line ~238):**
```tsx
// Before
<Box sx={{ display: 'flex', gap: 2 }}>

// After
<Box sx={{ display: 'flex', gap: 1.5 }}>
```

**3. Simplify delegate field helper text (line ~205):**
```tsx
// Before
helperText={errors.user || 'Select the person who will approve on your behalf'}

// After
helperText={errors.user}
```

**4. Simplify scope field helper text (line ~284):**
```tsx
// Before
helperText="What types of approvals can this delegate handle?"

// After
(remove helperText prop entirely)
```

**5. Tighten actions section (lines ~312-322):**
```tsx
// Before
<Box
  sx={{
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 1.5,
    mt: 3,
    pt: 2,
    borderTop: 1,
    borderColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'divider',
  }}
>

// After
<Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1.5, mt: 2 }}>
```

**6. (Optional) Make reason field single line:**
```tsx
// Before
multiline
rows={2}

// After
(remove multiline and rows props for single-line input)
```

## Summary

These changes will make the modal more compact and consistent with other modals in the codebase, removing unnecessary whitespace and verbose helper text while maintaining all functionality.
