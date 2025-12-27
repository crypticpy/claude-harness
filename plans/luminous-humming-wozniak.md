# Plan: Roadmap Phase Progress & Smart Sync

## Status: Phase 1 Complete, Phase 2 In Progress

### Phase 1: Basic Task→Feature Sync ✅ COMPLETE
- Created `roadmap-sync.ts` with status mapping
- Hooked into task-store.ts for status changes
- Added initial load sync in useRoadmapData hook

### Phase 2: Smart Progress & Backlog Support (Current)

## New Requirements

### 1. Add "Sync Now" Button
- Manual force re-sync for when things get out of sync
- Useful after bulk operations or system issues

### 2. Add "Backlog" Status for Features
- New feature status: `backlog` (user chose not to implement now)
- Backlogged features are EXCLUDED from progress calculations
- Progress formula: `done / (total - backlogged)` not `done / total`

### 3. Phase Status Auto-Update
Based on feature completion rates:
- **planned**: No features started
- **in_progress**: Any feature is `in_progress` OR some features `done` but not all
- **completed**: All non-backlogged features are `done`

Also allow manual override (user can force "mark complete")

### 4. Milestone Auto-Complete
- Milestones link to feature IDs via `milestone.features[]`
- When ALL linked features are `done` (excluding backlogged) → milestone becomes `achieved`

## Implementation Plan

### Files to Modify

| File | Change |
|------|--------|
| `src/shared/types/roadmap.ts` | Add `'backlog'` to RoadmapFeatureStatus |
| `src/shared/constants/roadmap.ts` | Add backlog to KANBAN_STATUSES |
| `src/renderer/lib/roadmap-sync.ts` | Add phase/milestone auto-update logic |
| `src/renderer/components/roadmap/PhaseCard.tsx` | Update progress calc to exclude backlog |
| `src/renderer/components/roadmap/RoadmapHeader.tsx` | Add "Sync Now" button |
| `src/renderer/stores/roadmap-store.ts` | Add actions for phase status & milestone updates |

### Progress Calculation Change

**Current (PhaseCard.tsx:17-18):**
```typescript
const completedCount = features.filter((f) => f.status === 'done').length;
const progress = features.length > 0 ? (completedCount / features.length) * 100 : 0;
```

**New:**
```typescript
const activeFeatures = features.filter((f) => f.status !== 'backlog');
const completedCount = activeFeatures.filter((f) => f.status === 'done').length;
const progress = activeFeatures.length > 0 ? (completedCount / activeFeatures.length) * 100 : 0;
// Display: "{completedCount}/{activeFeatures.length} features"
```

### Phase Status Auto-Update Logic

```typescript
function calculatePhaseStatus(features: RoadmapFeature[]): RoadmapPhaseStatus {
  const activeFeatures = features.filter(f => f.status !== 'backlog');

  if (activeFeatures.length === 0) return 'planned';

  const allDone = activeFeatures.every(f => f.status === 'done');
  if (allDone) return 'completed';

  const anyStarted = activeFeatures.some(f =>
    f.status === 'in_progress' || f.status === 'done'
  );
  if (anyStarted) return 'in_progress';

  return 'planned';
}
```

### Milestone Auto-Complete Logic

```typescript
function checkMilestoneCompletion(milestone: RoadmapMilestone, features: RoadmapFeature[]): boolean {
  const linkedFeatures = features.filter(f => milestone.features.includes(f.id));
  const activeLinked = linkedFeatures.filter(f => f.status !== 'backlog');

  if (activeLinked.length === 0) return false;
  return activeLinked.every(f => f.status === 'done');
}
```

### UI Changes

1. **Sync Now Button** - In RoadmapHeader, add refresh icon button that calls `syncAllFeaturesFromTasks`

2. **Backlog Column** - Add to Kanban view (or allow dragging to "backlog" status)

3. **Manual Phase Complete** - Add dropdown/button on PhaseCard to manually override status

## Testing Checklist

- [ ] Backlog a feature → progress denominator decreases
- [ ] Complete all active features → phase auto-completes
- [ ] Complete features linked to milestone → milestone auto-achieves
- [ ] Click "Sync Now" → all features re-sync from tasks
- [ ] Manual "mark complete" on phase → overrides auto-calculation
