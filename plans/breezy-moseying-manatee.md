# Fix: TypeError in analysis-exporter.ts estimatePageCount

## Problem

Console error when opening the export options modal:
```
TypeError: Cannot read properties of undefined (reading 'length')
lib/export/analysis-exporter.ts (251:42) @ estimatePageCount
```

The code at line 251 tries to access `evidence.text.length` but `evidence.text` is undefined:
```typescript
contentLength += evidence.text.length + 50; // timestamp overhead
```

## Root Cause

The `estimatePageCount` function iterates over `section.evidence` arrays but doesn't validate that each evidence item has a valid `text` property before accessing `.length`.

While the `Evidence` interface requires `text: string`, runtime data may have malformed evidence objects (e.g., from corrupted IndexedDB data, API responses with missing fields, or incomplete parsing).

Other parts of the codebase already handle this defensively - see `evidence-card.tsx:75-83` which validates all required fields before rendering.

## Fix

Add null-safe checks when accessing `evidence.text` in `lib/export/analysis-exporter.ts:251`:

**Current code:**
```typescript
for (const evidence of section.evidence) {
  contentLength += evidence.text.length + 50; // timestamp overhead
}
```

**Fixed code:**
```typescript
for (const evidence of section.evidence) {
  contentLength += (evidence.text?.length || 0) + 50; // timestamp overhead
}
```

This uses optional chaining (`?.`) and nullish coalescing (`|| 0`) to safely handle missing or undefined `text` properties.

## Files to Modify

1. `lib/export/analysis-exporter.ts` - Line 251

## Testing

1. Open the export options modal for an analysis
2. Verify no TypeError in console
3. Verify estimated size displays correctly
