# Plan: Improve Focus Management in ResponsiveDialog

## Summary
Improve the focus management logic in `ResponsiveDialog.tsx` to skip disabled and hidden elements when finding the first focusable element on dialog open.

## Problem
The current focus selector:
```typescript
'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
```
Matches **all** focusable elements including disabled ones. This can cause:
1. Focus moving to a disabled button when dialog opens
2. Poor UX when forms have conditionally disabled elements
3. Accessibility issues per WCAG guidelines

This is a real issue in the codebase - dialogs like `EditUserModal` and `CreateDelegationModal` have multiple disabled buttons based on loading/validation states.

## Solution

### File to Modify
- `frontend/packages/ui-components/src/components/base/ResponsiveDialog.tsx`

### Changes

1. **Update the focusable element selector** to exclude disabled elements:
```typescript
const focusable = node.querySelector<HTMLElement>(
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
);
```

2. **Add visibility check** before focusing to ensure the element is actually visible:
```typescript
if (focusable && focusable.offsetParent !== null) {
  focusable.focus();
} else {
  node.focus();
}
```

### Final Implementation
```typescript
const handleEntered = useCallback(
  (node: HTMLElement, isAppearing: boolean) => {
    // Move focus into dialog to prevent aria-hidden on focused element warning
    // Find first focusable element that is not disabled
    const focusable = node.querySelector<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    // Check element is visible (offsetParent is null for hidden elements)
    if (focusable && focusable.offsetParent !== null) {
      focusable.focus();
    } else {
      // Fallback to dialog paper itself
      node.focus();
    }
    // Call user's onEntered if provided
    TransitionProps?.onEntered?.(node, isAppearing);
  },
  [TransitionProps]
);
```

## Testing
- Verify existing Storybook stories still work correctly
- Test dialogs with disabled buttons (CreateUserModal, EditUserModal)
- Confirm focus moves to first enabled, visible element
