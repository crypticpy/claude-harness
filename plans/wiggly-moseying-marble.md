# Fix: MUI DataGrid Row ID Crash in Analytics Tables View

## Problem
When switching to the tables view on the admin analytics page, the app crashes with:
```
MUI X: The Data Grid component requires all rows to have a unique `id` property.
A row was provided without id in the rows prop:
{"key":"2025-11","value":90500}
```

## Root Cause
`PivotTableInterface.tsx` transforms data into `{ key: string, value: number }` objects without an `id` field. MUI DataGrid requires either:
- An `id` property on each row, OR
- A custom `getRowId` prop function

## Recommended Fix

**Add `id` field to the pivot data transformation** in `PivotTableInterface.tsx`.

### File to Modify
- `frontend/packages/ui-components/src/components/base/PivotTableInterface.tsx`

### Change
In the `pivoted` useMemo hook (around line 47), modify the object creation to include `id`:

```typescript
// Before:
map.set(k, { key: k, value: 0 });

// After:
map.set(k, { id: k, key: k, value: 0 });
```

This uses the `key` value as the `id`, which is already unique (it's the aggregation key from a Map).

## Rationale
- Fixes at the source where data is created
- Consistent with other analytics tables (AnomalyTable, TrendComparisonTable) which include `id` in their data
- Minimal change with no risk of side effects
- More explicit than relying on `getRowId` prop downstream
