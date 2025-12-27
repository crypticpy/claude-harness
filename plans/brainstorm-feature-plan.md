# Implementation Plan: Brainstorm Feature Package Generator

Created: 2025-12-25
Status: PENDING APPROVAL

## Summary

Add a "Brainstorm" feature to the ideation workflow that transforms a user's feature idea into a **complete, dependency-linked package of tasks** ready for the auto-build system. The AI analyzes the feature through multiple dimensions (architecture, UI/UX, security, etc.) and produces a structured set of tasks with:
- Proper **dependency ordering** (infrastructure → core → UI → polish)
- **Phase grouping** for logical organization
- **Auto-build ready specs** with acceptance criteria and technical notes
- **Cohesive package identity** so all tasks stay linked through Roadmap → Kanban → Build

This is essentially a **Feature Architect** that takes a rough idea and produces a buildable sprint.

## Scope

### In Scope
- New "Brainstorm" button in ideation header (next to "Add More")
- Brainstorm modal with feature description input and analysis dimension selection
- **Feature Package data model** - groups of tasks with dependencies and build order
- New Python brainstorm agent that produces multi-task packages
- **Dependency graph generation** - AI determines task order based on technical requirements
- **Package view UI** - see all tasks in a brainstorm result as a cohesive unit
- **Bulk import to Roadmap** - import entire package with dependencies intact
- **Auto-build queue integration** - imported tasks queue in correct dependency order
- Backend IPC plumbing (channels, handlers, API)
- Graphiti integration for context and storing feature packages

### Out of Scope
- Chat-based multi-turn brainstorming (single submission for now)
- Visual dependency graph editor (view only for v1)
- Cross-package dependencies (packages are self-contained)
- Collaborative brainstorming (single user)

## Prerequisites
- Existing ideation workflow functional (✅ fixed in previous session)
- Understanding of IdeationGenerator pattern (✅ verified)
- Graphiti integration available (optional enhancement)

## Parallel Execution Strategy

This feature spans both UI (Electron/React) and backend (Python). Work can be parallelized across these two stacks, with integration happening in Phase 3.

### Workstream Analysis
| Workstream | Agent Type | Files Owned | Dependencies |
|------------|------------|-------------|--------------|
| UI Components | frontend-architect | React components, stores, hooks | Shared types (Phase 1) |
| Python Backend | backend-engineer | Python agents, prompts, runners | Shared IPC contract (Phase 1) |
| Integration | fullstack-architect | IPC handlers, preload API | UI + Python complete |

