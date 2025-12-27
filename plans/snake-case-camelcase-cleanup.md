# Implementation Plan: Snake_case/CamelCase Cleanup

Created: 2025-12-21
Status: PENDING APPROVAL

## Summary

Audit and fix all snake_case vs camelCase naming mismatches between the Rust backend and TypeScript frontend. The Rust backend uses `#[serde(rename_all = "camelCase")]` to serialize to camelCase, but the frontend IPC calls inconsistently send snake_case keys in many places.

## Scope

### In Scope
- Fix all `invoke()` calls in `tauri-api.ts` to use camelCase parameter keys
- Fix TypeScript type definitions that incorrectly declare snake_case properties
- Verify Rust structs have proper `#[serde(rename_all = "camelCase")]` attributes
- Add missing camelCase attributes to Rust structs that need them

### Out of Scope
- Changing Rust internal field names (they stay snake_case)
- Changing TypeScript enum string literal values (they can stay snake_case for backwards compatibility with status values like `in_progress`)
- Refactoring unrelated code

## Prerequisites
- Current branch is clean or changes are committed
- Application compiles successfully before starting

## Implementation Phases

### Phase 1: Fix Frontend IPC Invoke Calls

**Objective**: Update all `invoke()` calls in tauri-api.ts to use camelCase parameter keys

**Files to Modify**:
- `ui/src/lib/tauri-api.ts` - Convert all snake_case parameter keys to camelCase

**Key Changes** (examples from the 50+ invoke calls that need fixing):

| Current (snake_case) | Fix (camelCase) |
|---------------------|-----------------|
| `{ project_id: projectId }` | `{ projectId: projectId }` or `{ projectId }` |
| `{ task_id: taskId }` | `{ taskId }` |
| `{ terminal_id: terminalId }` | `{ terminalId }` |
| `{ idea_id: ideaId }` | `{ ideaId }` |
| `{ feature_id: featureId }` | `{ featureId }` |
| `{ session_id: sessionId }` | `{ sessionId }` |
| `{ spec_id: specId }` | `{ specId }` |
| `{ no_commit: options?.noCommit }` | `{ noCommit: options?.noCommit }` |
| `{ project_path: projectPath }` | `{ projectPath }` |
| `{ profile_id: profileId }` | `{ profileId }` |
| `{ new_name: newName }` | `{ newName }` |
| `{ issue_number: issueNumber }` | `{ issueNumber }` |
| `{ enable_competitor_analysis }` | `{ enableCompetitorAnalysis }` |

**Steps**:
1. Search for all `invoke(` calls
2. For each call, check if parameters use snake_case
3. Convert snake_case keys to camelCase
4. Use shorthand when variable name matches key (e.g., `{ projectId }` instead of `{ projectId: projectId }`)

**Verification**:
- [ ] TypeScript compiles without errors (`npm run typecheck`)
- [ ] No snake_case keys remain in invoke calls

---

### Phase 2: Fix TypeScript Type Definitions

**Objective**: Update TypeScript interfaces that incorrectly use snake_case properties

**Files to Modify**:
- `ui/src/shared/types/terminal.ts` - Fix `TerminalInfo` interface
- `ui/src/shared/types/project.ts` - Fix `ProjectIndex`, `ServiceInfo` interfaces

**Specific Changes**:

**terminal.ts - TerminalInfo (lines 16-25)**:
```typescript
// BEFORE:
export interface TerminalInfo {
  id: string;
  project_id: string;      // snake_case
  cwd: string;
  title: string;
  cols: number;
  rows: number;
  created_at: number;      // snake_case
  is_active: boolean;      // snake_case
}

// AFTER:
export interface TerminalInfo {
  id: string;
  projectId: string;       // camelCase
  cwd: string;
  title: string;
  cols: number;
  rows: number;
  createdAt: number;       // camelCase
  isActive: boolean;       // camelCase
}
```

**project.ts - ProjectIndex (lines 43-49)**:
```typescript
// BEFORE:
export interface ProjectIndex {
  project_root: string;
  project_type: 'single' | 'monorepo';
  // ...
}

// AFTER:
export interface ProjectIndex {
  projectRoot: string;
  projectType: 'single' | 'monorepo';
  // ...
}
```