### File Ownership Matrix
| File Category | Phase 1 (Types) | Phase 2A (UI) | Phase 2B (Python) | Phase 3 (Integration) |
|---------------|-----------------|---------------|-------------------|----------------------|
| shared/types/* | Central | - | - | - |
| shared/constants/* | Central | - | - | - |
| renderer/components/ideation/* | - | UI Agent | - | - |
| renderer/stores/* | - | UI Agent | - | - |
| auto-claude/ideation/* | - | - | Python Agent | - |
| auto-claude/prompts/* | - | - | Python Agent | - |
| main/ipc-handlers/* | - | - | - | Integration Agent |
| preload/api/* | - | - | - | Integration Agent |

## Implementation Phases

### Phase 1: Foundation (Types & Data Model)
**Objective**: Define the FeaturePackage data model and shared types

**Sequential Tasks** (must be done first to establish contracts):

1. **Task 1.1: Create FeaturePackage types**
   - New file: `auto-claude-ui/src/shared/types/package.ts`
   - Contains: `FeaturePackage`, `PackageTask`, `BrainstormConfig`, `PackagePhase`

2. **Task 1.2: Add IPC channels for brainstorm**
   - Files:
     - `auto-claude-ui/src/shared/constants/ipc.ts` - Add BRAINSTORM_* and PACKAGE_* channels
     - `auto-claude-ui/src/shared/types/ipc.ts` - Add BrainstormAPI interface

3. **Task 1.3: Add package ideation type**
   - Files:
     - `auto-claude-ui/src/shared/constants/ideation.ts` - Add `package` type labels/colors
     - `auto-claude-ui/src/renderer/components/ideation/constants.ts` - Update types

**Files to Modify**:
- `auto-claude-ui/src/shared/constants/ideation.ts` - Add package type config
- `auto-claude-ui/src/shared/constants/ipc.ts` - Add IPC channels
- `auto-claude-ui/src/shared/types/ipc.ts` - Add BrainstormAPI
- `auto-claude-ui/src/shared/types/index.ts` - Export new types

**New Files to Create**:
- `auto-claude-ui/src/shared/types/package.ts` - FeaturePackage data model

**Phase Verification**:
- [ ] TypeScript compiles with new types
- [ ] IPC channel constants defined
- [ ] FeaturePackage and PackageTask types match Python output structure

**Phase 1 Review Gate** (MANDATORY):
- [ ] Run `final-review-completeness` agent (Opus model) - verify all types complete, no TODOs
- [ ] Run `principal-code-reviewer` agent (Opus model) - verify type design quality
- [ ] Address ALL issues found by reviewers (no permission needed, just fix them)
- [ ] Re-run reviewers if significant changes were made

---

### Phase 2A: UI Components (Parallel with 2B)
**Objective**: Build the frontend brainstorm and package management UI

**Parallel Tasks** (can run simultaneously):

1. **Task 2A.1: Create BrainstormModal component**
   - Owner: UI Agent
   - New file: `auto-claude-ui/src/renderer/components/ideation/BrainstormModal.tsx`
   - Contains:
     - Feature title input (short name)
     - Feature description textarea (large, multi-line, the main idea)
     - Analysis dimension checkboxes (Architecture, UI/UX, Security, Performance, etc.)
     - Context toggles (include roadmap, include kanban, use Graphiti)
     - Depth selector (Quick overview vs Thorough analysis)
     - Submit/Cancel buttons
     - Progress indicator during generation with phase display

2. **Task 2A.2: Create PackageView component**
   - Owner: UI Agent
   - New file: `auto-claude-ui/src/renderer/components/ideation/PackageView.tsx`
   - Contains:
     - Package header (title, description, stats)
     - Phase accordion/tabs (Infrastructure, Core, UI, etc.)
     - Task list within each phase showing dependencies
     - Visual dependency indicators (arrows or badges showing "depends on X")
     - Build order numbers on each task
     - Bulk action buttons (Approve Package, Import to Roadmap, Import to Kanban)

3. **Task 2A.3: Create PackageTaskCard component**
   - Owner: UI Agent
   - New file: `auto-claude-ui/src/renderer/components/ideation/PackageTaskCard.tsx`
   - Contains:
     - Task title, description preview
     - Complexity/Priority badges
     - Dependency chain indicator (e.g., "→ Depends on: Task A, Task B")
     - Build order badge
     - Phase tag
     - Expand/collapse for full details (acceptance criteria, technical notes)

4. **Task 2A.4: Create package store**
   - Owner: UI Agent
   - New file: `auto-claude-ui/src/renderer/stores/package-store.ts`
   - Contains:
     - `packages: FeaturePackage[]` - All packages for current project
     - `activePackageId: string | null` - Currently viewing
     - `brainstormProgress: BrainstormProgress | null`
     - Actions: `startBrainstorm()`, `approvePackage()`, `importToRoadmap()`, `importToKanban()`
     - Event listeners for brainstorm progress/complete

5. **Task 2A.5: Update IdeationHeader**
   - Owner: UI Agent
   - Modify: `auto-claude-ui/src/renderer/components/ideation/IdeationHeader.tsx`
   - Add: "Brainstorm" button with Sparkles icon (left of "Add More")
   - Add: `onOpenBrainstorm` prop
   - Add: Package count badge if packages exist

**Sequential Tasks**:

6. **Task 2A.6: Wire up Ideation.tsx**
   - Owner: UI Agent
   - Modify: `auto-claude-ui/src/renderer/components/ideation/Ideation.tsx`
   - Add: showBrainstormModal state
   - Add: BrainstormModal rendering
   - Add: PackageView rendering (when viewing a package)
   - Add: Package list/switcher in sidebar or tabs
   - Pass: onOpenBrainstorm to header

7. **Task 2A.7: Update IdeationFilters for packages**
   - Owner: UI Agent
   - Modify: `auto-claude-ui/src/renderer/components/ideation/IdeationFilters.tsx`
   - Add: "Packages" tab to switch between Ideas view and Packages view
   - Add: Package filter/selector

**Files to Modify**:
- `IdeationHeader.tsx` - Add Brainstorm button
- `Ideation.tsx` - Add modal, package view, and navigation
- `IdeationFilters.tsx` - Add Packages tab
- `type-guards.ts` - Add isPackageTask() guard
- `TypeIcon.tsx` - Add Package icon for package type

**New Files to Create**:
- `BrainstormModal.tsx` - Input modal for feature description
- `PackageView.tsx` - View a generated package with all tasks
- `PackageTaskCard.tsx` - Individual task card within package
- `PackageList.tsx` - List of all packages (optional, could be in PackageView)
- `stores/package-store.ts` - Package state management

**Phase Verification**:
- [ ] Brainstorm button appears in header
- [ ] Modal opens with feature title, description, dimension checkboxes
- [ ] Form validates (title required, description required, at least 1 dimension)
- [ ] PackageView renders with phase accordion and task cards
- [ ] Dependency chain visible on task cards
- [ ] Store actions exist (even if backend not connected)

**Phase 2A Review Gate** (MANDATORY):
- [ ] Run `final-review-completeness` agent (Opus model) - verify all UI components complete
- [ ] Run `principal-code-reviewer` agent (Opus model) - verify component quality, accessibility, patterns
- [ ] Address ALL issues found by reviewers (no permission needed, just fix them)
- [ ] Re-run reviewers if significant changes were made

---

### Phase 2B: Python Backend (Parallel with 2A)
**Objective**: Build the Python Feature Architect agent that produces dependency-linked task packages

**Parallel Tasks**:

1. **Task 2B.1: Create feature architect prompt**
   - Owner: Python Agent
   - New file: `auto-claude/prompts/feature_architect.md`
   - Contains:
     - Role: You are a Feature Architect that breaks down ideas into buildable tasks
     - Instructions for analyzing a user-provided feature idea
     - How to incorporate context (roadmap, kanban, Graphiti memory)
     - **Phase decomposition rules** (Infrastructure → Core → UI → Polish)
     - **Dependency determination** - how to identify what depends on what
     - **Output structure** for FeaturePackage with multiple PackageTasks
     - Each task must include: acceptance criteria, technical notes, complexity, dependencies

2. **Task 2B.2: Create dimension analyzer prompts**
   - Owner: Python Agent
   - New files: One prompt per analysis dimension
     - `auto-claude/prompts/dimension_architecture.md` - System design, data models, APIs
     - `auto-claude/prompts/dimension_uiux.md` - User flows, components, interactions
     - `auto-claude/prompts/dimension_security.md` - Auth, validation, vulnerabilities
     - `auto-claude/prompts/dimension_performance.md` - Caching, optimization, scaling
     - `auto-claude/prompts/dimension_testing.md` - Test strategy, coverage requirements
   - Each outputs tasks specific to that dimension with proper dependencies

3. **Task 2B.3: Create package orchestrator**
   - Owner: Python Agent
   - New file: `auto-claude/ideation/package_builder.py`
   - Contains:
     - `FeaturePackageBuilder` class
     - Loads context (project_index, roadmap, kanban, Graphiti)
     - Phase 1: Runs Feature Architect agent for overall decomposition
     - Phase 2: Runs dimension analyzers in parallel for selected dimensions
     - Phase 3: Merges tasks, resolves cross-dimension dependencies
     - Phase 4: Computes build order via topological sort
     - Phase 5: Validates package structure (no circular deps, all refs valid)

4. **Task 2B.4: Create dependency resolver**
   - Owner: Python Agent
   - New file: `auto-claude/ideation/dependency_resolver.py`
   - Contains:
     - `resolve_dependencies(tasks)` - topological sort for build order
     - `detect_cycles(tasks)` - find circular dependencies
     - `compute_parallel_groups(tasks)` - identify tasks that can run together
     - `validate_references(tasks)` - ensure all dependsOn IDs exist

5. **Task 2B.5: Create brainstorm runner (CLI entry point)**
   - Owner: Python Agent
   - New file: `auto-claude/runners/brainstorm_runner.py`
   - Contains:
     - CLI argument parsing:
       - `--project` - project path
       - `--title` - feature title
       - `--description` - feature description (or --description-file)
       - `--dimensions` - comma-separated analysis dimensions
       - `--depth` - quick or thorough
       - `--use-graphiti` - enable Graphiti context
     - Progress markers for streaming:
       - `BRAINSTORM_PHASE:analyzing` / `decomposing` / `dimension:X` / `resolving` / `validating`
       - `BRAINSTORM_PROGRESS:50:Analyzing security requirements`
     - Completion marker: `BRAINSTORM_COMPLETE:task_count`
     - Writes output to `feature_package.json`

6. **Task 2B.6: Add Graphiti integration for packages**
   - Owner: Python Agent
   - Modify: `auto-claude/ideation/analyzer.py` (or new module)
   - Add: `get_feature_context(feature_description)` - retrieves relevant past work
   - Add: `store_feature_package(package)` - stores package for future reference
   - Add: `get_similar_features()` - find similar past brainstorms

**Sequential Task**:

7. **Task 2B.7: Test brainstorm runner CLI**
   - Owner: Python Agent
   - Verify: Can run from command line
   - Verify: Outputs valid FeaturePackage JSON
   - Verify: Dependencies are correctly ordered
   - Verify: Progress markers work
   - Verify: Handles edge cases (no dependencies, single task, deep chain)

**Files to Modify**:
- `auto-claude/ideation/__init__.py` - Export package builder classes
- `auto-claude/ideation/analyzer.py` - Add feature context functions

**New Files to Create**:
- `auto-claude/prompts/feature_architect.md` - Main decomposition prompt
- `auto-claude/prompts/dimension_*.md` - Dimension-specific prompts (5 files)
- `auto-claude/ideation/package_builder.py` - Package orchestrator
- `auto-claude/ideation/dependency_resolver.py` - Dependency ordering
- `auto-claude/runners/brainstorm_runner.py` - CLI entry point

**Phase Verification**:
- [ ] `python runners/brainstorm_runner.py --help` works
- [ ] Can run with test input and get valid FeaturePackage JSON
- [ ] Package contains multiple tasks with correct dependencies
- [ ] Build order is correctly computed (topological sort)
- [ ] Progress markers appear in stdout
- [ ] No circular dependencies in output
- [ ] All task references are valid

**Phase 2B Review Gate** (MANDATORY):
- [ ] Run `final-review-completeness` agent (Opus model) - verify all Python modules complete
- [ ] Run `principal-code-reviewer` agent (Opus model) - verify code quality, error handling, async patterns
- [ ] Address ALL issues found by reviewers (no permission needed, just fix them)
- [ ] Re-run reviewers if significant changes were made

---

### Phase 3: Integration (IPC, Preload & Import Flows)
**Objective**: Connect UI to Python backend and implement Roadmap/Kanban import flows

**Sequential Tasks** (dependencies between each):

1. **Task 3.1: Create brainstorm IPC handlers**
   - Owner: Integration Agent
   - New file: `auto-claude-ui/src/main/ipc-handlers/brainstorm-handlers.ts`
   - Contains:
     - Handler for `BRAINSTORM_START` - spawns Python process
     - Handler for `BRAINSTORM_STOP` - kills running process
     - Event forwarding for progress/phase/complete/error
   - Modify: `auto-claude-ui/src/main/agent/agent-queue.ts`
     - Add: `startBrainstorm()` method
     - Add: `spawnBrainstormProcess()` method
     - Add: `stopBrainstorm()` method

2. **Task 3.2: Create package management IPC handlers**
   - Owner: Integration Agent
   - New file: `auto-claude-ui/src/main/ipc-handlers/package-handlers.ts`
   - Contains:
     - `PACKAGE_GET` - Load package by ID
     - `PACKAGE_LIST` - List all packages for project
     - `PACKAGE_APPROVE` - Mark package as approved
     - `PACKAGE_DELETE` - Delete a package
     - `PACKAGE_UPDATE_TASK` - Edit a task within package

3. **Task 3.3: Create import flow handlers**
   - Owner: Integration Agent
   - New file: `auto-claude-ui/src/main/ipc-handlers/package-import-handlers.ts`
   - Contains:
     - `PACKAGE_IMPORT_ROADMAP` - Import package tasks to Roadmap
       - Creates roadmap items with proper dependencies
       - Tags all items with package ID
       - Preserves build order
     - `PACKAGE_IMPORT_KANBAN` - Import package tasks to Kanban
       - Creates kanban tasks with dependencies
       - Queues in auto-build queue respecting dependency order
       - Tags all tasks with package ID
     - `PACKAGE_IMPORT_DIRECT` - Import directly to Kanban (skip roadmap)

4. **Task 3.4: Register all handlers**
   - Owner: Integration Agent
   - Modify: `auto-claude-ui/src/main/ipc-handlers/index.ts`
   - Add: Import and register brainstorm, package, and import handlers

5. **Task 3.5: Add preload API for brainstorm**
   - Owner: Integration Agent
   - New file: `auto-claude-ui/src/preload/api/modules/brainstorm-api.ts`
   - Contains:
     - `startBrainstorm(projectId, config)` method
     - `stopBrainstorm(projectId)` method
     - `onBrainstormProgress(callback)` listener
     - `onBrainstormPhase(callback)` listener
     - `onBrainstormComplete(callback)` listener
     - `onBrainstormError(callback)` listener

6. **Task 3.6: Add preload API for packages**
   - Owner: Integration Agent
   - New file: `auto-claude-ui/src/preload/api/modules/package-api.ts`
   - Contains:
     - `getPackage(packageId)` method
     - `listPackages(projectId)` method
     - `approvePackage(packageId)` method
     - `deletePackage(packageId)` method
     - `updatePackageTask(packageId, taskId, updates)` method
     - `importToRoadmap(packageId)` method
     - `importToKanban(packageId, options)` method
   - Modify: `auto-claude-ui/src/shared/types/ipc.ts`
     - Add: BrainstormAPI and PackageAPI to ElectronAPI interface

7. **Task 3.7: Update auto-build queue for package awareness**
   - Owner: Integration Agent
   - Modify: `auto-claude-ui/src/main/agent/agent-queue.ts` (or queue manager)
   - Add: Dependency-aware queuing for package tasks
   - Add: Block task execution if dependencies not complete
   - Add: Package tag filtering
   - Ensure: Tasks from same package maintain correct order

8. **Task 3.8: Connect stores to backend**
   - Owner: Integration Agent
   - Modify: `package-store.ts`
     - Connect all actions to IPC calls
     - Set up event listeners for brainstorm progress
   - Modify: `roadmap-store.ts` (if exists)
     - Add: `importPackage()` action
   - Modify: `task-store.ts`
     - Add: `importPackageTasks()` action
     - Add: Package-aware queue position assignment

9. **Task 3.9: Wire UI to stores**
   - Owner: Integration Agent
   - Modify: `BrainstormModal.tsx` - Submit triggers `startBrainstorm()`
   - Modify: `PackageView.tsx` - Import buttons trigger store actions
   - Modify: `PackageTaskCard.tsx` - Edit triggers `updatePackageTask()`

**Files to Modify**:
- `main/ipc-handlers/index.ts` - Register all new handlers
- `main/agent/agent-queue.ts` - Add brainstorm spawn and queue logic
- `shared/types/ipc.ts` - Add to ElectronAPI
- `renderer/stores/package-store.ts` - Connect to backend
- `BrainstormModal.tsx`, `PackageView.tsx`, `PackageTaskCard.tsx` - Wire to stores

**New Files to Create**:
- `main/ipc-handlers/brainstorm-handlers.ts` - Brainstorm IPC
- `main/ipc-handlers/package-handlers.ts` - Package CRUD IPC
- `main/ipc-handlers/package-import-handlers.ts` - Import flow IPC
- `preload/api/modules/brainstorm-api.ts` - Brainstorm preload API
- `preload/api/modules/package-api.ts` - Package preload API

**Phase Verification**:
- [ ] Modal submit triggers Python process
- [ ] Progress events flow to UI with phase indicators
- [ ] Complete event adds package to store
- [ ] Package appears in Packages view with all tasks
- [ ] Can view package details and individual task details
- [ ] Can edit task within package
- [ ] Import to Roadmap creates linked roadmap items
- [ ] Import to Kanban creates tasks in correct queue order
- [ ] Auto-build respects dependency order (blocked tasks don't start)
- [ ] All tasks tagged with package ID for filtering

**Phase 3 Review Gate** (MANDATORY):
- [ ] Run `final-review-completeness` agent (Opus model) - verify all IPC handlers, APIs complete
- [ ] Run `principal-code-reviewer` agent (Opus model) - verify integration quality, security, error handling
- [ ] Address ALL issues found by reviewers (no permission needed, just fix them)
- [ ] Re-run reviewers if significant changes were made

---

### Phase 4: Polish, UX & Edge Cases
**Objective**: Handle errors, add UX polish, package management features

**Parallel Tasks**:

1. **Task 4.1: Error handling & recovery**
   - Add: Error states in modal with retry option
   - Add: Cancel in-progress brainstorm
   - Add: Partial recovery (if some dimensions fail, keep successful ones)
   - Add: Circular dependency detection with user-friendly error message

2. **Task 4.2: Progress UX**
   - Add: Multi-step progress bar showing phases
   - Add: Current phase display with dimension being analyzed
   - Add: Estimated time remaining
   - Add: Task count preview as they're generated

3. **Task 4.3: Package management features**
   - Add: Edit package title/description
   - Add: Remove tasks from package
   - Add: Re-order tasks within phase (manual override)
   - Add: Duplicate package for iteration
   - Add: Package history/versioning (optional)

4. **Task 4.4: Visual dependency graph (optional enhancement)**
   - Add: Simple dependency tree visualization
   - Show: Critical path highlighted
   - Show: Parallel groups indication

5. **Task 4.5: Filter and search in Roadmap/Kanban by package**
   - Add: Package filter dropdown in Roadmap view
   - Add: Package filter dropdown in Kanban view
   - Add: "Show only package X" quick filter
   - Add: Package badge on task cards

6. **Task 4.6: Package status tracking**
   - Add: Package progress indicator (X of Y tasks complete)
   - Add: Automatic status update when all tasks complete
   - Add: Package completion notification

**Phase Verification**:
- [ ] Error states display correctly with recovery options
- [ ] Can cancel in-progress brainstorm
- [ ] Can filter Roadmap/Kanban by package
- [ ] Package progress shows correctly
- [ ] Dependency graph renders (if implemented)
- [ ] All edge cases handled

**Phase 4 Review Gate** (MANDATORY):
- [ ] Run `final-review-completeness` agent (Opus model) - verify all polish items complete
- [ ] Run `principal-code-reviewer` agent (Opus model) - verify UX quality, accessibility, edge cases
- [ ] Address ALL issues found by reviewers (no permission needed, just fix them)
- [ ] Re-run reviewers if significant changes were made

---

## Final Deliverable Review (COMPREHENSIVE)

**MANDATORY**: After ALL phases complete, run a comprehensive final review on the ENTIRE deliverable:

### Final Review Process:

1. **Run `final-review-completeness` agent (Opus model)**
   - Full codebase scan for incomplete items across ALL modified files
   - Check for: TODOs, FIXMEs, placeholders, mock data, incomplete implementations
   - Verify: All acceptance criteria from each phase are met
   - Verify: No broken imports, missing exports, or undefined references

2. **Run `principal-code-reviewer` agent (Opus model)**
   - Comprehensive quality assessment of entire feature
   - Check: Code patterns, security, performance, accessibility
   - Check: Consistent naming, proper error handling, type safety
   - Check: Integration points between UI, IPC, and Python backend

3. **Address ALL Issues Found**
   - Fix every issue identified by reviewers (no permission needed)
   - Prioritize: Critical → High → Medium → Low
   - Document any intentional deferrals with justification

4. **Re-run Both Reviewers**
   - After fixing issues, run both agents again
   - Repeat until both agents return clean reports
   - Only proceed to "complete" when no issues remain

### Final Checklist:
- [ ] `final-review-completeness` returns clean (Opus)
- [ ] `principal-code-reviewer` returns clean (Opus)
- [ ] All TypeScript compiles without errors
- [ ] All Python tests pass
- [ ] End-to-end flow works: Brainstorm → Package → Roadmap → Kanban → Auto-build
- [ ] No console errors in browser
- [ ] No unhandled exceptions in main process

## Testing Strategy

**Unit Tests**:
- Python: Test brainstorm orchestrator with mock Claude client
- TypeScript: Test store actions, type guards

**Integration Tests**:
- IPC round-trip: UI → Main → Python → Main → UI
- Graphiti integration (if enabled)

**Manual Testing**:
1. Open ideation → Click "Brainstorm" → Verify modal opens
2. Enter feature description → Select dimensions → Submit
3. Verify progress updates appear
4. Verify idea appears in list with "Custom" type
5. Verify idea details show all analysis sections
6. Convert to task → Verify task structure

## Rollback Plan

1. **UI Changes**: Revert component additions, remove brainstorm button
2. **Python Changes**: Remove new files (brainstorm.py, runner, prompt)
3. **IPC Changes**: Remove handlers and API methods
4. **Types**: Remove BrainstormIdea and related constants

All changes are additive, so rollback is straightforward deletion.

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Python process spawn fails | Low | High | Reuse existing ideation spawn pattern |
| Graphiti not available | Med | Low | Make Graphiti optional, graceful fallback |
| Long brainstorm generation time | Med | Med | Add timeout, progress indicators, cancel button |
| File conflict between agents | Low | High | Clear file ownership matrix above |
| Output format mismatch | Med | Med | Define shared types in Phase 1 first |

## User Workflow (End-to-End)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           BRAINSTORM WORKFLOW                               │
└─────────────────────────────────────────────────────────────────────────────┘

1. USER INITIATES BRAINSTORM
   ┌──────────────────────────────────────────────────────────────────────────┐
   │  Ideation View                                                           │
   │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐                        │
   │  │✨Brainstorm│ │ Add More│ │ Config  │ │ Refresh │                        │
   │  └─────────┘ └─────────┘ └─────────┘ └─────────┘                        │
   │       ↓                                                                  │
   │  ┌────────────────────────────────────────────────────────────────────┐ │
   │  │ BRAINSTORM MODAL                                                    │ │
   │  │                                                                     │ │
   │  │  Feature Title: [User Authentication System______________]         │ │
   │  │                                                                     │ │
   │  │  Describe your feature idea:                                       │ │
   │  │  ┌───────────────────────────────────────────────────────────────┐ │ │
   │  │  │ I want to add a complete authentication system with login,   │ │ │
   │  │  │ signup, password reset, and OAuth providers. Should support  │ │ │
   │  │  │ role-based permissions for admin vs regular users...         │ │ │
   │  │  └───────────────────────────────────────────────────────────────┘ │ │
   │  │                                                                     │ │
   │  │  Analysis Dimensions:                                              │ │
   │  │  [✓] Architecture    [✓] Security    [✓] UI/UX                    │ │
   │  │  [ ] Performance     [✓] Testing     [ ] Documentation            │ │
   │  │                                                                     │ │
   │  │  Context:  [✓] Include Roadmap  [✓] Include Kanban  [✓] Graphiti │ │
   │  │  Depth:    (○) Quick  (●) Thorough                                │ │
   │  │                                                                     │ │
   │  │                              [Cancel] [✨ Generate Feature Package] │ │
   │  └────────────────────────────────────────────────────────────────────┘ │
   └──────────────────────────────────────────────────────────────────────────┘

2. AI GENERATES PACKAGE (Progress Shown)
   ┌──────────────────────────────────────────────────────────────────────────┐
   │  Generating Feature Package...                                           │
   │  ════════════════════════════════════════░░░░░░░░░░  65%                │
   │                                                                          │
   │  Phase: Analyzing Security Requirements                                  │
   │  ✓ Architecture decomposition complete (4 tasks)                        │
   │  ✓ UI/UX components identified (3 tasks)                                │
   │  → Security analysis in progress...                                      │
   │  ○ Testing strategy pending                                              │
   │                                                                          │
   │  [Cancel]                                                                │
   └──────────────────────────────────────────────────────────────────────────┘

3. PACKAGE GENERATED - USER REVIEWS
   ┌──────────────────────────────────────────────────────────────────────────┐
   │  📦 User Authentication System                                           │
   │  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   │
   │  12 Tasks  •  4 Phases  •  Est. 2-3 weeks  •  Status: Draft             │
   │                                                                          │
   │  [✓ Approve Package]  [📋 Import to Roadmap]  [🚀 Import to Kanban]     │
   │  ─────────────────────────────────────────────────────────────────────── │
   │                                                                          │
   │  ▼ Phase 1: Infrastructure (3 tasks)                                     │
   │    ┌────────────────────────────────────────────────────────────────┐   │
   │    │ #1 │ Set up authentication database schema                      │   │
   │    │    │ Complexity: Medium  •  No dependencies                     │   │
   │    └────────────────────────────────────────────────────────────────┘   │
   │    ┌────────────────────────────────────────────────────────────────┐   │
   │    │ #2 │ Implement JWT token service                                │   │
   │    │    │ Complexity: Medium  •  Depends on: #1                      │   │
   │    └────────────────────────────────────────────────────────────────┘   │
   │    ┌────────────────────────────────────────────────────────────────┐   │
   │    │ #3 │ Set up OAuth provider integrations                         │   │
   │    │    │ Complexity: Large  •  Depends on: #1, #2                   │   │
   │    └────────────────────────────────────────────────────────────────┘   │
   │                                                                          │
   │  ▶ Phase 2: Core API (4 tasks)                                           │
   │  ▶ Phase 3: UI Components (3 tasks)                                      │
   │  ▶ Phase 4: Testing & Polish (2 tasks)                                   │
   └──────────────────────────────────────────────────────────────────────────┘

4. USER IMPORTS TO ROADMAP (Optional)
   ┌──────────────────────────────────────────────────────────────────────────┐
   │  ROADMAP VIEW                                                            │
   │  ─────────────────────────────────────────────────────────────────────── │
   │  Filter: [All ▼]  [📦 User Auth Package ▼]                              │
   │                                                                          │
   │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                   │
   │  │ Auth Schema  │→ │ JWT Service  │→ │ OAuth Setup  │→ ...              │
   │  │ 📦 pkg-auth  │  │ 📦 pkg-auth  │  │ 📦 pkg-auth  │                   │
   │  └──────────────┘  └──────────────┘  └──────────────┘                   │
   │                                                                          │
   │  All 12 tasks linked with dependencies and tagged with package ID       │
   └──────────────────────────────────────────────────────────────────────────┘

5. USER IMPORTS TO KANBAN (From Roadmap or Direct)
   ┌──────────────────────────────────────────────────────────────────────────┐
   │  KANBAN VIEW                                                             │
   │  ─────────────────────────────────────────────────────────────────────── │
   │  Auto-Build Queue:                                                       │
   │  ┌───────────────────────────────────────────────────────────────────┐  │
   │  │  Position │ Task                        │ Status   │ Blocked By   │  │
   │  │  1        │ Auth Schema (#pkg-auth-1)   │ Ready    │ -            │  │
   │  │  2        │ JWT Service (#pkg-auth-2)   │ Blocked  │ #1           │  │
   │  │  3        │ OAuth Setup (#pkg-auth-3)   │ Blocked  │ #1, #2       │  │
   │  │  4        │ Login API (#pkg-auth-4)     │ Blocked  │ #2, #3       │  │
   │  │  ...      │ ...                         │ ...      │ ...          │  │
   │  └───────────────────────────────────────────────────────────────────┘  │
   │                                                                          │
   │  Auto-build starts #1, then #2 when #1 completes, etc.                  │
   └──────────────────────────────────────────────────────────────────────────┘

6. AUTO-BUILD EXECUTES IN ORDER
   - Task #1 builds → completes → Task #2 unblocks
   - Task #2 builds → completes → Tasks #3, #4 unblock
   - Parallel tasks in same phase can run together if no dependencies
   - Package progress tracked: "3/12 tasks complete"
```

## Open Questions

1. **Multi-turn refinement?** - Defer to v2; for now, single submission generates package
2. **Package editing?** - Can user add/remove tasks from package after generation?
   - Recommendation: Yes, allow editing before import
3. **Cross-package dependencies?** - Can tasks in one package depend on another package?
   - Recommendation: Not in v1; packages are self-contained
4. **Partial import?** - Can user import only some tasks from a package?
   - Recommendation: Yes, allow selective import with dependency warnings
5. **Package versioning?** - Track iterations of same feature package?
   - Recommendation: Defer to v2; for now, each brainstorm creates new package

---

## Data Structures (Reference)

### BrainstormConfig
```typescript
interface BrainstormConfig {
  featureTitle: string;         // Short name for the feature
  description: string;          // User's feature idea (detailed)
  dimensions: IdeationType[];   // Which analysis types to run
  includeRoadmapContext: boolean;
  includeKanbanContext: boolean;
  useGraphiti: boolean;         // Read/write to Graphiti
  depth?: 'quick' | 'thorough'; // Analysis depth
}
```

### FeaturePackage (the main output)
```typescript
interface FeaturePackage {
  id: string;                    // e.g., "pkg-20251225-auth-system"
  title: string;                 // User's feature name
  description: string;           // Original brainstorm description
  projectId: string;

  // The generated tasks (ordered by buildOrder)
  tasks: PackageTask[];

  // Phases for organization (e.g., "Infrastructure", "Core", "UI", "Polish")
  phases: {
    id: string;
    name: string;
    description: string;
    taskIds: string[];
  }[];

  // Metadata
  status: 'draft' | 'approved' | 'in_progress' | 'completed';
  createdAt: string;
  approvedAt?: string;
  analysisConfig: BrainstormConfig;

  // Summary stats
  totalTasks: number;
  estimatedTotalEffort: string;  // "2-3 weeks", etc.
  dependencyDepth: number;       // Max depth of dependency chain

  // For tracking through the system
  importedToRoadmap: boolean;
  roadmapIds?: string[];         // IDs of roadmap items created
  importedToKanban: boolean;
  kanbanTaskIds?: string[];      // IDs of kanban tasks created
}
```

### PackageTask (individual task within a package)
```typescript
interface PackageTask {
  id: string;                    // Local ID within package
  packageId: string;             // Links back to parent package

  // === Task content (matches what auto-build expects) ===
  title: string;
  description: string;           // Detailed spec
  category: TaskCategory;        // feature, bug, refactor, etc.
  complexity: Complexity;        // trivial, small, medium, large, complex
  priority: Priority;            // low, medium, high, critical

  // === Dependencies (key for build order) ===
  dependsOn: string[];           // IDs of tasks THIS task depends on
  dependedOnBy: string[];        // IDs of tasks that depend on THIS

  // === Analysis context ===
  analysisType: IdeationType;    // Which dimension generated this task
  rationale: string;             // Why this task is needed
  phase: string;                 // Which phase this belongs to

  // === Auto-build ready fields ===
  acceptanceCriteria: string[];  // Clear success conditions
  technicalNotes: string;        // Implementation hints
  affectedFiles?: string[];      // Files likely to be modified
  testingNotes?: string;         // How to verify

  // === Ordering ===
  buildOrder: number;            // Computed from dependencies (1 = first)
  canParallelize: boolean;       // True if no blocking dependencies

  // === Status tracking ===
  status: 'pending' | 'in_roadmap' | 'in_kanban' | 'building' | 'completed';
}
```

### Package Tag Convention
All tasks from a package share a tag for filtering/grouping:
```typescript
// Tag format: "package:{packageId}"
// Example: "package:pkg-20251225-auth-system"

// This allows:
// - Filtering Roadmap/Kanban by package
// - Visual grouping in UI
// - Dependency validation within package
```

### Dependency Resolution for Auto-Build Queue
```typescript
// When importing to Kanban, the system:
// 1. Reads all tasks in the package
// 2. Topologically sorts by dependencies
// 3. Assigns queue positions respecting dependencies
// 4. Tasks with no dependencies can run in parallel

interface QueuedPackageTask extends Task {
  queuePosition: number;         // Position in auto-build queue
  blockedBy: string[];           // Task IDs that must complete first
  parallelGroup?: number;        // Tasks in same group can run together
}
```

---

**USER: Please review this plan. Edit any section directly, then confirm to proceed.**