**project.ts - ServiceInfo (lines 51-96)**:
- `package_manager` → `packageManager`
- `default_port` → `defaultPort`
- `entry_point` → `entryPoint`
- `key_directories` → `keyDirectories`
- `dev_dependencies` → `devDependencies`
- `e2e_testing` → `e2eTesting`
- `test_directory` → `testDirectory`
- `task_queue` → `taskQueue`
- `state_management` → `stateManagement`
- `build_tool` → `buildTool`
- `detected_count` → `detectedCount`
- `total_routes` → `totalRoutes`
- `requires_auth` → `requiresAuth`
- `total_models` → `totalModels`
- `model_names` → `modelNames`

**Steps**:
1. Update each interface property to camelCase
2. Find all usages of these properties in the codebase
3. Update all usages to match new camelCase names

**Verification**:
- [ ] TypeScript compiles without errors
- [ ] No snake_case property names in type definitions (except enum values)

---

### Phase 3: Fix Rust Backend Structs Missing camelCase

**Objective**: Add `#[serde(rename_all = "camelCase")]` to Rust structs that are missing it

**Files to Modify**:
- `crates/forge-tauri/src/ipc/types.rs`

**Structs Needing camelCase Attribute** (currently missing):
- `WorktreeStatus` (line ~545) - has multi-word fields
- `WorktreeDiscardResult` (line ~789)
- `WorktreeListResult` (line ~820)
- `BranchInfo` (line ~827)
- `StashInfo` (line ~848)
- `PushResult` (line ~861)
- `PullResult` (line ~876)
- `TerminalInfo` (line ~897)
- `TerminalOutput` (line ~918)
- `AppSettings` (line ~933)
- `PartialAppSettings` (line ~1039)
- `ApiSettings` (line ~1201)
- `UiSettings` (line ~1213)
- `Keybinding` (line ~1248)
- `KeybindingsConfig` (line ~1281)
- `ContextSearchResult` (line ~1423)
- `GraphitiErrorEntry` (line ~1511)
- `MergeReport` (line ~601)

**Steps**:
1. For each struct, add `#[serde(rename_all = "camelCase")]` attribute
2. Verify struct has multi-word fields that need conversion
3. If struct has only single-word fields, skip (no conversion needed)

**Verification**:
- [ ] Rust compiles without errors (`cargo check -p forge-tauri`)
- [ ] All frontend-facing structs have camelCase serialization

---

### Phase 4: Update Frontend Code Using Changed Types

**Objective**: Update all frontend code that uses the changed property names

**Files to Search and Modify** (property access patterns):
- Search for `\.project_id`, `\.created_at`, `\.is_active` → change to camelCase
- Search for `\.project_root`, `\.project_type` → change to camelCase
- Search for all ServiceInfo snake_case property accesses

**Steps**:
1. Use grep to find all usages of old snake_case property names
2. Update each usage to camelCase
3. Repeat for each changed property

**Verification**:
- [ ] TypeScript compiles without errors
- [ ] Application runs and functions correctly

---

### Phase 5: Integration Testing

**Objective**: Verify all IPC calls work correctly after changes

**Steps**:
1. Run `cargo tauri dev`
2. Test each major feature area:
   - Project creation and selection
   - Task creation, start, stop
   - Terminal creation and management
   - Worktree operations
   - Settings management
   - Roadmap and ideation features
   - Claude profile management

**Verification**:
- [ ] No console errors about missing properties
- [ ] All IPC calls return expected data
- [ ] Application functions as expected

## Testing Strategy
- TypeScript type checking (`npm run typecheck`)
- Rust compilation (`cargo check -p forge-tauri`)
- Manual testing of each feature area
- Check browser console for runtime errors

## Rollback Plan
- All changes are in source files that can be reverted via git
- `git checkout -- ui/src/lib/tauri-api.ts ui/src/shared/types/ crates/forge-tauri/src/ipc/types.rs`

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Breaking existing functionality | Medium | High | Extensive testing after changes, TypeScript will catch most issues at compile time |
| Missing some snake_case usages | Low | Medium | Use grep to systematically find all usages |
| Rust serialization issues | Low | High | Verify with Rust tests and manual testing |

## Estimated Changes

| File | Approximate Changes |
|------|---------------------|
| `ui/src/lib/tauri-api.ts` | ~50 invoke calls to fix |
| `ui/src/shared/types/terminal.ts` | 3 properties |
| `ui/src/shared/types/project.ts` | ~20 properties |
| `crates/forge-tauri/src/ipc/types.rs` | ~15 structs |
| Various frontend files | Property access updates |

## Open Questions
- Should we create a migration for any persisted data that might use the old field names? (Likely not needed if data is re-serialized from Rust)

---
**USER: Please review this plan. Edit any section directly in this file, then confirm to proceed.**
